import { NextResponse, type NextRequest } from 'next/server';
import { getContext, canViewRates } from '@/lib/data';
import { rpc } from '@/lib/rest';
import { csv } from '@/lib/dates';
import { checkedId } from '@/lib/ids';
import { bordereauCsv, isMonth, monthStart, type BordereauRow } from '@/lib/bordereau';

export async function GET(request: NextRequest) {
  const ctx = await getContext();
  if (!ctx) return new NextResponse('Please sign in.', { status: 401 });
  if (!canViewRates(ctx)) return new NextResponse('Not available for your role.', { status: 403 });
  const month = request.nextUrl.searchParams.get('month') ?? '';
  if (!isMonth(month)) return new NextResponse('Invalid month.', { status: 400 });
  try {
    const insurer = request.nextUrl.searchParams.get('insurer') || ctx.orgs.find(o => o.kind === 'insurer')?.id;
    const rows = await rpc<BordereauRow[]>('insurer_bordereau', { p_insurer: checkedId(insurer), p_month: monthStart(month) });
    return new NextResponse(csv(bordereauCsv(month, rows)), { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="stratify-bordereau-${month}.csv"`, 'Cache-Control': 'no-store' } });
  } catch (error) { return new NextResponse(error instanceof Error ? error.message : 'Unable to export.', { status: 400 }); }
}
