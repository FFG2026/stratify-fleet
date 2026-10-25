import {describe,it,expect,vi,beforeEach} from 'vitest';
const m=vi.hoisted(()=>({ctx:vi.fn(),rpc:vi.fn(),rest:vi.fn(),upload:vi.fn(),remove:vi.fn()}));
vi.mock('next/cache',()=>({revalidatePath:vi.fn()}));
vi.mock('@/lib/session',()=>({requireContext:m.ctx,messageOf:(e:Error)=>e.message}));
vi.mock('@/lib/data',()=>({isPlatform:(ctx:{platform:boolean})=>ctx.platform}));
vi.mock('@/lib/rest',()=>({rpc:m.rpc,rest:m.rest}));
vi.mock('@/lib/storage',()=>({uploadFile:m.upload,deleteFile:m.remove}));
import {saveBranding} from '@/app/(app)/branding-actions';
const insurer='10000000-0000-4000-8000-000000000002';
const form=()=>{const f=new FormData();f.set('insurer',insurer);f.set('name','Example Mutual');f.set('accent','#1a5c4b');f.set('useAccent','on');return f;};
beforeEach(()=>{vi.resetAllMocks();m.ctx.mockResolvedValue({demo:false,platform:true});m.rest.mockResolvedValue([{logo_path:null}]);m.rpc.mockResolvedValue(null);m.upload.mockResolvedValue(null);});
describe('super-admin insurer branding',()=>{
 it('rejects insurer and demo accounts before reading or saving anything',async()=>{
  for(const ctx of [{demo:false,platform:false},{demo:true,platform:true}]){m.ctx.mockResolvedValue(ctx);expect((await saveBranding(form())).ok).toBe(false);}
  expect(m.rest).not.toHaveBeenCalled();expect(m.rpc).not.toHaveBeenCalled();expect(m.upload).not.toHaveBeenCalled();
 });
 it('preserves the existing logo when saving a colour',async()=>{
  m.rest.mockResolvedValue([{logo_path:insurer+'/old.png'}]);expect((await saveBranding(form())).ok).toBe(true);
  expect(m.rpc).toHaveBeenCalledWith('set_branding',expect.objectContaining({p_logo_path:insurer+'/old.png',p_accent:'#1a5c4b'}));
 });
 it('uploads an image under the selected insurer and cleans it up if saving fails',async()=>{
  const f=form();f.set('logo',new File([new Uint8Array([137,80,78,71,13,10,26,10])],'logo.png',{type:'image/png'}));m.rpc.mockRejectedValue(new Error('save failed'));
  expect((await saveBranding(f)).ok).toBe(false);const path=m.upload.mock.calls[0][0];expect(path).toMatch(new RegExp('^'+insurer+'/.*\\.png$'));expect(m.upload.mock.calls[0][3]).toBe('insurer-logos');expect(m.remove).toHaveBeenCalledWith(path,'insurer-logos');
 });
 it('refuses PDFs disguised as logos and supports removing a logo',async()=>{
  const bad=form();bad.set('logo',new File(['%PDF-1.4'],'logo.png',{type:'image/png'}));expect((await saveBranding(bad)).ok).toBe(false);expect(m.upload).not.toHaveBeenCalled();
  const remove=form();remove.set('removeLogo','on');expect((await saveBranding(remove)).ok).toBe(true);expect(m.rpc).toHaveBeenCalledWith('set_branding',expect.objectContaining({p_logo_path:null}));
 });
});
