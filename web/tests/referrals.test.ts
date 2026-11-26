import { describe, it, expect } from 'vitest';
import { parseTypes, typeLabel, isOpen, statusLabel } from '../src/lib/referrals';
import { bordereauRef, netToInsurer, type BordereauRow } from '../src/lib/bordereau';

describe('referral helpers', () => {
  it('keeps only known vehicle types', () => { expect(parseTypes(['car', 'spaceship', 'hgv', 5])).toEqual(['car', 'hgv']); });
  it('labels types and statuses', () => { expect(typeLabel('van_3_5t')).toBe('Van (up to 3.5t)'); expect(statusLabel.queried).toBe('Under query'); });
  it('treats only awaiting and queried as open', () => { expect(['awaiting_authorisation', 'queried', 'approved', 'declined', 'withdrawn'].map(isOpen)).toEqual([true, true, false, false, false]); });
  it('builds a bordereau reference and net to insurer', () => {
    expect(bordereauRef('Northbridge Mutual (demo)', '2026-11')).toBe('BORD-NORTHB-11-2026');
    expect(netToInsurer({ premium_net: 300, premium_gross: 336, commission: 24 } as unknown as BordereauRow)).toBe(276);
  });
});

import { parseDailyRate, monthlyFromDaily } from '../src/lib/referrals';
describe('agreed daily rate', () => {
  it('treats blank as the policy rate', () => { expect(parseDailyRate('  ')).toEqual({ ok: true, value: null }); expect(parseDailyRate(null)).toEqual({ ok: true, value: null }); });
  it('accepts amounts with a pound sign or commas', () => { expect(parseDailyRate('£18.50')).toEqual({ ok: true, value: 18.5 }); expect(parseDailyRate('1,000')).toEqual({ ok: true, value: 1000 }); });
  it('rejects junk and negatives', () => { for (const v of ['abc', '-3', '1.23456', '12.3.4', '99999']) expect(parseDailyRate(v).ok).toBe(false); });
  it('monthly price is daily x 365 / 12', () => { expect(monthlyFromDaily(14.55)).toBe(442.56); });
});
