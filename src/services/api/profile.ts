import { supabase } from '../supabase/client';

export interface PatientProfile {
  id: string;
  user_id: string;
  first_name: string;
  last_name: string;
  email: string;
  contact_number?: string;
  id_number?: string;
  gender?: string;
  ethnicity?: string;
  date_of_birth?: string;
  address?: {
    streetNumber?: string;
    streetName?: string;
    city?: string;
    postalCode?: string;
    province?: string;
  };
  next_of_kin_name?: string;
  next_of_kin_relation?: string;
  next_of_kin_contact?: string;
    notification_preference?: {
    sms?: boolean;
    email?: boolean;
    inApp?: boolean;
    appointment_reminder?: 'day_before' | '30_min_before';
  };
  medical_aid_number?: string;
  medical_aid_plan?: string;
  status?: string;
  created_at?: string;
  updated_at?: string;
}

export const profileApi = {
  async getByUserId(userId: string): Promise<PatientProfile | null> {
    const { data, error } = await supabase
      .from('patients')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle();
    if (error) throw error;
    return data as PatientProfile | null;
  },

  async update(userId: string, payload: Partial<PatientProfile>): Promise<PatientProfile> {
    const { data, error } = await supabase
      .from('patients')
      .update({ ...payload, updated_at: new Date().toISOString() })
      .eq('user_id', userId)
      .select()
      .single();
    if (error) throw error;
    return data as PatientProfile;
  },
};
