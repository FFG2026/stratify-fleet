import { NextResponse, type NextRequest } from 'next/server';
import { getContext, getReport, demoPreview, orgName } from '@/lib/data';
import { csv, monthBounds } from '@/lib/dates';
import { checkedId } from '@/lib/ids';

// CSV of one saved report (or, for the demo account only, the date-only preview).
export async function GET(request: NextRequest) {
  const ctx = await getContext();
  if (!ctx) return new NextResponse('Please sign in.', { status: 401 });
  const params = request.nextUrl.searchParams;
  const policyName = (id: string) => ctx.policies.find(p => p.id === id)?.reference ?? '';
  const customer = (id: string) => orgName(ctx, ctx.policies.find(p => p.id === id)?.customer_id);
  const head = ['Report status', 'Month', 'Policy', 'Customer', 'Registration', 'Insured days', 'Report ID', 'Rules source'];
  let file: string, month: string, rows: unknown[][];
  try {
    if (ctx.demo) {
      month = params.get('month') ?? ''; monthBounds(month);
      rows = demoPreview(month, params.get('policy') || undefined).map(r => ['PROVISIONAL', month, policyName(r.policy_id), customer(r.policy_id), r.registration, r.days, 'UNSAVED DATE PREVIEW', 'London dates; start included, removal excluded']);
    } else {
      const saved = await getReport(checkedId(params.get('report')));
      if (!saved) return new NextResponse('Report not found in your authorised workspace.', { status: 404 });
      month = saved.report.month_start.slice(0, 7);
      const map = new Map<string, { policy_id: string; registration: string; days: number }>();
      for (const l of saved.lines) { const k = l.policy_id + ':' + l.registration; const hit = map.get(k); if (hit) hit.days += l.days; else map.set(k, { policy_id: l.policy_id, registration: l.registration, days: l.days }); }
      rows = [...map.values()].map(r => ['PROVISIONAL', month, policyName(r.policy_id), customer(r.policy_id), r.registration, r.days, saved.report.id, JSON.stringify(saved.report.rules_snapshot)]);
    }
    file = csv([head, ...rows]);
  } catch (error) { return new NextResponse(error instanceof Error ? error.message : 'Unable to export.', { status: 400 }); }
  return new NextResponse(file, { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="stratify-provisional-${month}.csv"`, 'Cache-Control': 'no-store' } });
}
