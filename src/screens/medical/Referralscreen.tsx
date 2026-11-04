import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
  TextInput,
  Linking,
  Modal,
  FlatList,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute, useFocusEffect } from '@react-navigation/native';
import { useAuth } from '../../context/AuthContext';
import { supabase } from '../../services/supabase/client';
import { clinicApi, Clinic } from '../../services/api/clinic';
import {
  referralsApi,
  Referral,
  ReferralStatus,
  ReferralUrgency,
  SPECIALIST_TYPES,
  FOLLOW_UP_AFTER_HOURS,
  canFollowUpStatus,
  followUpAvailableAt,
} from '../../services/api/referrals';
import { shareOrDownloadPdf, shareOrDownloadText } from '../../utils/shareText';
import { notify } from '../../utils/dialogs';

// ── helpers ────────────────────────────────────────────────────────────────

const STATUS_META: Record<ReferralStatus, { label: string; fg: string; bg: string }> = {
  pending: { label: 'Awaiting approval', fg: '#e6a817', bg: '#fff8e6' },
  accepted: { label: 'Accepted', fg: '#1565C0', bg: '#E3F2FD' },
  scheduled: { label: 'Appointment scheduled', fg: '#2d7a4f', bg: '#e8f5ee' },
  completed: { label: 'Completed', fg: '#7B1FA2', bg: '#F3E5F5' },
  cancelled: { label: 'Cancelled', fg: '#C62828', bg: '#FFEBEE' },
};

const URGENCY_COLOR: Record<ReferralUrgency, string> = {
  routine: '#2d7a4f',
  urgent: '#e6a817',
  emergency: '#C62828',
};

/** Which statuses a clinician may move a referral to from the current one. */
const NEXT_STATUS: Record<ReferralStatus, { to: ReferralStatus; label: string; danger?: boolean }[]> = {
  pending: [
    { to: 'accepted', label: 'Mark accepted' },
    { to: 'cancelled', label: 'Cancel', danger: true },
  ],
  accepted: [
    { to: 'scheduled', label: 'Mark scheduled' },
    { to: 'cancelled', label: 'Cancel', danger: true },
  ],
  scheduled: [
    { to: 'completed', label: 'Mark completed' },
    { to: 'cancelled', label: 'Cancel', danger: true },
  ],
  completed: [],
  cancelled: [],
};

const RANK: Record<ReferralStatus, number> = {
  pending: 0,
  accepted: 1,
  scheduled: 2,
  completed: 3,
  cancelled: -1,
};

function fmtDate(d?: string | null) {
  if (!d) return '—';
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return '—';
  return dt.toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' });
}

function fmtDateTime(d?: string | null) {
  if (!d) return '—';
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return '—';
  return `${fmtDate(d)} · ${dt.toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' })}`;
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

const doctorName = (r: Referral) =>
  r.referring_doctor
    ? `Dr ${r.referring_doctor.first_name || ''} ${r.referring_doctor.last_name || ''}`.trim()
    : 'Referring clinician';

const doctorLabel = (d?: { first_name?: string; last_name?: string } | null) =>
  d ? `Dr ${d.first_name || ''} ${d.last_name || ''}`.trim() : '';

const personName = (p?: { first_name?: string; last_name?: string } | null) =>
  p ? `${p.first_name || ''} ${p.last_name || ''}`.trim() : '';

// ── small presentational pieces ────────────────────────────────────────────

interface PickerOption {
  key: string;
  label: string;
  sub?: string;
}

/** Dropdown: tap to open a list, tap an item to choose it. */
const PickerField: React.FC<{
  label: string;
  placeholder: string;
  value: string | null;
  options: PickerOption[];
  onSelect: (key: string) => void;
  disabled?: boolean;
  emptyText?: string;
}> = ({ label, placeholder, value, options, onSelect, disabled, emptyText }) => {
  const [open, setOpen] = useState(false);
  const chosen = options.find((o) => o.key === value);
  return (
    <View>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TouchableOpacity
        style={[styles.input, styles.pickerTrigger, disabled && { opacity: 0.5 }]}
        onPress={() => !disabled && setOpen(true)}
        activeOpacity={0.7}
      >
        <Text style={[styles.pickerText, !chosen && { color: '#999' }]} numberOfLines={1}>
          {chosen ? chosen.label : placeholder}
        </Text>
        <Text style={styles.pickerArrow}>▼</Text>
      </TouchableOpacity>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <TouchableOpacity style={styles.overlay} activeOpacity={1} onPress={() => setOpen(false)}>
          <View style={styles.sheet}>
            <Text style={styles.sheetTitle}>{label}</Text>
            <FlatList
              data={options}
              keyExtractor={(o) => o.key}
              ListEmptyComponent={<Text style={styles.sheetEmpty}>{emptyText || 'Nothing to choose from.'}</Text>}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={[styles.sheetRow, item.key === value && styles.sheetRowOn]}
                  onPress={() => {
                    onSelect(item.key);
                    setOpen(false);
                  }}
                >
                  <Text style={styles.sheetRowText}>{item.label}</Text>
                  {item.sub ? <Text style={styles.sheetRowSub}>{item.sub}</Text> : null}
                </TouchableOpacity>
              )}
            />
          </View>
        </TouchableOpacity>
      </Modal>
    </View>
  );
};

const SectionCard: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <View style={styles.card}>
    <Text style={styles.cardLabel}>{label}</Text>
    {children}
  </View>
);

const InfoRow: React.FC<{ label: string; value: string; valueColor?: string; isLast?: boolean }> = ({
  label,
  value,
  valueColor,
  isLast,
}) => (
  <View style={[styles.infoRow, isLast && styles.infoRowLast]}>
    <Text style={styles.infoKey}>{label}</Text>
    <Text style={[styles.infoVal, valueColor ? { color: valueColor } : null]}>{value}</Text>
  </View>
);

const TimelineItem: React.FC<{ label: string; date: string; completed: boolean; isLast: boolean }> = ({
  label,
  date,
  completed,
  isLast,
}) => (
  <View style={styles.tlItem}>
    <View style={styles.tlSpine}>
      <View style={[styles.tlDot, !completed && styles.tlDotDim]} />
      {!isLast && <View style={styles.tlLine} />}
    </View>
    <View style={styles.tlContent}>
      <Text style={[styles.tlLabel, !completed && styles.tlLabelDim]}>{label}</Text>
      <Text style={styles.tlDate}>{date}</Text>
    </View>
  </View>
);

// ── screen ─────────────────────────────────────────────────────────────────

export default function ReferralScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const { role, profile, staffProfile } = useAuth();

  const patientIdParam: string | undefined = route.params?.patientId;
  const referralIdParam: string | undefined = route.params?.referralId;
  const startInCreate = route.params?.mode === 'create';

  const isPatient = role === 'patient';
  const canRefer = role === 'Doctor' || role === 'Nurse';

  // A patient only ever sees their own referrals; staff look up the patient passed in.
  const patientId = isPatient ? profile?.id : patientIdParam;

  // Referrals for one patient (patient view, or staff opened from a patient)
  const [items, setItems] = useState<Referral[]>([]);
  // Staff overview (no patient chosen): addressed to me / issued by me
  const [received, setReceived] = useState<Referral[]>([]);
  const [issued, setIssued] = useState<Referral[]>([]);
  const [tab, setTab] = useState<'received' | 'issued'>('received');
  const [selected, setSelected] = useState<Referral | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [staffViewedPatientName, setStaffViewedPatientName] = useState('');

  // create form
  const [showCreate, setShowCreate] = useState(startInCreate && canRefer);
  const [clinics, setClinics] = useState<Clinic[]>([]);
  const [specialistType, setSpecialistType] = useState<string>(SPECIALIST_TYPES[0]);
  const [clinicId, setClinicId] = useState<string | null>(null);
  const [doctors, setDoctors] = useState<
    { id: string; first_name: string; last_name: string; specialization: string | null }[]
  >([]);
  const [doctorId, setDoctorId] = useState<string | null>(null);
  const [doctorsLoading, setDoctorsLoading] = useState(false);
  const [urgency, setUrgency] = useState<ReferralUrgency>('routine');
  const [reason, setReason] = useState('');
  const [clinicalNotes, setClinicalNotes] = useState('');

  const load = useCallback(async () => {
    try {
      setError(null);

      if (referralIdParam) {
        const one = await referralsApi.getById(referralIdParam);
        // Never show a patient somebody else's referral.
        if (!one || (isPatient && profile?.id && one.patient_id !== profile.id)) {
          setItems([]);
          setSelected(null);
          setError('This referral could not be found.');
        } else {
          setItems([one]);
          setSelected(one);
        }
        return;
      }

      let all: Referral[] = [];
      if (patientId) {
        const rows = await referralsApi.getByPatient(patientId);
        setItems(rows);
        all = rows;
      } else if (canRefer && staffProfile?.id) {
        const [mine, sent] = await Promise.all([
          role === 'Doctor' ? referralsApi.getForDoctor(staffProfile.id) : Promise.resolve([] as Referral[]),
          referralsApi.getByDoctor(staffProfile.id),
        ]);
        setReceived(mine);
        setIssued(sent);
        all = [...mine, ...sent];
      }
      // keep an open detail view in sync after a refresh / status change
      setSelected((cur) => (cur ? all.find((r) => r.id === cur.id) ?? null : null));

      if (canRefer && patientId) {
        const { data } = await supabase
          .from('patients')
          .select('first_name, last_name')
          .eq('id', patientId)
          .maybeSingle();
        setStaffViewedPatientName(personName(data as any));
      }
    } catch (e: any) {
      console.error('Failed to load referrals:', e);
      setError(e?.message || 'Could not load referrals.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [referralIdParam, patientId, isPatient, canRefer, role, profile?.id, staffProfile?.id]);

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      load();
    }, [load])
  );

  // clinics are only needed by the create form
  const openCreate = async () => {
    setShowCreate(true);
    if (clinics.length === 0) {
      try {
        setClinics(await clinicApi.getAll());
      } catch (e) {
        console.warn('Could not load clinics for referral form:', e);
      }
    }
  };

  const chooseClinic = async (id: string) => {
    setClinicId(id);
    setDoctorId(null);
    setDoctors([]);
    setDoctorsLoading(true);
    try {
      const list = await referralsApi.getDoctorsByClinic(id);
      // a doctor cannot refer a patient to themselves
      setDoctors(list.filter((d) => d.id !== staffProfile?.id));
    } catch (e: any) {
      notify('Could not load doctors', e?.message || 'Please try again.');
    } finally {
      setDoctorsLoading(false);
    }
  };

  // opened straight into create mode from the patient screen
  React.useEffect(() => {
    if (startInCreate && canRefer) openCreate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const patientNameFor = (r: Referral) =>
    personName(r.patients) || (isPatient ? personName(profile as any) : staffViewedPatientName);

  const download = async (r: Referral) => {
    try {
      setBusy(true);
      const name = `referral-${r.id.slice(0, 8)}`;
      const patientName = patientNameFor(r);
      try {
        await shareOrDownloadPdf(`${name}.pdf`, referralsApi.formatAsHtml(r, patientName));
      } catch {
        await shareOrDownloadText(`${name}.txt`, referralsApi.formatAsText(r, patientName));
      }
    } catch (e: any) {
      notify('Could not download', e?.message || 'Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const changeStatus = async (r: Referral, status: ReferralStatus) => {
    try {
      setBusy(true);
      await referralsApi.updateStatus(r.id, status, staffProfile?.id);
      await load();
    } catch (e: any) {
      notify('Could not update', e?.message || 'Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const sendFollowUp = async (r: Referral) => {
    try {
      setBusy(true);
      await referralsApi.followUp(r);
      await load();
      notify('Follow-up sent', `${doctorLabel(r.referred_doctor) || 'The receiving doctor'} has been reminded.`);
    } catch (e: any) {
      notify('Could not follow up', e?.message || 'Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const submitCreate = async () => {
    if (!patientId) {
      notify('Error', 'No patient selected.');
      return;
    }
    if (!staffProfile?.id) {
      notify('Cannot issue referral', 'Your staff profile could not be found.');
      return;
    }
    if (!clinicId) {
      notify('Missing info', 'Choose the clinic you are referring the patient to.');
      return;
    }
    const target = doctors.find((d) => d.id === doctorId);
    if (!target) {
      notify('Missing info', 'Choose the doctor you are referring the patient to.');
      return;
    }
    if (!reason.trim()) {
      notify('Missing info', 'Please enter a reason for the referral.');
      return;
    }
    try {
      setBusy(true);
      const created = await referralsApi.create({
        patient_id: patientId,
        referring_doctor_id: staffProfile.id,
        specialist_type: specialistType,
        specialist_name: `Dr ${target.first_name} ${target.last_name}`.trim(),
        referred_to_doctor_id: target.id,
        preferred_clinic_id: clinicId,
        reason: reason.trim(),
        clinical_notes: clinicalNotes.trim() || undefined,
        urgency,
      });
      setReason('');
      setClinicalNotes('');
      setClinicId(null);
      setDoctorId(null);
      setDoctors([]);
      setUrgency('routine');
      setShowCreate(false);
      // reload with all joins so the detail view is fully populated
      const full = await referralsApi.getById(created.id);
      await load();
      if (full) setSelected(full);
      notify('Referral issued', 'The patient has been notified and can download the letter.');
    } catch (e: any) {
      notify('Could not create referral', e?.message || 'Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const goBackFromDetail = () => {
    if (referralIdParam) navigation.goBack();
    else setSelected(null);
  };

  const onRefresh = () => {
    setRefreshing(true);
    load();
  };

  // ── loading ──────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.center}>
          <ActivityIndicator size="large" color="#1e2a3a" />
          <Text style={styles.muted}>Loading referrals…</Text>
        </View>
      </SafeAreaView>
    );
  }

  // ── create form ──────────────────────────────────────────────────────────
  if (showCreate && canRefer) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <ScrollView contentContainerStyle={styles.scrollContainer} keyboardShouldPersistTaps="handled">
          <View style={styles.header}>
            <TouchableOpacity
              onPress={() => (startInCreate ? navigation.goBack() : setShowCreate(false))}
              style={styles.backRow}
            >
              <Text style={styles.backArrow}>←</Text>
              <Text style={styles.backLabel}>Cancel</Text>
            </TouchableOpacity>
            <Text style={styles.headerTitle}>New specialist referral</Text>
            <Text style={styles.headerSub}>
              {staffViewedPatientName ? `For ${staffViewedPatientName}` : 'Issue a referral for this patient'}
            </Text>
          </View>

          <View style={styles.body}>
            <Text style={styles.fieldLabel}>Specialist type</Text>
            <View style={styles.chipWrap}>
              {SPECIALIST_TYPES.map((t) => (
                <TouchableOpacity
                  key={t}
                  style={[styles.chip, specialistType === t && styles.chipOn]}
                  onPress={() => setSpecialistType(t)}
                >
                  <Text style={[styles.chipText, specialistType === t && styles.chipTextOn]}>{t}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <PickerField
              label="Refer to clinic *"
              placeholder="Select a clinic"
              value={clinicId}
              options={clinics.map((c) => ({ key: c.id, label: c.clinic_name, sub: c.location }))}
              onSelect={chooseClinic}
              emptyText="No clinics available."
            />

            <PickerField
              label="Refer to doctor *"
              placeholder={
                !clinicId ? 'Choose a clinic first' : doctorsLoading ? 'Loading doctors…' : 'Select a doctor'
              }
              value={doctorId}
              options={doctors.map((d) => ({
                key: d.id,
                label: `Dr ${d.first_name} ${d.last_name}`.trim(),
                sub: d.specialization || undefined,
              }))}
              onSelect={setDoctorId}
              disabled={!clinicId || doctorsLoading}
              emptyText="No other doctors are registered at this clinic."
            />

            <Text style={styles.fieldLabel}>Urgency</Text>
            <View style={styles.chipWrap}>
              {(['routine', 'urgent', 'emergency'] as ReferralUrgency[]).map((u) => (
                <TouchableOpacity
                  key={u}
                  style={[styles.chip, urgency === u && styles.chipOn]}
                  onPress={() => setUrgency(u)}
                >
                  <Text style={[styles.chipText, urgency === u && styles.chipTextOn]}>{cap(u)}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={styles.fieldLabel}>Reason for referral *</Text>
            <TextInput
              style={[styles.input, styles.textarea]}
              value={reason}
              onChangeText={setReason}
              placeholder="Clinical reason…"
              placeholderTextColor="#999"
              multiline
            />

            <Text style={styles.fieldLabel}>Clinical notes (optional)</Text>
            <TextInput
              style={[styles.input, styles.textarea]}
              value={clinicalNotes}
              onChangeText={setClinicalNotes}
              placeholder="Additional notes for the specialist…"
              placeholderTextColor="#999"
              multiline
            />

            <TouchableOpacity
              style={[styles.btnPrimary, busy && { opacity: 0.6 }]}
              onPress={submitCreate}
              disabled={busy}
            >
              {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnPrimaryText}>Issue referral</Text>}
            </TouchableOpacity>
          </View>
        </ScrollView>
      </SafeAreaView>
    );
  }

  // ── detail ───────────────────────────────────────────────────────────────
  if (selected) {
    const r = selected;
    const meta = STATUS_META[r.status] ?? STATUS_META.pending;
    const rank = RANK[r.status];
    const isCancelled = r.status === 'cancelled';
    const slot = r.appointment?.time_slots;
    const apptWhen = slot?.date
      ? `${fmtDate(slot.date)}${slot.start_time ? ` · ${slot.start_time.slice(0, 5)}` : ''}`
      : '';
    const issuingClinic = r.referring_doctor?.clinic?.clinic_name || '—';
    const targetClinic = r.preferred_clinic || r.referred_doctor?.clinic || null;
    const referredTo = targetClinic?.clinic_name
      ? `${targetClinic.clinic_name}${targetClinic.location ? `, ${targetClinic.location}` : ''}`
      : 'Any suitable facility';
    const contact =
      r.referred_doctor?.contact_number || targetClinic?.phone || targetClinic?.contact_details || '';
    const targetName = doctorLabel(r.referred_doctor);
    const specialistTitle = targetName || r.specialist_name || r.specialist_type;
    const specialistRole = r.referred_doctor?.specialization || r.specialist_type;

    // Who may do what
    const myId = staffProfile?.id;
    const isTarget = !!myId && r.referred_to_doctor_id === myId;
    const isReferrer = !!myId && r.referring_doctor_id === myId;
    const isLegacy = !r.referred_to_doctor_id; // referrals made before doctors could be chosen
    const nextActions = !canRefer
      ? []
      : isTarget || (isLegacy && (isReferrer || role === 'Doctor'))
      ? NEXT_STATUS[r.status]
      : isReferrer
      ? NEXT_STATUS[r.status].filter((a) => a.danger) // the referrer may only withdraw
      : [];
    const showFollowUp = isReferrer && canFollowUpStatus(r);
    const followUpAt = showFollowUp ? followUpAvailableAt(r) : null;
    const followUps = r.followup_count ?? 0;

    return (
      <SafeAreaView style={styles.safeArea}>
        <ScrollView
          contentContainerStyle={styles.scrollContainer}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={['#1e2a3a']} />}
        >
          <View style={styles.header}>
            <TouchableOpacity onPress={goBackFromDetail} style={styles.backRow}>
              <Text style={styles.backArrow}>←</Text>
              <Text style={styles.backLabel}>{referralIdParam ? 'Back' : 'All referrals'}</Text>
            </TouchableOpacity>
            <Text style={styles.headerTitle}>Specialist Referral</Text>
            <Text style={styles.headerSub}>
              {isPatient ? 'Issued by your doctor' : `For ${patientNameFor(r) || 'patient'}`}
            </Text>
            <View style={styles.refIdPill}>
              <Text style={styles.refIdText}>REF-{r.id.slice(0, 8).toUpperCase()}</Text>
            </View>
          </View>

          <View style={styles.body}>
            <View style={styles.statusRow}>
              <View style={[styles.statusBadge, { backgroundColor: meta.bg }]}>
                <View style={[styles.statusDot, { backgroundColor: meta.fg }]} />
                <Text style={[styles.statusText, { color: meta.fg }]}>{meta.label}</Text>
              </View>
            </View>

            <SectionCard label="REFERRAL ROUTE">
              <View style={styles.routeBlock}>
                <Text style={styles.routeTag}>FROM</Text>
                <View style={styles.specialistRow}>
                  <View style={styles.specialistAvatar}>
                    <Text style={styles.specialistAvatarText}>
                      {(doctorLabel(r.referring_doctor) || 'D').replace('Dr ', '').charAt(0).toUpperCase()}
                    </Text>
                  </View>
                  <View style={styles.specialistInfo}>
                    <Text style={styles.specialistName}>{doctorLabel(r.referring_doctor) || 'Referring clinician'}</Text>
                    {r.referring_doctor?.specialization ? (
                      <Text style={styles.specialistRole}>{r.referring_doctor.specialization}</Text>
                    ) : null}
                    <Text style={styles.specialistClinic}>{issuingClinic}</Text>
                    {r.referring_doctor?.contact_number ? (
                      <Text style={styles.specialistClinic}>Contact: {r.referring_doctor.contact_number}</Text>
                    ) : null}
                  </View>
                </View>
              </View>

              <Text style={styles.routeArrow}>↓ referred to ↓</Text>

              <View style={styles.routeBlock}>
                <Text style={styles.routeTag}>TO</Text>
                <View style={styles.specialistRow}>
                  <View style={styles.specialistAvatar}>
                    <Text style={styles.specialistAvatarText}>
                      {specialistTitle.replace('Dr ', '').charAt(0).toUpperCase()}
                    </Text>
                  </View>
                  <View style={styles.specialistInfo}>
                    <Text style={styles.specialistName}>{specialistTitle}</Text>
                    <Text style={styles.specialistRole}>{specialistRole}</Text>
                    <Text style={styles.specialistClinic}>{referredTo}</Text>
                    {r.referred_doctor?.contact_number || contact ? (
                      <Text style={styles.specialistClinic}>
                        Contact: {r.referred_doctor?.contact_number || contact}
                      </Text>
                    ) : null}
                  </View>
                </View>
              </View>
            </SectionCard>

            {r.appointment && apptWhen ? (
              <SectionCard label="APPOINTMENT">
                <InfoRow label="Date & time" value={apptWhen} />
                {r.appointment.clinics?.clinic_name ? (
                  <InfoRow label="Clinic" value={r.appointment.clinics.clinic_name} />
                ) : null}
                {r.appointment.services?.service_name ? (
                  <InfoRow label="Service" value={r.appointment.services.service_name} />
                ) : null}
                <InfoRow label="Status" value={cap(r.appointment.status || '—')} isLast />
              </SectionCard>
            ) : null}

            <SectionCard label="REFERRAL DETAILS">
              <InfoRow label="Date issued" value={fmtDate(r.referred_at || r.created_at)} />
              <InfoRow label="Priority" value={cap(r.urgency)} valueColor={URGENCY_COLOR[r.urgency]} />
              <InfoRow label="Specialist type" value={r.specialist_type} isLast={followUps === 0} />
              {followUps > 0 ? (
                <InfoRow
                  label="Follow-ups sent"
                  value={`${followUps} · last ${fmtDateTime(r.last_followup_at)}`}
                  isLast
                />
              ) : null}
            </SectionCard>

            <SectionCard label="REASON FOR REFERRAL">
              <Text style={styles.reasonText}>{r.reason}</Text>
              {r.clinical_notes ? (
                <>
                  <Text style={[styles.cardLabel, { marginTop: 12 }]}>CLINICAL NOTES</Text>
                  <Text style={styles.reasonText}>{r.clinical_notes}</Text>
                </>
              ) : null}
            </SectionCard>

            <SectionCard label="STATUS TIMELINE">
              <TimelineItem
                label="Referral issued"
                date={fmtDateTime(r.referred_at || r.created_at)}
                completed
                isLast={false}
              />
              {isCancelled ? (
                <TimelineItem label="Cancelled" date={fmtDateTime(r.updated_at)} completed isLast />
              ) : (
                <>
                  <TimelineItem
                    label="Accepted by specialist"
                    date={rank === 1 ? fmtDateTime(r.updated_at) : rank > 1 ? 'Done' : 'Pending'}
                    completed={rank >= 1}
                    isLast={false}
                  />
                  <TimelineItem
                    label="Appointment scheduled"
                    date={apptWhen || (rank === 2 ? fmtDateTime(r.updated_at) : rank > 2 ? 'Done' : 'Pending')}
                    completed={rank >= 2}
                    isLast={false}
                  />
                  <TimelineItem
                    label="Completed"
                    date={rank === 3 ? fmtDateTime(r.updated_at) : 'Pending'}
                    completed={rank >= 3}
                    isLast
                  />
                </>
              )}
            </SectionCard>

            {isPatient && r.appointment_id && r.appointment ? (
              <TouchableOpacity
                style={styles.btnPrimary}
                onPress={() => navigation.navigate('AppointmentDetail', { appointmentId: r.appointment_id })}
              >
                <Text style={styles.btnPrimaryText}>View appointment</Text>
              </TouchableOpacity>
            ) : contact && !isCancelled ? (
              <TouchableOpacity
                style={styles.btnPrimary}
                onPress={() => Linking.openURL(`tel:${contact.replace(/\s/g, '')}`)}
              >
                <Text style={styles.btnPrimaryText}>Contact specialist clinic</Text>
              </TouchableOpacity>
            ) : null}

            <TouchableOpacity
              style={[styles.btnOutline, busy && { opacity: 0.6 }]}
              onPress={() => download(r)}
              disabled={busy}
            >
              {busy ? (
                <ActivityIndicator color="#1e2a3a" />
              ) : (
                <Text style={styles.btnOutlineText}>Download Referral Letter</Text>
              )}
            </TouchableOpacity>

            {showFollowUp ? (
              <>
                <TouchableOpacity
                  style={[styles.btnFollow, (busy || !!followUpAt) && { opacity: 0.5 }]}
                  onPress={() => sendFollowUp(r)}
                  disabled={busy || !!followUpAt}
                >
                  <Text style={styles.btnPrimaryText}>
                    Follow up with {targetName || 'doctor'}
                  </Text>
                </TouchableOpacity>
                <Text style={styles.followHint}>
                  {followUpAt
                    ? `Available ${followUpAt.toLocaleString('en-ZA', {
                        day: 'numeric',
                        month: 'short',
                        hour: '2-digit',
                        minute: '2-digit',
                      })} — ${FOLLOW_UP_AFTER_HOURS}h after the last update.`
                    : `No update for ${FOLLOW_UP_AFTER_HOURS}h or more. Send a reminder to the doctor.`}
                </Text>
              </>
            ) : null}

            {isTarget && r.status === 'pending' ? (
              <Text style={styles.followHint}>This referral is waiting for you to accept it.</Text>
            ) : null}

            {nextActions.length > 0 ? (
              <View style={styles.actionRow}>
                {nextActions.map((a) => (
                  <TouchableOpacity
                    key={a.to}
                    style={[styles.btnOutline, styles.actionBtn, a.danger && { borderColor: '#C62828' }]}
                    onPress={() => changeStatus(r, a.to)}
                    disabled={busy}
                  >
                    <Text style={[styles.btnOutlineText, a.danger && { color: '#C62828' }]}>{a.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            ) : null}
          </View>
        </ScrollView>
      </SafeAreaView>
    );
  }

  // ── list ─────────────────────────────────────────────────────────────────
  const overview = !patientId && canRefer; // staff, no patient chosen
  const showTabs = overview && role === 'Doctor';
  const activeTab = showTabs ? tab : 'issued';
  const listItems = patientId ? items : activeTab === 'received' ? received : issued;

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView
        contentContainerStyle={styles.scrollContainer}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={['#1e2a3a']} />}
      >
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backRow}>
            <Text style={styles.backArrow}>←</Text>
            <Text style={styles.backLabel}>Back</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>{isPatient ? 'My Referrals' : 'Referrals'}</Text>
          <Text style={styles.headerSub}>
            {isPatient
              ? 'Specialist referrals issued by your doctor'
              : staffViewedPatientName
              ? `Specialist referrals for ${staffViewedPatientName}`
              : 'Referrals sent to you and ones you have issued'}
          </Text>
        </View>

        <View style={styles.body}>
          {error ? <Text style={styles.error}>{error}</Text> : null}

          {canRefer && patientId ? (
            <TouchableOpacity style={[styles.btnPrimary, { marginTop: 14 }]} onPress={openCreate}>
              <Text style={styles.btnPrimaryText}>+ New referral</Text>
            </TouchableOpacity>
          ) : null}

          {showTabs ? (
            <View style={styles.tabs}>
              {(
                [
                  ['received', `For me (${received.length})`],
                  ['issued', `Issued by me (${issued.length})`],
                ] as const
              ).map(([k, label]) => (
                <TouchableOpacity
                  key={k}
                  style={[styles.tab, tab === k && styles.tabOn]}
                  onPress={() => setTab(k)}
                >
                  <Text style={[styles.tabText, tab === k && styles.tabTextOn]}>{label}</Text>
                </TouchableOpacity>
              ))}
            </View>
          ) : null}

          {listItems.length === 0 && !error ? (
            <View style={styles.center}>
              <Text style={styles.emptyTitle}>No referrals yet</Text>
              <Text style={styles.muted}>
                {isPatient
                  ? 'When your doctor refers you to a specialist it will appear here.'
                  : activeTab === 'received' && showTabs
                  ? 'Nobody has referred a patient to you yet.'
                  : 'No referrals have been issued.'}
              </Text>
            </View>
          ) : (
            listItems.map((r) => {
              const meta = STATUS_META[r.status] ?? STATUS_META.pending;
              return (
                <TouchableOpacity key={r.id} style={styles.listCard} onPress={() => setSelected(r)} activeOpacity={0.75}>
                  <View style={styles.listHead}>
                    <Text style={styles.listTitle}>{r.specialist_type}</Text>
                    <View style={[styles.miniBadge, { backgroundColor: meta.bg }]}>
                      <Text style={[styles.miniBadgeText, { color: meta.fg }]}>{meta.label}</Text>
                    </View>
                  </View>
                  <Text style={styles.muted}>
                    {fmtDate(r.referred_at || r.created_at)} ·{' '}
                    {r.referred_doctor
                      ? `${doctorName(r)} → ${doctorLabel(r.referred_doctor)}`
                      : doctorName(r)}{' '}
                    ·{' '}
                    <Text style={{ color: URGENCY_COLOR[r.urgency], fontWeight: '700' }}>{r.urgency}</Text>
                  </Text>
                  {!isPatient && personName(r.patients) ? (
                    <Text style={styles.muted}>Patient: {personName(r.patients)}</Text>
                  ) : null}
                  {r.referring_doctor_id === staffProfile?.id &&
                  canFollowUpStatus(r) &&
                  !followUpAvailableAt(r) ? (
                    <Text style={[styles.muted, { color: '#e6a817', fontWeight: '700' }]}>
                      No update for {FOLLOW_UP_AFTER_HOURS}h+ — you can follow up
                    </Text>
                  ) : null}
                  <Text style={styles.listReason} numberOfLines={2}>
                    {r.reason}
                  </Text>
                </TouchableOpacity>
              );
            })
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

// ── styles ─────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#e8d5b7' },
  scrollContainer: { flexGrow: 1, paddingBottom: 40 },
  center: { alignItems: 'center', justifyContent: 'center', paddingVertical: 40, gap: 8 },

  header: { backgroundColor: '#d4b896', paddingHorizontal: 20, paddingTop: 20, paddingBottom: 24 },
  backRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 18 },
  backArrow: { fontSize: 18, color: '#1e2a3a' },
  backLabel: { fontSize: 15, fontWeight: '700', color: '#1e2a3a' },
  headerTitle: { fontSize: 22, fontWeight: '700', color: '#1e2a3a', marginBottom: 4 },
  headerSub: { fontSize: 11, color: '#1e2a3a', opacity: 0.65, letterSpacing: 0.4 },
  refIdPill: {
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(30,42,58,0.12)',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 3,
    marginTop: 10,
  },
  refIdText: { fontSize: 10, fontWeight: '700', color: '#1e2a3a', letterSpacing: 0.8 },

  body: { backgroundColor: '#f5ede0', paddingHorizontal: 16, paddingTop: 4, paddingBottom: 8, flexGrow: 1 },

  statusRow: { alignItems: 'flex-end', paddingVertical: 14 },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 999,
  },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  statusText: { fontSize: 11, fontWeight: '700', letterSpacing: 0.4 },

  card: {
    backgroundColor: '#ffffff',
    borderRadius: 12,
    padding: 14,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#e2ddd6',
  },
  cardLabel: { fontSize: 9, fontWeight: '700', letterSpacing: 0.9, color: '#888888', marginBottom: 10 },

  specialistRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  specialistAvatar: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: '#eae3d8',
    borderWidth: 2,
    borderColor: '#e2ddd6',
    justifyContent: 'center',
    alignItems: 'center',
  },
  specialistAvatarText: { fontSize: 18, fontWeight: '700', color: '#1e2a3a' },
  specialistInfo: { flex: 1 },
  specialistName: { fontSize: 14, fontWeight: '700', color: '#1e2a3a' },
  specialistRole: { fontSize: 11, fontWeight: '600', color: '#7a8c3a', marginTop: 1 },
  specialistClinic: { fontSize: 11, color: '#777e8a', marginTop: 2 },

  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingVertical: 7,
    borderBottomWidth: 1,
    borderBottomColor: '#e2ddd6',
    gap: 12,
  },
  infoRowLast: { borderBottomWidth: 0, paddingBottom: 0 },
  infoKey: { fontSize: 11, color: '#777e8a' },
  infoVal: { fontSize: 12, fontWeight: '600', color: '#1e2a3a', textAlign: 'right', flexShrink: 1 },

  reasonText: { fontSize: 12, color: '#1e2a3a', lineHeight: 19 },

  tlItem: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  tlSpine: { alignItems: 'center', width: 20 },
  tlDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#7a8c3a', marginTop: 3 },
  tlDotDim: { backgroundColor: '#e2ddd6' },
  tlLine: { width: 2, flex: 1, backgroundColor: '#e2ddd6', minHeight: 18 },
  tlContent: { flex: 1, paddingBottom: 16 },
  tlLabel: { fontSize: 12, fontWeight: '600', color: '#1e2a3a' },
  tlLabelDim: { color: '#777e8a' },
  tlDate: { fontSize: 10, color: '#777e8a', marginTop: 2 },

  btnPrimary: {
    width: '100%',
    backgroundColor: '#1e2a3a',
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 4,
    marginBottom: 10,
  },
  btnPrimaryText: { color: '#ffffff', fontSize: 14, fontWeight: '700' },
  btnOutline: {
    width: '100%',
    borderWidth: 1.5,
    borderColor: '#1e2a3a',
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
    marginBottom: 10,
  },
  btnOutlineText: { color: '#1e2a3a', fontSize: 13, fontWeight: '600' },
  actionRow: { flexDirection: 'row', gap: 10 },
  actionBtn: { flex: 1, width: undefined },

  // list
  listCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 14,
    marginTop: 12,
    borderWidth: 1,
    borderColor: '#e2ddd6',
  },
  listHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  listTitle: { fontSize: 15, fontWeight: '700', color: '#1e2a3a', flex: 1 },
  listReason: { fontSize: 12, color: '#555', marginTop: 6 },
  miniBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10 },
  miniBadgeText: { fontSize: 10, fontWeight: '700' },
  muted: { fontSize: 12, color: '#777e8a', textAlign: 'center' },
  emptyTitle: { fontSize: 16, fontWeight: '700', color: '#1e2a3a' },
  error: { color: '#C62828', marginTop: 14, fontSize: 13 },

  routeBlock: { paddingVertical: 4 },
  routeTag: { fontSize: 9, fontWeight: '700', letterSpacing: 0.9, color: '#7a8c3a', marginBottom: 6 },
  routeArrow: { textAlign: 'center', fontSize: 11, color: '#777e8a', marginVertical: 10 },
  btnFollow: {
    width: '100%',
    backgroundColor: '#b26a00',
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: 'center',
    marginBottom: 6,
  },
  followHint: { fontSize: 11, color: '#777e8a', textAlign: 'center', marginBottom: 12 },
  tabs: { flexDirection: 'row', gap: 8, marginTop: 14 },
  tab: { flex: 1, paddingVertical: 10, borderRadius: 8, backgroundColor: '#eae3d8', alignItems: 'center' },
  tabOn: { backgroundColor: '#1e2a3a' },
  tabText: { fontSize: 12, fontWeight: '700', color: '#1e2a3a' },
  tabTextOn: { color: '#fff' },

  // dropdown
  pickerTrigger: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  pickerText: { fontSize: 14, color: '#222', flex: 1 },
  pickerArrow: { fontSize: 11, color: '#777e8a', marginLeft: 8 },
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', padding: 24 },
  sheet: { backgroundColor: '#fff', borderRadius: 12, maxHeight: '70%', paddingVertical: 8 },
  sheetTitle: { fontSize: 14, fontWeight: '700', color: '#1e2a3a', paddingHorizontal: 16, paddingVertical: 10 },
  sheetEmpty: { padding: 16, color: '#777e8a', fontSize: 13 },
  sheetRow: { paddingHorizontal: 16, paddingVertical: 12, borderTopWidth: 1, borderTopColor: '#eee' },
  sheetRowOn: { backgroundColor: '#f5ede0' },
  sheetRowText: { fontSize: 14, color: '#1e2a3a', fontWeight: '600' },
  sheetRowSub: { fontSize: 11, color: '#777e8a', marginTop: 2 },

  // create form
  fieldLabel: { fontSize: 12, fontWeight: '700', color: '#1e2a3a', marginTop: 14, marginBottom: 6 },
  input: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e2ddd6',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: '#222',
  },
  textarea: { minHeight: 90, textAlignVertical: 'top' },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 20, backgroundColor: '#eae3d8' },
  chipOn: { backgroundColor: '#1e2a3a' },
  chipText: { fontSize: 12, color: '#1e2a3a', fontWeight: '600' },
  chipTextOn: { color: '#fff' },
});