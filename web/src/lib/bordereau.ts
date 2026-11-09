// Insurer bordereau rows and small helpers. Figures are calculated in the database; this file only shapes and formats them.
export type BordereauRow = {
  policy_id: string; policy_number: string; fleet_id: string; fleet_name: string;
  vehicles: number; additions: number; removals: number; vehicle_days: number; minimum_period_days: number;
  premium_net: number; ipt: number; premium_gross: number;
  commission_pct: number; commission: number; addition_fee: number; removal_fee: number; admin_fees: number; remuneration: number;
  terms_set: boolean;
};
export const gbp = (n: number | string) => '£' + Number(n).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const isMonth = (m: string | undefined): m is string => /^\d{4}-(0[1-9]|1[0-2])$/.test(m ?? '');
export const monthStart = (m: string) => m + '-01';

export function totals(rows: BordereauRow[]) {
  const sum = (k: keyof BordereauRow) => Math.round(rows.reduce((s, r) => s + Number(r[k]), 0) * 100) / 100;
  return { vehicles: sum('vehicles'), additions: sum('additions'), removals: sum('removals'), vehicle_days: sum('vehicle_days'),
    premium_net: sum('premium_net'), ipt: sum('ipt'), premium_gross: sum('premium_gross'), commission: sum('commission'), admin_fees: sum('admin_fees'), remuneration: sum('remuneration') };
}

// Helper for entering a monthly price: the portal bills a daily rate, so £300 a month over a 365-day year is £9.8630 a day.
export const dailyFromMonthly = (monthly: number) => Math.round((monthly * 12 / 365) * 10000) / 10000;

export function bordereauCsv(month: string, rows: BordereauRow[]): unknown[][] {
  const head = ['Month', 'Policy', 'Customer', 'Vehicles', 'Additions', 'Removals', 'Vehicle days', 'Days from minimum period', 'Net premium', 'IPT', 'Gross premium',
    'Commission %', 'Commission', 'Addition fee each', 'Removal fee each', 'Admin fees', 'Total remuneration', 'Terms set'];
  const t = totals(rows);
  return [head,
    ...rows.map(r => [month, r.policy_number, r.fleet_name, r.vehicles, r.additions, r.removals, r.vehicle_days, r.minimum_period_days, r.premium_net, r.ipt, r.premium_gross,
      r.commission_pct, r.commission, r.addition_fee, r.removal_fee, r.admin_fees, r.remuneration, r.terms_set ? 'yes' : 'NO TERMS SET']),
    ['TOTAL', '', '', t.vehicles, t.additions, t.removals, t.vehicle_days, '', t.premium_net, t.ipt, t.premium_gross, '', t.commission, '', '', t.admin_fees, t.remuneration, '']];
}
