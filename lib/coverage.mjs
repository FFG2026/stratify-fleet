const day = 86400000;
export function parseDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('Use a valid calendar date.');
  const date = new Date(value + 'T00:00:00Z');
  if (!Number.isFinite(+date) || date.toISOString().slice(0, 10) !== value) throw new Error('Invalid calendar date.');
  return +date;
}
export function monthBounds(month) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error('Invalid month.');
  const start = parseDate(month + '-01');
  const next = new Date(start); next.setUTCMonth(next.getUTCMonth() + 1);
  return [start, +next];
}
// Provisional: London calendar dates, start included and removal date excluded.
// UTC arithmetic counts date labels without DST 23/25-hour day errors.
export function insuredDays(start, end, month) {
  const [a, b] = monthBounds(month);
  const s = parseDate(start), e = end ? parseDate(end) : Infinity;
  if (e < s) throw new Error('Removal precedes addition.');
  return Math.max(0, (Math.min(e, b) - Math.max(s, a)) / day);
}
export function normaliseRegistration(value) {
  const result = String(value).toUpperCase().replace(/\s/g, '');
  if (!/^[A-Z0-9]{2,8}$/.test(result)) throw new Error('Enter 2–8 registration letters or numbers.');
  return result;
}
export function csv(rows) {
  return rows.map(row => row.map(value => {
    let text = String(value ?? '');
    if (/^[\s]*[=+@-]/.test(text)) text = "'" + text;
    return '"' + text.replaceAll('"', '""') + '"';
  }).join(',')).join('\r\n');
}
