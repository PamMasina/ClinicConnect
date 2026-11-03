import React, { useState, useCallback, useEffect } from 'react';
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

export default function NotificationsScreen() {
  const navigation = useNavigation<any>();
  const { user } = useAuth();
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!user?.id) {
      setLoading(false);
      return;
    }
    try {
      const { data, error } = await supabase
        .from('notifications')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });
      if (error) throw error;
      setItems(data || []);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [user?.id]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  // Live updates: new notifications appear without leaving or refreshing the screen.
  useEffect(() => {
    if (!user?.id) return;

    const channel = supabase
      .channel(`notifications-${user.id}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'notifications',
          filter: `user_id=eq.${user.id}`,
        },
        (payload) => {
          const row = payload.new as any;
          setItems((prev) =>
            prev.some((n) => n.id === row.id) ? prev : [row, ...prev]
          );
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'notifications',
          filter: `user_id=eq.${user.id}`,
        },
        (payload) => {
          const row = payload.new as any;
          setItems((prev) => prev.map((n) => (n.id === row.id ? { ...n, ...row } : n)));
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user?.id]);

  const markRead = async (id: string) => {
    await supabase.from('notifications').update({ is_read: true }).eq('id', id);
    setItems((prev) => prev.map((n) => (n.id === id ? { ...n, is_read: true } : n)));
  };

  const openNotification = async (item: any) => {
    await markRead(item.id);

    const data = item.data || {};
    const type = item.type || data.type;

    if (type === 'referral' || data.screen === 'Referral') {
      navigation.navigate('Referral', {
        referralId: data.referralId,
        patientId: data.patientId,
      });
      return;
    }

    if (data.prescriptionId) {
      navigation.navigate('Prescription', { prescriptionId: data.prescriptionId });
      return;
    }

    if (type === 'prescription' || data.screen === 'MedicalRecord') {
      navigation.navigate('MedicalRecord', {
        patientId: data.patientId,
      });
      return;
    }

    if (data.appointmentId) {
      navigation.navigate('AppointmentDetail', { appointmentId: data.appointmentId });
      return;
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={{ padding: 8 }}>
          <Ionicons name="arrow-back" size={22} color="#212121" />
        </TouchableOpacity>
        <Text style={styles.title}>Notifications</Text>
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
          ListEmptyComponent={
            <View style={styles.emptyWrap}>
              <Ionicons name="notifications-off-outline" size={40} color="#BDBDBD" />
              <Text style={styles.empty}>No notifications yet</Text>
            </View>
          }
          renderItem={({ item }) => (
            <TouchableOpacity
              style={[styles.card, !item.is_read && styles.unread]}
              onPress={() => openNotification(item)}
            >
              <Text style={styles.cardTitle}>{item.title || 'Notification'}</Text>
              <Text style={styles.cardBody}>{item.message}</Text>
              <Text style={styles.cardTime}>
                {item.created_at ? new Date(item.created_at).toLocaleString('en-ZA') : ''}
              </Text>
              {(item.type === 'referral' || item.data?.type === 'referral') && (
                <Text style={styles.cta}>Tap to view referral letter →</Text>
              )}
              {(item.type === 'prescription' || item.data?.type === 'prescription') && (
                <Text style={styles.cta}>Tap to view and download prescription →</Text>
              )}
            </TouchableOpacity>
          )}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#F5F7F5' },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 10 },
  title: { fontSize: 18, fontWeight: '700', marginLeft: 4 },
  emptyWrap: { alignItems: 'center', marginTop: 60 },
  empty: { color: '#9E9E9E', marginTop: 8 },
  card: {
    backgroundColor: '#FFF',
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
  },
  unread: { borderLeftWidth: 3, borderLeftColor: '#2E7D32' },
  cardTitle: { fontWeight: '700', color: '#212121', marginBottom: 4 },
  cardBody: { fontSize: 14, color: '#616161' },
  cardTime: { fontSize: 11, color: '#9E9E9E', marginTop: 6 },
  cta: { fontSize: 12, color: '#6B7C5C', fontWeight: '700', marginTop: 8 },
});