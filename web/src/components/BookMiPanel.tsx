import Link from 'next/link';
import { bookTotals, formatEarned, formatFrequency, claimsPerVehicleYear, type BookFleetRow } from '@/lib/book-mi';
import { formatDuration } from '@/lib/inbox';
import { fmt, Notice } from '@/components/ui';

export function BookMiPanel({ rows, medianFirstTouchMs, demo = false }: { rows: BookFleetRow[]; medianFirstTouchMs?: number | null; demo?: boolean }) {
  const t = bookTotals(rows);
  return (
    <section className="panel" aria-label="Book and loss MI">
      <div className="panel-header">
        <div>
          <h2>Book and loss</h2>
          <p className="subtext">Frequency and operational smell, not a loss ratio. Incurred is blank until a claims system sends it.</p>
        </div>
        <span className="muted">{rows.length} fleets</span>
      </div>
      {demo && <Notice>Fictional earned premium and claim counts so you can walk an insurer through the book. They are not the live register.</Notice>}
      <div className="stats book-mi-stats">
        {[
          ['Vehicles on cover today', fmt(t.onCover), 'Live register'],
          ['Earned premium YTD', formatEarned(t.earned), t.earned === null ? 'Lock a month to show this' : 'From locked reconciliations'],
          ['Claims per vehicle-year', formatFrequency(t.frequency), 'Sent claims ÷ vehicles on cover'],
          ['Open claims', fmt(t.open), 'Not yet closed'],
          ['Cover recorded after incident', fmt(t.coverAfter), 'Open and last 12 months'],
          ['Median wait to first touch', medianFirstTouchMs != null ? formatDuration(medianFirstTouchMs) : '—', 'From submitted to start review'],
          ['Licence check overdue', fmt(t.licenceOverdue), 'Latest recorded check'],
          ['On cover, no driver', fmt(t.noDriver), 'Assignments as at today']
        ].map(([label, value, note]) => (
          <div className="stat" key={label}><div className="stat-label">{label}</div><div className="stat-number">{value}</div><div className="stat-note">{note}</div></div>
        ))}
      </div>
      <div className="table-scroll"><table>
        <thead><tr><th>Customer</th><th>On cover</th><th>Earned YTD</th><th>Claims 12m</th><th>Open</th><th>Per veh-year</th><th>Cover-after</th><th>Licence overdue</th><th>No driver</th></tr></thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.fleet_id}>
              <td><strong>{r.fleet_name}</strong></td>
              <td>{fmt(r.on_cover)}</td>
              <td>{formatEarned(r.earned_ytd)}</td>
              <td>{fmt(r.claims_12m)}</td>
              <td>{r.open ? <Link prefetch={false} href="/claims?queue=overdue">{fmt(r.open)}</Link> : '0'}</td>
              <td>{formatFrequency(claimsPerVehicleYear(r.claims_12m, r.on_cover))}</td>
              <td>{fmt(r.cover_after)}</td>
              <td>{fmt(r.licence_overdue)}</td>
              <td>{fmt(r.no_driver)}</td>
            </tr>
          ))}
        </tbody>
      </table></div>
      {!rows.length && <div className="empty">No fleets in this view.</div>}
    </section>
  );
}
