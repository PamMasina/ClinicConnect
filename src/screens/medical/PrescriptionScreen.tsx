import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useRoute, useFocusEffect } from '@react-navigation/native';
import { useAuth } from '../../context/AuthContext';
import {
  prescriptionsApi,
  Prescription,
  effectiveStatus,
  prescriberOf,
} from '../../services/api/prescriptions';
import { shareOrDownloadPdf, shareOrDownloadText } from '../../utils/shareText';
import { notify } from '../../utils/dialogs';

const STATUS_CHIP: Record<Prescription['status'], { label: string; bg: string; fg: string }> = {
  active: { label: 'Active', bg: '#E8F5E9', fg: '#2E7D32' },
  expired: { label: 'Expired', bg: '#FFF3E0', fg: '#E65100' },
  cancelled: { label: 'Cancelled', bg: '#FFEBEE', fg: '#C62828' },
  completed: { label: 'Completed', bg: '#F3E5F5', fg: '#7B1FA2' },
};

function fmtDate(d?: string | null) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-ZA', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

export default function PrescriptionScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const { profile } = useAuth();
  const prescriptionId: string | undefined = route.params?.prescriptionId;

  const [rx, setRx] = useState<Prescription | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!prescriptionId) {
      setError('No prescription selected.');
      setLoading(false);
      return;
    }
    try {
      setError(null);
      const found = await prescriptionsApi.getById(prescriptionId);
      if (!found) setError('This prescription could not be found.');
      setRx(found);
    } catch (e: any) {
      console.error('Failed to load prescription:', e);
      setError(e?.message || 'Could not load the prescription.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [prescriptionId]);

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      load();
    }, [load])
  );

  const patientName =
    rx?.patients
      ? `${rx.patients.first_name || ''} ${rx.patients.last_name || ''}`.trim()
      : profile
      ? `${profile.first_name || ''} ${profile.last_name || ''}`.trim()
      : undefined;

  const download = async () => {
    if (!rx) return;
    try {
      setBusy(true);
      const name = `prescription-${rx.id.slice(0, 8)}`;
      try {
        await shareOrDownloadPdf(`${name}.pdf`, prescriptionsApi.formatAsHtml(rx, patientName));
      } catch {
        await shareOrDownloadText(`${name}.txt`, prescriptionsApi.formatAsText(rx, patientName));
      }
    } catch (e: any) {
      notify('Could not download', e?.message || 'Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const header = (
    <View style={styles.header}>
      <TouchableOpacity onPress={() => navigation.goBack()} style={styles.back}>
        <Ionicons name="arrow-back" size={22} color="#212121" />
      </TouchableOpacity>
      <Text style={styles.title}>Prescription</Text>
    </View>
  );

  if (loading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        {header}
        <ActivityIndicator size="large" color="#6B7C5C" style={{ marginTop: 40 }} />
      </SafeAreaView>
    );
  }

  if (error || !rx) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        {header}
        <Text style={styles.error}>{error || 'Prescription not found.'}</Text>
      </SafeAreaView>
    );
  }

  const status = effectiveStatus(rx);
  const chip = STATUS_CHIP[status];
  const prescriber = prescriberOf(rx);
  const doctor = prescriber.specialization
    ? `${prescriber.name} · ${prescriber.specialization}`
    : prescriber.name;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {header}
      <ScrollView
        contentContainerStyle={styles.body}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              load();
            }}
            colors={['#6B7C5C']}
          />
        }
      >
        <Text style={styles.sub}>ID {rx.id.slice(0, 8).toUpperCase()}</Text>
        <View style={[styles.badge, { backgroundColor: chip.bg }]}>
          <Text style={[styles.badgeText, { color: chip.fg }]}>{chip.label}</Text>
        </View>

        {status !== 'active' ? (
          <Text style={styles.warning}>This prescription is no longer valid ({status}).</Text>
        ) : null}

        <View style={styles.card}>
          <Text style={styles.cardLabel}>DETAILS</Text>
          <Row label="Issued by" value={doctor} />
          {prescriber.licenseNumber ? (
            <Row label="Registration no." value={prescriber.licenseNumber} />
          ) : null}
          <Row label="Date issued" value={fmtDate(rx.issued_at || rx.created_at)} />
          <Row label="Valid until" value={fmtDate(rx.valid_until)} />
          {rx.diagnosis ? <Row label="Diagnosis" value={rx.diagnosis} /> : null}
        </View>

        <View style={styles.card}>
          <Text style={styles.cardLabel}>MEDICATIONS</Text>
          {(rx.medications || []).map((m, i) => (
            <View key={i} style={styles.med}>
              <Text style={styles.medName}>
                {i + 1}. {m.name}
              </Text>
              <Text style={styles.medLine}>
                {m.dosage} · {m.frequency} · {m.duration}
              </Text>
              {m.instructions ? <Text style={styles.medNote}>{m.instructions}</Text> : null}
            </View>
          ))}
        </View>

        {rx.notes ? (
          <View style={styles.card}>
            <Text style={styles.cardLabel}>NOTES</Text>
            <Text style={styles.bodyText}>{rx.notes}</Text>
          </View>
        ) : null}

        <TouchableOpacity
          style={[styles.primaryBtn, busy && { opacity: 0.6 }]}
          onPress={download}
          disabled={busy}
        >
          {busy ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <>
              <Ionicons name="download-outline" size={18} color="#fff" />
              <Text style={styles.primaryBtnText}>Download prescription</Text>
            </>
          )}
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.infoRow}>
      <Text style={styles.infoKey}>{label}</Text>
      <Text style={styles.infoVal}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#F4F7F6' },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 10 },
  back: { padding: 8 },
  title: { fontSize: 18, fontWeight: '700', marginLeft: 4, color: '#1a1a1a' },
  body: { padding: 16, paddingBottom: 40 },
  error: { color: '#C62828', padding: 20, fontSize: 14 },
  sub: { fontSize: 13, color: '#777', marginBottom: 8 },
  badge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 14,
    marginBottom: 14,
  },
  badgeText: { fontSize: 12, fontWeight: '700' },
  warning: {
    backgroundColor: '#FFEBEE',
    color: '#C62828',
    padding: 10,
    borderRadius: 8,
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 12,
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 14,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#E8E8E8',
  },
  cardLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#6B7C5C',
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#EEE',
  },
  infoKey: { fontSize: 13, color: '#777' },
  infoVal: { fontSize: 13, fontWeight: '600', color: '#222', maxWidth: '60%', textAlign: 'right' },
  med: { paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#EEE' },
  medName: { fontSize: 15, fontWeight: '700', color: '#1a1a1a' },
  medLine: { fontSize: 13, color: '#555', marginTop: 2 },
  medNote: { fontSize: 12, color: '#777', fontStyle: 'italic', marginTop: 3 },
  bodyText: { fontSize: 14, color: '#333', lineHeight: 20 },
  primaryBtn: {
    backgroundColor: '#6B7C5C',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 8,
    marginTop: 8,
  },
  primaryBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
});