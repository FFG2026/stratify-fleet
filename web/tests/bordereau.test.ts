import { describe, it, expect } from 'vitest';
import { dailyFromMonthly, totals, bordereauCsv, gbp, isMonth, type BordereauRow } from '../src/lib/bordereau';

const row = (o: Partial<BordereauRow>): BordereauRow => ({ policy_id: 'p', policy_number: 'P-1', fleet_id: 'f', fleet_name: 'Fleet', vehicles: 2, additions: 1, removals: 1, vehicle_days: 51, minimum_period_days: 15,
  premium_net: 510, ipt: 61.2, premium_gross: 571.2, commission_pct: 12.5, commission: 63.75, addition_fee: 5, removal_fee: 3, admin_fees: 8, remuneration: 71.75, terms_set: true, ...o });

describe('bordereau helpers', () => {
  it('converts a monthly price to a daily rate', () => { expect(dailyFromMonthly(300)).toBe(9.863); });
  it('totals rows without float drift', () => {
    const t = totals([row({ commission: 0.1 }), row({ commission: 0.2 })]);
    expect(t.commission).toBe(0.3); expect(t.premium_net).toBe(1020);
  });
  it('flags policies with no terms in the CSV and adds a total line', () => {
    const out = bordereauCsv('2026-09', [row({ terms_set: false })]);
    expect(out[1][18]).toBe('NO TERMS SET'); expect(out[2][0]).toBe('TOTAL');
  });
  it('formats money and validates months', () => {
    expect(gbp(1234.5)).toBe('£1,234.50'); expect(isMonth('2026-09')).toBe(true); expect(isMonth('2026-13')).toBe(false); expect(isMonth(undefined)).toBe(false);
  });
});
