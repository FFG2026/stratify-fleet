import { describe, it, expect } from 'vitest';
import { parseTypes, typeLabel, isOpen, statusLabel } from '../src/lib/referrals';
import { bordereauRef, netToInsurer, type BordereauRow } from '../src/lib/bordereau';

describe('referral helpers', () => {
  it('keeps only known vehicle types', () => { expect(parseTypes(['car', 'spaceship', 'hgv', 5])).toEqual(['car', 'hgv']); });
  it('labels types and statuses', () => { expect(typeLabel('van_3_5t')).toBe('Van (up to 3.5t)'); expect(statusLabel.queried).toBe('Under query'); });
  it('treats only awaiting and queried as open', () => { expect(['awaiting_authorisation', 'queried', 'approved', 'declined', 'withdrawn'].map(isOpen)).toEqual([true, true, false, false, false]); });
  it('builds a bordereau reference and net to insurer', () => {
    expect(bordereauRef('Northbridge Mutual (demo)', '2026-11')).toBe('BORD-NORTHB-11-2026');
    expect(netToInsurer({ premium_gross: 336, commission: 24 } as unknown as BordereauRow)).toBe(312);
  });
});
