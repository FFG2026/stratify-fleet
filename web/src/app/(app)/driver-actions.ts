'use server';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { rpc } from '@/lib/rest';
import { requireContext, messageOf } from '@/lib/session';
import { checkedId } from '@/lib/ids';
import { parseDate } from '@/lib/dates';
import { driverFleetOf, isDriverOnly, suggestDrivers } from '@/lib/data';
import { consents, consentVersion, documentKinds, maxFileBytes, sniffFile, type ConsentKind } from '@/lib/drivers';
import { deleteFile, uploadFile } from '@/lib/storage';
import { createLimiter } from '@/lib/vehicle-lookup';
import type { ActionResult } from '@/components/useAction';

const done = (message: string): ActionResult => ({ ok: true, message });
const fail = (error: unknown): ActionResult => ({ ok: false, message: error instanceof z.ZodError ? error.issues[0]?.message ?? 'Check the details.' : messageOf(error) });
const refresh = () => revalidatePath('/drivers');

// Every action here is for the signed-in driver's own record. The database checks that again.
async function asDriver() {
  const ctx = await requireContext();
  if (!isDriverOnly(ctx)) throw Object.assign(new Error('Only drivers can change a driver record.'), { status: 403 });
  return ctx;
}
const optionalDate = (v: FormDataEntryValue | null) => { const s = String(v ?? '').trim(); if (!s) return null; parseDate(s); return s; };
const text = (max: number, message: string) => z.string().trim().min(1, message).max(max);

export async function saveDriverProfile(form: FormData): Promise<ActionResult> {
  try {
    await asDriver();
    const data = z.object({ name: text(120, 'Enter your full name.'), licence: z.string().trim().max(24), phone: z.string().trim().max(30) })
      .parse({ name: form.get('name'), licence: form.get('licence') ?? '', phone: form.get('phone') ?? '' });
    await rpc('save_driver_profile', { p_name: data.name, p_dob: optionalDate(form.get('dob')), p_licence: data.licence || null, p_phone: data.phone || null });
    refresh();
    return done('Details saved.');
  } catch (error) { return fail(error); }
}

export async function uploadDriverDocument(form: FormData): Promise<ActionResult> {
  try {
    const ctx = await asDriver();
    const fleet = driverFleetOf(ctx);
    const kind = String(form.get('kind') ?? '');
    if (!documentKinds.some(k => k.kind === kind)) return { ok: false, message: 'Choose which document this is.' };
    const file = form.get('file');
    if (!(file instanceof File) || !file.size) return { ok: false, message: 'Choose a file to upload.' };
    if (file.size > maxFileBytes) return { ok: false, message: 'That file is over 4 MB. Take a smaller photo or a PDF under 4 MB.' };
    const bytes = new Uint8Array(await file.arrayBuffer());
    const kindOfFile = sniffFile(bytes);
    if (!kindOfFile) return { ok: false, message: 'Upload a photo (JPG, PNG or WebP) or a PDF.' };
    if (!fleet) return { ok: false, message: 'Your account is not linked to a fleet yet.' };
    const path = `${fleet}/${ctx.user.id}/${crypto.randomUUID()}.${kindOfFile.ext}`;
    await uploadFile(path, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, kindOfFile.type);
    try {
      await rpc('add_driver_document', { p_kind: kind, p_path: path, p_name: file.name.slice(0, 200), p_type: kindOfFile.type, p_size: file.size, p_expires: optionalDate(form.get('expires')) });
    } catch (error) { await deleteFile(path); throw error; }
    refresh();
    return done('Uploaded. Your fleet and its insurers can now see it.');
  } catch (error) { return fail(error); }
}

export async function removeDriverDocument(form: FormData): Promise<ActionResult> {
  try {
    await asDriver();
    const path = await rpc<string>('remove_driver_document', { p_id: checkedId(form.get('id')) });
    if (path) await deleteFile(path);
    refresh();
    return done('File removed.');
  } catch (error) { return fail(error); }
}

export async function setDriverConsent(form: FormData): Promise<ActionResult> {
  try {
    await asDriver();
    const kind = String(form.get('kind') ?? '') as ConsentKind;
    if (!(kind in consents)) return { ok: false, message: 'Unknown permission.' };
    const given = form.get('given') === 'true';
    await rpc('record_driver_consent', { p_kind: kind, p_given: given, p_version: consentVersion, p_statement: consents[kind].statement });
    refresh();
    return done(given ? 'Permission recorded.' : 'Permission withdrawn.');
  } catch (error) { return fail(error); }
}

const recordSchema = z.object({ kind: z.enum(['employment', 'claim', 'conviction']), title: text(160, 'Fill in the first box.'), detail: z.string().trim().max(500) });
export async function addDriverRecord(form: FormData): Promise<ActionResult> {
  try {
    await asDriver();
    const base = recordSchema.parse({ kind: form.get('kind'), title: form.get('title'), detail: form.get('detail') ?? '' });
    const start = optionalDate(form.get('start'));
    if (!start) return { ok: false, message: 'Enter the date.' };
    const end = optionalDate(form.get('end'));
    const amountRaw = String(form.get('amount') ?? '').trim(), pointsRaw = String(form.get('points') ?? '').trim();
    const amount = amountRaw ? Number(amountRaw) : null, points = pointsRaw ? Number(pointsRaw) : null;
    if (amount !== null && (!Number.isFinite(amount) || amount < 0 || amount > 10000000)) return { ok: false, message: 'Check the amount.' };
    if (points !== null && (!Number.isInteger(points) || points < 0 || points > 12)) return { ok: false, message: 'Penalty points must be between 0 and 12.' };
    await rpc('add_driver_record', {
      p_kind: base.kind, p_title: base.title, p_detail: base.detail || null, p_start: start, p_end: end,
      p_amount: amount, p_at_fault: form.get('fault') === 'yes' ? true : form.get('fault') === 'no' ? false : null, p_points: points
    });
    refresh();
    return done('Added.');
  } catch (error) { return fail(error); }
}
export async function removeDriverRecord(form: FormData): Promise<ActionResult> {
  try { await asDriver(); await rpc('remove_driver_record', { p_id: checkedId(form.get('id')) }); refresh(); return done('Removed.'); }
  catch (error) { return fail(error); }
}
export async function declareNone(form: FormData): Promise<ActionResult> {
  try { await asDriver(); await rpc('declare_none', { p_kind: String(form.get('kind') ?? '') }); refresh(); return done('Recorded.'); }
  catch (error) { return fail(error); }
}

// Name suggestions for staff (fleet and insurer side). Row-level security limits them to the drivers the person may see.
const limiter = createLimiter(240);
export type DriverSuggestion = { id: string; name: string };
export async function findDrivers(query: string, fleet?: string): Promise<DriverSuggestion[]> {
  const ctx = await requireContext();
  if (ctx.demo || isDriverOnly(ctx) || !limiter(ctx.user.id)) return [];
  try { return (await suggestDrivers(String(query).slice(0, 60), fleet || undefined)).map(r => ({ id: r.user_id, name: r.full_name })); }
  catch { return []; }
}
