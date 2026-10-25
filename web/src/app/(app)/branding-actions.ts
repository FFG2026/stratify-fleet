'use server';
import { revalidatePath } from 'next/cache';
import { rpc } from '@/lib/rest';
import { requireContext, messageOf } from '@/lib/session';
import { checkedId } from '@/lib/ids';
import { readableAccent } from '@/lib/colour';
import { isPlatform } from '@/lib/data';
import { sniffFile, maxFileBytes } from '@/lib/drivers';
import { uploadFile, deleteFile } from '@/lib/storage';
import { rest } from '@/lib/rest';
import type { ActionResult } from '@/components/useAction';

export async function saveBranding(form: FormData): Promise<ActionResult> {
  const ctx = await requireContext();
  if (ctx.demo) return { ok: false, message: 'The demo account is read-only.' };
  if (!isPlatform(ctx)) return { ok: false, message: 'Only super admins can manage insurer branding.' };
  let uploaded:string|null=null;
  try {
    const name = String(form.get('name') ?? '').trim(), accent = String(form.get('accent') ?? '').trim();
    if (name.length > 60) return { ok: false, message: 'The display name can be 60 characters at most.' };
    if (accent && !/^#[0-9a-fA-F]{6}$/.test(accent)) return { ok: false, message: 'Choose a colour.' };
    if (accent && !readableAccent(accent)) return { ok: false, message: 'That colour is too light to read on a white page. Choose a darker one.' };
    const insurer=checkedId(form.get('insurer'));
    const previous=await rest<{logo_path:string|null}[]>('/rest/v1/org_branding?select=logo_path&insurer_id=eq.'+insurer+'&limit=1');
    let logoPath=form.get('removeLogo')==='on'?null:previous[0]?.logo_path||null;
    const logo=form.get('logo');
    if(logo instanceof File && logo.size){
      if(form.get('removeLogo')==='on')return{ok:false,message:'Choose either uploading a logo or removing it.'};
      if(logo.size>maxFileBytes)return{ok:false,message:'Choose a logo under 4 MB.'};
      const bytes=new Uint8Array(await logo.arrayBuffer()),kind=sniffFile(bytes);
      if(!kind||!['image/png','image/jpeg','image/webp'].includes(kind.type))return{ok:false,message:'Use a PNG, JPG or WebP logo.'};
      logoPath=insurer+'/'+crypto.randomUUID()+'.'+kind.ext;
      await uploadFile(logoPath,bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength) as ArrayBuffer,kind.type,'insurer-logos');uploaded=logoPath;
    }
    await rpc('set_branding', { p_insurer: insurer, p_display_name: name || null, p_accent: form.get('useAccent') === 'on' ? accent || null : null, p_logo_path:logoPath });
    revalidatePath('/', 'layout');
    return { ok: true, message: 'Saved. It shows for this insurer\'s staff and their customers.' };
  } catch (error) { if(uploaded)await deleteFile(uploaded,'insurer-logos');return { ok: false, message: messageOf(error) }; }
}
