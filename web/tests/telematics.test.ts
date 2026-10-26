import { describe, expect, it } from 'vitest';
import { parseCsv, readTelematicsCsv, riskScore, scoreBand, weightedPoints, csvTemplate, telematicsNotConnected, maxCsvRows } from '../src/lib/telematics';

const head = 'type,registration,date_time,kind,severity,speed_mph,limit_mph,location,distance_miles\n';

describe('parseCsv', () => {
  it('reads quoted commas, doubled quotes and CRLF', () => expect(parseCsv('a,"b,c","d""e"\r\nx,y,z\r\n')).toEqual([['a', 'b,c', 'd"e'], ['x', 'y', 'z']]));
  it('drops blank lines and a byte-order mark', () => expect(parseCsv('﻿a,b\n\n,\nc,d')).toEqual([['a', 'b'], ['c', 'd']]));
});

describe('readTelematicsCsv', () => {
  it('reads the template', () => {
    const rows = readTelematicsCsv(csvTemplate);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ type: 'trip', registration: 'AB12CDE', distance_miles: 42.5 });
    expect(rows[1]).toMatchObject({ type: 'event', kind: 'speeding', severity: 2, speed_mph: 52, limit_mph: 40, location: 'A1 northbound' });
  });
  it('tidies the registration and treats a bare date as UTC midnight', () =>
    expect(readTelematicsCsv(head + 'trip,ab 12 cde,2026-10-20,,,,,,10')[0]).toMatchObject({ registration: 'AB12CDE', at: '2026-10-20T00:00:00.000Z' }));
  it('names the line with the problem', () => {
    expect(() => readTelematicsCsv(head + 'trip,AB12CDE,2026-10-20T08:00:00Z,,,,,,5\nevent,AB12CDE,2026-10-20T08:00:00Z,wheelie,,,,,')).toThrow(/Line 3: kind must be/);
    expect(() => readTelematicsCsv(head + 'trip,AB12CDE,not a date,,,,,,5')).toThrow(/Line 2: date_time/);
    expect(() => readTelematicsCsv(head + 'trip,AB12CDE,2026-10-20,,,,,,')).toThrow(/needs distance_miles/);
    expect(() => readTelematicsCsv(head + 'other,AB12CDE,2026-10-20,,,,,,1')).toThrow(/type must be/);
    expect(() => readTelematicsCsv(head + 'event,AB12CDE,2026-10-20,speeding,9,,,,')).toThrow(/severity must be/);
  });
  it('rejects a missing header, an empty file and too many rows', () => {
    expect(() => readTelematicsCsv('type,registration\nevent,AB12CDE')).toThrow(/must include: date_time/);
    expect(() => readTelematicsCsv(head)).toThrow(/no rows/);
    expect(() => readTelematicsCsv(head + Array(maxCsvRows + 1).fill('trip,AB12CDE,2026-10-20,,,,,,1').join('\n'))).toThrow(/At most/);
  });
  it('keeps spreadsheet-formula text as plain text and limits its length', () => {
    const loc = readTelematicsCsv(head + 'event,AB12CDE,2026-10-20,speeding,1,,,"=HYPERLINK(""x"")' + 'z'.repeat(300) + '",')[0].location!;
    expect(loc.length).toBe(200);
  });
});

describe('risk score', () => {
  it('weights speeding double and multiplies by severity, ignoring crash alerts', () =>
    expect(weightedPoints([{ kind: 'speeding', severity: 2 }, { kind: 'harsh_braking', severity: 3 }, { kind: 'crash_alert', severity: 3 }])).toBe(7));
  it('is 100 with no events and falls with events per 100 miles', () => {
    expect(riskScore(0, 500)).toBe(100);
    expect(riskScore(10, 100)).toBe(80);
    expect(riskScore(1000, 100)).toBe(0);
  });
  it('declines to score under 50 miles', () => { expect(riskScore(0, 49.9)).toBeNull(); expect(riskScore(0, 0)).toBeNull(); });
  it('bands the score', () => {
    expect(scoreBand(null)).toBe('none'); expect(scoreBand(80)).toBe('good'); expect(scoreBand(79)).toBe('watch'); expect(scoreBand(59)).toBe('high');
  });
  it('says plainly that no provider is connected', () => expect(telematicsNotConnected).toMatch(/No telematics provider is connected/));
});
