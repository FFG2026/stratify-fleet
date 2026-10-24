import { describe, expect, it } from 'vitest';
import { completeness, historyGaps, sniffFile } from '@/lib/drivers';

describe('file type check', () => {
  it('recognises real files by their first bytes', () => {
    expect(sniffFile(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]))?.type).toBe('image/jpeg');
    expect(sniffFile(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))?.ext).toBe('png');
    expect(sniffFile(new TextEncoder().encode('%PDF-1.7'))?.type).toBe('application/pdf');
    expect(sniffFile(new TextEncoder().encode('RIFF\0\0\0\0WEBPVP8 '))?.ext).toBe('webp');
  });
  it('refuses anything else, whatever it is called', () => {
    expect(sniffFile(new TextEncoder().encode('<script>alert(1)</script>'))).toBeNull();
    expect(sniffFile(new TextEncoder().encode('MZ\x90\x00'))).toBeNull();
    expect(sniffFile(new Uint8Array())).toBeNull();
  });
});

describe('three-year job history', () => {
  const today = '2026-10-24';
  it('is complete when jobs cover the whole window', () => {
    expect(historyGaps([{ start_date: '2020-01-01', end_date: '2025-01-31' }, { start_date: '2025-02-01', end_date: null }], today)).toEqual([]);
  });
  it('reports an empty history as one gap covering the window', () => {
    expect(historyGaps([], today)).toEqual([{ from: '2023-10-24', to: '2026-10-24' }]);
  });
  it('finds a gap between jobs and one at the end', () => {
    const gaps = historyGaps([{ start_date: '2020-01-01', end_date: '2024-12-31' }, { start_date: '2025-03-01', end_date: '2026-05-31' }], today);
    expect(gaps).toEqual([{ from: '2025-01-01', to: '2025-02-28' }, { from: '2026-06-01', to: '2026-10-24' }]);
  });
  it('ignores a gap of a week or less and overlapping jobs', () => {
    expect(historyGaps([{ start_date: '2020-01-01', end_date: '2025-01-01' }, { start_date: '2024-06-01', end_date: '2025-06-30' }, { start_date: '2025-07-05', end_date: null }], today)).toEqual([]);
  });
});

describe('file checklist', () => {
  const base = { profile: { full_name: 'A B', licence_number: 'ABC123', no_claims_declared_at: null, no_convictions_declared_at: null },
    docKinds: [] as string[], licenceCheck: false, dataSharing: false, jobs: [], claims: 0, convictions: 0 };
  it('starts mostly empty', () => { expect(completeness(base, '2026-10-24').filter(i => i.done)).toHaveLength(1); });
  it('counts a nil declaration or entries as declared', () => {
    const items = completeness({ ...base, claims: 1, profile: { ...base.profile, no_convictions_declared_at: '2026-10-01T00:00:00Z' } }, '2026-10-24');
    expect(items.find(i => i.label === 'Claims declared')?.done).toBe(true);
    expect(items.find(i => i.label === 'Convictions declared')?.done).toBe(true);
  });
});
