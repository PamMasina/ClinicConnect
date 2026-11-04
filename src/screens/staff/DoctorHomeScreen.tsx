import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { LinearGradient } from 'expo-linear-gradient';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../context/ThemeContext';
import { supabase } from '../../services/supabase/client';
import AppointmentStatusActions from '../../components/AppointmentStatusActions';
import { sendTodaysMorningSummaries } from '@/services/notifications/appointmentReminders';

export default function DoctorHomeScreen() {
  const navigation = useNavigation<any>();
  const { theme } = useTheme();
  const { staffProfile, logout } = useAuth();
  const [openCount, setOpenCount] = useState(0);
  const [todayQueue, setTodayQueue] = useState<any[]>([]);
  const [patients, setPatients] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const name = `${staffProfile?.first_name || 'Doctor'} ${staffProfile?.last_name || ''}`.trim();
  const specialty = staffProfile?.specialization;

  const load = useCallback(async () => {
    try {
      setError(null);
      const today = new Date().toISOString().slice(0, 10);

      const [{ count }, { data: appts, error: apptErr }, { data: pats, error: patErr }] =
        await Promise.all([
          supabase
            .from('appointments')
            .select('*', { count: 'exact', head: true })
            .in('status', ['booked', 'confirmed']),
          supabase
            .from('appointments')
            .select(
              `
              id,
              status,
              patient_id,
              created_at,
              patients ( first_name, last_name, contact_number ),
              services ( service_name ),
              time_slots ( date, start_time, end_time )
            `
            )
            .in('status', ['booked', 'confirmed'])
            .order('created_at', { ascending: false })
            .limit(15),
          supabase
            .from('patients')
            .select('id, first_name, last_name, contact_number, email, id_number')
            .eq('status', 'active')
            .order('last_name')
            .limit(20),
        ]);

      if (apptErr) throw apptErr;
      if (patErr) throw patErr;

      setOpenCount(count || 0);

      // Prefer today's slots when available
      const list = appts || [];
      const todays = list.filter((a: any) => a.time_slots?.date === today);
      setTodayQueue(todays.length > 0 ? todays : list);
      setPatients(pats || []);
    } catch (e: any) {
      console.error(e);
      setError(e.message || 'Failed to load dashboard');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      load();
      // Morning summary for today's appointments (no-op if the staff member
      // has no appointments today).
      sendTodaysMorningSummaries().catch(() => {});
    }, [load])
  );

  const formatSlot = (a: any) => {
    const slot = a.time_slots;
    if (slot?.date) {
      return `${slot.date} · ${slot.start_time || ''}${slot.end_time ? `–${slot.end_time}` : ''}`;
    }
    return a.status || 'Scheduled';
  };

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.colors.background }]}>
      <LinearGradient
        colors={['#B08968', '#FFFFFF', '#FFFFFF']}
        locations={[0, 0.15, 0.45]}
        style={{ flex: 1 }}
      >
        <ScrollView
          contentContainerStyle={styles.content}
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
          <View style={styles.headerRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.kicker}>Doctor</Text>
              <Text style={[styles.title, { color: theme.colors.text }]} numberOfLines={1}>
                {name}
              </Text>
              {specialty ? <Text style={styles.specialty}>{specialty}</Text> : null}
            </View>
            <TouchableOpacity
              style={styles.avatar}
              onPress={() => navigation.navigate('DoctorProfile')}
            >
              <Text style={styles.avatarText}>
                {(staffProfile?.first_name?.[0] || 'D') + (staffProfile?.last_name?.[0] || '')}
              </Text>
            </TouchableOpacity>
          </View>

          <View style={styles.stats}>
            <View style={[styles.statCard, { backgroundColor: theme.colors.surface }]}>
              <Text style={styles.statNum}>{openCount}</Text>
              <Text style={styles.statLabel}>Open appointments</Text>
            </View>
            <View style={[styles.statCard, { backgroundColor: theme.colors.surface }]}>
              <Text style={styles.statNum}>{patients.length}</Text>
              <Text style={styles.statLabel}>Patients</Text>
            </View>
          </View>

          <View style={styles.actions}>
            <TouchableOpacity
              style={styles.action}
              onPress={() => navigation.navigate('PatientSearch')}
            >
              <Ionicons name="search" size={22} color="#2196F3" />
              <Text style={styles.actionText}>Search patients</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.action}
              onPress={() => navigation.navigate('PatientSearch')}
            >
              <Ionicons name="document-text" size={22} color="#9C27B0" />
              <Text style={styles.actionText}>Medical records</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.action}
              onPress={() => navigation.navigate('Notifications')}
            >
              <Ionicons name="notifications-outline" size={22} color="#FF9800" />
              <Text style={styles.actionText}>Notifications</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.action}
              onPress={() => navigation.navigate('Referral')}
            >
              <Ionicons name="swap-horizontal" size={22} color="#2E7D32" />
              <Text style={styles.actionText}>Referrals</Text>
            </TouchableOpacity>
          </View>

          {error ? (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>{error}</Text>
              <TouchableOpacity onPress={load}>
                <Text style={styles.retry}>Retry</Text>
              </TouchableOpacity>
            </View>
          ) : null}

          <Text style={[styles.section, { color: theme.colors.text }]}>Appointment queue</Text>
          {loading ? (
            <ActivityIndicator color="#6B7C5C" />
          ) : todayQueue.length === 0 ? (
            <Text style={styles.empty}>No open appointments</Text>
          ) : (
            todayQueue.map((a) => (
              <View key={a.id}>
              <TouchableOpacity
                style={[styles.row, { backgroundColor: theme.colors.surface }]}
                onPress={() =>
                  a.patient_id &&
                  navigation.navigate('PatientDetailView', { patientId: a.patient_id })
                }
              >
                <View style={styles.pAvatar}>
                  <Text style={styles.pAvatarText}>
                    {(a.patients?.first_name?.[0] || '') + (a.patients?.last_name?.[0] || '')}
                  </Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.pName}>
                    {a.patients?.first_name} {a.patients?.last_name}
                  </Text>
                  <Text style={styles.pMeta}>
                    {a.services?.service_name || 'Consultation'} · {formatSlot(a)}
                  </Text>
                  <Text style={styles.status}>{a.status}</Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color="#BDBDBD" />
              </TouchableOpacity>
              <AppointmentStatusActions
                appointmentId={a.id}
                status={a.status}
                slot={a.time_slots}
                onChanged={load}
                onPrescribe={() =>
                  navigation.navigate('WritePrescription', {
                    appointmentId: a.id,
                    patientId: a.patient_id,
                    patientName: `${a.patients?.first_name || ''} ${a.patients?.last_name || ''}`.trim(),
                  })
                }
              />
              </View>
            ))
          )}

          <Text style={[styles.section, { color: theme.colors.text, marginTop: 12 }]}>
            Recent patients
          </Text>
          {loading ? null : patients.length === 0 ? (
            <Text style={styles.empty}>No patients found</Text>
          ) : (
            patients.slice(0, 8).map((p) => (
              <TouchableOpacity
                key={p.id}
                style={[styles.row, { backgroundColor: theme.colors.surface }]}
                onPress={() => navigation.navigate('PatientDetailView', { patientId: p.id })}
              >
                <View style={styles.pAvatar}>
                  <Text style={styles.pAvatarText}>
                    {(p.first_name?.[0] || '') + (p.last_name?.[0] || '')}
                  </Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.pName}>
                    {p.first_name} {p.last_name}
                  </Text>
                  <Text style={styles.pMeta}>{p.contact_number || p.email || p.id_number || '—'}</Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color="#BDBDBD" />
              </TouchableOpacity>
            ))
          )}

          <TouchableOpacity
            style={styles.logout}
            onPress={() =>
              Alert.alert('Sign out', 'Are you sure?', [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Sign out', style: 'destructive', onPress: () => logout() },
              ])
            }
          >
            <Ionicons name="log-out-outline" size={18} color="#E53935" />
            <Text style={styles.logoutText}>Sign out</Text>
          </TouchableOpacity>
        </ScrollView>
      </LinearGradient>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  content: { padding: 16, paddingBottom: 40 },
  headerRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 16 },
  kicker: { color: '#6B7C5C', fontWeight: '700', fontSize: 12 },
  title: { fontSize: 24, fontWeight: '700' },
  specialty: { fontSize: 13, color: '#777', marginTop: 2 },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#6B7C5C',
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarText: { color: '#FFF', fontWeight: '700' },
  stats: { flexDirection: 'row', gap: 10, marginBottom: 12 },
  statCard: {
    flex: 1,
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: '#E8E8E8',
    alignItems: 'center',
  },
  statNum: { fontSize: 26, fontWeight: '700', color: '#6B7C5C' },
  statLabel: { fontSize: 12, color: '#777', marginTop: 4, textAlign: 'center' },
  actions: { flexDirection: 'row', gap: 8, marginBottom: 16 },
  action: {
    flex: 1,
    backgroundColor: '#FFF',
    borderRadius: 12,
    padding: 12,
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderColor: '#E8E8E8',
  },
  actionText: { fontSize: 11, fontWeight: '600', color: '#333', textAlign: 'center' },
  section: { fontSize: 16, fontWeight: '700', marginBottom: 10 },
  empty: { textAlign: 'center', color: '#999', marginVertical: 16 },
  errorBox: {
    backgroundColor: '#FFEBEE',
    padding: 12,
    borderRadius: 10,
    marginBottom: 12,
  },
  errorText: { color: '#C62828', fontSize: 13 },
  retry: { color: '#6B7C5C', fontWeight: '700', marginTop: 6 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#E8E8E8',
    gap: 12,
  },
  pAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#E3F2FD',
    justifyContent: 'center',
    alignItems: 'center',
  },
  pAvatarText: { color: '#1565C0', fontWeight: '700', fontSize: 12 },
  pName: { fontWeight: '600', color: '#222' },
  pMeta: { fontSize: 12, color: '#888', marginTop: 2 },
  status: { fontSize: 11, color: '#6B7C5C', fontWeight: '600', marginTop: 2, textTransform: 'capitalize' },
  logout: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 6,
    marginTop: 20,
    backgroundColor: '#FFF',
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E8E8E8',
  },
  logoutText: { color: '#E53935', fontWeight: '700' },
});