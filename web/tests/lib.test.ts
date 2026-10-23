import { describe, it, expect } from 'vitest';
import { insuredDays, monthBounds, normaliseRegistration, londonMidnight, londonDate, csv, parseDate, nextDate } from '@/lib/dates';
import { fleetQuery, historyQuery } from '@/lib/queries';
import { checkedId } from '@/lib/ids';
import { memberEmail, memberRole } from '@/lib/members';
import { lookupVehicle, tidyMake, createLimiter, lookupConfigured } from '@/lib/vehicle-lookup';
import { contentSecurityPolicy } from '@/middleware';

describe('dates', () => {
  it('rejects impossible dates and months', () => {
    expect(() => parseDate('2026-02-30')).toThrow();
    expect(() => parseDate('26-1-1')).toThrow();
    expect(() => monthBounds('2026-13')).toThrow();
    expect(nextDate('2026-02-28')).toBe('2026-03-01');
  });
  it('counts date-only preview days with start included and removal excluded', () => {
    expect(insuredDays('2026-10-01', '2026-10-10', '2026-10')).toBe(9);
    expect(insuredDays('2026-09-15', null, '2026-10')).toBe(31);
    expect(insuredDays('2026-10-31', null, '2026-10')).toBe(1);
    expect(insuredDays('2026-11-05', null, '2026-10')).toBe(0);
    expect(() => insuredDays('2026-10-10', '2026-10-01', '2026-10')).toThrow();
  });
  it('converts a London date to UTC midnight across daylight saving', () => {
    expect(londonMidnight('2026-07-01')).toBe('2026-06-30T23:00:00.000Z');
    expect(londonMidnight('2026-01-15')).toBe('2026-01-15T00:00:00.000Z');
    expect(londonMidnight('2026-03-29')).toBe('2026-03-29T00:00:00.000Z'); // clocks go forward at 01:00 that day
    expect(londonMidnight('2026-10-25')).toBe('2026-10-24T23:00:00.000Z'); // clocks go back at 02:00 that day
    expect(londonDate('2026-06-30T23:30:00Z')).toBe('2026-07-01');
  });
  it('normalises registrations', () => {
    expect(normaliseRegistration(' ab12 cde ')).toBe('AB12CDE');
    expect(() => normaliseRegistration('')).toThrow();
    expect(() => normaliseRegistration('AB-12!')).toThrow();
    expect(() => normaliseRegistration('A'.repeat(9))).toThrow();
  });
  it('neutralises spreadsheet formulas in CSV cells', () => {
    expect(csv([['=1+1', '+cmd', '-x', '@y', 'ok "q"']])).toBe(`"'=1+1","'+cmd","'-x","'@y","ok ""q"""`);
  });
});

describe('queries', () => {
  it('builds the register query with validated filters only', () => {
    const { query } = fleetQuery({ status: 'open', q: 'ab1 2', offset: '25', limit: '25' });
    expect(query.get('cover_end')).toBe('is.null');
    expect(query.get('vehicle.or')).toContain('registration.ilike.*ab12*');
    expect(query.get('offset')).toBe('25');
  });
  it('rejects hostile input', () => {
    expect(() => fleetQuery({ q: 'a);drop' })).toThrow();
    expect(() => fleetQuery({ status: 'weird' })).toThrow();
    expect(() => fleetQuery({ policy: 'not-a-uuid' })).toThrow();
    expect(() => fleetQuery({ limit: '1000' })).toThrow();
    expect(() => fleetQuery({ offset: '-1' })).toThrow();
    expect(() => historyQuery({ month: '2026-99' })).toThrow();
    expect(() => checkedId('1; select')).toThrow();
  });
  it('active status asks for open or future-ended periods on active policies', () => {
    const q = fleetQuery({ status: 'active' }, new Date('2026-10-23T12:00:00Z')).query;
    expect(q.get('or')).toContain('cover_end.is.null');
    expect(q.get('policy.active')).toBe('eq.true');
  });
});

describe('members', () => {
  it('validates email and role', () => {
    expect(memberEmail('  New.Person@Example.com ')).toBe('new.person@example.com');
    for (const bad of ['', 'nope', 'a@b', 'a b@c.com', null]) expect(() => memberEmail(bad)).toThrow();
    expect(memberRole('fleet_manager')).toBe('fleet_manager');
    expect(() => memberRole('root')).toThrow();
  });
});

describe('vehicle lookup', () => {
  const env = { DVLA_VES_API_KEY: 'secret-test-key' };
  const ok = { make: 'FORD', colour: 'WHITE', fuelType: 'DIESEL', yearOfManufacture: 2021, motExpiryDate: '2027-03-01', dateOfLastV5CIssued: '2021-05-05' };
  const respond = (status: number, data?: unknown) => (async (_u: unknown, o?: RequestInit) => { (respond as unknown as { last: RequestInit }).last = o!; return new Response(data === undefined ? null : JSON.stringify(data), { status }); }) as typeof fetch;
  it('tidies makes', () => {
    expect(tidyMake('FORD')).toBe('Ford'); expect(tidyMake('MERCEDES-BENZ')).toBe('Mercedes-Benz'); expect(tidyMake('BMW')).toBe('BMW');
  });
  it('sends the key in a header and returns a trimmed summary', async () => {
    const r = await lookupVehicle('ab12 cde', { env, fetchImpl: respond(200, ok) });
    const sent = (respond as unknown as { last: RequestInit }).last;
    expect((sent.headers as Record<string, string>)['x-api-key']).toBe('secret-test-key');
    expect(JSON.parse(String(sent.body))).toEqual({ registrationNumber: 'AB12CDE' });
    expect(r.make).toBe('Ford');
    expect('dateOfLastV5CIssued' in r).toBe(false);
    expect(JSON.stringify(r)).not.toContain('secret');
  });
  it('gives plain errors and never leaks the key', async () => {
    await expect(lookupVehicle('AB12CDE', { env: {}, fetchImpl: respond(200, ok) })).rejects.toMatchObject({ status: 503 });
    await expect(lookupVehicle('!!', { env, fetchImpl: respond(200, ok) })).rejects.toMatchObject({ status: 400 });
    await expect(lookupVehicle('AB12CDE', { env, fetchImpl: respond(404, {}) })).rejects.toMatchObject({ status: 404 });
    await expect(lookupVehicle('AB12CDE', { env, fetchImpl: respond(429, {}) })).rejects.toMatchObject({ status: 429 });
    await expect(lookupVehicle('AB12CDE', { env, fetchImpl: respond(500, {}) })).rejects.toMatchObject({ status: 502 });
    await expect(lookupVehicle('AB12CDE', { env, fetchImpl: (async () => { throw new Error('boom secret-test-key'); }) as typeof fetch })).rejects.toSatisfy((e: Error) => !e.message.includes('secret'));
    await expect(lookupVehicle('AB12CDE', { env: { ...env, DVLA_VES_URL: 'http://insecure.invalid' }, fetchImpl: respond(200, ok) })).rejects.toMatchObject({ status: 503 });
  });
  it('limits bursts and recovers', () => {
    let t = 0; const allow = createLimiter(3, 1000, () => t);
    expect([allow('u'), allow('u'), allow('u'), allow('u')]).toEqual([true, true, true, false]);
    t = 1001; expect(allow('u')).toBe(true);
    expect(lookupConfigured({})).toBe(false); expect(lookupConfigured(env)).toBe(true);
  });
});

describe('content security policy', () => {
  it('allows only nonce-marked scripts and no inline styles in production', () => {
    const csp = contentSecurityPolicy('abc', false);
    expect(csp).toContain("script-src 'self' 'nonce-abc' 'strict-dynamic'");
    expect(csp).not.toMatch(/unsafe-inline|unsafe-eval/);
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("connect-src 'self'");
  });
});
