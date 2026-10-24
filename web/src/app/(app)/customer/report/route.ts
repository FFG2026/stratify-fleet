import { NextResponse, type NextRequest } from 'next/server';
import { getContext, getCoveredVehicles, isDriverOnly, orgName } from '@/lib/data';
import { csv, londonDate, londonDateTime } from '@/lib/dates';

// Vehicles on cover today, with the driver assigned to each and the exact time each vehicle was added to the portal.
export async function GET(request: NextRequest) {
  const ctx = await getContext();
  if (!ctx) return new NextResponse('Please sign in.', { status: 401 });
  if (ctx.demo || isDriverOnly(ctx)) return new NextResponse('Not available.', { status: 404 });
  const scope = request.nextUrl.searchParams.get('scope') === 'unassigned' ? 'unassigned' : 'all';
  try {
    const vehicles = (await getCoveredVehicles(ctx)).filter(v => scope === 'all' || !v.drivers.length);
    const head = ['Registration', 'Vehicle', 'Fleet', 'Policy', 'Cover started', 'Added to portal (UK time)', 'Driver', 'Driver assigned from'];
    const rows = vehicles.flatMap(v => (v.drivers.length ? v.drivers : [null]).map(d => [
      v.registration, v.vehicle, orgName(ctx, v.fleet_id), v.policy, londonDateTime(v.cover_start), londonDateTime(v.recorded_at), d ? d.name : 'UNASSIGNED', d ? d.since : ''
    ]));
    const file = csv([head, ...rows]);
    return new NextResponse(file, { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="stratify-${scope === 'all' ? 'vehicles' : 'unassigned-vehicles'}-${londonDate(new Date())}.csv"`, 'Cache-Control': 'no-store' } });
  } catch (error) { return new NextResponse(error instanceof Error ? error.message : 'Unable to build the report.', { status: 400 }); }
}
