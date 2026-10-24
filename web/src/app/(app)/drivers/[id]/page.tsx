import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getContext, getDriverFile, canViewDrivers, isDriverOnly, orgName } from '@/lib/data';
import { PageHeader, Notice, LinkButton } from '@/components/ui';
import { Checklist, Documents, History, Permissions } from '@/components/DriverFile';
import { checkedId } from '@/lib/ids';

const day = (d: string) => new Date(d + 'T12:00:00Z').toLocaleDateString('en-GB', { timeZone: 'UTC' });

export default async function DriverDetail({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await getContext();
  if (!ctx) redirect('/login');
  if (isDriverOnly(ctx)) redirect('/drivers');
  if (!canViewDrivers(ctx)) redirect('/');
  const { id } = await params;
  try { checkedId(id); } catch { notFound(); }
  const file = await getDriverFile(id).catch(() => null);
  // Row-level security returns nothing for drivers this person may not see; that looks the same as a missing driver.
  if (!file || !file.profile) notFound();
  const p = file.profile;
  return (
    <>
      <PageHeader title={p.full_name} subtitle={`Driver at ${orgName(ctx, p.fleet_id)}`} actions={<LinkButton href="/drivers">← All drivers</LinkButton>} />
      <Notice>Provided by the driver. Opening a document is recorded in the audit trail. Recording a licence-check permission is not a licence check: the portal does not check licences with the DVLA yet.</Notice>
      <section className="panel"><div className="panel-body">
        <div className="cardhead"><h2>Details</h2></div>
        <dl className="details">
          <div><dt>Full name</dt><dd>{p.full_name}</dd></div>
          <div><dt>Date of birth</dt><dd>{p.date_of_birth ? day(p.date_of_birth) : '—'}</dd></div>
          <div><dt>Driving licence number</dt><dd>{p.licence_number ?? '—'}</dd></div>
          <div><dt>Phone</dt><dd>{p.phone ?? '—'}</dd></div>
        </dl>
      </div></section>
      <Checklist file={file} />
      <Documents file={file} editable={false} />
      <Permissions file={file} editable={false} />
      <History file={file} editable={false} />
      <p><Link prefetch={false} className="textbtn" href="/drivers">← Back to all drivers</Link></p>
    </>
  );
}
