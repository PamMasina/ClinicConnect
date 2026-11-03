import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Switch, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { useAuth } from '../../context/AuthContext';

type ReminderTiming = 'day_before' | '30_min_before';

const REMINDER_OPTIONS: { value: ReminderTiming; label: string; hint: string }[] = [
  { value: 'day_before', label: '1 day before', hint: 'Reminder 24 hours before your appointment' },
  { value: '30_min_before', label: '30 minutes before', hint: 'Reminder shortly before you need to leave' },
];

export default function NotificationPreferencesScreen() {
  const navigation = useNavigation();
  const { profile, updateProfile } = useAuth();
  const prefs: any = profile?.notification_preference || {};
  const [sms, setSms] = useState(!!prefs.sms);
  const [email, setEmail] = useState(!!prefs.email);
  const [inApp, setInApp] = useState(prefs.inApp !== false);
  const [reminder, setReminder] = useState<ReminderTiming>(
    prefs.appointment_reminder === '30_min_before' ? '30_min_before' : 'day_before'
  );
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      await updateProfile({
        // Spread existing prefs so nothing else stored there is lost.
        notification_preference: {
          ...prefs,
          sms,
          email,
          inApp,
          appointment_reminder: reminder,
        },
      });
      Alert.alert('Saved', 'Notification preferences updated');
    } catch (e: any) {
      Alert.alert('Error', e.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={{ padding: 8 }}>
          <Ionicons name="arrow-back" size={22} color="#212121" />
        </TouchableOpacity>
        <Text style={styles.title}>Notification preferences</Text>
      </View>
      <View style={styles.body}>
        {[
          { label: 'SMS', value: sms, set: setSms },
          { label: 'Email', value: email, set: setEmail },
          { label: 'In-app', value: inApp, set: setInApp },
        ].map((row) => (
          <View key={row.label} style={styles.row}>
            <Text style={styles.label}>{row.label}</Text>
            <Switch
              value={row.value}
              onValueChange={row.set}
              trackColor={{ true: '#2E7D32', false: '#BDBDBD' }}
            />
          </View>
        ))}

        <Text style={styles.sectionTitle}>Appointment reminder</Text>
        {REMINDER_OPTIONS.map((opt) => {
          const selected = reminder === opt.value;
          return (
            <TouchableOpacity
              key={opt.value}
              style={[styles.option, selected && styles.optionSelected]}
              onPress={() => setReminder(opt.value)}
              activeOpacity={0.8}
            >
              <View style={{ flex: 1 }}>
                <Text style={styles.label}>{opt.label}</Text>
                <Text style={styles.hint}>{opt.hint}</Text>
              </View>
              <Ionicons
                name={selected ? 'radio-button-on' : 'radio-button-off'}
                size={22}
                color={selected ? '#2E7D32' : '#BDBDBD'}
              />
            </TouchableOpacity>
          );
        })}

        <TouchableOpacity
          style={[styles.save, saving && { opacity: 0.6 }]}
          onPress={save}
          disabled={saving}
        >
          <Text style={styles.saveText}>{saving ? 'Saving...' : 'Save preferences'}</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#F5F7F5' },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 10 },
  title: { fontSize: 18, fontWeight: '700', marginLeft: 4 },
  body: { padding: 20 },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#FFF',
    padding: 16,
    borderRadius: 12,
    marginBottom: 10,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#6B7C5C',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: 18,
    marginBottom: 10,
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFF',
    padding: 16,
    borderRadius: 12,
    marginBottom: 10,
    borderWidth: 1.5,
    borderColor: 'transparent',
  },
  optionSelected: { borderColor: '#2E7D32' },
  label: { fontSize: 15, fontWeight: '600', color: '#212121' },
  hint: { fontSize: 12, color: '#757575', marginTop: 2 },
  save: {
    backgroundColor: '#2E7D32',
    borderRadius: 10,
    padding: 14,
    alignItems: 'center',
    marginTop: 16,
  },
  saveText: { color: '#FFF', fontWeight: '700' },
});