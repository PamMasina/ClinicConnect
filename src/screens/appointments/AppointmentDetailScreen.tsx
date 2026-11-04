// src/screens/appointments/AppointmentDetailScreen.tsx
import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Linking,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useRoute, useFocusEffect } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { supabase } from '../../services/supabase/client';
import { useAuth } from '../../context/AuthContext';
import { RootStackParamList } from '../../navigation/types';
import PrescriptionList from '../../components/PrescriptionList';

type NavigationProp = NativeStackNavigationProp<RootStackParamList, 'AppointmentDetail'>;
type RouteProp = import('@react-navigation/native').RouteProp<RootStackParamList, 'AppointmentDetail'>;

// ── Types ───────────────────────────────────────────────────────────
interface ApptRow {
  id: string;
  patient_id: string | null;
  reason_for_visit?: string | null;
  status: string;
  notes?: string | null;
  created_at?: string;
  updated_at?: string;
  clinics?: {
    clinic_name?: string | null;
    location?: string | null;
    address?: string | null;
    phone?: string | null;
    latitude?: number | null;
    longitude?: number | null;
    operating_hours?: string | null;
  } | null;
  services?: {
    service_name?: string | null;
    description?: string | null;
    estimated_duration?: string | null;
    price?: number | null;
  } | null;
  time_slots?: {
    id: string;
    date?: string | null;
    start_time?: string | null;
    end_time?: string | null;
  } | null;
}

interface VisitRecord {
  id: string;
  visit_date: string;
  diagnosis_notes?: string | null;
  doctor_notes?: string | null;
  treatment_plan?: string | null;
  follow_up_date?: string | null;
  vitals?: Record<string, unknown> | null;
}

interface LinkedReferral {
  id: string;
  specialist_type: string;
  specialist_name?: string | null;
  status: string;
  urgency: string;
}

// ── Styling tables ──────────────────────────────────────────────────
const STATUS_STYLE: Record<string, { label: string; bg: string; text: string }> = {
  booked: { label: 'Booked', bg: '#E3F2FD', text: '#1565C0' },
  confirmed: { label: 'Confirmed', bg: '#E8F5E9', text: '#2E7D32' },
  completed: { label: 'Completed', bg: '#F3E5F5', text: '#7B1FA2' },
  cancelled: { label: 'Cancelled', bg: '#FFEBEE', text: '#C62828' },
  no_show: { label: 'No Show', bg: '#FFF3E0', text: '#E65100' },
};

const REFERRAL_STATUS: Record<string, { label: string; bg: string; fg: string }> = {
  pending: { label: 'Awaiting review', bg: '#FFF3E0', fg: '#E65100' },
  accepted: { label: 'Accepted', bg: '#E3F2FD', fg: '#1565C0' },
  scheduled: { label: 'Scheduled', bg: '#E8F5E9', fg: '#2E7D32' },
  completed: { label: 'Completed', bg: '#F3E5F5', fg: '#7B1FA2' },
  cancelled: { label: 'Cancelled', bg: '#FFEBEE', fg: '#C62828' },
};

const TONE: Record<string, { bg: string; fg: string; icon: keyof typeof Ionicons.glyphMap }> = {
  upcoming: { bg: '#EEF4EA', fg: '#3F5A32', icon: 'time-outline' },
  now: { bg: '#E8F5E9', fg: '#2E7D32', icon: 'pulse-outline' },
  muted: { bg: '#F0F0F0', fg: '#666', icon: 'information-circle-outline' },
};

// ── Helpers ─────────────────────────────────────────────────────────
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function statusUi(status: string) {
  return (
    STATUS_STYLE[status] || {
      label: cap((status || 'unknown').replace(/_/g, ' ')),
      bg: '#EEEEEE',
      text: '#555',
    }
  );
}

function parseDate(d?: string | null): Date | null {
  if (!d) return null;
  const x = new Date(d.length === 10 ? `${d}T12:00:00` : d);
  return Number.isNaN(x.getTime()) ? null : x;
}

function fmtLong(d?: string | null): string {
  const x = parseDate(d);
  return x
    ? x.toLocaleDateString('en-ZA', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      })
    : 'Date to be confirmed';
}

function fmtShort(d?: string | null): string {
  const x = parseDate(d);
  return x
    ? x.toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' })
    : '—';
}

function fmtDateTime(d?: string | null): string {
  const x = parseDate(d);
  if (!x) return '—';
  return `${fmtShort(d)} · ${x.toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' })}`;
}

/** Local yyyy-mm-dd for a date or timestamp string. */
function localYmd(d: string): string {
  if (d.length === 10) return d;
  const x = new Date(d);
  if (Number.isNaN(x.getTime())) return d.slice(0, 10);
  const mm = String(x.getMonth() + 1).padStart(2, '0');
  const dd = String(x.getDate()).padStart(2, '0');
  return `${x.getFullYear()}-${mm}-${dd}`;
}

function slotTimes(slot?: ApptRow['time_slots']): { start: Date | null; end: Date | null } {
  if (!slot?.date || !slot.start_time) return { start: null, end: null };
  const start = new Date(`${slot.date}T${slot.start_time.slice(0, 8)}`);
  if (Number.isNaN(start.getTime())) return { start: null, end: null };
  let end = slot.end_time ? new Date(`${slot.date}T${slot.end_time.slice(0, 8)}`) : null;
  if (!end || Number.isNaN(end.getTime())) end = new Date(start.getTime() + 30 * 60000);
  return { start, end };
}

function countdown(
  start: Date,
  end: Date,
  now: Date = new Date()
): { text: string; tone: 'upcoming' | 'now' | 'muted' } {
  if (now >= end) return { text: 'This appointment time has passed', tone: 'muted' };
  if (now >= start) return { text: 'Your appointment is happening now', tone: 'now' };

  const time = start.toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' });
  const mins = Math.round((start.getTime() - now.getTime()) / 60000);
  const startDay = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const days = Math.round((startDay.getTime() - today.getTime()) / 86400000);

  if (days === 0) {
    if (mins < 60) return { text: `Starts in ${mins} min · ${time}`, tone: 'upcoming' };
    return {
      text: `Today at ${time} · in ${Math.floor(mins / 60)} h ${mins % 60} min`,
      tone: 'upcoming',
    };
  }
  if (days === 1) return { text: `Tomorrow at ${time}`, tone: 'upcoming' };
  return { text: `In ${days} days · ${time}`, tone: 'upcoming' };
}

function vitalsText(v: unknown): string {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return '';
  return Object.entries(v as Record<string, unknown>)
    .filter(([, val]) => val !== null && val !== undefined && val !== '')
    .map(([k, val]) => `${cap(k.replace(/_/g, ' '))}: ${String(val)}`)
    .join('   ·   ');
}

function isMissingFunction(error: any): boolean {
  const msg = String(error?.message || '').toLowerCase();
  return (
    error?.code === 'PGRST202' ||
    error?.code === '42883' ||
    msg.includes('could not find the function') ||
    (msg.includes('cancel_appointment') && msg.includes('not'))
  );
}

// ── Small components ────────────────────────────────────────────────
function DetailRow({
  icon,
  label,
  value,
  sub,
  actionLabel,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value: string;
  sub?: string | null;
  actionLabel?: string;
  onPress?: () => void;
}) {
  return (
    <View style={styles.detailRow}>
      <Ionicons name={icon} size={20} color="#6B7C5C" />
      <View style={styles.detailText}>
        <Text style={styles.detailLabel}>{label}</Text>
        <Text style={styles.detailValue}>{value}</Text>
        {sub ? <Text style={styles.detailSub}>{sub}</Text> : null}
        {actionLabel && onPress ? (
          <TouchableOpacity onPress={onPress} hitSlop={8}>
            <Text style={styles.linkText}>{actionLabel}</Text>
          </TouchableOpacity>
        ) : null}
      </View>
    </View>
  );
}

// ── Screen ──────────────────────────────────────────────────────────
export default function AppointmentDetailScreen() {
  const navigation = useNavigation<NavigationProp>();
  const route = useRoute<RouteProp>();
  const { role } = useAuth();
  const { appointmentId } = route.params || ({} as { appointmentId?: string });

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [appointment, setAppointment] = useState<ApptRow | null>(null);
  const [record, setRecord] = useState<VisitRecord | null>(null);
  const [referrals, setReferrals] = useState<LinkedReferral[]>([]);

  const fetchAppointment = useCallback(async () => {
    if (!appointmentId) {
      setLoading(false);
      return;
    }
    try {
      setError(null);
      const { data, error: qErr } = await supabase
        .from('appointments')
        .select(
          `
          id,
          patient_id,
          reason_for_visit,
          status,
          notes,
          created_at,
          updated_at,
          clinics ( clinic_name, location, address, phone, latitude, longitude, operating_hours ),
          services ( service_name, description, estimated_duration, price ),
          time_slots ( id, date, start_time, end_time )
        `
        )
        .eq('id', appointmentId)
        .maybeSingle();

      if (qErr) throw qErr;
      const appt = (data as unknown as ApptRow) || null;
      setAppointment(appt);

      if (!appt) {
        setRecord(null);
        setReferrals([]);
        return;
      }

      // Visit outcome + linked referrals. Both are optional extras.
      const [recRes, refRes] = await Promise.allSettled([
        (async (): Promise<VisitRecord | null> => {
          const byAppt = await supabase
            .from('medical_records')
            .select('id, visit_date, diagnosis_notes, doctor_notes, treatment_plan, follow_up_date, vitals')
            .eq('appointment_id', appt.id)
            .order('created_at', { ascending: false })
            .limit(1);
          if (byAppt.error) throw byAppt.error;
          if (byAppt.data && byAppt.data.length > 0) return byAppt.data[0] as VisitRecord;

          // Records written by doctors are not always linked to the appointment:
          // fall back to this patient's record from the same day.
          const day = appt.time_slots?.date;
          if (!day || !appt.patient_id) return null;
          const byDay = await supabase
            .from('medical_records')
            .select('id, visit_date, diagnosis_notes, doctor_notes, treatment_plan, follow_up_date, vitals')
            .eq('patient_id', appt.patient_id)
            .order('visit_date', { ascending: false })
            .limit(50);
          if (byDay.error) throw byDay.error;
          const match = (byDay.data || []).find(
            (r: any) => r.visit_date && localYmd(String(r.visit_date)) === day
          );
          return (match as VisitRecord) || null;
        })(),
        supabase
          .from('referrals')
          .select('id, specialist_type, specialist_name, status, urgency')
          .eq('appointment_id', appt.id),
      ]);

      setRecord(recRes.status === 'fulfilled' ? recRes.value : null);
      setReferrals(
        refRes.status === 'fulfilled' && !refRes.value.error
          ? ((refRes.value.data || []) as LinkedReferral[])
          : []
      );
    } catch (err: any) {
      console.error('Error loading appointment:', err);
      setError(err?.message || 'Could not load appointment details.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [appointmentId]);

  useFocusEffect(
    useCallback(() => {
      fetchAppointment();
    }, [fetchAppointment])
  );

  const onRefresh = () => {
    setRefreshing(true);
    fetchAppointment();
  };

  // ── Cancel ────────────────────────────────────────────────────────
  const cancelClientSide = async (appt: ApptRow) => {
    const { data: updated, error: upErr } = await supabase
      .from('appointments')
      .update({ status: 'cancelled', updated_at: new Date().toISOString() })
      .eq('id', appt.id)
      .select('id');
    if (upErr) throw upErr;
    if (!updated || updated.length === 0) {
      throw new Error('You do not have permission to cancel this appointment.');
    }

    const slotId = appt.time_slots?.id;
    if (slotId) {
      const { count } = await supabase
        .from('appointments')
        .select('id', { count: 'exact', head: true })
        .eq('time_slot_id', slotId)
        .in('status', ['booked', 'confirmed']);
      const active = count ?? 0;
      await supabase
        .from('time_slots')
        .update({
          booked_count: active,
          is_available: active < 1,
          updated_at: new Date().toISOString(),
        })
        .eq('id', slotId);
    }
  };

  const doCancel = async () => {
    if (!appointment) return;
    setCancelling(true);
    try {
      const { data, error: rpcErr } = await supabase.rpc('cancel_appointment', {
        p_appointment_id: appointment.id,
      });
      if (rpcErr) {
        if (isMissingFunction(rpcErr)) {
          await cancelClientSide(appointment);
        } else {
          throw rpcErr;
        }
      } else if (data && (data as any).ok === false) {
        throw new Error((data as any).message || 'Could not cancel this appointment.');
      }

      Alert.alert('Cancelled', 'Your appointment has been cancelled.', [
        { text: 'OK', onPress: () => navigation.goBack() },
      ]);
    } catch (err: any) {
      Alert.alert('Could not cancel', err?.message || 'Failed to cancel appointment');
      fetchAppointment();
    } finally {
      setCancelling(false);
    }
  };

  const handleCancel = () => {
    Alert.alert(
      'Cancel Appointment',
      'Are you sure you want to cancel this appointment? Your time slot will be released.',
      [
        { text: 'No', style: 'cancel' },
        { text: 'Yes, Cancel', style: 'destructive', onPress: doCancel },
      ]
    );
  };

  // ── Actions ───────────────────────────────────────────────────────
  const callClinic = (phone: string) => {
    Linking.openURL(`tel:${phone.replace(/\s+/g, '')}`).catch(() =>
      Alert.alert('Error', 'Could not open the phone app.')
    );
  };

  const openDirections = (c: NonNullable<ApptRow['clinics']>) => {
    const hasCoords = typeof c.latitude === 'number' && typeof c.longitude === 'number';
    const query = hasCoords
      ? `${c.latitude},${c.longitude}`
      : encodeURIComponent([c.clinic_name, c.address || c.location].filter(Boolean).join(', '));
    Linking.openURL(`https://www.google.com/maps/dir/?api=1&destination=${query}`).catch(() =>
      Alert.alert('Error', 'Could not open maps.')
    );
  };

  // ── Render states ─────────────────────────────────────────────────
  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#6B7C5C" />
          <Text style={styles.loadingText}>Loading appointment…</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (!appointment) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
            <Ionicons name="arrow-back" size={24} color="#333" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Appointment</Text>
          <View style={{ width: 40 }} />
        </View>
        <View style={styles.loadingContainer}>
          <Ionicons
            name={error ? 'cloud-offline-outline' : 'calendar-outline'}
            size={48}
            color="#CCC"
          />
          <Text style={styles.emptyText}>
            {error ? 'Could not load this appointment' : 'Appointment not found'}
          </Text>
          {error ? <Text style={styles.errorDetail}>{error}</Text> : null}
          {error ? (
            <TouchableOpacity style={styles.retryBtn} onPress={() => { setLoading(true); fetchAppointment(); }}>
              <Text style={styles.retryText}>Try again</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      </SafeAreaView>
    );
  }

  const statusCfg = statusUi(appointment.status);
  const clinic = appointment.clinics || null;
  const service = appointment.services || null;
  const slot = appointment.time_slots || null;
  const { start, end } = slotTimes(slot);
  const isActive = appointment.status === 'booked' || appointment.status === 'confirmed';
  const hasPassed = !!end && new Date() >= end;
  const banner = isActive && start && end ? countdown(start, end) : null;
  const tone = banner ? TONE[banner.tone] : null;

  const timeStr = slot?.start_time
    ? `${slot.start_time.slice(0, 5)}${slot.end_time ? ` – ${slot.end_time.slice(0, 5)}` : ''}`
    : 'Time to be confirmed';

  const canCancel = role === 'patient' && isActive && !hasPassed;
  const canRebook = role === 'patient' && !isActive;

  const placeLine = clinic?.address || clinic?.location || null;
  const placeSub =
    clinic?.address && clinic?.location && clinic.address !== clinic.location
      ? clinic.location
      : null;
  const canNavigate =
    !!clinic &&
    ((typeof clinic.latitude === 'number' && typeof clinic.longitude === 'number') ||
      !!placeLine);

  const vitals = record ? vitalsText(record.vitals) : '';
  const hasOutcome =
    !!record &&
    !!(
      record.diagnosis_notes ||
      record.doctor_notes ||
      record.treatment_plan ||
      record.follow_up_date ||
      vitals
    );

  const priceText =
    service?.price === null || service?.price === undefined
      ? null
      : service.price === 0
      ? 'Free'
      : `R${Number(service.price).toFixed(2)}`;

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
          <Ionicons name="arrow-back" size={24} color="#333" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Appointment Details</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={['#6B7C5C']} />
        }
      >
        <View style={styles.topRow}>
          <View style={[styles.statusBadge, { backgroundColor: statusCfg.bg }]}>
            <Text style={[styles.statusText, { color: statusCfg.text }]}>{statusCfg.label}</Text>
          </View>
          <Text style={styles.refCode}>APT-{appointment.id.slice(0, 8).toUpperCase()}</Text>
        </View>

        {banner && tone ? (
          <View style={[styles.banner, { backgroundColor: tone.bg }]}>
            <Ionicons name={tone.icon} size={18} color={tone.fg} />
            <Text style={[styles.bannerText, { color: tone.fg }]}>{banner.text}</Text>
          </View>
        ) : null}

        {error ? <Text style={styles.inlineError}>{error}</Text> : null}

        {/* Main details */}
        <View style={styles.card}>
          <Text style={styles.reason}>
            {appointment.reason_for_visit || service?.service_name || 'Consultation'}
          </Text>

          <DetailRow icon="calendar-outline" label="Date" value={fmtLong(slot?.date)} />
          <DetailRow icon="time-outline" label="Time" value={timeStr} />

          <DetailRow
            icon="business-outline"
            label="Clinic"
            value={clinic?.clinic_name || '—'}
            sub={placeLine}
            actionLabel={canNavigate ? 'Get directions →' : undefined}
            onPress={canNavigate && clinic ? () => openDirections(clinic) : undefined}
          />
          {placeSub ? (
            <Text style={[styles.detailSub, { marginTop: -10, marginBottom: 14, marginLeft: 32 }]}>
              {placeSub}
            </Text>
          ) : null}

          {clinic?.phone ? (
            <DetailRow
              icon="call-outline"
              label="Clinic phone"
              value={clinic.phone}
              actionLabel="Call clinic →"
              onPress={() => callClinic(clinic.phone as string)}
            />
          ) : null}

          {clinic?.operating_hours ? (
            <DetailRow
              icon="storefront-outline"
              label="Clinic hours"
              value={clinic.operating_hours}
            />
          ) : null}
        </View>

        {/* Service */}
        {service?.service_name ? (
          <View style={styles.card}>
            <Text style={styles.cardLabel}>SERVICE</Text>
            <Text style={styles.serviceName}>{service.service_name}</Text>
            {service.description ? (
              <Text style={styles.bodyText}>{service.description}</Text>
            ) : null}
            {service.estimated_duration || priceText ? (
              <View style={styles.chipRow}>
                {service.estimated_duration ? (
                  <View style={styles.infoChip}>
                    <Ionicons name="hourglass-outline" size={14} color="#6B7C5C" />
                    <Text style={styles.infoChipText}>{service.estimated_duration}</Text>
                  </View>
                ) : null}
                {priceText ? (
                  <View style={styles.infoChip}>
                    <Ionicons name="pricetag-outline" size={14} color="#6B7C5C" />
                    <Text style={styles.infoChipText}>{priceText}</Text>
                  </View>
                ) : null}
              </View>
            ) : null}
          </View>
        ) : null}

        {/* Visit outcome */}
        {hasOutcome && record ? (
          <View style={styles.card}>
            <Text style={styles.cardLabel}>VISIT SUMMARY</Text>
            {record.diagnosis_notes ? (
              <>
                <Text style={styles.fieldLabel}>Diagnosis</Text>
                <Text style={styles.bodyText}>{record.diagnosis_notes}</Text>
              </>
            ) : null}
            {record.doctor_notes && record.doctor_notes !== record.diagnosis_notes ? (
              <>
                <Text style={styles.fieldLabel}>Clinical notes</Text>
                <Text style={styles.bodyText}>{record.doctor_notes}</Text>
              </>
            ) : null}
            {record.treatment_plan ? (
              <>
                <Text style={styles.fieldLabel}>Treatment plan</Text>
                <Text style={styles.bodyText}>{record.treatment_plan}</Text>
              </>
            ) : null}
            {vitals ? (
              <>
                <Text style={styles.fieldLabel}>Vitals</Text>
                <Text style={styles.bodyText}>{vitals}</Text>
              </>
            ) : null}
            {record.follow_up_date ? (
              <>
                <Text style={styles.fieldLabel}>Follow-up</Text>
                <Text style={styles.bodyText}>{fmtLong(record.follow_up_date)}</Text>
              </>
            ) : null}
          </View>
        ) : null}

        {/* Linked referrals */}
        {referrals.length > 0 ? (
          <View style={styles.card}>
            <Text style={styles.cardLabel}>SPECIALIST REFERRAL</Text>
            {referrals.map((r, i) => {
              const ui = REFERRAL_STATUS[r.status] || REFERRAL_STATUS.pending;
              return (
                <TouchableOpacity
                  key={r.id}
                  style={[styles.referralRow, i === referrals.length - 1 && { borderBottomWidth: 0 }]}
                  onPress={() => navigation.navigate('Referral', { referralId: r.id })}
                  activeOpacity={0.7}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={styles.referralTitle}>{r.specialist_name || r.specialist_type}</Text>
                    <Text style={styles.detailSub}>
                      {r.specialist_name ? `${r.specialist_type} · ` : ''}
                      {cap(r.urgency)}
                    </Text>
                  </View>
                  <View style={[styles.miniBadge, { backgroundColor: ui.bg }]}>
                    <Text style={[styles.miniBadgeText, { color: ui.fg }]}>{ui.label}</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color="#AAA" style={{ marginLeft: 6 }} />
                </TouchableOpacity>
              );
            })}
          </View>
        ) : null}

        {/* Prescriptions issued at this appointment */}
        <PrescriptionList appointmentId={appointment.id} title="Prescriptions" hideWhenEmpty />

        {/* Booking info */}
        <View style={styles.card}>
          <Text style={styles.cardLabel}>BOOKING INFO</Text>
          <View style={styles.infoLine}>
            <Text style={styles.infoKey}>Reference</Text>
            <Text style={styles.infoVal}>APT-{appointment.id.slice(0, 8).toUpperCase()}</Text>
          </View>
          <View style={styles.infoLine}>
            <Text style={styles.infoKey}>Booked on</Text>
            <Text style={styles.infoVal}>{fmtDateTime(appointment.created_at)}</Text>
          </View>
          {appointment.status === 'cancelled' && appointment.updated_at ? (
            <View style={styles.infoLine}>
              <Text style={styles.infoKey}>Cancelled on</Text>
              <Text style={styles.infoVal}>{fmtDateTime(appointment.updated_at)}</Text>
            </View>
          ) : null}
          {appointment.notes ? (
            <View style={[styles.infoLine, { borderBottomWidth: 0, flexDirection: 'column', alignItems: 'flex-start' }]}>
              <Text style={styles.infoKey}>Notes</Text>
              <Text style={[styles.bodyText, { marginTop: 4 }]}>{appointment.notes}</Text>
            </View>
          ) : null}
        </View>

        {canCancel ? (
          <TouchableOpacity style={styles.cancelBtn} onPress={handleCancel} disabled={cancelling}>
            {cancelling ? (
              <ActivityIndicator color="#C62828" />
            ) : (
              <>
                <Ionicons name="close-circle-outline" size={20} color="#C62828" />
                <Text style={styles.cancelBtnText}>Cancel Appointment</Text>
              </>
            )}
          </TouchableOpacity>
        ) : null}

        {canRebook ? (
          <TouchableOpacity
            style={styles.rebookBtn}
            onPress={() => navigation.navigate('BookAppointment', { clinicId: undefined })}
          >
            <Ionicons name="add-circle-outline" size={20} color="#FFF" />
            <Text style={styles.rebookBtnText}>Book another appointment</Text>
          </TouchableOpacity>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F5F5F5' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  backButton: { padding: 8 },
  headerTitle: { fontSize: 18, fontWeight: '600', color: '#1a1a1a' },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  loadingText: { marginTop: 12, fontSize: 14, color: '#666' },
  emptyText: { fontSize: 15, color: '#888', marginTop: 12 },
  errorDetail: { fontSize: 12, color: '#C62828', marginTop: 8, textAlign: 'center' },
  retryBtn: {
    marginTop: 16,
    paddingHorizontal: 22,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: '#6B7C5C',
  },
  retryText: { color: '#FFF', fontWeight: '700' },
  inlineError: { color: '#C62828', fontSize: 13, marginBottom: 12 },
  content: { padding: 16, paddingBottom: 40 },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  statusBadge: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 20 },
  statusText: { fontSize: 13, fontWeight: '700' },
  refCode: { fontSize: 12, fontWeight: '700', color: '#888', letterSpacing: 0.8 },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 12,
    borderRadius: 10,
    marginBottom: 14,
  },
  bannerText: { fontSize: 14, fontWeight: '600', flex: 1 },
  card: {
    backgroundColor: '#FFF',
    borderRadius: 12,
    padding: 20,
    borderWidth: 1,
    borderColor: '#E8E8E8',
    marginBottom: 14,
  },
  cardLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#6B7C5C',
    letterSpacing: 0.6,
    marginBottom: 10,
  },
  reason: { fontSize: 20, fontWeight: '700', color: '#1a1a1a', marginBottom: 20 },
  detailRow: { flexDirection: 'row', gap: 12, marginBottom: 16 },
  detailText: { flex: 1 },
  detailLabel: { fontSize: 12, color: '#888', marginBottom: 2 },
  detailValue: { fontSize: 15, fontWeight: '600', color: '#1a1a1a' },
  detailSub: { fontSize: 13, color: '#666', marginTop: 2 },
  linkText: { fontSize: 13, fontWeight: '700', color: '#6B7C5C', marginTop: 6 },
  serviceName: { fontSize: 16, fontWeight: '700', color: '#1a1a1a', marginBottom: 4 },
  bodyText: { fontSize: 14, color: '#444', lineHeight: 20 },
  fieldLabel: { fontSize: 12, fontWeight: '700', color: '#444', marginTop: 12, marginBottom: 3 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  infoChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#EEF4EA',
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  infoChipText: { fontSize: 13, fontWeight: '600', color: '#3F5A32' },
  referralRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#EEE',
  },
  referralTitle: { fontSize: 15, fontWeight: '700', color: '#1a1a1a' },
  miniBadge: { paddingHorizontal: 9, paddingVertical: 3, borderRadius: 999 },
  miniBadgeText: { fontSize: 11, fontWeight: '700' },
  infoLine: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#EEE',
    gap: 12,
  },
  infoKey: { fontSize: 13, color: '#777' },
  infoVal: { fontSize: 13, fontWeight: '600', color: '#222', textAlign: 'right', flexShrink: 1 },
  cancelBtn: {
    marginTop: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#FFCDD2',
    backgroundColor: '#FFF',
  },
  cancelBtnText: { fontSize: 15, fontWeight: '600', color: '#C62828' },
  rebookBtn: {
    marginTop: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: '#6B7C5C',
  },
  rebookBtnText: { fontSize: 15, fontWeight: '700', color: '#FFF' },
});