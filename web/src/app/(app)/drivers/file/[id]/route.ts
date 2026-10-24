import { getContext, getDriverDocument } from '@/lib/data';
import { checkedId } from '@/lib/ids';
import { downloadFile } from '@/lib/storage';
import { rpc } from '@/lib/rest';

// Streams one driver document to someone allowed to see it. Storage rules and row-level security decide who that is;
// opening a document as staff is written to the audit trail before any byte is sent.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getContext();
  if (!ctx || ctx.demo) return new Response('Not found', { status: 404 });
  try {
    const { id } = await params;
    const doc = await getDriverDocument(checkedId(id));
    if (!doc) return new Response('Not found', { status: 404 });
    await rpc('log_driver_document_view', { p_id: doc.id });
    const file = await downloadFile(doc.storage_path);
    if (!file || !file.body) return new Response('Not found', { status: 404 });
    return new Response(file.body, { headers: {
      'content-type': doc.content_type,
      'content-disposition': `inline; filename="${doc.file_name.replace(/[^\w. -]/g, '_')}"`,
      'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff',
      'content-security-policy': "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox", 'referrer-policy': 'no-referrer'
    } });
  } catch { return new Response('Not found', { status: 404 }); }
}
