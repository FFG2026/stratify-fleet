import { describe, expect, it } from 'vitest';
import { safeNext } from '@/lib/redirect';

describe('safeNext', () => {
  it('keeps same-site paths', () => { expect(safeNext('/reset-password')).toBe('/reset-password'); expect(safeNext('/fleet?x=1')).toBe('/fleet?x=1'); });
  it('falls back to the home page for anything that could leave the site', () => {
    for (const bad of ['//evil.example', 'https://evil.example', '/\\evil.example', 'javascript:alert(1)', '', null, undefined, '/ok\nSet-Cookie: x=1']) expect(safeNext(bad as string)).toBe('/');
  });
});
