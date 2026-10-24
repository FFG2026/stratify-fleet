// Date helpers. Everything is Europe/London calendar-day arithmetic; UTC arithmetic on date labels avoids 23/25-hour day errors.
const day = 86400000;

export function parseDate(value: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('Use a valid calendar date.');
  const date = new Date(value + 'T00:00:00Z');
  if (!Number.isFinite(+date) || date.toISOString().slice(0, 10) !== value) throw new Error('Invalid calendar date.');
  return +date;
}
export function monthBounds(month: string): [number, number] {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error('Invalid month.');
  const start = parseDate(month + '-01');
  const next = new Date(start); next.setUTCMonth(next.getUTCMonth() + 1);
  return [start, +next];
}
// Provisional preview rule: London calendar dates, start included, removal date excluded.
export function insuredDays(start: string, end: string | null, month: string): number {
  const [a, b] = monthBounds(month);
  const s = parseDate(start), e = end ? parseDate(end) : Infinity;
  if (e < s) throw new Error('Removal precedes addition.');
  return Math.max(0, (Math.min(e, b) - Math.max(s, a)) / day);
}
export function normaliseRegistration(value: unknown): string {
  const result = String(value ?? '').toUpperCase().replace(/\s/g, '');
  if (!/^[A-Z0-9]{2,8}$/.test(result)) throw new Error('Enter 2–8 registration letters or numbers.');
  return result;
}
export function csv(rows: unknown[][]): string {
  return rows.map(row => row.map(value => {
    let text = String(value ?? '');
    if (/^[\s]*[=+@-]/.test(text)) text = "'" + text; // stops spreadsheet formula injection
    return '"' + text.replaceAll('"', '""') + '"';
  }).join(',')).join('\r\n');
}
export function londonDate(iso: string | Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
}
export const today = () => londonDate(new Date());
export function londonMidnight(value: string): string {
  const timestamp = parseDate(value);
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', timeZoneName: 'shortOffset' }).formatToParts(new Date(timestamp));
  const offset = parts.find(p => p.type === 'timeZoneName')?.value === 'GMT+1' ? 3600000 : 0;
  return new Date(timestamp - offset).toISOString();
}
// The moment a cover change takes effect. "Today" means from the moment it is recorded, never from midnight, so cover cannot be
// recorded back to the start of a day that has already begun. A later date starts at midnight London time.
export function effectiveFrom(value: string, now = new Date()): string {
  return value === londonDate(now) ? now.toISOString() : londonMidnight(value);
}
export function nextDate(value: string): string { return new Date(parseDate(value) + day).toISOString().slice(0, 10); }
export const londonDateTime = (iso: string) => new Date(iso).toLocaleString('en-GB', { timeZone: 'Europe/London' });
export const londonShortDate = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { timeZone: 'Europe/London' });
