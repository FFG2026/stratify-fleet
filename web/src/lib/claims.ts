// Claims: wording, status rules and small pure helpers shared by the server and the browser. No database access here.
import { parseDate } from '@/lib/dates';

export type ClaimStatus = 'reported' | 'submitted' | 'under_review' | 'awaiting_information' | 'closed';
export const statusLabel: Record<ClaimStatus, string> = {
  reported: 'With the fleet · not yet sent', submitted: 'Sent to insurer', under_review: 'Under review',
  awaiting_information: 'Insurer needs information', closed: 'Closed'
};
export const outcomeLabel: Record<string, string> = {
  settled: 'Settled', declined: 'Declined', withdrawn: 'Withdrawn before sending', no_claim_pursued: 'No claim pursued', other: 'Other'
};
export const insurerOutcomes = ['settled', 'declined', 'no_claim_pursued', 'other'] as const;
export const originLabel: Record<string, string> = { driver: 'Reported by the driver', fleet: 'Reported by the fleet', insurer: 'Logged by the insurer' };

export const eventTitle: Record<string, string> = {
  reported: 'Claim reported', updated: 'Details changed', assessed: 'Reviewed by the fleet', submitted: 'Sent to the insurer',
  status_changed: 'Review started', reference_set: 'Insurer reference', info_requested: 'Insurer asked for information',
  info_provided: 'Information provided', info_cancelled: 'Question withdrawn', note: 'Note', closed: 'Closed', reopened: 'Reopened',
  logged_by_insurer: 'Logged by the insurer', party_added: 'Person added'
};

// Which claims need the person's attention, by side.
export const needsFleetAction = ['reported', 'awaiting_information'];
export const needsInsurerAction = ['submitted'];

// Europe/London wall-clock time to an exact moment.
function londonOffsetMs(ts: number) {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', timeZoneName: 'shortOffset' }).formatToParts(new Date(ts));
  return parts.find(p => p.type === 'timeZoneName')?.value === 'GMT+1' ? 3600000 : 0;
}
export function londonToIso(date: string, time: string): string {
  const day = parseDate(date);
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new Error('Enter the time as hours and minutes.');
  const [h, m] = time.split(':').map(Number);
  const naive = day + (h * 60 + m) * 60000;
  return new Date(naive - londonOffsetMs(naive - londonOffsetMs(naive))).toISOString();
}

export const yesNo = (value: FormDataEntryValue | null): boolean | null => (value === 'yes' ? true : value === 'no' ? false : null);

// What a report still needs before the fleet can send it. The database enforces the same rules.
export function claimGaps(c: { police_attended: boolean | null; third_party_involved: boolean | null; no_photos_confirmed: boolean }, thirdParties: number, files: number): string[] {
  const gaps: string[] = [];
  if (c.police_attended === null) gaps.push('Say whether the police attended');
  if (c.third_party_involved === null) gaps.push('Say whether another vehicle or person was involved');
  if (c.third_party_involved && thirdParties === 0) gaps.push('Add the other party’s details');
  if (!c.no_photos_confirmed && files === 0) gaps.push('Add photos, or confirm that none are available');
  return gaps;
}
