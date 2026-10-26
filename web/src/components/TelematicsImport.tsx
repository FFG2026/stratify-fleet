'use client';
import { useAction } from '@/components/useAction';
import { importTelematics } from '@/app/(app)/telematics-actions';
import { csvTemplate } from '@/lib/telematics';

export function TelematicsImport({ fleet }: { fleet: string }) {
  const up = useAction(importTelematics, true);
  const href = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csvTemplate);
  return (
    <form onSubmit={up.onSubmit}>
      <input type="hidden" name="fleet" value={fleet} />
      <div className="field"><label htmlFor="tel-file">CSV file</label><input id="tel-file" name="file" type="file" accept=".csv,text/csv" required /></div>
      <div className="field"><label htmlFor="tel-source">Where it came from (optional)</label><input id="tel-source" name="source" maxLength={60} placeholder="e.g. your provider's name" /></div>
      <div className="actions"><button disabled={up.pending}>{up.pending ? 'Uploading…' : 'Upload'}</button> <a className="textbtn" href={href} download="telematics-template.csv">Download template</a></div>
      <div role="status" aria-live="polite" className={'form-note' + (up.result && !up.result.ok ? ' form-error' : '')}>{up.result?.message}</div>
    </form>
  );
}
