import { supabase } from '../supabase/client';
import { notifyPatient, notifyStaff } from '../notifications/pushNotifications';

export type ReferralUrgency = 'routine' | 'urgent' | 'emergency';
export type ReferralStatus =
  | 'pending'
  | 'accepted'
  | 'scheduled'
  | 'completed'
  | 'cancelled';

export interface Referral {
  id: string;
  patient_id: string;
  referring_doctor_id?: string | null;
  /** staff.id of the doctor the patient is referred to */
  referred_to_doctor_id?: string | null;
  followup_count?: number;
  last_followup_at?: string | null;
  specialist_type: string;
  specialist_name?: string | null;
  preferred_clinic_id?: string | null;
  reason: string;
  clinical_notes?: string | null;
  urgency: ReferralUrgency;
  status: ReferralStatus;
  referred_at?: string;
  appointment_id?: string | null;
  created_at?: string;
  updated_at?: string;
  /** Joins */
  referring_doctor?: {
    first_name?: string;
    last_name?: string;
    specialization?: string | null;
    contact_number?: string | null;
    clinic?: { clinic_name?: string } | null;
  } | null;
  referred_doctor?: {
    id?: string;
    first_name?: string;
    last_name?: string;
    specialization?: string | null;
    contact_number?: string | null;
    clinic?: {
      clinic_name?: string;
      location?: string;
      phone?: string | null;
      contact_details?: string | null;
    } | null;
  } | null;
  preferred_clinic?: {
    clinic_name?: string;
    location?: string;
    phone?: string | null;
    contact_details?: string | null;
  } | null;
  patients?: {
    first_name?: string;
    last_name?: string;
  } | null;
  appointment?: {
    id: string;
    status?: string;
    clinics?: { clinic_name?: string } | null;
    services?: { service_name?: string } | null;
    time_slots?: {
      date?: string;
      start_time?: string;
      end_time?: string;
    } | null;
  } | null;
}

export interface CreateReferralInput {
  patient_id: string;
  referring_doctor_id?: string;
  referred_to_doctor_id?: string;
  specialist_type: string;
  specialist_name?: string;
  preferred_clinic_id?: string;
  reason: string;
  clinical_notes?: string;
  urgency?: ReferralUrgency;
}

export const SPECIALIST_TYPES = [
  'Cardiologist',
  'Dermatologist',
  'Endocrinologist',
  'ENT (Ear, Nose & Throat)',
  'Gastroenterologist',
  'Gynaecologist',
  'Neurologist',
  'Oncologist',
  'Ophthalmologist',
  'Orthopaedics',
  'Paediatrician',
  'Psychiatrist',
  'Pulmonologist',
  'Rheumatologist',
  'Urologist',
  'Other',
] as const;

const REFERRAL_SELECT = `
  *,
  preferred_clinic:preferred_clinic_id ( clinic_name, location, phone, contact_details ),
  patients:patient_id ( first_name, last_name ),
  appointment:appointment_id ( id, status, clinics ( clinic_name ), services ( service_name ), time_slots ( date, start_time, end_time ) )
`;

/** The referring clinician may chase a referral once nothing has moved for this long. */
export const FOLLOW_UP_AFTER_HOURS = 24;

const OPEN_STATUSES: ReferralStatus[] = ['pending', 'accepted', 'scheduled'];

export const STATUS_LABEL: Record<ReferralStatus, string> = {
  pending: 'awaiting approval',
  accepted: 'accepted',
  scheduled: 'scheduled',
  completed: 'completed',
  cancelled: 'cancelled',
};

/** When the referral last saw any activity (issued, status change or follow-up). */
function lastActivityMs(ref: Referral): number {
  return Math.max(
    ...[ref.referred_at, ref.created_at, ref.updated_at, ref.last_followup_at]
      .map((d) => (d ? new Date(d).getTime() : 0))
  );
}

/**
 * Null when a follow-up may be sent now, otherwise the moment it becomes available.
 * Also null-safe for closed referrals: use canFollowUpStatus() to hide the button.
 */
export function followUpAvailableAt(ref: Referral, now: Date = new Date()): Date | null {
  const at = lastActivityMs(ref) + FOLLOW_UP_AFTER_HOURS * 3600 * 1000;
  return at <= now.getTime() ? null : new Date(at);
}

export function canFollowUpStatus(ref: Pick<Referral, 'status' | 'referred_to_doctor_id'>): boolean {
  return !!ref.referred_to_doctor_id && OPEN_STATUSES.includes(ref.status);
}

const fullDoctor = (d?: { first_name?: string; last_name?: string } | null) =>
  d ? `Dr ${d.first_name || ''} ${d.last_name || ''}`.trim() : 'a doctor';

/**
 * Doctor details come from get_referral_staff(), a database function that
 * returns only name, specialization, clinic and contact number (never email or
 * registration numbers) and only for doctors on referrals the caller may see.
 */
async function hydrateDoctors(rows: Referral[]): Promise<Referral[]> {
  const ids = Array.from(
    new Set(
      rows.flatMap((r) => [r.referring_doctor_id, r.referred_to_doctor_id]).filter(Boolean) as string[]
    )
  );
  if (ids.length === 0) return rows;

  const { data, error } = await supabase.rpc('get_referral_staff', { p_ids: ids });
  if (error) {
    console.warn('[Referrals] Could not load doctor details:', error.message);
    return rows;
  }
  const byId = new Map<string, any>((data || []).map((d: any) => [d.id, d]));
  const shape = (id?: string | null) => {
    const d = id ? byId.get(id) : null;
    if (!d) return null;
    return {
      id: d.id,
      first_name: d.first_name,
      last_name: d.last_name,
      specialization: d.specialization,
      contact_number: d.contact_number,
      clinic: d.clinic_name
        ? {
            clinic_name: d.clinic_name,
            location: d.clinic_location,
            phone: d.clinic_phone,
            contact_details: d.contact_number,
          }
        : null,
    };
  };
  return rows.map((r) => ({
    ...r,
    referring_doctor: shape(r.referring_doctor_id),
    referred_doctor: shape(r.referred_to_doctor_id),
  }));
}

export const referralsApi = {
  /** Active doctors working at a clinic (for the "refer to" dropdown). */
  getDoctorsByClinic: async (
    clinicId: string
  ): Promise<{ id: string; first_name: string; last_name: string; specialization: string | null }[]> => {
    const { data, error } = await supabase
      .from('staff')
      .select('id, first_name, last_name, specialization')
      .eq('clinic_id', clinicId)
      .eq('role', 'Doctor')
      .eq('status', 'active')
      .order('last_name');
    if (error) throw error;
    return (data || []) as any;
  },

  /** Referrals addressed TO a doctor (staff.id). */
  getForDoctor: async (staffId: string): Promise<Referral[]> => {
    const { data, error } = await supabase
      .from('referrals')
      .select(REFERRAL_SELECT)
      .eq('referred_to_doctor_id', staffId)
      .order('referred_at', { ascending: false });
    if (error) throw error;
    return hydrateDoctors((data || []) as Referral[]);
  },

  getByPatient: async (patientId: string): Promise<Referral[]> => {
    const { data, error } = await supabase
      .from('referrals')
      .select(REFERRAL_SELECT)
      .eq('patient_id', patientId)
      .order('referred_at', { ascending: false });

    if (error) throw error;
    return hydrateDoctors((data || []) as Referral[]);
  },

  getById: async (id: string): Promise<Referral | null> => {
    const { data, error } = await supabase
      .from('referrals')
      .select(REFERRAL_SELECT)
      .eq('id', id)
      .maybeSingle();

    if (error) throw error;
    if (!data) return null;
    return (await hydrateDoctors([data as Referral]))[0];
  },

  /** Referrals issued by a specific staff member (staff.id, doctor or nurse) */
  getByDoctor: async (doctorId: string): Promise<Referral[]> => {
    const { data, error } = await supabase
      .from('referrals')
      .select(REFERRAL_SELECT)
      .eq('referring_doctor_id', doctorId)
      .order('referred_at', { ascending: false });

    if (error) throw error;
    return hydrateDoctors((data || []) as Referral[]);
  },

  create: async (input: CreateReferralInput): Promise<Referral> => {
    const { data, error } = await supabase
      .from('referrals')
      .insert({
        patient_id: input.patient_id,
        referring_doctor_id: input.referring_doctor_id ?? null,
        referred_to_doctor_id: input.referred_to_doctor_id ?? null,
        specialist_type: input.specialist_type,
        specialist_name: input.specialist_name ?? null,
        preferred_clinic_id: input.preferred_clinic_id ?? null,
        reason: input.reason,
        clinical_notes: input.clinical_notes ?? null,
        urgency: input.urgency ?? 'routine',
        status: 'pending',
      })
      .select()
      .single();

    if (error) throw error;
    const created = data as Referral;

    // Tell the patient (push + in-app). Never blocks or fails the create.
    notifyPatient(created.patient_id, {
      title: 'New specialist referral',
      body: `You have a new ${created.specialist_type} referral. Tap to view and download the letter.`,
      data: {
        type: 'referral',
        screen: 'Referral',
        referralId: created.id,
      },
    }).catch(() => {});

    // Tell the doctor the patient was referred to.
    if (created.referred_to_doctor_id) {
      notifyStaff(created.referred_to_doctor_id, {
        title: 'New referral for you',
        body: `A ${created.urgency} ${created.specialist_type} referral was sent to you. Tap to review it.`,
        data: { type: 'referral', screen: 'Referral', referralId: created.id },
      }).catch(() => {});
    }

    return created;
  },

  /**
   * Change a referral's status. The patient and the referring clinician are
   * told (the clinician who made the change is not notified of their own action).
   */
  updateStatus: async (id: string, status: ReferralStatus, actorStaffId?: string): Promise<void> => {
    const { error } = await supabase
      .from('referrals')
      .update({ status, updated_at: new Date().toISOString() })
      .eq('id', id);
    if (error) throw error;

    try {
      const ref = await referralsApi.getById(id);
      if (!ref) return;
      const label = STATUS_LABEL[status];
      const data = { type: 'referral', screen: 'Referral', referralId: ref.id };

      notifyPatient(ref.patient_id, {
        title: 'Referral update',
        body: `Your ${ref.specialist_type} referral is now ${label}. Tap to view it.`,
        data,
      }).catch(() => {});

      if (ref.referring_doctor_id && ref.referring_doctor_id !== actorStaffId) {
        notifyStaff(ref.referring_doctor_id, {
          title: 'Referral update',
          body: `${fullDoctor(ref.referred_doctor)} marked your ${ref.specialist_type} referral as ${label}.`,
          data,
        }).catch(() => {});
      }
    } catch (e) {
      console.warn('[Referrals] Status saved but notifications failed:', e);
    }
  },

  /**
   * The referring clinician nudges the receiving doctor when a referral has
   * not moved. Allowed only on open referrals, once FOLLOW_UP_AFTER_HOURS have
   * passed since the last activity.
   */
  followUp: async (ref: Referral): Promise<void> => {
    if (!canFollowUpStatus(ref)) {
      throw new Error('This referral is closed or has no receiving doctor to follow up with.');
    }
    const next = followUpAvailableAt(ref);
    if (next) {
      throw new Error(
        `You can follow up after ${next.toLocaleString('en-ZA', {
          day: 'numeric',
          month: 'short',
          hour: '2-digit',
          minute: '2-digit',
        })}.`
      );
    }

    const { error } = await supabase
      .from('referrals')
      .update({
        followup_count: (ref.followup_count ?? 0) + 1,
        last_followup_at: new Date().toISOString(),
      })
      .eq('id', ref.id);
    if (error) throw error;

    const who = fullDoctor(ref.referring_doctor);
    notifyStaff(ref.referred_to_doctor_id as string, {
      title: 'Referral follow-up',
      body: `${who} is following up on a ${ref.urgency} ${ref.specialist_type} referral that is still ${STATUS_LABEL[ref.status]}.`,
      data: { type: 'referral', screen: 'Referral', referralId: ref.id },
    }).catch(() => {});
  },

  /** Print-ready letter used for the PDF download. */
  formatAsHtml: (ref: Referral, patientName?: string): string => {
    const doctor = ref.referring_doctor
      ? `Dr ${ref.referring_doctor.first_name || ''} ${ref.referring_doctor.last_name || ''}`.trim()
      : 'Referring clinician';
    const doctorClinic = ref.referring_doctor?.clinic?.clinic_name || '';
    const date = ref.referred_at
      ? new Date(ref.referred_at).toLocaleDateString('en-ZA', {
          year: 'numeric',
          month: 'long',
          day: 'numeric',
        })
      : '—';
    const clinic = ref.preferred_clinic?.clinic_name
      ? `${ref.preferred_clinic.clinic_name}${
          ref.preferred_clinic.location ? ` (${ref.preferred_clinic.location})` : ''
        }`
      : 'Any suitable facility';
    const slot = ref.appointment?.time_slots;
    const appt = slot?.date
      ? `${slot.date}${slot.start_time ? ` at ${slot.start_time.slice(0, 5)}` : ''}`
      : '';
    const e = escapeHtml;

    return `<!DOCTYPE html>
<html><head><meta charset="utf-8" /><title>Specialist referral</title>
<style>
  body{font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#222;font-size:13px;line-height:1.5;margin:0;padding:24px}
  .header{background:#6B7C5C;color:#fff;padding:18px 22px;border-radius:8px 8px 0 0}
  .header h1{margin:0;font-size:18px}.header p{margin:4px 0 0;font-size:12px;opacity:.9}
  .card{border:1px solid #e0e0e0;border-radius:0 0 8px 8px;padding:20px 22px}
  .grid{display:grid;grid-template-columns:1fr 1fr;gap:10px 24px;margin-bottom:16px}
  label{display:block;font-size:11px;text-transform:uppercase;letter-spacing:.4px;color:#888}
  span.v{font-size:13px;font-weight:600}
  .title{font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:#6B7C5C;margin:16px 0 6px;padding-bottom:4px;border-bottom:2px solid #6B7C5C}
  p.t{margin:0;white-space:pre-wrap}
  .footer{margin-top:24px;padding-top:12px;border-top:1px solid #e8e8e8;font-size:11px;color:#888;text-align:center}
</style></head><body>
<div class="header"><h1>Clinic-Connect Specialist Referral</h1><p>Please take this letter to the specialist or facility</p></div>
<div class="card">
  <div class="grid">
    <div><label>Patient</label><span class="v">${e(patientName || '—')}</span></div>
    <div><label>Referral ID</label><span class="v">${e(ref.id.slice(0, 8).toUpperCase())}</span></div>
    <div><label>Referred by</label><span class="v">${e(doctor)}</span></div>
    <div><label>Issuing clinic</label><span class="v">${e(doctorClinic || '—')}</span></div>
    <div><label>Date issued</label><span class="v">${e(date)}</span></div>
    <div><label>Urgency</label><span class="v">${e(ref.urgency.toUpperCase())}</span></div>
    <div><label>Specialist type</label><span class="v">${e(ref.specialist_type)}</span></div>
    <div><label>Referred to</label><span class="v">${e(ref.referred_doctor ? fullDoctor(ref.referred_doctor) : ref.specialist_name || '—')}</span></div>
    <div><label>Facility</label><span class="v">${e(clinic)}</span></div>
    <div><label>Status</label><span class="v">${e(ref.status)}</span></div>
    ${appt ? `<div><label>Appointment</label><span class="v">${e(appt)}</span></div>` : ''}
  </div>
  <div class="title">Reason for referral</div><p class="t">${e(ref.reason)}</p>
  ${ref.clinical_notes ? `<div class="title">Clinical notes</div><p class="t">${e(ref.clinical_notes)}</p>` : ''}
  <div class="footer">Generated by Clinic-Connect · Electronic referral letter</div>
</div></body></html>`;
  },

  formatAsText: (ref: Referral, patientName?: string): string => {
    const doctorName = ref.referring_doctor
      ? `Dr ${ref.referring_doctor.first_name || ''} ${ref.referring_doctor.last_name || ''}`.trim()
      : 'Doctor';
    const date = ref.referred_at
      ? new Date(ref.referred_at).toLocaleDateString('en-ZA', {
          year: 'numeric',
          month: 'long',
          day: 'numeric',
        })
      : '';
    const clinic = ref.preferred_clinic?.clinic_name
      ? `${ref.preferred_clinic.clinic_name}${
          ref.preferred_clinic.location ? ` (${ref.preferred_clinic.location})` : ''
        }`
      : 'Any suitable facility';

    return [
      '═══════════════════════════════════════',
      '      CLINIC-CONNECT SPECIALIST REFERRAL',
      '═══════════════════════════════════════',
      '',
      `Patient: ${patientName || '—'}`,
      `Referring doctor: ${doctorName}`,
      ref.referring_doctor?.clinic?.clinic_name
        ? `Issuing clinic: ${ref.referring_doctor.clinic.clinic_name}`
        : '',
      `Date: ${date}`,
      `Urgency: ${ref.urgency.toUpperCase()}`,
      `Status: ${ref.status}`,
      '',
      `Specialist type: ${ref.specialist_type}`,
      ref.specialist_name ? `Preferred specialist: ${ref.specialist_name}` : '',
      `Preferred clinic / facility: ${clinic}`,
      '',
      '── Reason for referral ────────────────',
      ref.reason,
      '',
      ref.clinical_notes
        ? `Clinical notes:\n${ref.clinical_notes}\n`
        : '',
      '───────────────────────────────────────',
      'Please take this referral letter to the specialist or facility.',
      '═══════════════════════════════════════',
    ]
      .filter((l) => l !== '')
      .join('\n');
  },
};

/** Minimal HTML escaping for the PDF template. */
function escapeHtml(value: string): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export default referralsApi;