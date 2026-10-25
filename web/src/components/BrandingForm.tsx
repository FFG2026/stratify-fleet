'use client';
import { useAction } from './useAction';
import { saveBranding } from '@/app/(app)/branding-actions';

export function BrandingForm({ insurer, name, accent, logoPath }: { insurer: string; name: string; accent: string | null; logoPath:string|null }) {
  const { pending, result, onSubmit } = useAction(saveBranding,false);
  return (
    <form className="form-grid" onSubmit={onSubmit}>
      <input type="hidden" name="insurer" value={insurer} />
      <label>Display name (optional)<input name="name" maxLength={60} defaultValue={name} autoComplete="off" /></label>
      <label className="inline"><input type="checkbox" name="useAccent" defaultChecked={!!accent} /> Use this insurer’s accent colour</label>
      <label>Accent colour<input type="color" name="accent" defaultValue={accent ?? '#226b55'} /></label>
      <label>Insurer logo (PNG, JPG or WebP, up to 4 MB)<input type="file" name="logo" accept="image/png,image/jpeg,image/webp"/></label>{logoPath&&<label className="inline"><input type="checkbox" name="removeLogo"/> Remove the current logo and use Stratify</label>}<p className="subtext">Used for links and highlights. An uploaded insurer logo replaces the Stratify logo for its staff and fleets. Pale colours are refused because they are hard to read on white.</p>
      <div className="actions"><button className="primary" disabled={pending}>{pending ? 'Saving…' : 'Save branding'}</button></div>
      <div role="status" aria-live="polite" className={result?.ok === false ? 'form-error' : 'form-note'}>{result?.message}</div>
    </form>
  );
}
