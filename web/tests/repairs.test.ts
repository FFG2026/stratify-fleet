import { describe, it, expect } from 'vitest';
import { parseQuoteAmount, repairActions, repairStatusLabel, isRepairStatus, repairIsOpen } from '../src/lib/repairs';

describe('repair quote amount', () => {
  it('accepts plain and formatted amounts', () => {
    expect(parseQuoteAmount('1250')).toBe(1250); expect(parseQuoteAmount('£1,250.50')).toBe(1250.5); expect(parseQuoteAmount(' 99.9 ')).toBe(99.9);
  });
  it('rejects blank, zero, negative, junk and too many decimals', () => {
    for (const v of ['', '0', '-5', 'abc', '12.345', '1e5', null, undefined, '123456789']) expect(parseQuoteAmount(v)).toBeNull();
  });
});

describe('repair stages', () => {
  it('a new job lets the shop add photos, a quote and send it, but not an invoice or completion', () => {
    const a = repairActions('with_repairer');
    expect(a).toMatchObject({ addPhotos: true, addQuote: true, submitQuote: true, addInvoice: false, complete: false, insurerDecide: false, insurerCanTakeBack: true });
  });
  it('once the quote is sent it is locked and the insurer can decide', () => {
    const a = repairActions('quote_submitted');
    expect(a).toMatchObject({ addQuote: false, submitQuote: false, insurerDecide: true, insurerCanTakeBack: true });
  });
  it('once approved the shop can invoice and complete, and the insurer can no longer take it back', () => {
    const a = repairActions('approved');
    expect(a).toMatchObject({ addInvoice: true, complete: true, insurerDecide: false, insurerCanTakeBack: false, addQuote: false });
  });
  it('a completed repair is closed to changes', () => {
    const a = repairActions('completed');
    expect(Object.values(a).every(v => v === false)).toBe(true);
    expect(repairIsOpen('completed')).toBe(false);
  });
  it('knows its statuses', () => {
    expect(isRepairStatus('approved')).toBe(true); expect(isRepairStatus('nope')).toBe(false);
    expect(Object.keys(repairStatusLabel)).toHaveLength(4);
  });
});
