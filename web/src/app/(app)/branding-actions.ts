'use server';
import { revalidatePath } from 'next/cache';
import { rpc } from '@/lib/rest';
import { requireContext, messageOf } from '@/lib/session';
import { checkedId } from '@/lib/ids';
import { readableAccent } from '@/lib/colour';
import type { ActionResult } from '@/components/useAction';

export async function saveBranding(form: FormData): Promise<ActionResult> {
  const ctx = await requireContext();
  if (ctx.demo) return { ok: false, message: 'The demo account is read-only.' };
  try {
    const name = String(form.get('name') ?? '').trim(), accent = String(form.get('accent') ?? '').trim();
    if (name.length > 60) return { ok: false, message: 'The display name can be 60 characters at most.' };
    if (accent && !/^#[0-9a-fA-F]{6}$/.test(accent)) return { ok: false, message: 'Choose a colour.' };
    if (accent && !readableAccent(accent)) return { ok: false, message: 'That colour is too light to read on a white page. Choose a darker one.' };
    await rpc('set_branding', { p_insurer: checkedId(form.get('insurer')), p_display_name: name || null, p_accent: form.get('useAccent') === 'on' ? accent || null : null });
    revalidatePath('/', 'layout');
    return { ok: true, message: 'Saved. It shows for this insurer\'s staff and their customers.' };
  } catch (error) { return { ok: false, message: messageOf(error) }; }
}
