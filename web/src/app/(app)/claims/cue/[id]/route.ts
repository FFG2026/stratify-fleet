import { getContext } from '@/lib/data';
import { checkedId } from '@/lib/ids';
import { claimSide, getClaimBasic, getCueRecord } from '@/lib/claims-data';
import { cueFileName } from '@/lib/cue';
import { rest, rpc } from '@/lib/rest';

// Downloads one prepared CUE record as JSON. Insurer side only (row-level security decides); each download is written to the audit trail first.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getContext();
  if (!ctx || ctx.demo || claimSide(ctx) !== 'insurer') return new Response('Not found', { status: 404 });
  try {
    const record = await getCueRecord(checkedId((await params).id));
    if (!record) return new Response('Not found', { status: 404 });
    const [claim] = await rest<{ reference: string }[]>('/rest/v1/claims?select=reference&id=eq.' + checkedId(record.claim_id));
    if (!claim || !(await getClaimBasic(record.claim_id))) return new Response('Not found', { status: 404 });
    await rpc('log_cue_download', { p_id: record.id });
    const body = JSON.stringify({ version: record.version, prepared_at: record.created_at, status: record.submission_status, record: record.payload }, null, 2);
    return new Response(body, { headers: {
      'content-type': 'application/json; charset=utf-8', 'content-disposition': `attachment; filename="${cueFileName(claim.reference, record.version)}"`,
      'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer'
    } });
  } catch { return new Response('Not found', { status: 404 }); }
}
