import { getContext } from '@/lib/data';
import { canReadCrm, type CrmDocument } from '@/lib/crm';
import { checkedId } from '@/lib/ids';
import { rest } from '@/lib/rest';
import { downloadFile } from '@/lib/storage';
export async function GET(_request:Request,{params}:{params:Promise<{id:string}>}){
 const ctx=await getContext();if(!ctx||ctx.demo||ctx.user.mustChangePassword||!canReadCrm(ctx))return new Response('Not found',{status:404});
 try{
  const {id}=await params,rows=await rest<CrmDocument[]>('/rest/v1/crm_documents?select=*&id=eq.'+checkedId(id)),doc=rows[0];if(!doc)return new Response('Not found',{status:404});
  const file=await downloadFile(doc.storage_path,'fleet-documents');if(!file?.body)return new Response('Not found',{status:404});
  return new Response(file.body,{headers:{'content-type':doc.content_type,'content-disposition':`attachment; filename="${doc.file_name.replace(/[^\w. -]/g,'_')}"`,'cache-control':'private, no-store','x-content-type-options':'nosniff','content-security-policy':"default-src 'none'; sandbox"}});
 }catch{return new Response('Not found',{status:404});}
}
