import { describe, it, expect } from 'vitest';
import { monthlyFromDaily, burnBand, burnTotals, type BurnRow } from '../src/lib/burn';

const row = (o: Partial<BurnRow>): BurnRow => ({ policy_id: 'p', policy_number: 'P', fleet_id: 'f', fleet_name: 'F', period_from: '2026-01-01', vehicles: 1, daily_rate: 10, monthly_price: 304.17,
  earned_net: 1000, claims: 1, paid: 300, reserve: 200, incurred: 500, burn_rate_pct: 50, ...o });

describe('burn rate helpers', () => {
  it('monthly price is daily x 365 / 12', () => { expect(monthlyFromDaily(10)).toBe(304.17); expect(monthlyFromDaily(9.863)).toBe(300); });
  it('bands', () => { expect([null, 10, 59.9, 60, 79.9, 80, 120].map(burnBand)).toEqual(['none', 'good', 'good', 'watch', 'watch', 'high', 'high']); });
  it('totals divide claims by premium, not the other way round', () => {
    const t = burnTotals([row({}), row({ earned_net: 3000, incurred: 1500 })]);
    expect(t.earned).toBe(4000); expect(t.incurred).toBe(2000); expect(t.pct).toBe(50);
  });
  it('no premium gives no percentage', () => { expect(burnTotals([row({ earned_net: 0 })]).pct).toBeNull(); });
});
