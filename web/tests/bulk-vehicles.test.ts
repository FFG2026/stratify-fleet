import { describe, expect, it } from 'vitest';
import { parseVehicleCsv, splitCsv, maxBulkRows, bulkTemplate, makeModel } from '@/lib/bulk-vehicles';

describe('bulk vehicle csv', () => {
  it('reads the template', () => {
    const p = parseVehicleCsv(bulkTemplate);
    expect(p.fileError).toBeNull();
    expect(p.rows.map(r => r.registration)).toEqual(['AB26CDE', 'AB26CDF']);
    expect(p.rows.every(r => !r.error)).toBe(true);
  });
  it('copes with quotes, BOM, CRLF, spaces and lower case', () => {
    const p = parseVehicleCsv('﻿Reg,Make,Model\r\n"ab26 cde","Ford, UK","Transit ""Custom"""\r\n');
    expect(p.rows[0]).toMatchObject({ registration: 'AB26CDE', make: 'Ford, UK', model: 'Transit "Custom"', error: null });
  });
  it('works without a header row', () => {
    const p = parseVehicleCsv('AB26CDE,Ford,Transit\nAB26CDF,Ford,Transit');
    expect(p.rows).toHaveLength(2); expect(p.rows[0].line).toBe(1);
  });
  it('accepts semicolons and a single make and model column', () => {
    expect(parseVehicleCsv('Registration;Make;Model\nAB26CDE;Ford;Transit').rows[0].error).toBeNull();
    expect(parseVehicleCsv('VRM,Vehicle\nAB26CDE,Ford Transit').rows[0]).toMatchObject({ make: 'Ford Transit', error: null });
  });
  it('flags bad, duplicate and incomplete rows without dropping them', () => {
    const p = parseVehicleCsv('Registration,Make,Model\nNOTAREG!!,Ford,T\nAB26CDE,Ford,T\nab26 cde,Ford,T\nAB26CDF,,\n,Ford,T');
    expect(p.rows.map(r => !!r.error)).toEqual([true, false, true, true, true]);
    expect(p.rows[2].error).toMatch(/earlier/);
  });
  it('rejects empty files and files that are too large', () => {
    expect(parseVehicleCsv('').fileError).toMatch(/empty/);
    expect(parseVehicleCsv('Registration,Make,Model').fileError).toMatch(/no vehicles/);
    const big = 'Registration,Make,Model\n' + Array.from({ length: maxBulkRows + 1 }, () => 'AB26CDE,F,T').join('\n');
    expect(parseVehicleCsv(big).fileError).toMatch(/at most/);
  });
  it('splitCsv ignores blank lines and joins make and model', () => {
    expect(splitCsv('a,b\n\n\nc,d\n')).toEqual([['a', 'b'], ['c', 'd']]);
    expect(makeModel({ make: 'Ford', model: 'Transit' })).toBe('Ford Transit');
  });
});
