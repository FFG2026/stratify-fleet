// Telematics: CSV reading, row checking and the indicative risk score. Pure functions; no database access here.
// No telematics provider is connected. The score is a simple, transparent summary for the fleet, not an underwriting model.

export const eventKinds = ['harsh_braking', 'harsh_acceleration', 'harsh_cornering', 'speeding', 'crash_alert'] as const;
export type EventKind = (typeof eventKinds)[number];
export const kindLabel: Record<EventKind, string> = {
  harsh_braking: 'Harsh braking', harsh_acceleration: 'Harsh acceleration', harsh_cornering: 'Harsh cornering', speeding: 'Speeding', crash_alert: 'Crash alert'
};
export const maxCsvBytes = 1_000_000;
export const maxCsvRows = 2000;
export const minScoreMiles = 50;

export const telematicsNotConnected = 'No telematics provider is connected. Upload a CSV from your provider to see scores here. Provider feeds can be added later without changing this page.';

export const csvTemplate = 'type,registration,date_time,kind,severity,speed_mph,limit_mph,location,distance_miles\n'
  + 'trip,AB12CDE,2026-10-20T08:00:00Z,,,,,,42.5\n'
  + 'event,AB12CDE,2026-10-20T08:30:00Z,speeding,2,52,40,A1 northbound,\n';

// Reads CSV text with quoted fields, doubled quotes and CRLF. Returns rows of cells; blank lines are dropped.
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []; let row: string[] = []; let cell = ''; let quoted = false;
  const src = text.replace(/^﻿/, '');
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') { if (src[i + 1] === '"') { cell += '"'; i++; } else quoted = false; } else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && src[i + 1] === '\n') i++; row.push(cell); cell = ''; if (row.some(c => c.trim() !== '')) rows.push(row); row = []; }
    else cell += ch;
  }
  row.push(cell); if (row.some(c => c.trim() !== '')) rows.push(row);
  return rows;
}

export type ImportRow = {
  type: 'event' | 'trip'; registration: string; at: string; kind?: EventKind; severity?: number; speed_mph?: number; limit_mph?: number; location?: string; distance_miles?: number;
};

const header = ['type', 'registration', 'date_time', 'kind', 'severity', 'speed_mph', 'limit_mph', 'location', 'distance_miles'];

// Turns CSV text into rows for the import function. Throws a plain-English error naming the line that is wrong.
export function readTelematicsCsv(text: string): ImportRow[] {
  const table = parseCsv(text);
  if (table.length < 2) throw new Error('The file has no rows. Use the template: it has a header line and one line per trip or event.');
  const head = table[0].map(h => h.trim().toLowerCase());
  const missing = header.filter(h => !head.includes(h) && !['kind', 'severity', 'speed_mph', 'limit_mph', 'location', 'distance_miles'].includes(h));
  if (missing.length) throw new Error('The first line must include: ' + missing.join(', ') + '.');
  if (table.length - 1 > maxCsvRows) throw new Error(`At most ${maxCsvRows} rows can be uploaded at once.`);
  const col = (cells: string[], name: string) => { const i = head.indexOf(name); return i < 0 ? '' : (cells[i] ?? '').trim(); };
  return table.slice(1).map((cells, idx) => {
    const line = idx + 2; const bad = (why: string) => new Error(`Line ${line}: ${why}`);
    const type = col(cells, 'type').toLowerCase();
    if (type !== 'event' && type !== 'trip') throw bad('type must be event or trip.');
    const registration = col(cells, 'registration').toUpperCase().replace(/\s/g, '');
    if (!/^[A-Z0-9]{2,8}$/.test(registration)) throw bad('enter the vehicle registration.');
    const when = col(cells, 'date_time'); const ms = Date.parse(when);
    if (!when || Number.isNaN(ms) || !/^\d{4}-\d{2}-\d{2}/.test(when)) throw bad('date_time must look like 2026-10-20T08:30:00Z.');
    // A date and time with no zone is read as UTC, so the same file always means the same moments.
    const at = new Date(/(Z|[+-]\d{2}:?\d{2})$/.test(when) ? ms : Date.parse(when + (when.includes('T') ? 'Z' : 'T00:00:00Z'))).toISOString();
    const num = (name: string, min: number, max: number) => {
      const raw = col(cells, name); if (raw === '') return undefined;
      const n = Number(raw); if (!Number.isFinite(n) || n < min || n > max) throw bad(`${name} must be a number from ${min} to ${max}.`);
      return n;
    };
    if (type === 'trip') {
      const distance = num('distance_miles', 0.1, 3000);
      if (distance === undefined) throw bad('a trip needs distance_miles.');
      return { type: 'trip', registration, at, distance_miles: distance } satisfies ImportRow;
    }
    const kind = col(cells, 'kind').toLowerCase() as EventKind;
    if (!eventKinds.includes(kind)) throw bad('kind must be one of ' + eventKinds.join(', ') + '.');
    const severity = num('severity', 1, 3);
    return { type: 'event', registration, at, kind, severity: severity === undefined ? 1 : Math.round(severity),
      speed_mph: num('speed_mph', 0, 250), limit_mph: num('limit_mph', 0, 150), location: col(cells, 'location').slice(0, 200) || undefined } satisfies ImportRow;
  });
}

// Points per event kind; severity (1 to 3) multiplies it. Crash alerts are shown separately and do not score.
export const kindWeight: Record<EventKind, number> = { harsh_braking: 1, harsh_acceleration: 1, harsh_cornering: 1, speeding: 2, crash_alert: 0 };
export const weightedPoints = (events: { kind: EventKind; severity: number }[]) => events.reduce((sum, e) => sum + kindWeight[e.kind] * e.severity, 0);

// 100 is best. Penalty is 2 points for each weighted event per 100 miles. Under 50 miles there is not enough driving to judge.
export function riskScore(points: number, miles: number): number | null {
  if (!(miles >= minScoreMiles)) return null;
  const per100 = points / (miles / 100);
  return Math.max(0, Math.min(100, Math.round(100 - 2 * per100)));
}
export const scoreBand = (score: number | null): 'none' | 'good' | 'watch' | 'high' => score === null ? 'none' : score >= 80 ? 'good' : score >= 60 ? 'watch' : 'high';
export const bandLabel = { none: 'Not enough driving', good: 'Low risk', watch: 'Watch', high: 'High risk' } as const;
