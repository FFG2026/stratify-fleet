import type { BookFleetRow } from './book-mi';
import type { InboxClaim } from './inbox';

export const demoPriyaId = '11111111-1111-4111-8111-111111111111';
export const demoPriyaEmail = 'priya.khan@aldermutual.test';

const ago = (now: Date, ms: number) => new Date(now.getTime() - ms).toISOString();
const day = 86400000;
const hour = 3600000;

// Five sent claims so the demo inbox has one row in each queue. Handler "me" is filled in at read time.
export function demoInboxClaims(now: Date, me: string): InboxClaim[] {
  return [
    {
      id: '00000000-0000-4000-8000-000000000184', reference: 'CLM-2026-000184', fleet_id: 'atlas',
      registration: 'BX22 ATL', driver_name: 'Jo Hale', status: 'submitted', anyone_injured: true,
      incident_at: ago(now, 8 * hour), submitted_at: ago(now, 30 * 60000), updated_at: ago(now, 30 * 60000),
      handler_id: null, handler_email: null, assigned_at: null, first_touched_at: null,
      cover_after: false, open_request: null
    },
    {
      id: '00000000-0000-4000-8000-000000000171', reference: 'CLM-2026-000171', fleet_id: 'swift',
      registration: 'LM24 SWF', driver_name: 'Chris Adeyemi', status: 'awaiting_information', anyone_injured: false,
      incident_at: ago(now, 9 * day), submitted_at: ago(now, 6 * day), updated_at: ago(now, 6 * day),
      handler_id: demoPriyaId, handler_email: demoPriyaEmail, assigned_at: ago(now, 6 * day), first_touched_at: ago(now, 6 * day),
      cover_after: false,
      open_request: { id: 'req-171', due_on: ago(now, day).slice(0, 10), requested_at: ago(now, 6 * day) }
    },
    {
      id: '00000000-0000-4000-8000-000000000166', reference: 'CLM-2026-000166', fleet_id: 'meridian',
      registration: 'NK21 MER', driver_name: 'Pat Quinn', status: 'under_review', anyone_injured: false,
      incident_at: ago(now, 14 * day), submitted_at: ago(now, 11 * day), updated_at: ago(now, 2 * day),
      handler_id: demoPriyaId, handler_email: demoPriyaEmail, assigned_at: ago(now, 11 * day), first_touched_at: ago(now, 11 * day),
      cover_after: false, open_request: null
    },
    {
      id: '00000000-0000-4000-8000-000000000159', reference: 'CLM-2026-000159', fleet_id: 'oak',
      registration: 'YH23 OAK', driver_name: 'Sam Reed', status: 'under_review', anyone_injured: false,
      incident_at: ago(now, 3 * day), submitted_at: ago(now, day + 2 * hour), updated_at: ago(now, 20 * 60000),
      handler_id: me, handler_email: 'you', assigned_at: ago(now, day), first_touched_at: ago(now, day),
      cover_after: true, open_request: null
    },
    {
      id: '00000000-0000-4000-8000-000000000152', reference: 'CLM-2026-000152', fleet_id: 'atlas',
      registration: 'BX25 ATL', driver_name: 'Lee Marks', status: 'awaiting_information', anyone_injured: false,
      incident_at: ago(now, 5 * day), submitted_at: ago(now, 2 * day), updated_at: ago(now, 2 * day),
      handler_id: me, handler_email: 'you', assigned_at: ago(now, 2 * day), first_touched_at: ago(now, 2 * day),
      cover_after: false,
      open_request: { id: 'req-152', due_on: ago(now, -3 * day).slice(0, 10), requested_at: ago(now, 2 * day) }
    }
  ];
}

export const demoBookRows: BookFleetRow[] = [
  { fleet_id: 'atlas', fleet_name: 'Atlas Logistics', on_cover: 600, earned_ytd: 96400, claims_12m: 17, open: 6, cover_after: 1, licence_overdue: 4, no_driver: 9 },
  { fleet_id: 'swift', fleet_name: 'Swiftline Couriers', on_cover: 180, earned_ytd: 31200, claims_12m: 11, open: 4, cover_after: 1, licence_overdue: 3, no_driver: 4 },
  { fleet_id: 'meridian', fleet_name: 'Meridian Transport', on_cover: 420, earned_ytd: 44800, claims_12m: 8, open: 3, cover_after: 0, licence_overdue: 1, no_driver: 3 },
  { fleet_id: 'oak', fleet_name: 'Oak & Co Services', on_cover: 85, earned_ytd: 11600, claims_12m: 3, open: 1, cover_after: 0, licence_overdue: 1, no_driver: 1 }
];

export const demoMedianFirstTouchMs = 2.4 * day;

export function demoClaimNote(id: string): string {
  if (id.endsWith('184')) return 'Reported this morning. Injury recorded. Nobody has taken it yet.';
  if (id.endsWith('171')) return 'The insurer asked for dashcam footage. The due date has passed.';
  if (id.endsWith('166')) return 'Review started eleven days ago. No decision yet.';
  if (id.endsWith('159')) return 'Cover was added to the portal after the incident time.';
  return 'Waiting for the fleet to answer. The due date is still ahead.';
}
