'use server';
import { revalidatePath } from 'next/cache';
import { after } from 'next/server';
import { z } from 'zod';
import { rpc } from '@/lib/rest';
import { requireContext, messageOf } from '@/lib/session';
import { checkedId } from '@/lib/ids';
import { maxFileBytes, sniffFile } from '@/lib/drivers';
import { deleteFile, uploadFile } from '@/lib/storage';
import { createLogin } from '@/lib/admin-auth';
import { memberEmail } from '@/lib/members';
import { emailAccess } from '@/lib/notify-email';
import { claimSide } from '@/lib/claims-data';
import { isRepairerOnly } from '@/lib/data';
import { parseQuoteAmount } from '@/lib/repairs';
import type { ActionResult } from '@/components/useAction';

const BUCKET = 'repair-files';
const done = (message: string): ActionResult => ({ ok: true, message });
const stop = (message: string) => Object.assign(new Error(message), { status: 400 });
const fail = (error: unknown): ActionResult => ({ ok: false, message: error instanceof z.ZodError ? error.issues[0]?.message ?? 'Check the details.' : messageOf(error) });
const demoStop: ActionResult = { ok: false, message: 'The demo account is read-only.' };
const str = (form: FormData, key: string, max = 2000) => { const v = String(form.get(key) ?? '').trim(); if (v.length > max) throw stop('One of the boxes is too long.'); return v; };
const refresh = (claim?: string) => { revalidatePath('/repairs'); revalidatePath('/repairers'); revalidatePath('/claims'); if (claim) { revalidatePath('/repairs/' + claim); revalidatePath('/claims/' + claim); } };

// ---- insurer administrator: repair shops and their people
export async function createRepairer(form: FormData): Promise<ActionResult> {
  try {
    const ctx = await requireContext(); if (ctx.demo) return demoStop;
    const name = str(form, 'name', 120);
    if (name.length < 2) throw stop('Enter the repair shop\'s name.');
    await rpc('create_repairer', { p_insurer: checkedId(form.get('insurer')), p_name: name });
    refresh();
    return done(name + ' was added. Now add the people who will work on repairs for it.');
  } catch (error) { return fail(error); }
}
export async function setRepairerActive(form: FormData): Promise<ActionResult> {
  try {
    const ctx = await requireContext(); if (ctx.demo) return demoStop;
    const on = form.get('active') === 'yes';
    await rpc('set_repairer_active', { p_repairer: checkedId(form.get('repairer')), p_active: on });
    refresh();
    return done(on ? 'Repair shop switched on.' : 'Repair shop switched off. Its people can no longer see repairs.');
  } catch (error) { return fail(error); }
}
export async function addRepairerMember(form: FormData): Promise<ActionResult> {
  try {
    const ctx = await requireContext(); if (ctx.demo) return demoStop;
    const repairer = checkedId(form.get('repairer')), email = memberEmail(form.get('email')), name = str(form, 'repairerName', 120) || 'a repair shop';
    const raw = str(form, 'password', 72);
    let outcome = await rpc<string>('add_repairer_member', { p_repairer: repairer, p_email: email });
    if (outcome === 'no_login') {
      if (!raw) return { ok: false, message: 'That person has no login yet. Enter a temporary password (at least 8 characters) to create one.' };
      if (raw.length < 8) throw stop('The temporary password must be at least 8 characters.');
      if (raw.toLowerCase().includes(email.split('@')[0])) throw stop('The temporary password must not contain the email name.');
      await createLogin(email, raw);
      outcome = await rpc<string>('add_repairer_member', { p_repairer: repairer, p_email: email });
    }
    refresh();
    after(() => emailAccess(email, name, 'a repair shop', !!raw));
    return done(raw ? `${email} was added with a temporary password. They must choose their own at first sign-in.` : `${email} was added.`);
  } catch (error) { return fail(error); }
}
export async function setRepairerMemberActive(form: FormData): Promise<ActionResult> {
  try {
    const ctx = await requireContext(); if (ctx.demo) return demoStop;
    const on = form.get('active') === 'yes';
    await rpc('set_repairer_member_active', { p_member: checkedId(form.get('member')), p_active: on });
    refresh();
    return done(on ? 'Access restored.' : 'Access removed.');
  } catch (error) { return fail(error); }
}

// ---- insurer claims staff: pass a claim on, decide the quote
export async function assignRepairer(form: FormData): Promise<ActionResult> {
  try {
    const ctx = await requireContext(); if (ctx.demo) return demoStop;
    if (claimSide(ctx) !== 'insurer') return { ok: false, message: 'Only insurer claims staff can pass a claim to a repair shop.' };
    const id = checkedId(form.get('id')); const raw = String(form.get('repairer') ?? '').trim();
    await rpc('assign_claim_repairer', { p_claim: id, p_repairer: raw ? checkedId(raw) : null });
    refresh(id);
    return done(raw ? 'Passed to the repair shop. They have been told.' : 'Taken back from the repair shop.');
  } catch (error) { return fail(error); }
}
export async function insurerRepairNote(form: FormData): Promise<ActionResult> {
  try {
    const ctx = await requireContext(); if (ctx.demo) return demoStop;
    if (claimSide(ctx) !== 'insurer') return { ok: false, message: 'Only insurer claims staff can write to the repair shop.' };
    const id = checkedId(form.get('id')), body = str(form, 'body');
    if (!body) throw stop('Write a note first.');
    await rpc('insurer_repair_note', { p_claim: id, p_body: body });
    refresh(id);
    return done('Sent to the repair shop.');
  } catch (error) { return fail(error); }
}
export async function decideRepairQuote(form: FormData): Promise<ActionResult> {
  try {
    const ctx = await requireContext(); if (ctx.demo) return demoStop;
    if (claimSide(ctx) !== 'insurer') return { ok: false, message: 'Only insurer claims staff can decide a repair quote.' };
    const id = checkedId(form.get('id')), decision = String(form.get('decision') ?? ''), note = str(form, 'note');
    if (!['approve', 'revise'].includes(decision)) throw stop('Choose approve or send back.');
    if (decision === 'revise' && !note) throw stop('Say what needs to change.');
    await rpc('decide_repair_quote', { p_claim: id, p_decision: decision, p_note: note || null });
    refresh(id);
    return done(decision === 'approve' ? 'Repair approved. The shop and the fleet have been told.' : 'Sent back to the repair shop with your note.');
  } catch (error) { return fail(error); }
}

// ---- repair shop: notes, files, quote, completion
const shopOnly = async () => { const ctx = await requireContext(); if (ctx.demo) return demoStop; if (!isRepairerOnly(ctx)) return { ok: false, message: 'Only a repair shop can use this.' } as ActionResult; return null; };
export async function repairerNote(form: FormData): Promise<ActionResult> {
  try {
    const blocked = await shopOnly(); if (blocked) return blocked;
    const id = checkedId(form.get('id')), body = str(form, 'body');
    if (!body) throw stop('Write a note first.');
    await rpc('repairer_note', { p_claim: id, p_body: body });
    refresh(id);
    return done('Sent to the insurer.');
  } catch (error) { return fail(error); }
}
export async function uploadRepairFile(form: FormData): Promise<ActionResult> {
  try {
    const blocked = await shopOnly(); if (blocked) return blocked;
    const id = checkedId(form.get('id')); const kind = String(form.get('kind') ?? '');
    if (!['photo', 'quote', 'invoice'].includes(kind)) throw stop('Choose what you are uploading.');
    const file = form.get('file');
    if (!(file instanceof File) || !file.size) return { ok: false, message: 'Choose a file to upload.' };
    if (file.size > maxFileBytes) return { ok: false, message: `${file.name} is over 4 MB. Use a smaller photo or a PDF under 4 MB.` };
    const bytes = new Uint8Array(await file.arrayBuffer());
    const sniffed = sniffFile(bytes);
    if (!sniffed) return { ok: false, message: `${file.name} is not a photo (JPG, PNG, WebP) or a PDF.` };
    if (kind === 'photo' && sniffed.type === 'application/pdf') return { ok: false, message: 'Photos must be JPG, PNG or WebP. Use the quote or invoice box for a PDF.' };
    const path = `${id}/${crypto.randomUUID()}.${sniffed.ext}`;
    await uploadFile(path, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, sniffed.type, BUCKET);
    try {
      await rpc('add_repair_file', { p_claim: id, p_kind: kind, p_path: path, p_name: file.name.slice(0, 200), p_type: sniffed.type, p_size: file.size, p_caption: str(form, 'caption', 200) || null });
    } catch (error) { await deleteFile(path, BUCKET); throw error; }
    refresh(id);
    return done('Uploaded.');
  } catch (error) { return fail(error); }
}
export async function removeRepairFile(form: FormData): Promise<ActionResult> {
  try {
    const blocked = await shopOnly(); if (blocked) return blocked;
    const path = await rpc<string>('remove_repair_file', { p_id: checkedId(form.get('fileId')) });
    if (path) await deleteFile(path, BUCKET);
    refresh(String(form.get('id') ?? ''));
    return done('Removed.');
  } catch (error) { return fail(error); }
}
export async function submitRepairQuote(form: FormData): Promise<ActionResult> {
  try {
    const blocked = await shopOnly(); if (blocked) return blocked;
    const id = checkedId(form.get('id'));
    const amount = parseQuoteAmount(form.get('amount'));
    if (amount === null) throw stop('Enter the quote total as an amount such as 1250.00.');
    await rpc('submit_repair_quote', { p_claim: id, p_amount: amount, p_note: str(form, 'note') || null });
    refresh(id);
    return done('Quote sent to the insurer for approval.');
  } catch (error) { return fail(error); }
}
export async function completeRepair(form: FormData): Promise<ActionResult> {
  try {
    const blocked = await shopOnly(); if (blocked) return blocked;
    const id = checkedId(form.get('id'));
    await rpc('complete_repair', { p_claim: id, p_note: str(form, 'note') || null });
    refresh(id);
    return done('Marked as complete. The insurer and the fleet have been told.');
  } catch (error) { return fail(error); }
}
