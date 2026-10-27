// Insurer claims inbox: who owns a sent claim, and whether a clock has run out.
// No money fields. Aging is computed from timestamps, never stored.

export const defaultSla = {
  firstTouchHours: 4,
  injuryFirstTouchHours: 2,
  fleetReplyDays: 5,
  decisionDays: 10
} as const;
export type SlaPolicy = typeof defaultSla;

export type InboxQueue = 'mine' | 'unassigned' | 'waiting' | 'overdue';
export const inboxQueues: { id: InboxQueue; label: string }[] = [
  { id: 'mine', label: 'Mine' },
  { id: 'unassigned', label: 'Unassigned' },
  { id: 'waiting', label: 'Waiting on fleet' },
  { id: 'overdue', label: 'Overdue' }
];

export type OpenRequest = { id: string; due_on: string | null; requested_at: string };
export type InboxClaim = {
  id: string;
  reference: string;
  fleet_id: string;
  registration: string;
  driver_name: string | null;
  status: string;
  anyone_injured: boolean;
  incident_at: string;
  submitted_at: string | null;
  updated_at: string;
  handler_id: string | null;
  handler_email: string | null;
  assigned_at: string | null;
  first_touched_at: string | null;
  cover_after: boolean;
  open_request: OpenRequest | null;
};

export type ClockKey = 'first_touch' | 'fleet_reply' | 'decision';
export type ClockState = {
  key: ClockKey;
  label: string;
  state: 'met' | 'ok' | 'overdue' | 'na';
  dueAt: string | null;
  metAt: string | null;
  remainingMs: number | null;
  text: string;
};

const hour = 3600000;
const day = 86400000;

export function formatDuration(ms: number): string {
  const minutes = Math.max(0, Math.round(Math.abs(ms) / 60000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}

function clockText(state: ClockState['state'], remainingMs: number | null): string {
  if (state === 'na' || remainingMs === null) return '—';
  if (state === 'met') return 'Met';
  if (state === 'overdue') return `${formatDuration(remainingMs)} overdue`;
  return `${formatDuration(remainingMs)} left`;
}

function stamp(ms: number): string {
  return new Date(ms).toISOString();
}

export function clocksOf(claim: InboxClaim, now: Date, sla: SlaPolicy = defaultSla): ClockState[] {
  const nowMs = now.getTime();
  const submitted = claim.submitted_at ? Date.parse(claim.submitted_at) : NaN;
  const firstHours = claim.anyone_injured ? sla.injuryFirstTouchHours : sla.firstTouchHours;

  const firstDue = Number.isFinite(submitted) ? submitted + firstHours * hour : null;
  const firstMet = claim.first_touched_at;
  const firstRemaining = firstMet ? Date.parse(firstMet) - (firstDue ?? Date.parse(firstMet)) : firstDue !== null ? firstDue - nowMs : null;
  const firstState: ClockState['state'] = !claim.submitted_at || claim.status === 'reported' ? 'na'
    : firstMet ? 'met'
    : firstDue !== null && firstDue < nowMs ? 'overdue'
    : 'ok';

  const req = claim.status === 'awaiting_information' ? claim.open_request : null;
  const londonToday = now.toLocaleDateString('en-CA', { timeZone: 'Europe/London' });
  const replyDueDate = req ? (req.due_on || new Date(Date.parse(req.requested_at) + sla.fleetReplyDays * day).toISOString().slice(0, 10)) : null;
  const replyDue = replyDueDate ? Date.parse(replyDueDate + 'T23:59:59.000Z') : null;
  const replyRemaining = replyDueDate ? (Date.parse(replyDueDate + 'T12:00:00Z') - Date.parse(londonToday + 'T12:00:00Z')) : null;
  const replyState: ClockState['state'] = !req ? 'na' : replyDueDate && replyDueDate < londonToday ? 'overdue' : 'ok';

  const decisionStart = claim.first_touched_at ? Date.parse(claim.first_touched_at) : submitted;
  const decisionDue = Number.isFinite(decisionStart) ? decisionStart + sla.decisionDays * day : null;
  const decisionState: ClockState['state'] = claim.status === 'closed' ? 'met'
    : !claim.submitted_at || claim.status === 'reported' ? 'na'
    : !claim.first_touched_at ? 'na'
    : decisionDue !== null && decisionDue < nowMs ? 'overdue'
    : 'ok';
  const decisionRemaining = claim.status === 'closed' ? 0 : decisionDue !== null ? decisionDue - nowMs : null;

  const first: ClockState = {
    key: 'first_touch', label: 'First touch', state: firstState,
    dueAt: firstDue !== null ? stamp(firstDue) : null, metAt: firstMet, remainingMs: firstRemaining, text: clockText(firstState, firstRemaining)
  };
  const reply: ClockState = {
    key: 'fleet_reply', label: 'Fleet reply', state: replyState,
    dueAt: replyDue !== null ? stamp(replyDue) : null, metAt: null, remainingMs: replyRemaining, text: clockText(replyState, replyRemaining)
  };
  const decision: ClockState = {
    key: 'decision', label: 'Decision', state: decisionState,
    dueAt: decisionDue !== null ? stamp(decisionDue) : null, metAt: claim.status === 'closed' ? claim.updated_at : null,
    remainingMs: decisionRemaining, text: clockText(decisionState, decisionRemaining)
  };
  return [first, reply, decision];
}

export function urgentClock(clocks: ClockState[]): ClockState | null {
  const overdue = clocks.find(c => c.state === 'overdue');
  if (overdue) return overdue;
  const open = clocks.filter(c => c.state === 'ok').sort((a, b) => (a.remainingMs ?? 0) - (b.remainingMs ?? 0));
  if (open[0]) return open[0];
  return clocks.find(c => c.state === 'met') ?? clocks[0] ?? null;
}

export function inQueue(claim: InboxClaim, queue: InboxQueue, me: string, now: Date, sla: SlaPolicy = defaultSla): boolean {
  if (claim.status === 'closed' || !claim.submitted_at) return false;
  if (queue === 'mine') return claim.handler_id === me;
  if (queue === 'unassigned') return !claim.handler_id;
  if (queue === 'waiting') return claim.status === 'awaiting_information' && !!claim.open_request;
  return clocksOf(claim, now, sla).some(c => c.state === 'overdue');
}

export function needsHandlerAction(claim: InboxClaim, me: string, now: Date, sla: SlaPolicy = defaultSla): boolean {
  if (claim.status === 'closed' || !claim.submitted_at) return false;
  if (!claim.handler_id) return true;
  if (claim.handler_id !== me) return false;
  if (claim.status === 'submitted') return true;
  return clocksOf(claim, now, sla).some(c => c.state === 'overdue');
}

export function inboxWhy(claim: InboxClaim, me: string, now: Date, sla: SlaPolicy = defaultSla): string {
  const bits: string[] = [];
  if (!claim.handler_id) bits.push('Unassigned');
  else if (claim.handler_id === me) bits.push('Yours');
  if (claim.status === 'submitted') bits.push('New');
  if (claim.status === 'awaiting_information') bits.push('Waiting on fleet');
  if (claim.status === 'under_review') bits.push('Under review');
  if (claim.anyone_injured) bits.push('Injury');
  if (claim.cover_after) bits.push('Cover recorded after incident');
  if (clocksOf(claim, now, sla).some(c => c.state === 'overdue')) bits.push('Overdue');
  return bits.join(' · ') || 'Open';
}

export function handlerLabel(claim: InboxClaim, me: string): string {
  if (!claim.handler_id) return '—';
  if (claim.handler_id === me) return 'You';
  return claim.handler_email || 'Assigned';
}

export function waitText(claim: InboxClaim, now: Date): string {
  if (!claim.submitted_at) return '—';
  return formatDuration(now.getTime() - Date.parse(claim.submitted_at));
}

export function nextInboxStep(claim: InboxClaim, me: string, now: Date, sla: SlaPolicy = defaultSla): string {
  if (claim.status === 'closed') return '';
  if (!claim.handler_id) return 'Assign or take';
  if (claim.status === 'submitted') return 'Start review';
  const clocks = clocksOf(claim, now, sla);
  if (clocks.find(c => c.key === 'fleet_reply')?.state === 'overdue') return 'Fleet reply overdue';
  if (claim.status === 'awaiting_information') return 'Waiting for the fleet';
  if (clocks.find(c => c.key === 'decision')?.state === 'overdue') return 'Decision overdue';
  if (claim.handler_id === me) return 'Review';
  return 'With handler';
}

export function filterInbox(rows: InboxClaim[], queue: InboxQueue, me: string, now: Date, sla: SlaPolicy = defaultSla): InboxClaim[] {
  return rows.filter(c => inQueue(c, queue, me, now, sla));
}

export function inboxCounts(rows: InboxClaim[], me: string, now: Date, sla: SlaPolicy = defaultSla) {
  return {
    mine: rows.filter(c => inQueue(c, 'mine', me, now, sla)).length,
    unassigned: rows.filter(c => inQueue(c, 'unassigned', me, now, sla)).length,
    waiting: rows.filter(c => inQueue(c, 'waiting', me, now, sla)).length,
    overdue: rows.filter(c => inQueue(c, 'overdue', me, now, sla)).length,
    action: rows.filter(c => needsHandlerAction(c, me, now, sla)).length,
    injury: rows.filter(c => c.status !== 'closed' && c.anyone_injured).length,
    coverAfter: rows.filter(c => c.status !== 'closed' && c.cover_after).length,
    open: rows.filter(c => c.status !== 'closed').length
  };
}
