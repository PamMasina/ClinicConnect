import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useRoute } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../../navigation/types';
import { clinicApi, Clinic } from '../../services/api/clinic';
import { getBestLocation, calculateDistance } from '../../utils/location';

type NavigationProp = NativeStackNavigationProp<RootStackParamList, 'BookAppointment'>;
type RouteProp = import('@react-navigation/native').RouteProp<RootStackParamList, 'BookAppointment'>;

interface ClinicWithDistance extends Clinic {
  distanceKm?: number;
}

const formatDistance = (km: number) =>
  km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(1)} km`;

/**
 * Book Appointment (opened from Medical Records and anywhere else).
 * Same clinic list as the main booking flow: nearest first, searchable,
 * nothing pre-selected, one tap on a clinic moves on to choosing a service.
 */
export default function BookAppointmentScreen() {
  const navigation = useNavigation<NavigationProp>();
  const route = useRoute<RouteProp>();
  const presetClinicId = route.params?.clinicId;

  const [clinics, setClinics] = useState<ClinicWithDistance[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [locationNote, setLocationNote] = useState<string | null>(null);

  const goToServices = useCallback(
    (clinic: Pick<Clinic, 'id' | 'clinic_name'>, replace = false) => {
      const params = { clinicId: clinic.id, clinicName: clinic.clinic_name };
      if (replace) navigation.replace('SelectService', params);
      else navigation.navigate('SelectService', params);
    },
    [navigation]
  );

  const fetchClinics = useCallback(async () => {
    try {
      setError(null);
      setLocationNote(null);

      const data = await clinicApi.getAll();

      // Opened for one specific clinic: skip the list.
      if (presetClinicId) {
        const match = data.find((c) => c.id === presetClinicId);
        if (match) {
          goToServices(match, true);
          return;
        }
      }

      let list: ClinicWithDistance[] = data;
      try {
        const loc = await getBestLocation();
        list = data.map((c) =>
          c.latitude && c.longitude
            ? { ...c, distanceKm: calculateDistance(loc.latitude, loc.longitude, c.latitude, c.longitude) }
            : c
        );
        list.sort((a, b) => (a.distanceKm ?? Infinity) - (b.distanceKm ?? Infinity));
      } catch {
        setLocationNote('Location unavailable, so clinics are listed alphabetically.');
      }
      setClinics(list);
    } catch (e) {
      console.error('Failed to fetch clinics:', e);
      setError('Unable to load clinics. Please try again.');
    } finally {
      setIsLoading(false);
      setRefreshing(false);
    }
  }, [presetClinicId, goToServices]);

  useEffect(() => {
    fetchClinics();
  }, [fetchClinics]);

  const q = searchQuery.trim().toLowerCase();
  const filtered = clinics.filter(
    (c) =>
      !q ||
      c.clinic_name.toLowerCase().includes(q) ||
      (c.address || '').toLowerCase().includes(q) ||
      (c.location || '').toLowerCase().includes(q)
  );

  return (
    <LinearGradient
      colors={['#B08968', '#FFFFFF', '#FFFFFF']}
      locations={[0, 0.3, 0.6]}
      style={styles.root}
    >
      <SafeAreaView style={styles.safeArea}>
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => {
                setRefreshing(true);
                fetchClinics();
              }}
              colors={['#6B7C5C']}
            />
          }
        >
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
            <Ionicons name="arrow-back" size={20} color="#FFF" />
          </TouchableOpacity>

          <Text style={styles.title}>Book an appointment</Text>
          <Text style={styles.stepText}>Step 1 of 4 - Clinic</Text>

          <View style={styles.searchContainer}>
            <Ionicons name="search-outline" size={18} color="#999" style={styles.searchIcon} />
            <TextInput
              style={styles.searchInput}
              placeholder="Search clinics by name or area..."
              placeholderTextColor="#999"
              value={searchQuery}
              onChangeText={setSearchQuery}
            />
            {searchQuery.length > 0 && (
              <TouchableOpacity onPress={() => setSearchQuery('')} hitSlop={8}>
                <Ionicons name="close-circle" size={18} color="#BDBDBD" />
              </TouchableOpacity>
            )}
          </View>

          <Text style={styles.sectionLabel}>
            {isLoading ? 'SELECT CLINIC' : `SELECT CLINIC · ${filtered.length} FOUND`}
          </Text>
          {locationNote ? <Text style={styles.note}>{locationNote}</Text> : null}

          <View style={styles.listCard}>
            {isLoading && (
              <View style={styles.stateContainer}>
                <ActivityIndicator size="large" color="#6B7C5C" />
                <Text style={styles.stateText}>Loading clinics...</Text>
              </View>
            )}

            {!isLoading && error && (
              <View style={styles.stateContainer}>
                <Ionicons name="alert-circle-outline" size={40} color="#E53935" />
                <Text style={styles.stateText}>{error}</Text>
                <TouchableOpacity
                  style={styles.retryButton}
                  onPress={() => {
                    setIsLoading(true);
                    fetchClinics();
                  }}
                >
                  <Text style={styles.retryButtonText}>Try Again</Text>
                </TouchableOpacity>
              </View>
            )}

            {!isLoading && !error && filtered.length === 0 && (
              <View style={styles.stateContainer}>
                <Ionicons name="business-outline" size={40} color="#CCC" />
                <Text style={styles.stateText}>
                  {searchQuery ? 'No clinics match your search' : 'No clinics available right now'}
                </Text>
              </View>
            )}

            {!isLoading &&
              !error &&
              filtered.map((clinic, index) => (
                <TouchableOpacity
                  key={clinic.id}
                  style={[styles.clinicRow, index === filtered.length - 1 && styles.clinicRowLast]}
                  onPress={() => goToServices(clinic)}
                  activeOpacity={0.75}
                >
                  <View style={styles.clinicIcon}>
                    <Ionicons name="medical-outline" size={20} color="#6B7C5C" />
                  </View>
                  <View style={styles.clinicInfo}>
                    <Text style={styles.clinicName}>{clinic.clinic_name}</Text>
                    <Text style={styles.clinicMeta} numberOfLines={1}>
                      {clinic.location || clinic.address || ''}
                    </Text>
                    {clinic.operating_hours ? (
                      <Text style={styles.clinicHours} numberOfLines={1}>
                        {clinic.operating_hours}
                      </Text>
                    ) : null}
                  </View>
                  {clinic.distanceKm != null && (
                    <Text style={styles.clinicDistance}>{formatDistance(clinic.distanceKm)}</Text>
                  )}
                  <Ionicons name="chevron-forward" size={18} color="#BDBDBD" />
                </TouchableOpacity>
              ))}
          </View>
        </ScrollView>
      </SafeAreaView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  safeArea: { flex: 1 },
  scrollContent: { padding: 16, paddingBottom: 40 },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(0,0,0,0.25)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
  },
  title: { fontSize: 24, fontWeight: '700', color: '#FFF' },
  stepText: { fontSize: 13, color: '#FFFFFFCC', marginTop: 4, marginBottom: 20 },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFF',
    borderRadius: 24,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: '#E0E0E0',
    marginBottom: 18,
  },
  searchIcon: { marginRight: 8 },
  searchInput: { flex: 1, paddingVertical: 12, fontSize: 14, color: '#333' },
  sectionLabel: { fontSize: 12, fontWeight: '700', letterSpacing: 0.6, color: '#333', marginBottom: 8 },
  note: { fontSize: 12, color: '#888', marginBottom: 8 },
  listCard: {
    backgroundColor: '#FFF',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E0E0E0',
    overflow: 'hidden',
  },
  stateContainer: { alignItems: 'center', justifyContent: 'center', paddingVertical: 40, paddingHorizontal: 16 },
  stateText: { fontSize: 14, color: '#666', marginTop: 10, textAlign: 'center' },
  retryButton: { marginTop: 14, backgroundColor: '#6B7C5C', paddingHorizontal: 18, paddingVertical: 10, borderRadius: 8 },
  retryButtonText: { color: '#FFF', fontWeight: '600' },
  clinicRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#F0F0F0',
    gap: 12,
  },
  clinicRowLast: { borderBottomWidth: 0 },
  clinicIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: '#6B7C5C15',
    justifyContent: 'center',
    alignItems: 'center',
  },
  clinicInfo: { flex: 1 },
  clinicName: { fontSize: 15, fontWeight: '600', color: '#1a1a1a' },
  clinicMeta: { fontSize: 13, color: '#666', marginTop: 2 },
  clinicHours: { fontSize: 12, color: '#999', marginTop: 2 },
  clinicDistance: { fontSize: 12, fontWeight: '600', color: '#6B7C5C' },
});