import React, { useState, useCallback, useMemo } from 'react';
import {
  StyleSheet,
  Text,
  View,
  ScrollView,
  TouchableOpacity,
  StatusBar,
  RefreshControl,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useRoute, useFocusEffect } from '@react-navigation/native';
import { useAuth } from '../../context/AuthContext';
import { supabase } from '../../services/supabase/client';
import {
  Prescription,
  prescriptionsApi,
  effectiveStatus,
  isUsable,
  prescriberOf,
} from '../../services/api/prescriptions';
import { shareOrDownloadPdf } from '../../utils/shareText';
import { notify } from '../../utils/dialogs';
import {
  buildMedicalRecordHtml,
  fmtDate,
  fmtTime,
  vitalsOf,
} from '../../utils/medicalRecordPdf';

interface RecordRow {
  id: string;
  patient_id: string | null;
  appointment_id?: string | null;
  visit_date: string;
  diagnosis_notes?: string | null;
  allergies?: string[] | null;
  chronic_medication?: string[] | null;
  vitals?: Record<string, unknown> | null;
  treatment_plan?: string | null;
  follow_up_date?: string | null;
  doctor_notes?: string | null;
  created_at?: string;
}

interface ApptInfo {
  id: string;
  status?: string | null;
  services?: { service_name?: string | null } | null;
  clinics?: { clinic_name?: string | null } | null;
  time_slots?: { date?: string | null; start_time?: string | null } | null;
}

const RX_CHIP: Record<string, { label: string; bg: string; fg: string }> = {
  active: { label: 'Active', bg: '#E8F5E9', fg: '#2E7D32' },
  expired: { label: 'Expired', bg: '#FFF3E0', fg: '#E65100' },
  cancelled: { label: 'Cancelled', bg: '#FFEBEE', fg: '#C62828' },
  completed: { label: 'Completed', bg: '#F3E5F5', fg: '#7B1FA2' },
};

/** Case-insensitive de-duplication that keeps the first spelling seen. */
function unique(items: (string | null | undefined)[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of items) {
    const v = (raw || '').trim();
    if (!v) continue;
    const key = v.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(v);
  }
  return out;
}

export default function MedicalRecordScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute();
  const params = (route.params as { patientId?: string } | undefined) || {};
  const { user, profile, role } = useAuth();

  const [patient, setPatient] = useState<any | null>(null);
  const [records, setRecords] = useState<RecordRow[]>([]);
  const [appts, setAppts] = useState<Record<string, ApptInfo>>({});
  const [prescriptions, setPrescriptions] = useState<Prescription[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const isPatientViewer = role === 'patient';

  const load = useCallback(async () => {
    try {
      setError(null);

      // Which patient? A staff member passes patientId; a patient sees their own.
      let pid: string | null =
        params.patientId || (isPatientViewer ? (profile as any)?.id ?? null : null);
      if (!pid && user?.id && isPatientViewer) {
        const { data } = await supabase
          .from('patients')
          .select('id')
          .eq('user_id', user.id)
          .maybeSingle();
        pid = data?.id ?? null;
      }
      if (!pid) {
        setPatient(null);
        setRecords([]);
        setPrescriptions([]);
        setAppts({});
        return;
      }

      const [patientRes, recordsRes, rxRes] = await Promise.allSettled([
        supabase.from('patients').select('*').eq('id', pid).maybeSingle(),
        supabase
          .from('medical_records')
          .select('*')
          .eq('patient_id', pid)
          .order('visit_date', { ascending: false }),
        prescriptionsApi.getByPatient(pid),
      ]);

      if (patientRes.status === 'fulfilled' && !patientRes.value.error) {
        setPatient(patientRes.value.data);
      }

      let recs: RecordRow[] = [];
      if (recordsRes.status === 'fulfilled') {
        if (recordsRes.value.error) {
          setError(recordsRes.value.error.message || 'Could not load medical records.');
        } else {
          recs = (recordsRes.value.data || []) as RecordRow[];
        }
      } else {
        setError('Could not load medical records.');
      }
      setRecords(recs);
      setExpandedId((prev) => prev ?? recs[0]?.id ?? null);

      setPrescriptions(rxRes.status === 'fulfilled' ? rxRes.value : []);

      // Clinic / service / slot for each record's appointment (best effort).
      const ids = Array.from(
        new Set(recs.map((r) => r.appointment_id).filter(Boolean) as string[])
      );
      if (ids.length) {
        const { data: apptRows } = await supabase
          .from('appointments')
          .select(
            'id, status, services ( service_name ), clinics ( clinic_name ), time_slots ( date, start_time )'
          )
          .in('id', ids);
        const map: Record<string, ApptInfo> = {};
        for (const a of (apptRows || []) as any[]) map[a.id] = a;
        setAppts(map);
      } else {
        setAppts({});
      }
    } catch (e: any) {
      console.error('Failed to load medical record:', e);
      setError(e?.message || 'Could not load the medical record.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [params.patientId, isPatientViewer, profile, user?.id]);

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      load();
    }, [load])
  );

  const onRefresh = () => {
    setRefreshing(true);
    load();
  };

  // ---- Derived real data ---------------------------------------------------
  const allergies = useMemo(
    () => unique(records.flatMap((r) => r.allergies || [])),
    [records]
  );

  const activeRx = useMemo(() => prescriptions.filter((rx) => isUsable(rx)), [prescriptions]);

  const medications = useMemo(() => {
    const fromRecords = records.flatMap((r) => r.chronic_medication || []);
    const fromRx = activeRx.flatMap((rx) =>
      (rx.medications || []).map((m) => `${m.name}${m.dosage ? ` ${m.dosage}` : ''}`)
    );
    return unique([...fromRecords, ...fromRx]);
  }, [records, activeRx]);

  const patientName = patient
    ? `${patient.first_name || ''} ${patient.last_name || ''}`.trim()
    : isPatientViewer && profile
    ? `${(profile as any).first_name || ''} ${(profile as any).last_name || ''}`.trim()
    : '';
  const patientNumber = (patient?.id || '').slice(0, 8).toUpperCase() || 'N/A';
  const dob = patient?.date_of_birth ? fmtDate(patient.date_of_birth) : null;

  const visitInfo = (r: RecordRow) => {
    const a = r.appointment_id ? appts[r.appointment_id] : undefined;
    return {
      clinic: a?.clinics?.clinic_name || null,
      service: a?.services?.service_name || null,
      status: a?.status || null,
      time: a?.time_slots?.start_time ? fmtTime(a.time_slots.start_time) : '',
    };
  };

  const download = async () => {
    try {
      setBusy(true);
      const html = buildMedicalRecordHtml({
        patientName,
        patientNumber,
        dateOfBirth: dob,
        generatedAt: new Date().toLocaleString('en-ZA'),
        allergies,
        medications,
        visits: records.map((r) => {
          const info = visitInfo(r);
          return {
            date: fmtDate(r.visit_date),
            title: info.service || 'Consultation',
            clinic: info.clinic,
            service: info.service,
            diagnosis: r.diagnosis_notes,
            notes: r.doctor_notes,
            treatment: r.treatment_plan,
            vitals: vitalsOf(r.vitals),
            followUp: r.follow_up_date ? fmtDate(r.follow_up_date) : null,
          };
        }),
        prescriptions: prescriptions.map((rx) => ({
          issued: fmtDate(rx.issued_at),
          validUntil: fmtDate(rx.valid_until),
          status: effectiveStatus(rx),
          medications: (rx.medications || []).map(
            (m) => `${m.name} – ${m.dosage}, ${m.frequency}, ${m.duration}`
          ),
          diagnosis: rx.diagnosis,
          doctor: prescriberOf(rx).name,
        })),
      });
      await shareOrDownloadPdf(`medical-record-${patientNumber.toLowerCase()}.pdf`, html);
    } catch (e: any) {
      notify('Could not create PDF', e?.message || 'Please try again.');
    } finally {
      setBusy(false);
    }
  };

  // ---- Render --------------------------------------------------------------
  if (loading) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#6B7C5C" />
          <Text style={styles.loadingText}>Loading medical record...</Text>
        </View>
      </SafeAreaView>
    );
  }

  const hasData = records.length > 0 || prescriptions.length > 0;

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <StatusBar barStyle="dark-content" />
      <ScrollView
        contentContainerStyle={styles.container}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={['#6B7C5C']} />
        }
      >
        <TouchableOpacity style={styles.backButton} onPress={() => navigation.goBack()}>
          <Ionicons name="arrow-back" size={24} color="#2D3A2B" />
        </TouchableOpacity>

        <View style={styles.header}>
          <Text style={styles.headerTitle}>
            {isPatientViewer ? 'My Medical Record' : 'Medical Record'}
          </Text>
          {patientName ? <Text style={styles.patientName}>{patientName}</Text> : null}
          <Text style={styles.patientId}>
            Patient no. {patientNumber}
            {dob ? `  ·  Born ${dob}` : ''}
          </Text>
        </View>

        {error ? (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{error}</Text>
            <TouchableOpacity onPress={onRefresh}>
              <Text style={styles.errorRetry}>Try again</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        {hasData ? (
          <>
            <View style={styles.statsRow}>
              <View style={styles.statBox}>
                <Text style={styles.statNumber}>{records.length}</Text>
                <Text style={styles.statLabel}>Visits</Text>
              </View>
              <View style={styles.statBox}>
                <Text style={styles.statNumber}>{activeRx.length}</Text>
                <Text style={styles.statLabel}>Active prescriptions</Text>
              </View>
              <View style={styles.statBox}>
                <Text style={styles.statNumber}>
                  {records[0] ? fmtDate(records[0].visit_date).split(' ').slice(0, 2).join(' ') : '—'}
                </Text>
                <Text style={styles.statLabel}>Last visit</Text>
              </View>
            </View>

            <Text style={styles.sectionTitle}>ALLERGIES</Text>
            {allergies.length > 0 ? (
              <View style={styles.pillContainer}>
                {allergies.map((a) => (
                  <View key={a} style={[styles.pill, styles.pillAllergy]}>
                    <Text style={styles.pillText}>{a}</Text>
                  </View>
                ))}
              </View>
            ) : (
              <Text style={styles.emptySectionText}>No allergies recorded</Text>
            )}

            <Text style={styles.sectionTitle}>CURRENT MEDICATION</Text>
            {medications.length > 0 ? (
              <View style={styles.pillContainer}>
                {medications.map((m) => (
                  <View key={m} style={styles.pill}>
                    <Text style={styles.pillText}>{m}</Text>
                  </View>
                ))}
              </View>
            ) : (
              <Text style={styles.emptySectionText}>No medication recorded</Text>
            )}

            <Text style={styles.sectionTitle}>VISIT HISTORY</Text>
            {records.length === 0 ? (
              <Text style={styles.emptySectionText}>No visits recorded yet</Text>
            ) : (
              records.map((r) => {
                const info = visitInfo(r);
                const open = expandedId === r.id;
                const vitals = vitalsOf(r.vitals);
                const snippet = (r.diagnosis_notes || '').trim();
                return (
                  <TouchableOpacity
                    key={r.id}
                    style={styles.visitCard}
                    activeOpacity={0.85}
                    onPress={() => setExpandedId(open ? null : r.id)}
                  >
                    <View style={styles.visitHead}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.visitDate}>
                          {fmtDate(r.visit_date)}
                          {info.time ? ` at ${info.time}` : ''}
                        </Text>
                        <Text style={styles.visitSub} numberOfLines={open ? 3 : 1}>
                          {[info.service, info.clinic].filter(Boolean).join(' · ') ||
                            (snippet ? snippet : 'Consultation')}
                        </Text>
                      </View>
                      {info.status ? (
                        <View style={styles.statusBadge}>
                          <Text style={styles.statusText}>{info.status}</Text>
                        </View>
                      ) : null}
                      <Ionicons
                        name={open ? 'chevron-up' : 'chevron-down'}
                        size={18}
                        color="#888"
                        style={{ marginLeft: 8 }}
                      />
                    </View>

                    {open ? (
                      <View style={styles.visitBody}>
                        {r.diagnosis_notes ? (
                          <>
                            <Text style={styles.notesLabel}>Diagnosis</Text>
                            <Text style={styles.notesText}>{r.diagnosis_notes}</Text>
                          </>
                        ) : null}
                        {r.doctor_notes && r.doctor_notes !== r.diagnosis_notes ? (
                          <>
                            <Text style={styles.notesLabel}>Clinical notes</Text>
                            <Text style={styles.notesText}>{r.doctor_notes}</Text>
                          </>
                        ) : null}
                        {r.treatment_plan ? (
                          <>
                            <Text style={styles.notesLabel}>Treatment plan</Text>
                            <Text style={styles.notesText}>{r.treatment_plan}</Text>
                          </>
                        ) : null}
                        {vitals.length > 0 ? (
                          <>
                            <Text style={styles.notesLabel}>Vitals</Text>
                            <Text style={styles.notesText}>
                              {vitals.map(([k, v]) => `${k}: ${v}`).join('   ·   ')}
                            </Text>
                          </>
                        ) : null}
                        {r.follow_up_date ? (
                          <>
                            <Text style={styles.notesLabel}>Follow-up</Text>
                            <Text style={styles.notesText}>{fmtDate(r.follow_up_date)}</Text>
                          </>
                        ) : null}
                        {!r.diagnosis_notes &&
                        !r.doctor_notes &&
                        !r.treatment_plan &&
                        vitals.length === 0 &&
                        !r.follow_up_date ? (
                          <Text style={styles.emptySectionText}>
                            No clinical details were recorded for this visit.
                          </Text>
                        ) : null}
                      </View>
                    ) : null}
                  </TouchableOpacity>
                );
              })
            )}

            <Text style={styles.sectionTitle}>PRESCRIPTIONS</Text>
            {prescriptions.length === 0 ? (
              <Text style={styles.emptySectionText}>No prescriptions</Text>
            ) : (
              prescriptions.map((rx) => {
                const status = effectiveStatus(rx);
                const chip = RX_CHIP[status] || RX_CHIP.active;
                return (
                  <View key={rx.id} style={styles.rxCard}>
                    <View style={styles.visitHead}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.visitDate}>Issued {fmtDate(rx.issued_at)}</Text>
                        <Text style={styles.visitSub}>
                          Valid until {fmtDate(rx.valid_until)} · {prescriberOf(rx).name}
                        </Text>
                      </View>
                      <View style={[styles.statusBadge, { backgroundColor: chip.bg }]}>
                        <Text style={[styles.statusText, { color: chip.fg }]}>{chip.label}</Text>
                      </View>
                    </View>
                    {(rx.medications || []).map((m, i) => (
                      <Text key={i} style={styles.rxLine}>
                        • {m.name} – {m.dosage}, {m.frequency}, {m.duration}
                      </Text>
                    ))}
                    {isPatientViewer ? (
                      <TouchableOpacity
                        onPress={() => navigation.navigate('Prescription', { prescriptionId: rx.id })}
                      >
                        <Text style={styles.rxLink}>View prescription →</Text>
                      </TouchableOpacity>
                    ) : null}
                  </View>
                );
              })
            )}

            <TouchableOpacity
              style={[styles.downloadButton, busy && { opacity: 0.6 }]}
              onPress={download}
              disabled={busy}
            >
              {busy ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <>
                  <Ionicons name="download-outline" size={20} color="#FFFFFF" />
                  <Text style={styles.downloadButtonText}>Download PDF</Text>
                </>
              )}
            </TouchableOpacity>
          </>
        ) : (
          <View style={styles.emptyContainer}>
            <Ionicons name="medical-outline" size={64} color="#CCC" />
            <Text style={styles.emptyTitle}>No Medical Records</Text>
            <Text style={styles.emptyText}>
              {isPatientViewer
                ? 'Your medical records will appear here after your first appointment.'
                : 'No medical records have been captured for this patient yet.'}
            </Text>
            {isPatientViewer ? (
              <TouchableOpacity
                style={styles.bookAppointmentButton}
                onPress={() => navigation.navigate('BookAppointment')}
              >
                <Text style={styles.bookAppointmentText}>Book an Appointment</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#F4F7F6' },
  container: { paddingHorizontal: 25, paddingBottom: 40 },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  loadingText: { marginTop: 12, fontSize: 14, color: '#666' },
  backButton: { marginTop: 10, width: 40, height: 40, justifyContent: 'center' },
  header: { alignItems: 'center', marginVertical: 16 },
  headerTitle: { fontSize: 22, fontWeight: 'bold', color: '#202020' },
  patientName: { fontSize: 16, fontWeight: '600', color: '#2D3A2B', marginTop: 6 },
  patientId: { fontSize: 13, color: '#707070', marginTop: 4 },
  errorBox: {
    backgroundColor: '#FFEBEE',
    borderRadius: 10,
    padding: 12,
    marginBottom: 12,
  },
  errorText: { color: '#C62828', fontSize: 13 },
  errorRetry: { color: '#C62828', fontWeight: '700', marginTop: 6 },
  statsRow: { flexDirection: 'row', gap: 10, marginTop: 4 },
  statBox: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 8,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#EAEAEA',
  },
  statNumber: { fontSize: 16, fontWeight: '700', color: '#2D3A2B', textAlign: 'center' },
  statLabel: { fontSize: 11, color: '#777', marginTop: 2, textAlign: 'center' },
  sectionTitle: {
    fontSize: 13,
    fontWeight: 'bold',
    color: '#2D3A2B',
    marginTop: 24,
    marginBottom: 10,
    letterSpacing: 0.5,
  },
  pillContainer: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  pill: {
    backgroundColor: '#769471',
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  pillAllergy: { backgroundColor: '#B65C5C' },
  pillText: { color: '#FFFFFF', fontSize: 12, fontWeight: '600' },
  emptySectionText: { fontSize: 14, color: '#999', fontStyle: 'italic' },
  visitCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#EAEAEA',
  },
  visitHead: { flexDirection: 'row', alignItems: 'center' },
  visitDate: { fontSize: 14, fontWeight: '700', color: '#2D3A2B' },
  visitSub: { fontSize: 12, color: '#666', marginTop: 2 },
  visitBody: { marginTop: 12, borderTopWidth: 1, borderTopColor: '#F0F0F0', paddingTop: 10 },
  notesLabel: { fontSize: 12, fontWeight: '700', color: '#444', marginTop: 8, marginBottom: 3 },
  notesText: { fontSize: 13, color: '#555', lineHeight: 19 },
  statusBadge: {
    backgroundColor: '#A8C6A3',
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 3,
    marginLeft: 8,
  },
  statusText: {
    color: '#2D3A2B',
    fontSize: 11,
    fontWeight: 'bold',
    textTransform: 'capitalize',
  },
  rxCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#EAEAEA',
  },
  rxLine: { fontSize: 13, color: '#444', marginTop: 6 },
  rxLink: { fontSize: 13, fontWeight: '700', color: '#6B7C5C', marginTop: 10 },
  downloadButton: {
    backgroundColor: '#3F4E65',
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 36,
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
  },
  downloadButtonText: { color: '#FFFFFF', fontWeight: 'bold', fontSize: 16 },
  emptyContainer: { alignItems: 'center', justifyContent: 'center', paddingVertical: 60 },
  emptyTitle: { fontSize: 18, fontWeight: '600', color: '#333', marginTop: 16 },
  emptyText: {
    fontSize: 14,
    color: '#999',
    textAlign: 'center',
    marginTop: 8,
    marginBottom: 20,
  },
  bookAppointmentButton: {
    backgroundColor: '#6B7C5C',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
  },
  bookAppointmentText: { color: '#FFF', fontSize: 14, fontWeight: '600' },
});