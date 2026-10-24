import { getContext } from '@/lib/data';
import { checkedId } from '@/lib/ids';
import { downloadFile } from '@/lib/storage';
import { getClaimFile } from '@/lib/claims-data';
import { rpc } from '@/lib/rest';

// Streams one claim photo or document to someone on that claim. The database rules decide who that is;
// opening a file that someone else added is written to the audit trail first.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getContext();
  if (!ctx || ctx.demo) return new Response('Not found', { status: 404 });
  try {
    const { id } = await params;
    const file = await getClaimFile(checkedId(id));
    if (!file) return new Response('Not found', { status: 404 });
    await rpc('log_claim_file_view', { p_id: file.id });
    const body = await downloadFile(file.storage_path, 'claim-files');
    if (!body || !body.body) return new Response('Not found', { status: 404 });
    return new Response(body.body, { headers: {
      'content-type': file.content_type, 'content-disposition': `inline; filename="${file.file_name.replace(/[^\w. -]/g, '_')}"`,
      'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff',
      'content-security-policy': "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox", 'referrer-policy': 'no-referrer'
    } });
  } catch { return new Response('Not found', { status: 404 }); }
}
