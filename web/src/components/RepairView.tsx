import { Badge, Notice } from '@/components/ui';
import { gbp } from '@/lib/bordereau';
import { londonDateTime } from '@/lib/dates';
import { repairActions, repairFileKindLabel, repairStatusHint, repairStatusLabel, type RepairFile, type RepairNote, type RepairRow } from '@/lib/repairs';
import { CompleteRepairForm, DecideQuoteForm, InsurerRepairNoteForm, RemoveRepairFile, RepairNoteForm, RepairUploader, SubmitQuoteForm } from '@/components/RepairForms';

const size = (n: number) => (n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB');
const photoAccept = 'image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif';
const docAccept = 'application/pdf,image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif';

export type RepairViewer = 'insurer' | 'fleet' | 'tpa' | 'repairer';

// One repair job: status, quote, photos, documents and the conversation. Shared by the insurer, the TPA, the fleet and the repair shop;
// the forms shown depend on who is looking, and the database enforces the same rules again.
export function RepairView({ claim, data, viewer, claimOpen }: {
  claim: string; viewer: RepairViewer; claimOpen: boolean;
  data: { repair: RepairRow; files: RepairFile[]; notes: RepairNote[] };
}) {
  const { repair, files, notes } = data;
  const act = repairActions(repair.status);
  const photos = files.filter(f => f.kind === 'photo');
  const docs = files.filter(f => f.kind !== 'photo');
  const amount = repair.quote_amount != null ? Number(repair.quote_amount) : null;
  const shop = viewer === 'repairer';
  const insurer = viewer === 'insurer';
  const link = (f: RepairFile) => '/repairs/file/' + f.id;
  return (
    <>
      <div className="cardhead">
        <h2>Repair</h2>
        <span><Badge warn={repair.status === 'quote_submitted'}>{repairStatusLabel[repair.status]}</Badge></span>
      </div>
      <p className="subtext">{repairStatusHint[repair.status]}{repair.repairers?.name && !shop ? ` · ${repair.repairers.name}` : ''}</p>

      {amount !== null && (
        <div className="request">
          <p><strong>Quote: {gbp(amount)}</strong> <span className="subtext">{repair.quote_submitted_at ? '· sent ' + londonDateTime(repair.quote_submitted_at) : ''}{repair.decided_at && repair.status !== 'with_repairer' ? ' · approved ' + londonDateTime(repair.decided_at) : ''}</span></p>
          {repair.quote_note && <p className="preline">{repair.quote_note}</p>}
        </div>
      )}

      <h3>Photos of the vehicle</h3>
      {photos.length === 0 ? <p className="subtext">No photos yet.</p> : (
        <div className="photo-grid">
          {photos.map(f => (
            <figure key={f.id} className="photo">
              <a href={link(f)} target="_blank" rel="noopener noreferrer"><img src={link(f)} alt={f.caption || f.file_name} loading="lazy" width={160} height={120} /></a>
              <figcaption className="subtext">{f.caption || f.file_name}{shop && act.addPhotos && <> <RemoveRepairFile claim={claim} file={f.id} name={f.file_name} /></>}</figcaption>
            </figure>
          ))}
        </div>
      )}
      {shop && act.addPhotos && claimOpen && <RepairUploader claim={claim} kind="photo" label="Add photos of the damage" multiple accept={photoAccept} />}

      <h3>Quote and invoice</h3>
      {docs.length === 0 ? <p className="subtext">Nothing uploaded yet.</p> : (
        <ul className="doclist">
          {docs.map(f => (
            <li key={f.id}>
              <a href={link(f)} target="_blank" rel="noopener noreferrer">{f.file_name}</a> <Badge>{repairFileKindLabel[f.kind]}</Badge>
              <span className="subtext"> · {size(f.size_bytes)} · {londonDateTime(f.uploaded_at)}</span>
              {shop && ((f.kind === 'quote' && act.addQuote) || (f.kind === 'invoice' && act.addInvoice)) && <> <RemoveRepairFile claim={claim} file={f.id} name={f.file_name} /></>}
            </li>
          ))}
        </ul>
      )}
      {shop && claimOpen && act.addQuote && <RepairUploader claim={claim} kind="quote" label="Upload your quote (PDF or photo)" accept={docAccept} />}
      {shop && claimOpen && act.addInvoice && <RepairUploader claim={claim} kind="invoice" label="Upload your invoice when the work is done (PDF or photo)" accept={docAccept} />}

      {shop && claimOpen && act.submitQuote && (
        <section className="panel next-step"><div className="panel-body"><h3>Send your quote for approval</h3><SubmitQuoteForm claim={claim} defaultAmount={amount !== null ? amount.toFixed(2) : undefined} defaultNote={repair.quote_note ?? undefined} /></div></section>
      )}
      {shop && repair.status === 'quote_submitted' && <Notice>Your quote has gone to the insurer. You will be told when they decide.</Notice>}
      {shop && claimOpen && act.complete && (
        <section className="panel next-step"><div className="panel-body"><h3>Finished the repair?</h3><CompleteRepairForm claim={claim} /></div></section>
      )}
      {insurer && claimOpen && act.insurerDecide && (
        <section className="panel next-step"><div className="panel-body"><h3>Decide on this quote</h3><DecideQuoteForm claim={claim} /></div></section>
      )}

      <h3>Messages</h3>
      {notes.length === 0 ? <p className="subtext">No messages yet.</p> : (
        <ul className="doclist">
          {notes.map(n => <li key={n.id}><div><strong>{n.side === 'repairer' ? 'Repair shop' : 'Insurer'}</strong> <span className="subtext">· {londonDateTime(n.created_at)}</span></div><p className="preline">{n.body}</p></li>)}
        </ul>
      )}
      {insurer && claimOpen && <InsurerRepairNoteForm claim={claim} />}
      {shop && claimOpen && <RepairNoteForm claim={claim} />}
    </>
  );
}
