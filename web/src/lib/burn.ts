// Burn rate = incurred claims (paid + reserve) / earned net premium x 100. Monthly price = daily rate x 365 / 12. Figures come from the database.
export type BurnRow = {
  policy_id: string; policy_number: string; fleet_id: string; fleet_name: string; period_from: string; vehicles: number;
  daily_rate: number | null; monthly_price: number | null; earned_net: number; claims: number; paid: number; reserve: number; incurred: number; burn_rate_pct: number | null;
};
export type PriceRow = { policy_id: string; policy_number: string; daily_rate: number; monthly_price: number; effective_from: string };
export const monthlyFromDaily = (daily: number) => Math.round((daily * 365 / 12) * 100) / 100;
// Guide bands only, to make the table easy to scan: not an underwriting rule.
export const burnBand = (pct: number | null): 'good' | 'watch' | 'high' | 'none' => (pct === null ? 'none' : pct < 60 ? 'good' : pct < 80 ? 'watch' : 'high');
export const bandLabel = { good: 'Healthy', watch: 'Watch', high: 'High', none: 'No premium yet' } as const;
export function burnTotals(rows: BurnRow[]) {
  const earned = rows.reduce((s, r) => s + Number(r.earned_net), 0), incurred = rows.reduce((s, r) => s + Number(r.incurred), 0);
  return { earned: Math.round(earned * 100) / 100, incurred: Math.round(incurred * 100) / 100, claims: rows.reduce((s, r) => s + r.claims, 0), pct: earned > 0 ? Math.round(incurred / earned * 1000) / 10 : null };
}
