// Book and loss MI for the insurer dashboard. Frequency and aging only.
// Do not invent incurred or a loss ratio unless the caller supplies incurred.

export type BookFleetRow = {
  fleet_id: string;
  fleet_name: string;
  on_cover: number;
  earned_ytd: number | null;
  claims_12m: number;
  open: number;
  cover_after: number;
  licence_overdue: number;
  no_driver: number;
};

export function claimsPerVehicleYear(claims12m: number, onCover: number): number | null {
  if (!onCover) return null;
  return Math.round((claims12m / onCover) * 100) / 100;
}

export function formatEarned(value: number | null): string {
  if (value === null) return 'No locked months';
  return '£' + Math.round(value).toLocaleString('en-GB');
}

export function formatFrequency(value: number | null): string {
  return value === null ? '—' : value.toFixed(2);
}

export function bookTotals(rows: BookFleetRow[]) {
  const earnedParts = rows.map(r => r.earned_ytd);
  const earned = earnedParts.every(v => v === null) ? null : earnedParts.reduce<number>((sum, v) => sum + (v ?? 0), 0);
  const onCover = rows.reduce((a, r) => a + r.on_cover, 0);
  const claims12m = rows.reduce((a, r) => a + r.claims_12m, 0);
  return {
    onCover,
    earned,
    claims12m,
    open: rows.reduce((a, r) => a + r.open, 0),
    coverAfter: rows.reduce((a, r) => a + r.cover_after, 0),
    licenceOverdue: rows.reduce((a, r) => a + r.licence_overdue, 0),
    noDriver: rows.reduce((a, r) => a + r.no_driver, 0),
    frequency: claimsPerVehicleYear(claims12m, onCover)
  };
}

export function medianMs(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}
