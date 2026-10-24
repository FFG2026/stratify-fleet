import { describe, expect, it } from 'vitest';
import { contrastOnWhite, readableAccent } from '@/lib/colour';

describe('accent colour', () => {
  it('accepts dark colours and refuses pale ones', () => {
    expect(readableAccent('#226B55')).toBe(true);
    expect(readableAccent('#000000')).toBe(true);
    expect(readableAccent('#FFFF00')).toBe(false);
    expect(readableAccent('#CCCCCC')).toBe(false);
  });
  it('treats anything that is not a six-digit hex colour as unreadable', () => {
    for (const bad of ['red', '#fff', '#12345', '', 'url(x)', '#GGGGGG']) expect(contrastOnWhite(bad)).toBe(0);
  });
  it('white on white is 1:1 and black on white is 21:1', () => {
    expect(contrastOnWhite('#FFFFFF')).toBeCloseTo(1, 1);
    expect(contrastOnWhite('#000000')).toBeCloseTo(21, 0);
  });
});
