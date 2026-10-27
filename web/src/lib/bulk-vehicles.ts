// Reads a CSV of vehicles (registration, make, model) for a bulk add. Pure functions so they can be tested without a browser.
export const maxBulkRows = 500;
export const bulkTemplate = 'Registration,Make,Model\r\nAB26CDE,Ford,Transit Custom\r\nAB26CDF,Mercedes-Benz,Sprinter\r\n';

export type BulkRow = { line: number; registration: string; make: string; model: string; error: string | null };
export type BulkParse = { rows: BulkRow[]; fileError: string | null };

// Same shapes the database accepts (private.is_valid_registration), so a row that passes here is not rejected for format later.
const regShape = /^([A-Z]{2}[0-9]{2}[A-Z]{3}|[A-Z][0-9]{1,3}[A-Z]{3}|[A-Z]{3}[0-9]{1,3}[A-Z]|[A-Z]{1,3}[0-9]{1,4}|[0-9]{1,4}[A-Z]{1,3})$/;

// Splits CSV text into records. Handles quoted fields, doubled quotes, commas and line breaks inside quotes, and CRLF.
export function splitCsv(input: string): string[][] {
  const text = input.replace(/^﻿/, '');
  const out: string[][] = []; let row: string[] = []; let cell = ''; let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else quoted = false; } else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',' || ch === ';' || ch === '\t') { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cell); out.push(row); row = []; cell = ''; }
    else cell += ch;
  }
  if (cell !== '' || row.length) { row.push(cell); out.push(row); }
  return out.filter(r => r.some(c => c.trim() !== ''));
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z]/g, '');
const regHeads = ['registration', 'reg', 'regnumber', 'regno', 'vrm', 'numberplate', 'registrationnumber'];

export function parseVehicleCsv(input: string): BulkParse {
  let records: string[][];
  try { records = splitCsv(input); } catch { return { rows: [], fileError: 'That file could not be read as a CSV.' }; }
  if (!records.length) return { rows: [], fileError: 'The file is empty.' };
  // Columns come from the header row when there is one; otherwise they are registration, make, model in that order.
  const first = records[0].map(norm);
  const hasHeader = first.some(h => regHeads.includes(h));
  let reg = 0, make = 1, model = 2, start = 0;
  if (hasHeader) {
    start = 1;
    reg = first.findIndex(h => regHeads.includes(h));
    make = first.findIndex(h => h === 'make' || h === 'manufacturer');
    model = first.findIndex(h => h === 'model');
    if (make < 0 && model < 0) { make = first.findIndex(h => h === 'makemodel' || h === 'vehicle' || h === 'description'); }
  }
  const body = records.slice(start);
  if (!body.length) return { rows: [], fileError: 'The file has a header row but no vehicles.' };
  if (body.length > maxBulkRows) return { rows: [], fileError: `That file has ${body.length} rows. Upload at most ${maxBulkRows} at a time.` };
  const seen = new Set<string>();
  const rows = body.map((r, i): BulkRow => {
    const line = i + 1 + start;
    const registration = (r[reg] ?? '').toUpperCase().replace(/\s/g, '');
    const m = make >= 0 ? (r[make] ?? '').trim() : '';
    const mo = model >= 0 && model !== make ? (r[model] ?? '').trim() : '';
    let error: string | null = null;
    if (!registration) error = 'No registration.';
    else if (!regShape.test(registration)) error = `"${registration.slice(0, 12)}" is not a valid UK registration.`;
    else if (seen.has(registration)) error = 'This registration appears earlier in the file.';
    else if (!m && !mo) error = 'Enter a make and model.';
    else if (m.length > 100 || mo.length > 100) error = 'Make or model is too long.';
    if (registration) seen.add(registration);
    return { line, registration, make: m, model: mo, error };
  });
  return { rows, fileError: null };
}
export const makeModel = (r: Pick<BulkRow, 'make' | 'model'>) => `${r.make} ${r.model}`.trim().slice(0, 200);
