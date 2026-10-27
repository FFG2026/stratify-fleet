// Specific things an insurer can ask the fleet for on a claim, and how far the fleet has got.
const bad = (message: string) => Object.assign(new Error(message), { status: 400 });
export const itemKinds = ['photos', 'estimate', 'police_report', 'witness_statement', 'other'] as const;
export type ItemKind = (typeof itemKinds)[number];
export const itemKindLabel: Record<ItemKind, string> = {
  photos: 'More photos', estimate: 'Repair estimate', police_report: 'Police report', witness_statement: 'Witness statement', other: 'Something else'
};

export type RequestItem = {
  id: string; request_id: string; kind: ItemKind; label: string | null; created_at?: string;
  fulfilled_at: string | null; attachment_id: string | null; unavailable_reason: string | null;
};
export type ItemInput = { kind: ItemKind; label?: string };

export const itemTitle = (i: { kind: ItemKind; label: string | null }) => (i.kind === 'other' ? (i.label || 'Something else') : itemKindLabel[i.kind]);
export const itemState = (i: RequestItem): 'received' | 'unavailable' | 'waiting' => (!i.fulfilled_at ? 'waiting' : i.attachment_id ? 'received' : 'unavailable');
export const itemProgress = (items: RequestItem[]) => ({ done: items.filter(i => i.fulfilled_at).length, total: items.length });

// Reads the insurer's form: checkboxes called "item" (one of the kinds) plus a text box for the "other" item.
export function itemsFromForm(values: { items: string[]; otherLabel: string }): ItemInput[] {
  const seen = new Set<string>();
  const out: ItemInput[] = [];
  for (const v of values.items) {
    if (!(itemKinds as readonly string[]).includes(v) || seen.has(v)) continue;
    seen.add(v);
    if (v === 'other') {
      const label = values.otherLabel.trim();
      if (label.length < 2 || label.length > 120) throw bad('Say what the other item is (2 to 120 characters).');
      out.push({ kind: 'other', label });
    } else out.push({ kind: v as ItemKind });
  }
  if (!out.length) throw bad('Choose at least one item.');
  return out;
}
