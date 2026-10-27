'use server';
import { revalidatePath } from 'next/cache';
import { after } from 'next/server';
import { emailClaimNotifications } from '@/lib/notify-email';
import { z } from 'zod';
import { rpc } from '@/lib/rest';
import { requireContext, messageOf } from '@/lib/session';
import { checkedId } from '@/lib/ids';
import { itemsFromForm } from '@/lib/claim-items';
import { normaliseRegistration, parseDate } from '@/lib/dates';
import { insurerOutcomes, londonToIso, yesNo } from '@/lib/claims';
import { maxFileBytes, sniffFile } from '@/lib/drivers';
import { deleteFile, uploadFile } from '@/lib/storage';
import { getNotices, claimFleetOf, claimSide, getClaimBasic, getClaimFile, myVehicleIdByRegistration, vehicleIdByRegistration } from '@/lib/claims-data';
import { createLogin } from '@/lib/admin-auth';
import { memberEmail } from '@/lib/members';
import { isTpaRecommendation } from '@/lib/tpa';
import { emailAccess } from '@/lib/notify-email';
import type { ActionResult } from '@/components/useAction';

export type ClaimResult = ActionResult & { id?: string };
const done = (message: string, id?: string): ClaimResult => ({ ok: true, message, id });
const fail = (error: unknown): ClaimResult => ({ ok: false, message: error instanceof z.ZodError ? error.issues[0]?.message ?? 'Check the details.' : error instanceof Error && !(error as { status?: number }).status && /^(Use a valid|Enter |Invalid calendar)/.test(error.message) ? error.message : messageOf(error) });
const refresh = (id?: string) => { revalidatePath('/claims'); if (id) { revalidatePath('/claims/' + id); after(() => emailClaimNotifications(id)); } };
const str = (form: FormData, key: string, max = 4000) => { const v = String(form.get(key) ?? '').trim(); if (v.length > max) throw Object.assign(new Error('One of the boxes is too long.'), { status: 400 }); return v; };

const fieldsSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Enter the date it happened.'), time: z.string().regex(/^\d{2}:\d{2}$/, 'Enter the time it happened.'),
  location: z.string().trim().min(2, 'Say where it happened.').max(300), description: z.string().trim().min(10, 'Describe what happened (at least a sentence).').max(4000),
  injured: z.enum(['yes', 'no'], { message: 'Say whether anyone was injured.' }), injury: z.string().trim().max(2000), police: z.enum(['yes', 'no'], { message: 'Say whether the police attended.' }),
  policeRef: z.string().trim().max(60), thirdParty: z.enum(['yes', 'no'], { message: 'Say whether another vehicle or person was involved.' })
});
function readFields(form: FormData) {
  const f = fieldsSchema.parse({
    date: form.get('date'), time: form.get('time'), location: form.get('location'), description: form.get('description'), injured: form.get('injured'),
    injury: form.get('injury') ?? '', police: form.get('police'), policeRef: form.get('policeRef') ?? '', thirdParty: form.get('thirdParty')
  });
  if (f.injured === 'yes' && f.injury.length < 3) throw Object.assign(new Error('Say who was injured and how.'), { status: 400 });
  return { ...f, at: londonToIso(f.date, f.time), driveable: yesNo(form.get('driveable')) };
}

// ---- reporting (driver or fleet) and logging (insurer)
export async function reportClaim(form: FormData): Promise<ClaimResult> {
  try {
    const ctx = await requireContext();
    const side = claimSide(ctx);
    const f = readFields(form);
    const regRaw = str(form, 'registration', 12);
    if (!regRaw) return { ok: false, message: 'Enter the vehicle registration.' };
    const reg = normaliseRegistration(regRaw);
    const driverName = str(form, 'driverName', 120);
    let id: string;
    if (side === 'insurer') {
      const fleet = checkedId(form.get('fleet'));
      const vehicle = await vehicleIdByRegistration(fleet, reg);
      const driver = String(form.get('driver') ?? '');
      id = await rpc<string>('log_insurer_claim', {
        p_fleet: fleet, p_vehicle: vehicle, p_registration: reg, p_driver: driver ? checkedId(driver) : null, p_driver_name: driverName || null,
        p_incident_at: f.at, p_location: f.location, p_description: f.description, p_injured: f.injured === 'yes', p_injury_details: f.injury || null,
        p_police: f.police === 'yes', p_police_ref: f.policeRef || null, p_insurer_ref: str(form, 'insurerRef', 60) || null
      });
    } else if (side === 'driver' || side === 'fleet') {
      const fleet = claimFleetOf(ctx);
      if (!fleet) return { ok: false, message: 'Your account is not linked to a fleet yet.' };
      const vehicle = side === 'driver' ? await myVehicleIdByRegistration(reg) : await vehicleIdByRegistration(fleet, reg);
      const driver = side === 'fleet' ? String(form.get('driver') ?? '') : '';
      id = await rpc<string>('report_claim', {
        p_fleet: side === 'fleet' ? fleet : null, p_vehicle: vehicle, p_registration: reg, p_driver: driver ? checkedId(driver) : null, p_driver_name: driverName || null,
        p_incident_at: f.at, p_location: f.location, p_description: f.description, p_injured: f.injured === 'yes', p_injury_details: f.injury || null,
        p_police: f.police === 'yes', p_police_ref: f.policeRef || null, p_driveable: f.driveable, p_third_party: f.thirdParty === 'yes'
      });
    } else return { ok: false, message: 'You cannot report claims.' };
    const partyName = str(form, 'partyName', 120);
    if (f.thirdParty === 'yes' && partyName) {
      await rpc('add_claim_party', { p_claim: id, p_kind: 'third_party', p_name: partyName, p_phone: str(form, 'partyPhone', 40) || null, p_reg: str(form, 'partyReg', 12) || null, p_insurer: str(form, 'partyInsurer', 120) || null, p_injured: null, p_notes: null });
    }
    refresh();
    return done('Claim saved.', id);
  } catch (error) { return fail(error); }
}

export async function updateClaim(form: FormData): Promise<ClaimResult> {
  try {
    const ctx = await requireContext();
    const id = checkedId(form.get('id'));
    const f = readFields(form);
    const regRaw = str(form, 'registration', 12);
    const reg = regRaw ? normaliseRegistration(regRaw) : null;
    const basic = await getClaimBasic(id);
    if (!basic) return { ok: false, message: 'Claim not found.' };
    const vehicle = reg && claimSide(ctx) === 'fleet' ? await vehicleIdByRegistration(basic.fleet_id, reg) : null;
    await rpc('update_claim_details', {
      p_claim: id, p_vehicle: vehicle, p_registration: vehicle ? null : reg, p_incident_at: f.at, p_location: f.location, p_description: f.description,
      p_injured: f.injured === 'yes', p_injury_details: f.injury || null, p_police: f.police === 'yes', p_police_ref: f.policeRef || null, p_driveable: f.driveable, p_third_party: f.thirdParty === 'yes'
    });
    refresh(id);
    return done('Saved. The report needs reviewing again before it can be sent.', id);
  } catch (error) { return fail(error); }
}

// ---- people
export async function addParty(form: FormData): Promise<ClaimResult> {
  try {
    await requireContext();
    const id = checkedId(form.get('id'));
    const kind = z.enum(['third_party', 'witness']).parse(form.get('kind'));
    const name = z.string().trim().min(1, 'Enter a name.').max(120).parse(form.get('name'));
    await rpc('add_claim_party', { p_claim: id, p_kind: kind, p_name: name, p_phone: str(form, 'phone', 40) || null, p_reg: str(form, 'reg', 12) || null, p_insurer: str(form, 'insurer', 120) || null, p_injured: yesNo(form.get('injured')), p_notes: str(form, 'notes', 1000) || null });
    refresh(id);
    return done('Added.', id);
  } catch (error) { return fail(error); }
}
export async function removeParty(form: FormData): Promise<ClaimResult> {
  try { await requireContext(); await rpc('remove_claim_party', { p_id: checkedId(form.get('partyId')) }); refresh(String(form.get('id') ?? '')); return done('Removed.'); }
  catch (error) { return fail(error); }
}

// ---- files: each file is its own request so a phone can send several photos without hitting the size limit
export async function uploadClaimFile(form: FormData): Promise<ClaimResult> {
  try {
    const ctx = await requireContext();
    const id = checkedId(form.get('id'));
    const request = String(form.get('request') ?? '');
    const item = String(form.get('item') ?? '');
    const file = form.get('file');
    if (!(file instanceof File) || !file.size) return { ok: false, message: 'Choose a file to upload.' };
    if (file.size > maxFileBytes) return { ok: false, message: `${file.name} is over 4 MB. Take a smaller photo or use a PDF under 4 MB.` };
    const bytes = new Uint8Array(await file.arrayBuffer());
    const kind = sniffFile(bytes);
    if (!kind) return { ok: false, message: `${file.name} is not a photo (JPG, PNG, WebP) or a PDF.` };
    const claim = await getClaimBasic(id);
    if (!claim) return { ok: false, message: 'Claim not found.' };
    const path = `${claim.fleet_id}/${claim.id}/${crypto.randomUUID()}.${kind.ext}`;
    await uploadFile(path, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, kind.type, 'claim-files');
    try {
      const attachment = await rpc<string>('add_claim_attachment', {
        p_claim: claim.id, p_request: request ? checkedId(request) : null, p_kind: kind.type === 'application/pdf' ? 'document' : 'photo', p_path: path,
        p_name: file.name.slice(0, 200), p_type: kind.type, p_size: file.size, p_caption: str(form, 'caption', 200) || null
      });
      // Uploading against a requested item also ticks that item off.
      if (item) await rpc('fulfil_request_item', { p_item: checkedId(item), p_attachment: attachment, p_unavailable: null });
    } catch (error) { await deleteFile(path, 'claim-files'); throw error; }
    void ctx;
    refresh(id);
    return done('Uploaded.', id);
  } catch (error) { return fail(error); }
}
export async function removeClaimFile(form: FormData): Promise<ClaimResult> {
  try {
    await requireContext();
    const path = await rpc<string>('remove_claim_attachment', { p_id: checkedId(form.get('fileId')) });
    if (path) await deleteFile(path, 'claim-files');
    refresh(String(form.get('id') ?? ''));
    return done('Removed.');
  } catch (error) { return fail(error); }
}

// ---- fleet: review and send
export async function reviewClaim(form: FormData): Promise<ClaimResult> {
  try {
    await requireContext();
    const id = checkedId(form.get('id'));
    await rpc('assess_claim', { p_claim: id, p_notes: str(form, 'notes', 2000) || null, p_no_photos: form.get('noPhotos') === 'on' });
    refresh(id);
    return done('Marked as reviewed. You can now send it to the insurer.', id);
  } catch (error) { return fail(error); }
}
export async function sendClaim(form: FormData): Promise<ClaimResult> {
  try { await requireContext(); const id = checkedId(form.get('id')); await rpc('submit_claim', { p_claim: id }); refresh(id); return done('Sent to the insurer.', id); }
  catch (error) { return fail(error); }
}
export async function withdrawClaim(form: FormData): Promise<ClaimResult> {
  try { await requireContext(); const id = checkedId(form.get('id')); await rpc('withdraw_claim', { p_claim: id, p_note: str(form, 'note', 500) }); refresh(id); return done('Report withdrawn.', id); }
  catch (error) { return fail(error); }
}

// ---- fleet and insurer: notes and answers
export async function addNote(form: FormData): Promise<ClaimResult> {
  try {
    await requireContext();
    const id = checkedId(form.get('id'));
    await rpc('add_claim_note', { p_claim: id, p_body: str(form, 'body'), p_internal: form.get('internal') === 'on' });
    refresh(id);
    return done('Note added.', id);
  } catch (error) { return fail(error); }
}
export async function answerRequest(form: FormData): Promise<ClaimResult> {
  try {
    await requireContext();
    const id = checkedId(form.get('id'));
    await rpc('respond_claim_request', { p_request: checkedId(form.get('request')), p_answer: str(form, 'answer') });
    refresh(id);
    return done('Sent to the insurer.', id);
  } catch (error) { return fail(error); }
}

// ---- insurer
export async function startReview(form: FormData): Promise<ClaimResult> {
  try { await requireContext(); const id = checkedId(form.get('id')); await rpc('start_claim_review', { p_claim: id, p_insurer_ref: str(form, 'ref', 60) || null }); refresh(id); return done('Saved.', id); }
  catch (error) { return fail(error); }
}
export async function requestItems(form: FormData): Promise<ClaimResult> {
  try {
    await requireContext();
    const id = checkedId(form.get('id'));
    const due = String(form.get('due') ?? '').trim();
    if (due) parseDate(due);
    const items = itemsFromForm({ items: form.getAll('item').map(String), otherLabel: String(form.get('otherLabel') ?? '') });
    await rpc('request_claim_items', { p_claim: id, p_items: items, p_message: str(form, 'message', 1000) || null, p_due: due || null });
    refresh(id);
    return done('Request sent. The fleet is notified and sees a checklist on the claim.', id);
  } catch (error) { return fail(error); }
}
// Fleet side: say that a requested item cannot be supplied.
export async function itemUnavailable(form: FormData): Promise<ClaimResult> {
  try {
    await requireContext();
    const id = checkedId(form.get('id'));
    await rpc('fulfil_request_item', { p_item: checkedId(form.get('item')), p_attachment: null, p_unavailable: str(form, 'reason', 300) });
    refresh(id);
    return done('Noted. The insurer can see why.', id);
  } catch (error) { return fail(error); }
}
export async function askForInformation(form: FormData): Promise<ClaimResult> {
  try {
    await requireContext();
    const id = checkedId(form.get('id'));
    const due = String(form.get('due') ?? '').trim();
    if (due) parseDate(due);
    await rpc('request_claim_info', { p_claim: id, p_question: str(form, 'question', 2000), p_due: due || null });
    refresh(id);
    return done('Question sent. The fleet can see it on the claim.', id);
  } catch (error) { return fail(error); }
}
export async function withdrawQuestion(form: FormData): Promise<ClaimResult> {
  try { await requireContext(); const id = checkedId(form.get('id')); await rpc('cancel_claim_request', { p_request: checkedId(form.get('request')) }); refresh(id); return done('Question withdrawn.', id); }
  catch (error) { return fail(error); }
}
export async function closeClaim(form: FormData): Promise<ClaimResult> {
  try {
    await requireContext();
    const id = checkedId(form.get('id'));
    const outcome = z.enum(insurerOutcomes, { message: 'Choose an outcome.' }).parse(form.get('outcome'));
    await rpc('close_claim', { p_claim: id, p_outcome: outcome, p_note: str(form, 'note', 2000) });
    refresh(id);
    return done('Claim closed.', id);
  } catch (error) { return fail(error); }
}
export async function reopenClaim(form: FormData): Promise<ClaimResult> {
  try { await requireContext(); const id = checkedId(form.get('id')); await rpc('reopen_claim', { p_claim: id, p_note: str(form, 'note', 2000) }); refresh(id); return done('Claim reopened.', id); }
  catch (error) { return fail(error); }
}

// One press: prepare the CUE record from this claim's FNOL data and queue it. Insurer side only; the database checks who is acting.
export async function queueCue(form: FormData): Promise<ClaimResult> {
  try {
    await requireContext();
    const id = checkedId(form.get('id'));
    await rpc('queue_cue_submission', { p_claim: id });
    refresh();
    revalidatePath('/claims/' + id);
    revalidatePath('/integrations');
    return done('Queued for CUE. Nothing has been transmitted: the portal is not connected to CUE yet.', id);
  } catch (error) { return fail(error); }
}

export async function markNoticesRead(): Promise<ClaimResult> {
  try { await requireContext(); await rpc('mark_notifications_read', { p_ids: null }); revalidatePath('/claims'); return done('Done.'); }
  catch (error) { return fail(error); }
}

export async function assignClaimHandler(form: FormData): Promise<ClaimResult> {
  try {
    const ctx = await requireContext();
    if (ctx.demo) return { ok: false, message: 'The demo account is read-only.' };
    if (claimSide(ctx) !== 'insurer') return { ok: false, message: 'Only insurer claims staff can assign a handler.' };
    const id = checkedId(form.get('id'));
    const raw = String(form.get('handler') ?? '').trim();
    const handler = raw ? checkedId(raw) : null;
    await rpc('assign_claim_handler', { p_claim: id, p_handler: handler });
    refresh(id);
    return done(handler ? (handler === ctx.user.id ? 'You have taken this claim.' : 'Handler updated.') : 'Returned to the unassigned pile.', id);
  } catch (error) { return fail(error); }
}

// ---- insurer tools: reminders, saved replies, bulk actions, digest
export async function remindFleet(form: FormData): Promise<ClaimResult> {
  try { await requireContext(); const id = checkedId(form.get('id')); await rpc('remind_fleet', { p_claim: id, p_request: checkedId(form.get('request')) }); refresh(id); return done('Reminder sent. The fleet is notified.', id); }
  catch (error) { return fail(error); }
}
export async function saveReply(form: FormData): Promise<ClaimResult> {
  try {
    const ctx = await requireContext();
    if (ctx.demo) return { ok: false, message: 'The demo account is read-only.' };
    const id = checkedId(form.get('id'));
    await rpc('save_reply', { p_insurer: checkedId(form.get('insurer')), p_title: str(form, 'title', 80), p_body: str(form, 'body', 1000) });
    revalidatePath('/claims/' + id);
    return done('Saved.', id);
  } catch (error) { return fail(error); }
}
export async function deleteReply(form: FormData): Promise<ClaimResult> {
  try { await requireContext(); const id = checkedId(form.get('id')); await rpc('delete_saved_reply', { p_id: checkedId(form.get('reply')) }); revalidatePath('/claims/' + id); return done('Deleted.', id); }
  catch (error) { return fail(error); }
}
export async function setDigest(form: FormData): Promise<ClaimResult> {
  try { await requireContext(); await rpc('set_digest', { p_enabled: form.get('enabled') === 'yes' }); revalidatePath('/claims'); return done(form.get('enabled') === 'yes' ? 'Daily email on.' : 'Daily email off.'); }
  catch (error) { return fail(error); }
}

// Bulk actions run the same single-claim functions one after another, so every claim is checked and audited on its own.
const claimIds = (form: FormData) => {
  const ids = [...new Set(form.getAll('claim').map(v => String(v)))];
  if (!ids.length) throw Object.assign(new Error('Tick at least one claim first.'), { status: 400 });
  if (ids.length > 50) throw Object.assign(new Error('Choose up to 50 claims at a time.'), { status: 400 });
  return ids.map(checkedId);
};
async function eachClaim(ids: string[], verb: string, one: (id: string) => Promise<unknown>): Promise<ClaimResult> {
  let ok = 0; const problems: string[] = [];
  for (const id of ids) { try { await one(id); ok++; } catch (e) { problems.push(messageOf(e)); } }
  revalidatePath('/claims');
  after(() => Promise.all(ids.map(id => emailClaimNotifications(id))));
  const failed = ids.length - ok;
  return { ok: failed === 0, message: failed ? `${verb} ${ok} of ${ids.length}. ${[...new Set(problems)].slice(0, 2).join(' ')}` : `${verb} ${ok} claim${ok === 1 ? '' : 's'}.` };
}
export async function bulkAssign(form: FormData): Promise<ClaimResult> {
  try {
    const ctx = await requireContext();
    if (ctx.demo) return { ok: false, message: 'The demo account is read-only.' };
    if (claimSide(ctx) !== 'insurer') return { ok: false, message: 'Only insurer claims staff can assign a handler.' };
    const ids = claimIds(form);
    const raw = String(form.get('handler') ?? '').trim();
    const handler = raw === 'unassign' ? null : checkedId(raw === 'me' ? ctx.user.id : raw);
    return await eachClaim(ids, handler ? 'Assigned' : 'Returned', id => rpc('assign_claim_handler', { p_claim: id, p_handler: handler }));
  } catch (error) { return fail(error); }
}
export async function bulkRequestItems(form: FormData): Promise<ClaimResult> {
  try {
    const ctx = await requireContext();
    if (ctx.demo) return { ok: false, message: 'The demo account is read-only.' };
    const ids = claimIds(form);
    const items = itemsFromForm({ items: form.getAll('item').map(String), otherLabel: String(form.get('otherLabel') ?? '') });
    const due = String(form.get('due') ?? '').trim(); if (due) parseDate(due);
    const message = str(form, 'message', 1000);
    return await eachClaim(ids, 'Requested from', id => rpc('request_claim_items', { p_claim: id, p_items: items, p_message: message || null, p_due: due || null }));
  } catch (error) { return fail(error); }
}

// Unread notifications for the pop-up in the corner. Read-only; the list and "Mark all as read" are unchanged.
export async function recentUnread(): Promise<{ id: string; claim_id: string | null; title: string; body: string | null }[]> {
  try { await requireContext(); return (await getNotices(8)).filter(n => !n.read_at).slice(0, 5).map(n => ({ id: n.id, claim_id: n.claim_id, title: n.title, body: n.body })); }
  catch { return []; }
}

// ---- third-party administrators (TPAs). The insurer keeps the decision; a TPA only recommends. The fleet never sees any of this.
const demoStop = { ok: false, message: 'The demo account is read-only.' } as const;
const tpaStop = (message: string) => Object.assign(new Error(message), { status: 400 });
const refreshTpa = (id?: string) => { revalidatePath('/tpas'); refresh(id); };

export async function createTpa(form: FormData): Promise<ClaimResult> {
  try {
    const ctx = await requireContext(); if (ctx.demo) return demoStop;
    const name = str(form, 'name', 120);
    if (name.length < 2) throw tpaStop('Enter the TPA\'s name.');
    await rpc('create_tpa', { p_insurer: checkedId(form.get('insurer')), p_name: name });
    revalidatePath('/tpas');
    return done(name + ' was added. Now add the people who will work claims for it.');
  } catch (error) { return fail(error); }
}
export async function setTpaActive(form: FormData): Promise<ClaimResult> {
  try {
    const ctx = await requireContext(); if (ctx.demo) return demoStop;
    const on = form.get('active') === 'yes';
    await rpc('set_tpa_active', { p_tpa: checkedId(form.get('tpa')), p_active: on });
    revalidatePath('/tpas');
    return done(on ? 'TPA switched on.' : 'TPA switched off. Its people can no longer see claims.');
  } catch (error) { return fail(error); }
}
export async function addTpaMember(form: FormData): Promise<ClaimResult> {
  try {
    const ctx = await requireContext(); if (ctx.demo) return demoStop;
    const tpa = checkedId(form.get('tpa')), email = memberEmail(form.get('email')), name = str(form, 'tpaName', 120) || 'a TPA';
    const raw = str(form, 'password', 72);
    let outcome = await rpc<string>('add_tpa_member', { p_tpa: tpa, p_email: email });
    if (outcome === 'no_login') {
      if (!raw) { return { ok: false, message: 'That person has no login yet. Enter a temporary password (at least 8 characters) to create one.' }; }
      if (raw.length < 8) throw tpaStop('The temporary password must be at least 8 characters.');
      if (raw.toLowerCase().includes(email.split('@')[0])) throw tpaStop('The temporary password must not contain the email name.');
      await createLogin(email, raw);
      outcome = await rpc<string>('add_tpa_member', { p_tpa: tpa, p_email: email });
    }
    revalidatePath('/tpas');
    after(() => emailAccess(email, name, 'a claims administrator', !!raw));
    return done(raw ? `${email} was added with a temporary password. They must choose their own at first sign-in.` : `${email} was added.`);
  } catch (error) { return fail(error); }
}
export async function setTpaMemberActive(form: FormData): Promise<ClaimResult> {
  try {
    const ctx = await requireContext(); if (ctx.demo) return demoStop;
    const on = form.get('active') === 'yes';
    await rpc('set_tpa_member_active', { p_member: checkedId(form.get('member')), p_active: on });
    revalidatePath('/tpas');
    return done(on ? 'Access restored.' : 'Access removed.');
  } catch (error) { return fail(error); }
}
export async function assignTpa(form: FormData): Promise<ClaimResult> {
  try {
    const ctx = await requireContext(); if (ctx.demo) return demoStop;
    if (claimSide(ctx) !== 'insurer') return { ok: false, message: 'Only insurer claims staff can route a claim to a TPA.' };
    const id = checkedId(form.get('id'));
    const raw = String(form.get('tpa') ?? '').trim();
    await rpc('assign_claim_tpa', { p_claim: id, p_tpa: raw ? checkedId(raw) : null });
    refreshTpa(id);
    return done(raw ? 'Routed to the TPA. They have been told.' : 'Taken back from the TPA.', id);
  } catch (error) { return fail(error); }
}
export async function insurerTpaNote(form: FormData): Promise<ClaimResult> {
  try {
    const ctx = await requireContext(); if (ctx.demo) return demoStop;
    if (claimSide(ctx) !== 'insurer') return { ok: false, message: 'Only insurer claims staff can write to the TPA.' };
    const id = checkedId(form.get('id')), body = str(form, 'body', 4000);
    if (!body) throw tpaStop('Write a note first.');
    await rpc('insurer_tpa_note', { p_claim: id, p_body: body });
    refreshTpa(id);
    return done('Sent to the TPA.', id);
  } catch (error) { return fail(error); }
}
export async function tpaNote(form: FormData): Promise<ClaimResult> {
  try {
    const ctx = await requireContext(); if (ctx.demo) return demoStop;
    if (claimSide(ctx) !== 'tpa') return { ok: false, message: 'Only a TPA can use this.' };
    const id = checkedId(form.get('id')), body = str(form, 'body', 4000);
    if (!body) throw tpaStop('Write a note first.');
    await rpc('tpa_add_note', { p_claim: id, p_body: body });
    refreshTpa(id);
    return done('Sent to the insurer.', id);
  } catch (error) { return fail(error); }
}
export async function tpaRecommend(form: FormData): Promise<ClaimResult> {
  try {
    const ctx = await requireContext(); if (ctx.demo) return demoStop;
    if (claimSide(ctx) !== 'tpa') return { ok: false, message: 'Only a TPA can use this.' };
    const id = checkedId(form.get('id')), rec = form.get('recommendation');
    if (!isTpaRecommendation(rec)) throw tpaStop('Choose a recommendation.');
    const note = str(form, 'note', 2000);
    if (note.length < 3) throw tpaStop('Add a short reason for the insurer.');
    await rpc('tpa_recommend', { p_claim: id, p_recommendation: rec, p_note: note });
    refreshTpa(id);
    return done('Recommendation sent. The insurer makes the final decision.', id);
  } catch (error) { return fail(error); }
}
