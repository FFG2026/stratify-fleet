import { describe, expect, it } from 'vitest';
import { claimGaps, londonToIso, yesNo } from '../src/lib/claims';

describe('londonToIso', () => {
  it('treats winter times as GMT', () => expect(londonToIso('2026-01-15', '14:30')).toBe('2026-01-15T14:30:00.000Z'));
  it('treats summer times as BST (one hour behind UTC)', () => expect(londonToIso('2026-07-15', '14:30')).toBe('2026-07-15T13:30:00.000Z'));
  it('handles the clocks going back on 25 Oct 2026', () => {
    expect(londonToIso('2026-10-25', '12:00')).toBe('2026-10-25T12:00:00.000Z');
    expect(londonToIso('2026-10-24', '12:00')).toBe('2026-10-24T11:00:00.000Z');
  });
  it('rejects a bad time', () => expect(() => londonToIso('2026-01-15', '25:00')).toThrow());
});

describe('claimGaps', () => {
  const full = { police_attended: false, third_party_involved: false, no_photos_confirmed: false };
  it('is empty for a complete report', () => expect(claimGaps(full, 0, 1)).toEqual([]));
  it('asks for photos unless none are confirmed', () => {
    expect(claimGaps(full, 0, 0)).toHaveLength(1);
    expect(claimGaps({ ...full, no_photos_confirmed: true }, 0, 0)).toEqual([]);
  });
  it('asks for the other party when one was involved', () => expect(claimGaps({ ...full, third_party_involved: true }, 0, 1)).toEqual(['Add the other party’s details']));
  it('asks about police and other party when unanswered', () => expect(claimGaps({ ...full, police_attended: null, third_party_involved: null }, 0, 1)).toHaveLength(2));
});

describe('yesNo', () => {
  it('maps yes/no/blank', () => { expect(yesNo('yes')).toBe(true); expect(yesNo('no')).toBe(false); expect(yesNo('')).toBeNull(); });
});
