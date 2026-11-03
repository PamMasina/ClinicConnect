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
  useWindowDimensions,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { LinearGradient } from 'expo-linear-gradient';
import { RootStackParamList } from '../../navigation/types';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../context/ThemeContext';
import { supabase } from '../../services/supabase/client';
import { sendDueAppointmentReminders } from '../../services/notifications/appointmentReminders';

type Nav = NativeStackNavigationProp<RootStackParamList>;

const QUICK_ACTIONS = [
  { id: 'book', label: 'Book Appointment', icon: 'calendar-outline' as const, color: '#6B7C5C', route: 'SelectClinic' as const },
  { id: 'nearby', label: 'Nearby Clinics', icon: 'location-outline' as const, color: '#4A90D9', route: 'NearbyClinics' as const },
  { id: 'records', label: 'Medical Records', icon: 'document-text-outline' as const, color: '#9C27B0', route: 'MedicalRecord' as const },
  { id: 'emergency', label: 'Emergency', icon: 'warning-outline' as const, color: '#E53935', route: 'Emergency' as const },
  { id: 'tips', label: 'Health Tips', icon: 'heart-outline' as const, color: '#00838F', route: 'HealthTips' as const },
  { id: 'alerts', label: 'My Alerts', icon: 'notifications-outline' as const, color: '#FF6F00', route: 'Alerts' as const },
];

function statusStyle(status: string) {
  switch (status) {
    case 'confirmed':
      return { bg: '#E8F5E9', text: '#2E7D32' };
    case 'cancelled':
      return { bg: '#FFEBEE', text: '#C62828' };
    case 'completed':
      return { bg: '#E3F2FD', text: '#1565C0' };
    default:
      return { bg: '#FFF3E0', text: '#EF6C00' };
  }
}

export default function PatientHomeScreen() {
  const navigation = useNavigation<Nav>();
  const { theme } = useTheme();
  const { profile, logout } = useAuth();
  const { width } = useWindowDimensions();
  const [upcoming, setUpcoming] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const isWeb = Platform.OS === 'web';
  const isDesktop = isWeb && width >= 1024;
  const menuColumns = isDesktop ? 3 : 2;

  const firstName = profile?.first_name || 'Patient';
  const lastName = profile?.last_name || '';
  const initials =
    `${profile?.first_name?.[0] || 'P'}${profile?.last_name?.[0] || ''}`.toUpperCase();

  const fetchUpcoming = useCallback(async () => {
    if (!profile?.id) {
      setLoading(false);
      setRefreshing(false);
      return;
    }
    try {
      const { data, error } = await supabase
        .from('appointments')
        .select('*, clinics(clinic_name), services(service_name), time_slots(date, start_time, end_time)')
        .eq('patient_id', profile.id)
        .in('status', ['booked', 'confirmed'])
        .order('created_at', { ascending: false })
        .limit(5);
      if (error) throw error;
      setUpcoming(data || []);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [profile?.id]);

  useFocusEffect(
    useCallback(() => {
      fetchUpcoming();
      // Daily sweep: fire due appointment reminders for upcoming appointments.
      sendDueAppointmentReminders().catch(() => {});
    }, [fetchUpcoming])
  );

  const onRefresh = () => {
    setRefreshing(true);
    fetchUpcoming();
  };

  const handleLogout = () => {
    Alert.alert('Sign Out', 'Are you sure you want to sign out?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign Out',
        style: 'destructive',
        onPress: async () => {
          try {
            await logout();
          } catch {
            Alert.alert('Error', 'Failed to sign out');
          }
        },
      },
    ]);
  };

  if (loading && !refreshing) {
    return (
      <SafeAreaView style={[styles.safeArea, { backgroundColor: theme.colors.background }]}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#6B7C5C" />
          <Text style={styles.loadingText}>Loading home...</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: theme.colors.background }]}>
      <LinearGradient
        colors={['#B08968', '#FFFFFF', '#FFFFFF']}
        locations={[0, 0.15, 0.5]}
        style={styles.gradient}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={['#6B7C5C']} />
          }
          showsVerticalScrollIndicator={false}
        >
          {/* Header — same pattern as AdminDashboard */}
          <View style={styles.header}>
            <View style={styles.headerRow}>
              <View style={styles.headerTextContainer}>
                <Text style={[styles.headerTitle, { color: theme.colors.text }]}>
                  Welcome, {firstName}
                </Text>
                <Text style={[styles.headerSubtitle, { color: theme.colors.textSecondary }]}>
                  Connecting Patients With Healthcare
                </Text>
              </View>
              <View style={styles.headerActions}>
                <TouchableOpacity
                  style={styles.iconButton}
                  onPress={() => navigation.navigate('Notifications')}
                  accessibilityLabel="Notifications"
                >
                  <Ionicons name="notifications-outline" size={22} color="#6B7C5C" />
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.avatarButton}
                  onPress={() => navigation.navigate('PatientProfile')}
                  accessibilityLabel="Profile"
                >
                  <Text style={styles.avatarText}>{initials}</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>

          {/* Quick Actions — same card grid as Admin */}
          <Text style={[styles.sectionTitle, { color: theme.colors.text }]}>Quick Actions</Text>
          <View style={styles.menuGrid}>
            {QUICK_ACTIONS.map((item) => (
              <TouchableOpacity
                key={item.id}
                style={[
                  styles.menuCard,
                  {
                    backgroundColor: theme.colors.surface,
                    width: `${100 / menuColumns - 2}%` as any,
                  },
                ]}
                onPress={() => navigation.navigate(item.route as any)}
                activeOpacity={0.85}
              >
                <View style={[styles.menuIconContainer, { backgroundColor: item.color + '15' }]}>
                  <Ionicons name={item.icon} size={28} color={item.color} />
                </View>
                <Text style={[styles.menuLabel, { color: theme.colors.text }]}>{item.label}</Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* Upcoming appointments */}
          <View style={styles.sectionHeader}>
            <Text style={[styles.sectionTitle, { color: theme.colors.text, marginTop: 0, marginBottom: 0 }]}>
              Upcoming Appointments
            </Text>
            <TouchableOpacity onPress={() => navigation.navigate('AppointmentHistory')}>
              <Text style={styles.linkText}>View all</Text>
            </TouchableOpacity>
          </View>

          <View style={[styles.listContainer, { backgroundColor: theme.colors.surface }]}>
            {upcoming.length === 0 ? (
              <View style={styles.emptyState}>
                <Ionicons name="calendar-outline" size={40} color="#BDBDBD" />
                <Text style={[styles.emptyText, { color: theme.colors.textSecondary }]}>
                  No upcoming appointments
                </Text>
                <TouchableOpacity
                  style={styles.primaryButton}
                  onPress={() => navigation.navigate('SelectClinic')}
                >
                  <Text style={styles.primaryButtonText}>Book an appointment</Text>
                </TouchableOpacity>
              </View>
            ) : (
              upcoming.map((apt, index) => {
                const st = statusStyle(apt.status);
                return (
                  <TouchableOpacity
                    key={apt.id}
                    style={[
                      styles.activityItem,
                      index < upcoming.length - 1 && styles.activityBorder,
                    ]}
                    onPress={() =>
                      navigation.navigate('AppointmentDetail', { appointmentId: apt.id })
                    }
                  >
                    <View style={[styles.activityIcon, { backgroundColor: '#6B7C5C20' }]}>
                      <Ionicons name="calendar-outline" size={16} color="#6B7C5C" />
                    </View>
                    <View style={styles.activityContent}>
                      <Text style={[styles.activityDescription, { color: theme.colors.text }]}>
                        {apt.clinics?.clinic_name || 'Clinic'}
                      </Text>
                      <Text style={[styles.activityTimestamp, { color: theme.colors.textSecondary }]}>
                        {apt.services?.service_name || 'Consultation'} ·{' '}
                        {apt.time_slots?.date || apt.appointment_date || apt.created_at?.slice(0, 10)} ·{' '}
                        {(apt.time_slots?.start_time || apt.start_time || '—').slice(0, 5)}
                      </Text>
                    </View>
                    <View style={[styles.badge, { backgroundColor: st.bg }]}>
                      <Text style={[styles.badgeText, { color: st.text }]}>{apt.status}</Text>
                    </View>
                  </TouchableOpacity>
                );
              })
            )}
          </View>

          {/* Logout — same control as Admin */}
          <TouchableOpacity
            style={styles.logoutButton}
            onPress={handleLogout}
            accessibilityLabel="Sign out"
          >
            <Ionicons name="log-out-outline" size={22} color="#E53935" />
            <Text style={styles.logoutText}>Logout</Text>
          </TouchableOpacity>
        </ScrollView>
      </LinearGradient>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  gradient: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 40,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 12,
    fontSize: 14,
    color: '#666',
  },
  header: {
    marginBottom: 24,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerTextContainer: {
    flex: 1,
    marginRight: 12,
  },
  headerTitle: {
    fontSize: 28,
    fontWeight: '700',
  },
  headerSubtitle: {
    fontSize: 14,
    marginTop: 4,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  iconButton: {
    width: 42,
    height: 42,
    borderRadius: 10,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E8E8E8',
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: '#6B7C5C',
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarText: {
    color: '#FFF',
    fontWeight: '700',
    fontSize: 14,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 12,
    marginTop: 8,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
    marginTop: 8,
  },
  linkText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#6B7C5C',
  },
  menuGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    gap: 10,
    marginBottom: 8,
  },
  menuCard: {
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#E8E8E8',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 1,
  },
  menuIconContainer: {
    width: 56,
    height: 56,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 10,
  },
  menuLabel: {
    fontSize: 13,
    fontWeight: '600',
    textAlign: 'center',
  },
  listContainer: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E8E8E8',
    overflow: 'hidden',
    marginBottom: 8,
  },
  activityItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    gap: 12,
  },
  activityBorder: {
    borderBottomWidth: 1,
    borderBottomColor: '#F0F0F0',
  },
  activityIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
  },
  activityContent: {
    flex: 1,
  },
  activityDescription: {
    fontSize: 14,
    fontWeight: '600',
  },
  activityTimestamp: {
    fontSize: 12,
    marginTop: 2,
  },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'capitalize',
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 36,
    paddingHorizontal: 16,
  },
  emptyText: {
    fontSize: 14,
    marginTop: 8,
    marginBottom: 16,
  },
  primaryButton: {
    backgroundColor: '#6B7C5C',
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderRadius: 10,
  },
  primaryButtonText: {
    color: '#FFF',
    fontWeight: '600',
    fontSize: 14,
  },
  logoutButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    backgroundColor: '#FFFFFF',
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#E8E8E8',
    gap: 6,
    marginTop: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 1,
  },
  logoutText: {
    color: '#E53935',
    fontWeight: '600',
    fontSize: 14,
  },
});