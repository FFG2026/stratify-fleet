import { describe, expect, it } from 'vitest';
import { eventTitle } from '../src/lib/claims';
import { bookTotals, claimsPerVehicleYear, formatEarned, formatFrequency, medianMs } from '../src/lib/book-mi';
import { demoBookRows, demoFleetLabel, demoInboxClaims, demoPriyaId, isDemoInboxClaim } from '../src/lib/demo-inbox';
import {
  clocksOf, defaultSla, filterInbox, formatDuration, inboxCounts, inboxWhy, inQueue,
  needsHandlerAction, nextInboxStep, urgentClock
} from '../src/lib/inbox';

const now = new Date('2026-10-27T12:00:00.000Z');
const me = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

describe('formatDuration', () => {
  it('uses minutes, hours, then days', () => {
    expect(formatDuration(10 * 60000)).toBe('10m');
    expect(formatDuration(2 * 3600000)).toBe('2h');
    expect(formatDuration(6 * 86400000)).toBe('6d');
  });
});

describe('demo inbox queues', () => {
  const rows = demoInboxClaims(now, me);

  it('puts the new injury in unassigned, not mine', () => {
    const fresh = rows.find(c => c.reference.endsWith('184'))!;
    expect(inQueue(fresh, 'unassigned', me, now)).toBe(true);
    expect(inQueue(fresh, 'mine', me, now)).toBe(false);
    expect(needsHandlerAction(fresh, me, now)).toBe(true);
    expect(nextInboxStep(fresh, me, now)).toBe('Assign or take');
  });

  it('marks first touch overdue for an injury sitting past two hours', () => {
    const stale = { ...rows[0], submitted_at: new Date(now.getTime() - 3 * 3600000).toISOString() };
    const first = clocksOf(stale, now).find(c => c.key === 'first_touch')!;
    expect(first.state).toBe('overdue');
    expect(inQueue(stale, 'overdue', me, now)).toBe(true);
  });

  it('counts Priya fleet-reply as overdue', () => {
    const waiting = rows.find(c => c.reference.endsWith('171'))!;
    expect(waiting.handler_id).toBe(demoPriyaId);
    expect(inQueue(waiting, 'waiting', me, now)).toBe(true);
    expect(inQueue(waiting, 'overdue', me, now)).toBe(true);
    expect(clocksOf(waiting, now).find(c => c.key === 'fleet_reply')?.state).toBe('overdue');
    expect(needsHandlerAction(waiting, me, now)).toBe(false);
  });

  it('marks an eleven-day review as decision overdue', () => {
    const review = rows.find(c => c.reference.endsWith('166'))!;
    expect(clocksOf(review, now).find(c => c.key === 'decision')?.state).toBe('overdue');
    expect(urgentClock(clocksOf(review, now))?.key).toBe('decision');
  });

  it('keeps the cover-after row on mine with first touch met', () => {
    const mine = rows.find(c => c.reference.endsWith('159'))!;
    expect(inQueue(mine, 'mine', me, now)).toBe(true);
    expect(clocksOf(mine, now).find(c => c.key === 'first_touch')?.state).toBe('met');
    expect(inboxWhy(mine, me, now)).toContain('Cover recorded after incident');
  });

  it('leaves a future fleet due date off the overdue list', () => {
    const open = rows.find(c => c.reference.endsWith('152'))!;
    expect(inQueue(open, 'waiting', me, now)).toBe(true);
    expect(clocksOf(open, now).find(c => c.key === 'fleet_reply')?.state).toBe('ok');
  });

  it('summarises the five demo rows', () => {
    const counts = inboxCounts(rows, me, now);
    expect(counts.open).toBe(5);
    expect(counts.unassigned).toBe(1);
    expect(counts.mine).toBe(2);
    expect(counts.waiting).toBe(2);
    expect(counts.coverAfter).toBe(1);
    expect(filterInbox(rows, 'unassigned', me, now)).toHaveLength(1);
  });
});

describe('SLA defaults', () => {
  it('gives an injury two hours to first touch', () => {
    expect(defaultSla.injuryFirstTouchHours).toBe(2);
    expect(defaultSla.firstTouchHours).toBe(4);
  });
});

describe('book MI', () => {
  it('does not invent a loss ratio', () => {
    const totals = bookTotals(demoBookRows);
    expect(totals.onCover).toBe(1285);
    expect(totals.earned).toBe(184000);
    expect(totals.frequency).toBe(claimsPerVehicleYear(39, 1285));
    expect(formatEarned(null)).toBe('No locked months');
    expect(formatFrequency(0.31)).toBe('0.31');
    expect(medianMs([4, 1, 2])).toBe(2);
    expect(eventTitle.handler_assigned).toBe('Handler updated');
    expect(isDemoInboxClaim('00000000-0000-4000-8000-000000000184')).toBe(true);
    expect(isDemoInboxClaim('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')).toBe(false);
    expect(demoFleetLabel('atlas')).toBe('Atlas Logistics');
  });
});
