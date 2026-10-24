// Driver records: wording, file checks and the three-year history check. Pure functions so they can be tested.
export const documentKinds = [
  { kind: 'licence_front', label: 'Driving licence (front)', hint: 'Photo card, front. Clear and in focus.' },
  { kind: 'licence_back', label: 'Driving licence (back)', hint: 'Photo card, back (shows the categories you can drive).' },
  { kind: 'right_to_work', label: 'Right to work', hint: 'Passport, share code result or other proof of your right to work in the UK.' },
  { kind: 'proof_of_address', label: 'Proof of address', hint: 'Recent bill or bank statement, dated within three months.' },
  { kind: 'other', label: 'Other documents', hint: 'Anything else your fleet asks for, for example a CPC or tachograph card.' }
] as const;
export type DocumentKind = (typeof documentKinds)[number]['kind'];
export const documentLabel = (kind: string) => documentKinds.find(k => k.kind === kind)?.label ?? 'Document';

// The wording a driver agrees to is stored with their answer, so we can always show exactly what was agreed.
export const consentVersion = 'v1';
export const consents = {
  licence_check: {
    label: 'Driving licence check',
    statement: 'I give permission for my fleet operator and the insurers of that fleet to check my driving licence record with the DVLA, and to repeat the check while I drive for the fleet. I understand I can withdraw this permission at any time.'
  },
  data_sharing: {
    label: 'Sharing my details',
    statement: 'I understand that my details, documents and history on this page will be seen by my fleet operator and by the insurers of that fleet, for insurance and driver-safety purposes.'
  },
  national_database: {
    label: 'National driver database (optional)',
    statement: 'I choose to add my name, date of birth and the history I have entered on this page (jobs, claims and convictions) to the Stratify national driver database, so that insurers using Stratify can look me up and see it when they assess a policy or a claim. This is separate from sharing my details with my own fleet and I do not have to agree to drive for my fleet. My licence number, phone number and uploaded documents are not shared. I can withdraw at any time and I will stop appearing in searches straight away; an insurer that has already seen my details may have kept a record of them.'
  }
} as const;
export type ConsentKind = keyof typeof consents;

export const maxFileBytes = 4 * 1024 * 1024;
export type FileType = { type: 'image/jpeg' | 'image/png' | 'image/webp' | 'application/pdf'; ext: 'jpg' | 'png' | 'webp' | 'pdf' };
// Looks at the first bytes of the file, not the name or the type the browser claims.
export function sniffFile(bytes: Uint8Array): FileType | null {
  const is = (...sig: number[]) => sig.every((b, i) => bytes[i] === b);
  if (is(0xff, 0xd8, 0xff)) return { type: 'image/jpeg', ext: 'jpg' };
  if (is(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return { type: 'image/png', ext: 'png' };
  if (is(0x25, 0x50, 0x44, 0x46, 0x2d)) return { type: 'application/pdf', ext: 'pdf' };
  if (is(0x52, 0x49, 0x46, 0x46) && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return { type: 'image/webp', ext: 'webp' };
  return null;
}

export type Span = { start_date: string; end_date: string | null };
const dayMs = 86400000, ms = (d: string) => Date.parse(d + 'T00:00:00Z');
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
// Periods in the last `years` years that no job covers. Gaps of a week or less are ignored (a normal change of job).
export function historyGaps(jobs: Span[], today: string, years = 3, toleranceDays = 7): { from: string; to: string }[] {
  const end = ms(today), t = new Date(end); t.setUTCFullYear(t.getUTCFullYear() - years);
  const windowStart = t.getTime();
  const spans = jobs.map(j => [Math.max(ms(j.start_date), windowStart), Math.min(j.end_date ? ms(j.end_date) : end, end)] as [number, number])
    .filter(([a, b]) => b >= a).sort((x, y) => x[0] - y[0]);
  const gaps: { from: string; to: string }[] = [];
  let cursor = windowStart;
  for (const [a, b] of spans) {
    if (a - cursor > toleranceDays * dayMs) gaps.push({ from: iso(cursor), to: iso(a - dayMs) });
    cursor = Math.max(cursor, b + dayMs);
  }
  if (end - cursor > toleranceDays * dayMs) gaps.push({ from: iso(cursor), to: iso(end) });
  return gaps;
}

export type Completeness = { label: string; done: boolean }[];
export function completeness(f: {
  profile: { full_name: string; licence_number: string | null; no_claims_declared_at: string | null; no_convictions_declared_at: string | null } | null;
  docKinds: string[]; licenceCheck: boolean; dataSharing: boolean;
  jobs: Span[]; claims: number; convictions: number;
}, today: string): Completeness {
  const has = (k: string) => f.docKinds.includes(k);
  return [
    { label: 'Details and licence number', done: !!f.profile?.full_name && !!f.profile?.licence_number },
    { label: 'Licence photos', done: has('licence_front') && has('licence_back') },
    { label: 'Right to work', done: has('right_to_work') },
    { label: 'Licence check permission', done: f.licenceCheck },
    { label: 'Sharing permission', done: f.dataSharing },
    { label: 'Three years of job history', done: f.jobs.length > 0 && historyGaps(f.jobs, today).length === 0 },
    { label: 'Claims declared', done: f.claims > 0 || !!f.profile?.no_claims_declared_at },
    { label: 'Convictions declared', done: f.convictions > 0 || !!f.profile?.no_convictions_declared_at }
  ];
}

// DVLA's own online service: an employer needs the last 8 characters of the licence number and a check code from the driver.
// The code is made by the driver on gov.uk, works once, and lasts 21 days. The portal never calls the DVLA.
export const dvlaCheckUrl = 'https://www.viewdrivingrecord.service.gov.uk/lang/en/driving-record/validate';
export const dvlaShareUrl = 'https://www.gov.uk/view-driving-licence';
export const dvlaNorthernIrelandUrl = 'https://dvaonline.nidirect.gov.uk/Customer/DataShare/CheckDrivingLicence';
export const lastEight = (licence: string | null) => (licence ? licence.replace(/\s/g, '').slice(-8) : null);
// A code is good for 21 days from when the driver made it. We only know when it was added, so this is the latest it can last to.
export const codeLatestExpiry = (addedAt: string) => new Date(Date.parse(addedAt) + 21 * 86400000).toISOString();
export const checkStatusLabel: Record<string, string> = { valid: 'Valid', not_valid: 'Not valid', could_not_check: 'Could not check' };
export const isHeic = (f: { name: string; type: string }) => /^image\/hei[cf]$/i.test(f.type) || /\.hei[cf]$/i.test(f.name);
