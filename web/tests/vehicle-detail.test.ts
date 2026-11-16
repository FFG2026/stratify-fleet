import { describe, it, expect } from 'vitest';
import { shapeStints, ukDate } from '../src/lib/vehicle-detail';

const names = new Map([['u1', 'Ann Driver'], ['u2', 'Ben Driver']]);

describe('vehicle driver history', () => {
  it('orders newest first and marks current, previous and upcoming', () => {
    const rows = [
      { id: 'a', user_id: 'u1', assigned_from: '2026-03-01', assigned_to: '2026-06-30' },
      { id: 'b', user_id: 'u2', assigned_from: '2026-07-01', assigned_to: null },
      { id: 'c', user_id: 'u1', assigned_from: '2026-12-01', assigned_to: null }
    ];
    const s = shapeStints(rows, names, '2026-11-16');
    expect(s.map(x => x.id)).toEqual(['c', 'b', 'a']);
    expect(s.map(x => x.status)).toEqual(['upcoming', 'current', 'previous']);
  });
  it('treats a stint ending today as still current', () => {
    expect(shapeStints([{ id: 'a', user_id: 'u1', assigned_from: '2026-11-01', assigned_to: '2026-11-16' }], names, '2026-11-16')[0].status).toBe('current');
  });
  it('leaves the name empty when the role cannot read driver names', () => {
    expect(shapeStints([{ id: 'a', user_id: 'zz', assigned_from: '2026-11-01', assigned_to: null }], names, '2026-11-16')[0].name).toBeNull();
  });
  it('formats dates in UK style', () => { expect(ukDate('2026-11-05')).toBe('05 Nov 2026'); expect(ukDate(null)).toBe(''); });
});
