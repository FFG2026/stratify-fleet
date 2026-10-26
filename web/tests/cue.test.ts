import { describe, expect, it } from 'vitest';
import { cueFileName, cueNotConnected, cueStatuses, cueStatusLabel } from '../src/lib/cue';
import { eventTitle } from '../src/lib/claims';

describe('cueFileName', () => {
  it('names the file after the claim and version', () => expect(cueFileName('CLM-2026-000012', 2)).toBe('CLM-2026-000012-cue-v2.json'));
  it('removes anything unsafe from the reference', () => expect(cueFileName('CLM/../x"y', 1)).toBe('CLM____x_y-cue-v1.json'));
  it('never goes below version 1', () => expect(cueFileName('CLM-1', 0)).toBe('CLM-1-cue-v1.json'));
});

describe('CUE wording', () => {
  it('labels every status', () => { for (const s of cueStatuses) expect(cueStatusLabel[s]).toBeTruthy(); });
  it('says a queued record has not been transmitted', () => expect(cueStatusLabel.queued).toMatch(/not transmitted/i));
  it('states plainly that the portal is not connected', () => expect(cueNotConnected).toMatch(/not connected/i));
  it('has a timeline title for the queue event', () => expect(eventTitle.cue_queued).toBe('CUE record queued'));
});
