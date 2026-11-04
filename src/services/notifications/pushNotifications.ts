/**
 * Push Notifications service using Expo Notifications.
 *
 * Prerequisites:
 *   npx expo install expo-notifications expo-device expo-constants
 *
 * Also add to app.json plugins:
 *   "expo-notifications"
 *
 * For production Android you need a Firebase project + google-services.json.
 * For iOS you need push certificates / APNs key configured in Expo.
 */

import { Platform } from 'react-native';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import { supabase } from '../supabase/client';

// Show notifications even when the app is in the foreground
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

export type PushPlatform = 'ios' | 'android' | 'web';

/**
 * Request permission and return an Expo push token (or null).
 */
export async function registerForPushNotificationsAsync(): Promise<string | null> {
  if (!Device.isDevice) {
    console.log('[Push] Must use a physical device for push notifications');
    return null;
  }

  const { status: existing } = await Notifications.getPermissionsAsync();
  let finalStatus = existing;

  if (existing !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }

  if (finalStatus !== 'granted') {
    console.log('[Push] Permission not granted');
    return null;
  }

  // Android notification channel
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'default',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#6B7C5C',
    });
  }

  try {
    const projectId =
      Constants.expoConfig?.extra?.eas?.projectId ??
      Constants.easConfig?.projectId;

    const tokenData = await Notifications.getExpoPushTokenAsync(
      projectId ? { projectId } : undefined
    );
    return tokenData.data;
  } catch (e) {
    console.warn('[Push] Failed to get Expo push token:', e);
    return null;
  }
}

/**
 * Save / upsert the device token for the given ClinicConnect user id
 * (public.users.id  not auth.uid()).
 */
export async function saveDeviceToken(
  userId: string,
  token: string,
  platform?: PushPlatform
): Promise<void> {
  const plat: PushPlatform =
    platform ??
    (Platform.OS === 'ios' ? 'ios' : Platform.OS === 'android' ? 'android' : 'web');

  const { error } = await supabase.from('device_tokens').upsert(
    {
      user_id: userId,
      token,
      platform: plat,
      is_active: true,
      last_used_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id,token' }
  );

  if (error) {
    console.warn('[Push] Failed to save device token:', error.message);
  }
}

/**
 * Mark token inactive (e.g. on logout).
 */
export async function deactivateDeviceToken(token: string): Promise<void> {
  await supabase
    .from('device_tokens')
    .update({ is_active: false, updated_at: new Date().toISOString() })
    .eq('token', token);
}

/**
 * Convenience: register + persist token for the current user.
 * Call after successful login when you have public.users.id.
 */
export async function setupPushForUser(userId: string): Promise<string | null> {
  const token = await registerForPushNotificationsAsync();
  if (token) {
    await saveDeviceToken(userId, token);
  }
  return token;
}

/**
 * Schedule a local notification (works offline / without server).
 */
export async function scheduleLocalNotification(opts: {
  title: string;
  body: string;
  data?: Record<string, unknown>;
  secondsFromNow?: number;
}): Promise<string> {
  const id = await Notifications.scheduleNotificationAsync({
    content: {
      title: opts.title,
      body: opts.body,
      data: opts.data ?? {},
      sound: true,
    },
    trigger: opts.secondsFromNow
      ? {
          type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
          seconds: opts.secondsFromNow,
        }
      : null,
  });
  return id;
}

/**
 * Cancel a previously scheduled local notification.
 */
export async function cancelLocalNotification(id: string): Promise<void> {
  await Notifications.cancelScheduledNotificationAsync(id);
}

/**
 * Create an in-app notification row (and optionally trigger push later via Edge Function).
 */
export async function createInAppNotification(opts: {
  userId: string;
  title: string;
  message: string;
  type?:
    | 'appointment_reminder'
    | 'alert'
    | 'general'
    | 'emergency'
    | 'system'
    | 'prescription'
    | 'referral';
  data?: Record<string, unknown>;
}): Promise<void> {
  const { error } = await supabase.from('notifications').insert({
    user_id: opts.userId,
    title: opts.title,
    message: opts.message,
    type: opts.type ?? 'general',
    data: opts.data ?? {},
    is_read: false,
  });
  if (error) console.warn('[Push] Failed to create in-app notification:', error.message);
}

// ============================================================================
// Backend-style push dispatch via Expo Push API + in-app notification mirror
// ============================================================================

const EXPO_PUSH_SEND_URL = 'https://exp.host/--/api/v2/push/send';

export interface PushPayload {
  title: string;
  body: string;
  data?: Record<string, unknown>;
}

interface ExpoPushSendResponse {
  data?: Array<{ id?: string; status?: string }>;
  errors?: unknown[];
  [key: string]: unknown;
}

async function sendToExpoPushToken(to: string, payload: PushPayload): Promise<boolean> {
  try {
    const response = await fetch(EXPO_PUSH_SEND_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [
          {
            to,
            title: payload.title,
            body: payload.body,
            data: payload.data ?? {},
            sound: 'default',
            priority: 'high',
          },
        ],
      }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      console.warn('[Push] Expo push request failed:', response.status, body);
      return false;
    }

    const json = (await response.json()) as ExpoPushSendResponse;
    const results = json.data ?? [];
    const failed =
      results.length > 0 && results.some((r) => !r?.status || r.status === 'error');

    if (failed) {
      console.warn('[Push] Expo push delivery reported failure:', json.errors ?? results);
    }

    return !failed;
  } catch (error) {
    console.warn('[Push] Expo push send error:', error);
    return false;
  }
}

/**
 * Send a push notification to a user through all their active device tokens,
 * then mirror it into the in-app notifications table so it also shows up in
 * the in-app notification center.
 */
export async function sendPushToUser(userId: string, payload: PushPayload): Promise<boolean> {
  const { data: tokens, error } = await supabase
    .from('device_tokens')
    .select('token')
    .eq('user_id', userId)
    .eq('is_active', true);

  if (error) {
    console.warn('[Push] Failed to load device tokens for user:', userId, error.message);
    return false;
  }

  const tokenList = ((tokens ?? []) as Array<{ token: string }>)
    .map((t) => t.token)
    .filter(Boolean) as string[];

  let delivered = false;
  for (const token of tokenList) {
    const ok = await sendToExpoPushToken(token, payload);
    if (ok) delivered = true;
  }

  try {
    await createInAppNotification({
      userId,
      title: payload.title,
      message: payload.body,
      type: (payload.data?.type as 'appointment_reminder' | 'alert' | 'general' | 'emergency' | 'system' | 'prescription' | 'referral') ?? 'general',
      data: payload.data,
    });
  } catch (e) {
    console.warn('[Push] Failed to create in-app notification mirror:', e);
  }

  return delivered;
}

/**
 * Notify a patient using their patients.id (not their user id).
 * Looks up patients.user_id, then sends a push + in-app notification.
 * Never throws: a notification failure must not break the caller's save.
 */
export async function notifyPatient(patientId: string, payload: PushPayload): Promise<boolean> {
  try {
    const { data, error } = await supabase
      .from('patients')
      .select('user_id')
      .eq('id', patientId)
      .maybeSingle();

    if (error || !data?.user_id) {
      console.warn('[Push] Could not resolve patient user for notification:', error?.message);
      return false;
    }

    return await sendPushToUser(data.user_id as string, {
      ...payload,
      data: { ...payload.data, patientId },
    });
  } catch (e) {
    console.warn('[Push] notifyPatient failed:', e);
    return false;
  }
}

/**
 * Notify a staff member using their staff.id (not their user id).
 * Never throws: a notification failure must not break the caller's save.
 */
export async function notifyStaff(staffId: string, payload: PushPayload): Promise<boolean> {
  try {
    const { data, error } = await supabase
      .from('staff')
      .select('user_id')
      .eq('id', staffId)
      .maybeSingle();

    if (error || !data?.user_id) {
      console.warn('[Push] Could not resolve staff user for notification:', error?.message);
      return false;
    }
    return await sendPushToUser(data.user_id as string, payload);
  } catch (e) {
    console.warn('[Push] notifyStaff failed:', e);
    return false;
  }
}

/**
 * Send an emergency alert push to a specific first responder.
 * Includes the alert's priority + location details via the payload data.
 */
export async function sendEmergencyToResponder(
  responderUserId: string,
  payload: PushPayload
): Promise<boolean> {
  const delivered = await sendPushToUser(responderUserId, {
    ...payload,
    data: {
      ...payload.data,
      type: 'emergency',
    },
  });

  if (delivered) {
    console.log('[Push] Sent emergency alert to responder', responderUserId);
  }

  return delivered;
}

export default {
  registerForPushNotificationsAsync,
  saveDeviceToken,
  deactivateDeviceToken,
  setupPushForUser,
  scheduleLocalNotification,
  cancelLocalNotification,
  createInAppNotification,
  sendToExpoPushToken,
  sendPushToUser,
  notifyPatient,
  notifyStaff,
  sendEmergencyToResponder,
};