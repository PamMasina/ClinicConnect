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

export default function NurseHomeScreen() {
  const navigation = useNavigation<any>();
  const { theme } = useTheme();
  const { staffProfile, logout } = useAuth();
  const [queue, setQueue] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const name = `${staffProfile?.first_name || 'Nurse'} ${staffProfile?.last_name || ''}`.trim();
  const department = staffProfile?.department;

  const load = useCallback(async () => {
    try {
      setError(null);
      const { data, error: qErr } = await supabase
        .from('appointments')
        .select(
          `
          id,
          status,
          patient_id,
          created_at,
          patients ( first_name, last_name, contact_number ),
          services ( service_name ),
          clinics ( clinic_name ),
          time_slots ( date, start_time, end_time )
        `
        )
        .in('status', ['booked', 'confirmed'])
        .order('created_at', { ascending: false })
        .limit(25);

      if (qErr) throw qErr;
      setQueue(data || []);
    } catch (e: any) {
      console.error(e);
      setError(e.message || 'Failed to load queue');
      setQueue([]);
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
    return a.created_at ? new Date(a.created_at).toLocaleDateString('en-ZA') : '—';
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
              <Text style={styles.kicker}>Nurse</Text>
              <Text style={[styles.title, { color: theme.colors.text }]} numberOfLines={1}>
                {name}
              </Text>
              {department ? <Text style={styles.dept}>{department}</Text> : null}
            </View>
            <TouchableOpacity
              style={styles.avatar}
              onPress={() => navigation.navigate('NurseProfile')}
            >
              <Text style={styles.avatarText}>
                {(staffProfile?.first_name?.[0] || 'N') + (staffProfile?.last_name?.[0] || '')}
              </Text>
            </TouchableOpacity>
          </View>

          <View style={styles.actions}>
            <TouchableOpacity
              style={styles.action}
              onPress={() => navigation.navigate('PatientSearch')}
            >
              <Ionicons name="search" size={22} color="#00838F" />
              <Text style={styles.actionText}>Find patient</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.action}
              onPress={() => navigation.navigate('PatientSearch')}
            >
              <Ionicons name="create-outline" size={22} color="#6A1B9A" />
              <Text style={styles.actionText}>Record notes</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.action}
              onPress={() => navigation.navigate('Notifications')}
            >
              <Ionicons name="notifications-outline" size={22} color="#FF9800" />
              <Text style={styles.actionText}>Alerts</Text>
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

          <Text style={[styles.section, { color: theme.colors.text }]}>
            Appointment queue ({queue.length})
          </Text>
          {loading ? (
            <ActivityIndicator color="#6B7C5C" />
          ) : queue.length === 0 ? (
            <Text style={styles.empty}>No appointments in queue</Text>
          ) : (
            queue.map((a) => (
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
                    {a.services?.service_name || 'Visit'} · {formatSlot(a)}
                  </Text>
                  <Text style={styles.pMeta}>
                    {a.clinics?.clinic_name || 'Clinic'} · {a.status}
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color="#BDBDBD" />
              </TouchableOpacity>
              <AppointmentStatusActions
                appointmentId={a.id}
                status={a.status}
                slot={a.time_slots}
                onChanged={load}
              />
              </View>
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
  kicker: { color: '#00838F', fontWeight: '700', fontSize: 12 },
  title: { fontSize: 24, fontWeight: '700' },
  dept: { fontSize: 13, color: '#777', marginTop: 2 },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#00838F',
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarText: { color: '#FFF', fontWeight: '700' },
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
  empty: { textAlign: 'center', color: '#999', marginVertical: 20 },
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
    backgroundColor: '#E0F7FA',
    justifyContent: 'center',
    alignItems: 'center',
  },
  pAvatarText: { color: '#00838F', fontWeight: '700', fontSize: 12 },
  pName: { fontWeight: '600', color: '#222' },
  pMeta: { fontSize: 12, color: '#888', marginTop: 2 },
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