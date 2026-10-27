import { describe, it, expect, vi } from 'vitest';
vi.mock('server-only', () => ({}));
vi.mock('@/lib/rest', () => ({ rest: vi.fn(), rpc: vi.fn(), allRows: vi.fn(), countRows: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));
import { isTpaRecommendation, isTpaPerson, tpaRecommendationLabel, tpaRecommendations } from '@/lib/tpa';
import { claimSide } from '@/lib/claims-data';
import { homeFor, isTpaOnly, canManageTpas, isInsurerSide } from '@/lib/data';
import { eventTitle } from '@/lib/claims';
import type { Context } from '@/lib/types';

const base: Context = { user: { id: 'u', email: 'u@x.test' }, demo: false, orgs: [], policies: [], memberships: [] };
const tpa = { id: 't', name: 'Alpha', insurer_id: 'i' };

describe('third-party administrators', () => {
  it('accepts only the four recommendations and labels each', () => {
    expect([...tpaRecommendations]).toEqual(['settle', 'decline', 'more_information', 'other']);
    for (const r of tpaRecommendations) expect(tpaRecommendationLabel[r].length).toBeGreaterThan(3);
    expect(isTpaRecommendation('settle')).toBe(true);
    expect(isTpaRecommendation('close')).toBe(false);
    expect(isTpaRecommendation(null)).toBe(false);
  });
  it('treats a person with only a TPA membership as a TPA, with the claims view and nothing else', () => {
    const ctx = { ...base, tpas: [tpa] };
    expect(isTpaOnly(ctx)).toBe(true);
    expect(claimSide(ctx)).toBe('tpa');
    expect(homeFor(ctx)).toBe('/claims');
    expect(isInsurerSide(ctx)).toBe(false);
    expect(canManageTpas(ctx)).toBe(false);
    expect(isTpaPerson(ctx.memberships, ctx.tpas)).toBe(true);
  });
  it('never gives the TPA view to anyone with an organisation role, or to nobody', () => {
    expect(claimSide(base)).toBeNull();
    const fleet = { ...base, tpas: [tpa], memberships: [{ organisation_id: 'f', active: true, role: 'fleet_admin' }] };
    expect(claimSide(fleet)).toBe('fleet'); expect(isTpaOnly(fleet)).toBe(false);
    const staff = { ...base, memberships: [{ organisation_id: 'i', active: true, role: 'insurer_claims' }] };
    expect(claimSide(staff)).toBe('insurer'); expect(canManageTpas(staff)).toBe(false);
    expect(canManageTpas({ ...base, memberships: [{ organisation_id: 'i', active: true, role: 'insurer_admin' }] })).toBe(true);
    expect(canManageTpas({ ...base, demo: true, memberships: [{ organisation_id: 'i', active: true, role: 'insurer_admin' }] })).toBe(false);
  });
  it('titles the routing event', () => { expect(eventTitle.tpa_assigned).toBeTruthy(); });
});
