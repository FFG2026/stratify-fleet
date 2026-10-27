// Third-party administrators (TPAs) work claims for an insurer. They only recommend; the insurer decides and closes.
export const tpaRecommendations = ['settle', 'decline', 'more_information', 'other'] as const;
export type TpaRecommendation = (typeof tpaRecommendations)[number];
export const tpaRecommendationLabel: Record<TpaRecommendation, string> = {
  settle: 'Settle the claim', decline: 'Decline the claim', more_information: 'More information needed', other: 'Other (see note)'
};
export const isTpaRecommendation = (v: unknown): v is TpaRecommendation => typeof v === 'string' && (tpaRecommendations as readonly string[]).includes(v);

export type ClaimTpa = {
  claim_id: string; tpa_id: string; assigned_at: string; first_touched_at: string | null;
  recommendation: TpaRecommendation | null; recommendation_note: string | null; recommended_at: string | null;
  tpas?: { name: string } | null;
};
export type TpaNote = { id: string; side: 'tpa' | 'insurer'; author_email: string | null; body: string; created_at: string };
export type TpaMemberRow = { id: string; email: string; active: boolean; created_at: string };
export type TpaRow = { id: string; name: string; active: boolean; insurer_id: string };

// A TPA person has no organisation membership, only a TPA membership.
export const isTpaPerson = (memberships: { active: boolean }[], tpas: unknown[] | undefined) => !memberships.some(m => m.active) && !!tpas && tpas.length > 0;
