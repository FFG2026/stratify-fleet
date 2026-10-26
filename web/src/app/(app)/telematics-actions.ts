'use server';
import { revalidatePath } from 'next/cache';
import { rpc } from '@/lib/rest';
import { requireContext, messageOf } from '@/lib/session';
import { checkedId } from '@/lib/ids';
import { maxCsvBytes, readTelematicsCsv } from '@/lib/telematics';
import { telematicsView } from '@/lib/telematics-data';
import type { ActionResult } from '@/components/useAction';

export async function importTelematics(form: FormData): Promise<ActionResult> {
  try {
    const ctx = await requireContext();
    if (telematicsView(ctx) !== 'fleet') return { ok: false, message: 'Your role cannot upload telematics data.' };
    const fleet = checkedId(form.get('fleet'));
    const file = form.get('file');
    if (!(file instanceof File) || file.size === 0) return { ok: false, message: 'Choose a CSV file.' };
    if (file.size > maxCsvBytes) return { ok: false, message: 'That file is too large. Keep it under 1 MB.' };
    const rows = readTelematicsCsv(await file.text());
    const source = String(form.get('source') ?? 'csv').trim().slice(0, 60) || 'csv';
    const r = await rpc<{ events: number; trips: number; duplicates: number; crash_alerts: number }>('import_telematics', { p_fleet: fleet, p_rows: rows, p_source: source });
    revalidatePath('/telematics');
    const parts = [`${r.trips} trip${r.trips === 1 ? '' : 's'} and ${r.events} event${r.events === 1 ? '' : 's'} added`];
    if (r.duplicates) parts.push(`${r.duplicates} already there, skipped`);
    if (r.crash_alerts) parts.push(`${r.crash_alerts} crash alert${r.crash_alerts === 1 ? '' : 's'} flagged`);
    return { ok: true, message: parts.join(' · ') + '.' };
  } catch (e) {
    if (e instanceof Error && !(e as { status?: number }).status && /^(Line \d|The file|The first line|At most)/.test(e.message)) return { ok: false, message: e.message };
    return { ok: false, message: messageOf(e) };
  }
}
