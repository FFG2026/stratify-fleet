'use client';
import { useAction } from './useAction';
import { saveBranding } from '@/app/(app)/branding-actions';

export function BrandingForm({ insurer, name, accent }: { insurer: string; name: string; accent: string | null }) {
  const { pending, result, onSubmit } = useAction(saveBranding);
  return (
    <form className="form-grid" onSubmit={onSubmit}>
      <input type="hidden" name="insurer" value={insurer} />
      <label>Name shown under the logo (optional)<input name="name" maxLength={60} defaultValue={name} autoComplete="off" /></label>
      <label className="inline"><input type="checkbox" name="useAccent" defaultChecked={!!accent} /> Use my own accent colour</label>
      <label>Accent colour<input type="color" name="accent" defaultValue={accent ?? '#226b55'} /></label>
      <p className="subtext">Used for links and highlights. The Stratify logo stays. Pale colours are refused because they are hard to read on white.</p>
      <div className="actions"><button className="primary" disabled={pending}>{pending ? 'Saving…' : 'Save branding'}</button></div>
      <div role="status" aria-live="polite" className={result?.ok === false ? 'form-error' : 'form-note'}>{result?.message}</div>
    </form>
  );
}
