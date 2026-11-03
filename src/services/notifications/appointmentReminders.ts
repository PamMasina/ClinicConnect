// src/services/notifications/appointmentReminders.ts
//
// Appointment reminder logic:
//  - Patients get reminded based on their chosen preference:
//      'day_before'    -> 24 hours before the appointment
//      '30_min_before' -> 30 minutes before the appointment
//  - Staff (Doctor / Nurse) get ONE morning summary per day,
//    sent at 07:30, only if they have appointments that day.
//
// All sends go through sendPushToUser (native Expo push + in-app mirror).

import { supabase } from '../supabase/client';
import { sendEmergencyToResponder, sendPushToUser } from './pushNotifications';
import { Appointment, Staff } from '../../types';

export const PATIENT_REMINDER_PREFERENCE_DAY_BEFORE = 'day_before';
export const PATIENT_REMINDER_PREFERENCE_30_MINUTES_BEFORE = '30_min_before';

export type PatientReminderPreference = 'day_before' | '30_min_before';

/** Morning summary is sent at 07:30 local device time. */
export const STAFF_MORNING_SUMMARY_HOUR = 7;
export const STAFF_MORNING_SUMMARY_MINUTE = 30;

const pad = (n: number) => n.toString().padStart(2, '0');
const dayKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** Tracks which (staff, day) morning summaries have already been sent. */
const morningSummarySentFor = new Set<string>();


/** Tracks which (appointment, reminder type) patient reminders were already sent. */
const reminderSentFor = new Set<string>();

/**
 * The appointment's date and start time live on the joined `time_slots` row,
 * not on the `appointments` table itself.
 */
function getSlotStart(appt: any): { date: string; time: string } | null {
  const date = appt?.time_slots?.date ?? appt?.appointment_date;
  const time = appt?.time_slots?.start_time ?? appt?.start_time;
  if (!date || !time) return null;
  return { date, time };
}

/** Offset used for the patient reminder, derived from their preference. */
export function getReminderOffsetMs(preference: string | null | undefined): number {
  if (preference === PATIENT_REMINDER_PREFERENCE_30_MINUTES_BEFORE) {
    return 30 * 60 * 1000;
  }
  // Default to a day before when preference is missing/unknown.
  return 24 * 60 * 60 * 1000;
}

/**
 * Compute when the reminder for an appointment should fire.
 * Returns null when the reminder is not yet due (in the future).
 */
export function getReminderSendAt(
  appointmentDateTime: string,
  preference: string | null | undefined,
  now: Date = new Date()
): Date | null {
  const apptMs = new Date(appointmentDateTime).getTime();
  if (Number.isNaN(apptMs)) return null;

  const sendAtMs = apptMs - getReminderOffsetMs(preference);
  const sendAt = new Date(sendAtMs);

  if (sendAtMs > now.getTime()) return null; // in the future -> not due yet
  return sendAt;
}

/**
 * Send the appointment reminder for a single patient appointment,
 * honouring the patient's chosen reminder preference.
 */
export async function sendPatientAppointmentReminder(
  patientUserId: string,
  appointment: Appointment,
  preference: string | null | undefined,
  now: Date = new Date()
): Promise<void> {
  const start = getSlotStart(appointment);
  if (!start) return; // no date/time to work from

  const sendAt = getReminderSendAt(`${start.date}T${start.time}`, preference, now);
  if (!sendAt) return; // reminder not due yet

  const kind = preference ?? 'day_before';

  // Fast in-session guard.
  const sentKey = `${appointment.id}:${kind}`;
  if (reminderSentFor.has(sentKey)) return;
  reminderSentFor.add(sentKey);

  // Durable guard: skip if this reminder was already created in an earlier
  // session or on another device.
  const { data: existing } = await supabase
    .from('notifications')
    .select('id')
    .eq('user_id', patientUserId)
    .eq('type', 'appointment_reminder')
    .contains('data', { appointmentId: appointment.id, reminderKind: kind })
    .limit(1);
  if (existing && existing.length > 0) return;

  const startTime = start.time.slice(0, 5);
  const clinicName = appointment.clinics?.clinic_name ?? 'clinic';
  const serviceName = appointment.services?.service_name ?? 'appointment';

  const delivered = await sendPushToUser(patientUserId, {
    title: 'Appointment reminder',
    body: `You have an appointment at ${clinicName} (${serviceName}) on ${start.date} at ${startTime}.`,
    data: {
      type: 'appointment_reminder',
      appointmentId: appointment.id,
      reminderKind: kind,
    },
  });

  if (delivered) {
    console.log('[Reminders] Sent appointment reminder to patient', patientUserId);
  }
}
/**
 * Send the morning summary to a single staff member.
 * Only sends if the staff member has appointments that day.
 */
export async function sendStaffMorningSummary(
  staff: Staff,
  todaysAppointments: Appointment[],
  now: Date = new Date()
): Promise<void> {
  const summary = buildMorningSummaryMessage(staff, todaysAppointments);

  if (!summary) return; // no appointments that day -> nothing to send

  const key = `${staff.id}:${dayKey(now)}`;
  if (morningSummarySentFor.has(key)) return; // already sent the summary today
  morningSummarySentFor.add(key);

  const delivered = await sendPushToUser(staff.user_id ?? '', {
    title: 'You have appointments today',
    body: summary,
    data: {
      type: 'appointment_reminder',
      staffId: staff.id,
    },
  });

  if (delivered) {
    console.log('[Reminders] Sent morning summary to staff', staff.id);
  }
}

function buildMorningSummaryMessage(
  staff: Staff,
  appointments: Appointment[]
): string | null {
  if (!appointments.length) return null;

  const lines = appointments.map((appt) => {
   const start = getSlotStart(appt);
   const time = start ? start.time.slice(0, 5) : '';
   const clinic = appt.clinics?.clinic_name ?? 'clinic';
   const service = appt.services?.service_name ?? 'appointment';
   return `- ${time ? `At ${time}` : 'Today'}: ${service} at ${clinic}`;
  });

  const firstAppt = appointments[0];
  const patientName =
    firstAppt?.patients?.first_name ?? firstAppt?.patients?.last_name ?? 'A patient';

  return `You have ${appointments.length} appointment${appointments.length > 1 ? 's' : ''} today. Next up: ${patientName}. ${lines.join('\n')}`;
}

/**
 * Send morning summaries for all staff members who have appointments today.
 * `appointments` should already be scoped to today's appointments.
 */
export async function sendMorningSummaries(
  appointments: Appointment[],
  now: Date = new Date()
): Promise<void> {
  if (!appointments.length) return;

  // Group appointments by clinic so each clinic's staff can be summarised.
  const byClinic = new Map<string, Appointment[]>();
  for (const appt of appointments) {
    const clinicId = appt.clinic_id;
    if (!clinicId) continue;
    const list = byClinic.get(clinicId) ?? [];
    list.push(appt);
    byClinic.set(clinicId, list);
  }

  for (const [clinicId, clinicAppointments] of byClinic) {
    const { data: clinicStaff, error } = await supabase
      .from('staff')
      .select('*')
      .eq('clinic_id', clinicId)
      .eq('status', 'active');

    if (error || !clinicStaff?.length) continue;

    for (const staff of clinicStaff as Staff[]) {
      await sendStaffMorningSummary(staff, clinicAppointments, now);
    }
  }
}

/**
 * Send morning summaries for every staff member who has appointments today.
 * Intended to be invoked once per day (e.g. around the morning summary time).
 */
export async function sendTodaysMorningSummaries(
  now: Date = new Date()
): Promise<void> {
  const todaysDate = dayKey(now);

  const { data: appointments, error } = await supabase
    .from('appointments')
    .select(
      '*, patients ( first_name, last_name ), clinics (*), services (*), time_slots!inner ( date, start_time )'
    )
    .in('status', ['booked', 'confirmed', 'completed'])
    .eq('time_slots.date', todaysDate);

  if (error) {
    console.warn('[Reminders] Failed to load todays appointments for summaries:', error.message);
    return;
  }

  await sendMorningSummaries((appointments ?? []) as Appointment[], now);
}

/**
 * Daily sweep: send appointment reminders that are now due.
 * Covers today's and tomorrow's appointments so day-before / 30-min-before
 * reminders fire without relying solely on the booking-time trigger.
 */
export async function sendDueAppointmentReminders(now: Date = new Date()): Promise<void> {
  const todayStr = dayKey(now);
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = dayKey(tomorrow);

  const { data: appointments, error } = await supabase
    .from('appointments')
    .select(
      '*, patients ( user_id, notification_preference ), clinics (*), services (*), time_slots!inner ( date, start_time )'
    )
    .in('status', ['booked', 'confirmed'])
    .gte('time_slots.date', todayStr)
    .lte('time_slots.date', tomorrowStr);

  if (error) {
    console.warn('[Reminders] Failed to load appointments for reminder sweep:', error.message);
    return;
  }

  const nowMs = now.getTime();
  for (const appt of (appointments ?? []) as any[]) {
    const patientUserId = appt?.patients?.user_id;
    const start = getSlotStart(appt);
    const apptStartMs = start ? new Date(`${start.date}T${start.time}`).getTime() : NaN;

    if (!patientUserId) continue;
    if (Number.isNaN(apptStartMs) || apptStartMs <= nowMs) continue; // only upcoming appointments

    const preference = appt?.patients?.notification_preference?.appointment_reminder ?? 'day_before';
    await sendPatientAppointmentReminder(patientUserId, appt, preference, now);
  }
}

/**
 * Send an emergency alert push to the first responder closest to the
 * patient's location. Falls back to sending to the first responder found
 * when no location-based matching is possible.
 */
export async function sendEmergencyToNearestResponder(
  patientUserId: string,
  patientLocation: { latitude?: number; longitude?: number; address?: string } | null,
  priority: string,
  description?: string | null
): Promise<boolean> {
  const { data: responders, error } = await supabase
    .from('staff')
    .select('*')
    .eq('role', 'FirstResponder')
    .eq('status', 'active');

  if (error || !responders?.length) {
    console.warn('[Reminders] Could not load first responders for emergency push');
    return false;
  }

  const nearest = pickNearestResponder(responders as Staff[], patientLocation);

  if (!nearest?.user_id) return false;

  const body = `Emergency (${priority})${description ? ` — ${description}` : ''}. ${
    patientLocation?.address ?? 'Location unavailable'
  }`;

  const delivered = await sendEmergencyToResponder(nearest.user_id, {
    title: 'Emergency alert',
    body,
    data: {
      type: 'emergency',
      priority,
      patientUserId,
    },
  });

  return delivered;
}

interface ResponderWithCoords extends Staff {
  latitude?: number | null;
  longitude?: number | null;
}

function pickNearestResponder(
  responders: Staff[],
  location: { latitude?: number; longitude?: number } | null
): Staff | null {
  const withCoords = responders as ResponderWithCoords[];
  const firstResponder = responders[0] ?? null;

  if (!location?.latitude || !location?.longitude || responders.length === 0) {
    // Fallback: no usable coordinates -> notify the first responder.
    return firstResponder;
  }

  const sorted = [...withCoords].sort((a, b) => {
    const distA = haversineKm(location.latitude!, location.longitude!, a);
    const distB = haversineKm(location.latitude!, location.longitude!, b);
    if (distA === Infinity && distB === Infinity) return 0;
    return distA - distB;
  });

  const nearest = sorted[0];
  if (!nearest?.user_id) return firstResponder;
  return nearest;
}

function haversineKm(
  lat1: number,
  lon1: number,
  target: { latitude?: number | null; longitude?: number | null }
): number {
  const lat2 = target.latitude;
  const lon2 = target.longitude;
  if (lat2 == null || lon2 == null) return Number.POSITIVE_INFINITY;

  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

