// =============================================================================
// ClinicConnect types — aligned with Supabase public schema (snake_case)
// =============================================================================

export type UserRole = 'patient' | 'Doctor' | 'Nurse' | 'Admin' | 'FirstResponder';
export type StaffRole = 'Doctor' | 'Nurse' | 'Admin' | 'FirstResponder';
export type AppUserRole = 'patient' | 'doctor' | 'nurse' | 'admin' | 'first_responder';

export type AppointmentStatus =
  | 'booked'
  | 'confirmed'
  | 'completed'
  | 'cancelled'
  | 'no_show';

export type Priority = 'low' | 'medium' | 'high' | 'critical';
export type EmergencyStatus = 'pending' | 'dispatched' | 'resolved' | 'cancelled';
export type FacilityType = 'Clinic' | 'CDC' | 'Satellite' | 'Mobile';
export type Gender = 'Male' | 'Female' | 'Other';
export type Ethnicity = 'African' | 'Coloured' | 'Indian/Asian' | 'White' | 'Other';
export type ActiveStatus = 'active' | 'inactive';

// -----------------------------------------------------------------------------
// Users (public.users)
// -----------------------------------------------------------------------------
export interface AppUser {
  id: string;
  auth_id: string | null;
  email: string;
  role: AppUserRole;
  status: 'active' | 'inactive' | 'suspended';
  last_login?: string | null;
  created_at?: string;
  updated_at?: string;
}

// -----------------------------------------------------------------------------
// Staff (public.staff)
// -----------------------------------------------------------------------------
export interface Staff {
  id: string;
  user_id: string | null;
  staff_reg_number: string;
  first_name: string;
  last_name: string;
  email: string;
  contact_number?: string | null;
  role: StaffRole;
  clinic_id?: string | null;
  specialization?: string | null;
  license_number?: string | null;
  department?: string | null;
  response_unit?: string | null;
  ambulance_number?: string | null;
  status: ActiveStatus;
  created_at?: string;
  updated_at?: string;
  /** Join: clinics.clinic_name */
  clinics?: { clinic_name?: string } | null;
}

// -----------------------------------------------------------------------------
// Clinics (public.clinics)
// -----------------------------------------------------------------------------
export interface Clinic {
  id: string;
  clinic_name: string;
  location: string;
  address?: string | null;
  phone?: string | null;
  facility_type?: FacilityType | string | null;
  latitude?: number | null;
  longitude?: number | null;
  operating_hours?: string | null;
  contact_details?: string | null;
  website?: string | null;
  email?: string | null;
  status: ActiveStatus;
  created_at?: string;
  updated_at?: string;
}

export interface ClinicWithDistance extends Clinic {
  distanceKm?: number;
  distance?: string;
}

// -----------------------------------------------------------------------------
// Services (public.services)
// -----------------------------------------------------------------------------
export interface Service {
  id: string;
  clinic_id: string | null;
  service_name: string;
  description?: string | null;
  estimated_duration?: string | null;
  price?: number | null;
  status: ActiveStatus;
  created_at?: string;
  updated_at?: string;
}

// -----------------------------------------------------------------------------
// Time slots (public.time_slots)
// -----------------------------------------------------------------------------
export interface TimeSlot {
  id: string;
  clinic_id: string | null;
  service_id?: string | null;
  date: string;
  start_time: string;
  end_time: string;
  is_available: boolean;
  max_patients?: number;
  booked_count?: number;
  created_at?: string;
  updated_at?: string;
}

// -----------------------------------------------------------------------------
// Appointments (public.appointments)
// -----------------------------------------------------------------------------
export interface Appointment {
  id: string;
  patient_id: string | null;
  clinic_id: string | null;
  time_slot_id?: string | null;
  service_id?: string | null;
  reason_for_visit?: string | null;
  status: AppointmentStatus;
  notes?: string | null;
  created_at?: string;
  updated_at?: string;
  /** Common joins */
  clinics?: Clinic | null;
  services?: Service | null;
  patients?: {
    first_name?: string;
    last_name?: string;
    contact_number?: string | null;
  } | null;
  /** Optional denormalised helpers used in UI */
  appointment_date?: string;
  start_time?: string;
  end_time?: string;
}

// -----------------------------------------------------------------------------
// Medical records (public.medical_records)
// -----------------------------------------------------------------------------
export interface MedicalRecord {
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
  updated_at?: string;
}

// -----------------------------------------------------------------------------
// Notifications (public.notifications)
// -----------------------------------------------------------------------------
export interface Notification {
  id: string;
  user_id: string | null;
  title: string;
  message: string;
  type?:
    | 'appointment_reminder'
    | 'alert'
    | 'general'
    | 'emergency'
    | 'system'
    | string
    | null;
  is_read: boolean;
  read_at?: string | null;
  data?: Record<string, unknown> | null;
  sent_at?: string | null;
  created_at?: string;
}

// -----------------------------------------------------------------------------
// Emergency alerts (public.emergency_alerts)
// -----------------------------------------------------------------------------
export interface EmergencyAlert {
  id: string;
  patient_id: string | null;
  responder_id?: string | null;
  location: Record<string, unknown> | string;
  timestamp?: string;
  emergency_status: EmergencyStatus;
  priority: Priority;
  description?: string | null;
  notes?: string | null;
  resolved_at?: string | null;
  created_at?: string;
  updated_at?: string;
  patients?: {
    first_name?: string;
    last_name?: string;
    contact_number?: string | null;
  } | null;
}

// -----------------------------------------------------------------------------
// Health tips (public.health_tips)
// -----------------------------------------------------------------------------
export interface HealthTip {
  id: string;
  title: string;
  content: string;
  category?:
    | 'general'
    | 'nutrition'
    | 'exercise'
    | 'mental_health'
    | 'prevention'
    | 'chronic'
    | string
    | null;
  image_url?: string | null;
  source?: string | null;
  is_featured?: boolean;
  views?: number;
  likes?: number;
  status?: 'draft' | 'published' | 'archived' | string;
  published_at?: string | null;
  created_at?: string;
  updated_at?: string;
}

// -----------------------------------------------------------------------------
// Patients (public.patients)
// -----------------------------------------------------------------------------
export interface Address {
  streetNumber?: string;
  streetName?: string;
  city?: string;
  postalCode?: string;
  province?: string;
  [key: string]: unknown;
}

export interface NotificationPreference {
  sms: boolean;
  email: boolean;
  inApp: boolean;
  appointment_reminder?: 'day_before' | '30_min_before';
}

export interface Patient {
  id: string;
  user_id: string | null;
  first_name: string;
  last_name: string;
  email?: string | null;
  contact_number?: string | null;
  id_number?: string | null;
  gender?: Gender | null;
  ethnicity?: Ethnicity | null;
  date_of_birth?: string | null;
  address?: Address | null;
  next_of_kin_name?: string | null;
  next_of_kin_relation?: string | null;
  next_of_kin_contact?: string | null;
  notification_preference?: NotificationPreference | null;
  medical_aid_number?: string | null;
  medical_aid_plan?: string | null;
  status: ActiveStatus;
  created_at?: string;
  updated_at?: string;
}

export interface PatientProfile extends Patient {
  full_name?: string;
}

export interface UpdatePatientData {
  first_name?: string;
  last_name?: string;
  contact_number?: string;
  id_number?: string;
  gender?: Gender;
  ethnicity?: Ethnicity;
  address?: Address;
  next_of_kin_name?: string;
  next_of_kin_relation?: string;
  next_of_kin_contact?: string;
  notification_preference?: NotificationPreference;
  medical_aid_number?: string;
  medical_aid_plan?: string;
}

// -----------------------------------------------------------------------------
// Admin dashboard (aggregated, not a table)
// -----------------------------------------------------------------------------
export interface DashboardStats {
  totalStaff: number;
  totalClinics: number;
  totalServices: number;
  totalAppointments: number;
  activeEmergencies: number;
  pendingStaffRequests: number;
}

export interface DashboardActivity {
  id: string;
  type: 'staff_added' | 'clinic_updated' | 'appointment' | 'emergency';
  description: string;
  timestamp: string;
}

// -----------------------------------------------------------------------------
// Admin / UI camelCase view models (optional mapping layer)
// -----------------------------------------------------------------------------
export interface StaffView {
  id: string;
  staffRegNumber: string;
  firstName: string;
  lastName: string;
  email: string;
  contactNumber: string;
  role: StaffRole;
  clinicId: string;
  clinicName?: string;
  status: ActiveStatus;
  specialization?: string;
  licenseNumber?: string;
  department?: string;
  responseUnit?: string;
  ambulanceNumber?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ClinicView {
  id: string;
  clinicName: string;
  location: string;
  operatingHours: string;
  contactDetails: string;
  status: ActiveStatus;
  serviceCount?: number;
  staffCount?: number;
  address?: string;
  phone?: string;
  facilityType?: FacilityType;
  latitude?: number | null;
  longitude?: number | null;
  distanceKm?: number;
  distance?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface ServiceView {
  id: string;
  serviceName: string;
  clinicId: string;
  clinicName?: string;
  description: string;
  estimatedDuration: string;
  status: ActiveStatus;
  createdAt?: string;
  updatedAt?: string;
}

export interface TimeSlotView {
  id: string;
  clinicId: string;
  clinicName?: string;
  serviceId: string;
  serviceName?: string;
  date: string;
  startTime: string;
  endTime: string;
  isAvailable: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface ClinicDetailsView extends ClinicView {
  services: Omit<ServiceView, 'clinicId' | 'clinicName'>[];
  staff: Pick<StaffView, 'id' | 'firstName' | 'lastName' | 'role'>[];
  timeSlots: Pick<TimeSlotView, 'id' | 'date' | 'startTime' | 'endTime' | 'isAvailable'>[];
}

export interface CreateClinicData {
  clinicName: string;
  location: string;
  address?: string;
  phone?: string;
  facilityType?: FacilityType;
  latitude?: number | null;
  longitude?: number | null;
  operatingHours: string;
  contactDetails: string;
}

export interface UpdateClinicData extends Partial<CreateClinicData> {
  status?: ActiveStatus;
}

export interface Coordinates {
  latitude: number;
  longitude: number;
}

export interface ClinicSearchFilters {
  query?: string;
  facilityType?: FacilityType | 'all';
  maxDistance?: number;
  latitude?: number;
  longitude?: number;
}

// -----------------------------------------------------------------------------
// Mappers: DB row → UI view model
// -----------------------------------------------------------------------------
export function toStaffView(
  s: Staff,
  clinicName?: string
): StaffView {
  return {
    id: s.id,
    staffRegNumber: s.staff_reg_number,
    firstName: s.first_name,
    lastName: s.last_name,
    email: s.email,
    contactNumber: s.contact_number || '',
    role: s.role,
    clinicId: s.clinic_id || '',
    clinicName: clinicName || s.clinics?.clinic_name,
    status: s.status,
    specialization: s.specialization || undefined,
    licenseNumber: s.license_number || undefined,
    department: s.department || undefined,
    responseUnit: s.response_unit || undefined,
    ambulanceNumber: s.ambulance_number || undefined,
    createdAt: s.created_at || '',
    updatedAt: s.updated_at || '',
  };
}

export function toClinicView(c: Clinic, extra?: Partial<ClinicView>): ClinicView {
  return {
    id: c.id,
    clinicName: c.clinic_name,
    location: c.location,
    operatingHours: c.operating_hours || '',
    contactDetails: c.contact_details || c.phone || '',
    status: c.status,
    address: c.address || undefined,
    phone: c.phone || undefined,
    facilityType: (c.facility_type as FacilityType) || undefined,
    latitude: c.latitude,
    longitude: c.longitude,
    createdAt: c.created_at,
    updatedAt: c.updated_at,
    ...extra,
  };
}

export function toServiceView(s: Service, clinicName?: string): ServiceView {
  return {
    id: s.id,
    serviceName: s.service_name,
    clinicId: s.clinic_id || '',
    clinicName,
    description: s.description || '',
    estimatedDuration: s.estimated_duration || '',
    status: s.status,
    createdAt: s.created_at,
    updatedAt: s.updated_at,
  };
}

export function toTimeSlotView(
  t: TimeSlot,
  opts?: { clinicName?: string; serviceName?: string }
): TimeSlotView {
  return {
    id: t.id,
    clinicId: t.clinic_id || '',
    clinicName: opts?.clinicName,
    serviceId: t.service_id || '',
    serviceName: opts?.serviceName,
    date: t.date,
    startTime: t.start_time,
    endTime: t.end_time,
    isAvailable: t.is_available,
    createdAt: t.created_at,
    updatedAt: t.updated_at,
  };
}