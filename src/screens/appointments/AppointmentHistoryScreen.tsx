import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { useAuth } from '../../context/AuthContext';
import { supabase } from '../../services/supabase/client';

export default function AppointmentHistoryScreen() {
  const navigation = useNavigation<any>();
  const { profile } = useAuth();
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!profile?.id) {
      setLoading(false);
      return;
    }
    try {
      const { data, error } = await supabase
        .from('appointments')
        .select('*, clinics(clinic_name), services(service_name), time_slots(date, start_time, end_time)')
        .eq('patient_id', profile.id)
        .order('created_at', { ascending: false });
      if (error) throw error;
      setItems(data || []);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [profile?.id]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={{ padding: 8 }}>
          <Ionicons name="arrow-back" size={22} color="#212121" />
        </TouchableOpacity>
        <Text style={styles.title}>Appointment history</Text>
      </View>
      {loading ? (
        <ActivityIndicator color="#2E7D32" style={{ marginTop: 40 }} />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />
          }
          ListEmptyComponent={<Text style={styles.empty}>No appointments yet</Text>}
          renderItem={({ item }) => (
            <TouchableOpacity
              style={styles.card}
              onPress={() => navigation.navigate('AppointmentDetail', { appointmentId: item.id })}
            >
              <View style={{ flex: 1 }}>
                <Text style={styles.clinic}>{item.clinics?.clinic_name || 'Clinic'}</Text>
                <Text style={styles.service}>{item.services?.service_name || 'Service'}</Text>
                <Text style={styles.meta}>
                  {item.time_slots?.date || item.appointment_date || item.created_at?.slice(0, 10)} · {(item.time_slots?.start_time || item.start_time || '—').slice(0, 5)}
                </Text>
              </View>
              <View style={[styles.badge, statusColor(item.status)]}>
                <Text style={styles.badgeText}>{item.status}</Text>
              </View>
            </TouchableOpacity>
          )}
        />
      )}
    </SafeAreaView>
  );
}

function statusColor(status: string) {
  switch (status) {
    case 'confirmed':
      return { backgroundColor: '#E8F5E9' };
    case 'cancelled':
      return { backgroundColor: '#FFEBEE' };
    case 'completed':
      return { backgroundColor: '#E3F2FD' };
    default:
      return { backgroundColor: '#FFF3E0' };
  }
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#F5F7F5' },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 10 },
  title: { fontSize: 18, fontWeight: '700', marginLeft: 4 },
  empty: { textAlign: 'center', color: '#9E9E9E', marginTop: 40 },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFF',
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
  },
  clinic: { fontWeight: '700', color: '#212121' },
  service: { fontSize: 13, color: '#616161', marginTop: 2 },
  meta: { fontSize: 12, color: '#9E9E9E', marginTop: 2 },
  badge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
  badgeText: { fontSize: 11, fontWeight: '600', textTransform: 'capitalize', color: '#424242' },
});
