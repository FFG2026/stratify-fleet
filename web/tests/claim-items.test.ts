import { describe, expect, it } from 'vitest';
import { itemsFromForm, itemState, itemProgress, itemTitle, type RequestItem } from '@/lib/claim-items';

const item = (o: Partial<RequestItem>): RequestItem => ({ id: 'i', request_id: 'r', kind: 'photos', label: null, created_at: '', fulfilled_at: null, attachment_id: null, unavailable_reason: null, ...o });

describe('claim items', () => {
  it('needs at least one item', () => { expect(() => itemsFromForm({ items: [], otherLabel: '' })).toThrow(/at least one/i); });
  it('errors carry a 400 status so the message is shown', () => {
    try { itemsFromForm({ items: [], otherLabel: '' }); } catch (e) { expect((e as { status?: number }).status).toBe(400); }
  });
  it('other needs a description', () => { expect(() => itemsFromForm({ items: ['other'], otherLabel: ' ' })).toThrow(); });
  it('accepts known kinds', () => { expect(itemsFromForm({ items: ['photos', 'estimate'], otherLabel: '' })).toHaveLength(2); });
  it('works out state and progress', () => {
    const a = item({ fulfilled_at: 'x', attachment_id: 'f' }), b = item({ fulfilled_at: 'x', unavailable_reason: 'no' }), c = item({});
    expect([itemState(a), itemState(b), itemState(c)]).toEqual(['received', 'unavailable', 'waiting']);
    expect(itemProgress([a, b, c])).toEqual({ done: 2, total: 3 });
    expect(itemTitle(item({ kind: 'other', label: 'Dashcam' }))).toContain('Dashcam');
  });
});
