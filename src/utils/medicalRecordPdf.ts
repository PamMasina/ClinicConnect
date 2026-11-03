export interface PdfVisit {
  date: string;
  title: string;
  clinic?: string | null;
  service?: string | null;
  diagnosis?: string | null;
  notes?: string | null;
  treatment?: string | null;
  vitals?: [string, string][];
  followUp?: string | null;
}

export interface PdfPrescription {
  issued: string;
  validUntil: string;
  status: string;
  medications: string[];
  diagnosis?: string | null;
  doctor?: string | null;
}

export interface MedicalRecordPdfInput {
  patientName: string;
  patientNumber: string;
  dateOfBirth?: string | null;
  generatedAt: string;
  allergies: string[];
  medications: string[];
  visits: PdfVisit[];
  prescriptions: PdfPrescription[];
}

const toDate = (d?: string | null): Date | null => {
  if (!d) return null;
  const x = new Date(d.length === 10 ? `${d}T12:00:00` : d);
  return Number.isNaN(x.getTime()) ? null : x;
};

export const fmtDate = (d?: string | null): string => {
  const x = toDate(d);
  return x
    ? x.toLocaleDateString('en-ZA', { day: 'numeric', month: 'long', year: 'numeric' })
    : '—';
};

export const fmtTime = (t?: string | null): string => (t ? t.slice(0, 5) : '');

/** Turn a vitals JSON object into readable [label, value] pairs. */
export function vitalsOf(v: unknown): [string, string][] {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return [];
  return Object.entries(v as Record<string, unknown>)
    .filter(([, val]) => val !== null && val !== undefined && val !== '')
    .map(([k, val]) => [
      k.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
      String(val),
    ]);
}

function esc(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function tags(items: string[], empty: string): string {
  if (!items.length) return `<p class="muted">${esc(empty)}</p>`;
  return `<div>${items.map((i) => `<span class="tag">${esc(i)}</span>`).join('')}</div>`;
}

export function buildMedicalRecordHtml(input: MedicalRecordPdfInput): string {
  const visits = input.visits
    .map((v) => {
      const where = [v.service, v.clinic].filter(Boolean).join(' · ');
      const vit = v.vitals && v.vitals.length
        ? `<p class="line"><b>Vitals:</b> ${v.vitals
            .map(([k, val]) => `${esc(k)}: ${esc(val)}`)
            .join(' &nbsp;|&nbsp; ')}</p>`
        : '';
      return `
      <div class="visit">
        <div class="visit-head">
          <span class="visit-date">${esc(v.date)}</span>
          ${where ? `<span class="visit-where">${esc(where)}</span>` : ''}
        </div>
        ${v.diagnosis ? `<p class="line"><b>Diagnosis:</b> ${esc(v.diagnosis)}</p>` : ''}
        ${v.notes ? `<p class="line"><b>Clinical notes:</b> ${esc(v.notes)}</p>` : ''}
        ${v.treatment ? `<p class="line"><b>Treatment plan:</b> ${esc(v.treatment)}</p>` : ''}
        ${vit}
        ${v.followUp ? `<p class="line"><b>Follow-up:</b> ${esc(v.followUp)}</p>` : ''}
      </div>`;
    })
    .join('');

  const rx = input.prescriptions
    .map(
      (p) => `
      <tr>
        <td>${esc(p.issued)}</td>
        <td>${p.medications.map((m) => esc(m)).join('<br/>') || '—'}</td>
        <td>${esc(p.validUntil)}</td>
        <td>${esc(p.status)}</td>
      </tr>`
    )
    .join('');

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Medical record</title>
  <style>
    @page { margin: 36px; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
           color: #222; font-size: 13px; line-height: 1.45; margin: 0; padding: 0; }
    .header { background: #6B7C5C; color: #fff; padding: 18px 22px; border-radius: 8px; }
    .header h1 { margin: 0; font-size: 18px; }
    .header p { margin: 4px 0 0; font-size: 12px; opacity: 0.9; }
    .meta { margin: 16px 0; }
    .meta span { display: inline-block; margin-right: 24px; }
    .meta b { color: #6B7C5C; font-size: 11px; text-transform: uppercase; letter-spacing: .4px; display: block; }
    h2 { font-size: 12px; text-transform: uppercase; letter-spacing: .5px; color: #6B7C5C;
         border-bottom: 2px solid #6B7C5C; padding-bottom: 4px; margin: 22px 0 10px; }
    .tag { display: inline-block; background: #E8F0E4; color: #2D3A2B; border-radius: 12px;
           padding: 4px 12px; margin: 0 6px 6px 0; font-weight: 600; font-size: 12px; }
    .muted { color: #888; font-style: italic; margin: 0; }
    .visit { border: 1px solid #e0e0e0; border-radius: 8px; padding: 12px 14px; margin-bottom: 10px;
             page-break-inside: avoid; }
    .visit-head { margin-bottom: 6px; }
    .visit-date { font-weight: 700; font-size: 14px; }
    .visit-where { color: #666; margin-left: 10px; }
    .line { margin: 3px 0; }
    table { width: 100%; border-collapse: collapse; }
    th { text-align: left; font-size: 11px; color: #888; text-transform: uppercase; padding: 6px 8px;
         border-bottom: 1px solid #ddd; }
    td { padding: 8px; border-bottom: 1px solid #eee; vertical-align: top; }
    .footer { margin-top: 28px; padding-top: 10px; border-top: 1px solid #e8e8e8; font-size: 11px;
              color: #888; text-align: center; }
  </style>
</head>
<body>
  <div class="header">
    <h1>Clinic-Connect Medical Record</h1>
    <p>Generated ${esc(input.generatedAt)}</p>
  </div>

  <div class="meta">
    <span><b>Patient</b>${esc(input.patientName || '—')}</span>
    <span><b>Patient no.</b>${esc(input.patientNumber)}</span>
    ${input.dateOfBirth ? `<span><b>Date of birth</b>${esc(input.dateOfBirth)}</span>` : ''}
  </div>

  <h2>Allergies</h2>
  ${tags(input.allergies, 'No allergies recorded')}

  <h2>Current medication</h2>
  ${tags(input.medications, 'No medication recorded')}

  <h2>Visit history</h2>
  ${visits || '<p class="muted">No visits recorded</p>'}

  <h2>Prescriptions</h2>
  ${
    rx
      ? `<table><thead><tr><th>Issued</th><th>Medication</th><th>Valid until</th><th>Status</th></tr></thead><tbody>${rx}</tbody></table>`
      : '<p class="muted">No prescriptions</p>'
  }

  <div class="footer">
    Generated by Clinic-Connect. This summary is for the patient's own use and does not replace
    the clinic's official records.
  </div>
</body>
</html>`;
}