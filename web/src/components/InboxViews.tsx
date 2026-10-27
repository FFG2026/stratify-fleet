import Link from 'next/link';
import { orgName } from '@/lib/data';
import type { Context } from '@/lib/types';
import { Badge } from '@/components/ui';
import {
  clocksOf, handlerLabel, inboxWhy, nextInboxStep, urgentClock, waitText, type InboxClaim
} from '@/lib/inbox';
import { statusLabel, type ClaimStatus } from '@/lib/claims';
import { demoFleetLabel, isDemoInboxClaim } from '@/lib/demo-inbox';

const fleetOf = (ctx: Context, id: string) => {
  const live = orgName(ctx, id);
  return live !== '—' ? live : demoFleetLabel(id) ?? '—';
};

export function InboxTable({ ctx, rows, me, now }: { ctx: Context; rows: InboxClaim[]; me: string; now: Date }) {
  return (
    <div className="table-scroll"><table>
      <thead><tr><th>Reference</th><th>Fleet</th><th>Why it is here</th><th>Handler</th><th>Clock</th><th>Wait</th><th>Status</th><th>Next step</th></tr></thead>
      <tbody>
        {rows.map(c => {
          const clock = urgentClock(clocksOf(c, now));
          return (
            <tr key={c.id}>
              <td><Link prefetch={false} href={'/claims/' + c.id}><strong>{c.reference}</strong></Link>
                <span className="subtext">{c.registration}{c.driver_name ? ' · ' + c.driver_name : ''}</span></td>
              <td>{fleetOf(ctx, c.fleet_id)}</td>
              <td>{inboxWhy(c, me, now)}{isDemoInboxClaim(c.id) ? <><br /><Badge>Demonstration</Badge></> : null}{c.anyone_injured ? <><br /><Badge warn>Injury</Badge></> : null}{c.cover_after ? <><br /><Badge warn>Cover after incident</Badge></> : null}</td>
              <td>{handlerLabel(c, me)}</td>
              <td>{clock ? <><strong className={clock.state === 'overdue' ? 'clock-overdue' : ''}>{clock.label}</strong><span className="subtext">{clock.text}</span></> : '—'}</td>
              <td>{waitText(c, now)}</td>
              <td><Badge warn={c.status !== 'closed'}>{statusLabel[c.status as ClaimStatus] ?? c.status}</Badge></td>
              <td><strong>{nextInboxStep(c, me, now)}</strong></td>
            </tr>
          );
        })}
      </tbody>
    </table></div>
  );
}

export function ClockList({ claim, now }: { claim: InboxClaim; now: Date }) {
  const clocks = clocksOf(claim, now);
  const met = clocks.filter(c => c.state === 'met').length;
  return (
    <section className="panel" aria-label="SLA clocks">
      <div className="panel-header"><div><h2>Clocks</h2><p className="subtext">{met} of {clocks.filter(c => c.state !== 'na').length || 3} met. Working elapsed time, Europe/London. No money clock.</p></div></div>
      <div className="table-scroll"><table>
        <thead><tr><th>Clock</th><th>State</th></tr></thead>
        <tbody>
          {clocks.map(c => (
            <tr key={c.key}>
              <td>{c.label}</td>
              <td className={c.state === 'overdue' ? 'clock-overdue' : ''}>{c.state === 'na' ? 'Not started' : c.text}</td>
            </tr>
          ))}
        </tbody>
      </table></div>
    </section>
  );
}
