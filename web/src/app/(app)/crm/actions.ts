'use server';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { rest, RestError } from '@/lib/rest';
import { requireContext, messageOf } from '@/lib/session';
import { canWriteCrm, profileSchema, contactSchema, taskSchema, taskStatuses, type Task } from '@/lib/crm';
import { checkedId } from '@/lib/ids';
import { normaliseRegistration, parseDate } from '@/lib/dates';
import { maxFileBytes, sniffFile } from '@/lib/drivers';
import { uploadFile, deleteFile } from '@/lib/storage';
import type { ActionResult } from '@/components/useAction';

async function writer(){const ctx=await requireContext();if(!canWriteCrm(ctx))throw new RestError('Your account cannot change fleet CRM records.',403);return ctx;}
const fail=(e:unknown):ActionResult=>({ok:false,message:e instanceof z.ZodError?e.issues[0]?.message||'Check the details.':messageOf(e)});
const done=(message:string):ActionResult=>{revalidatePath('/crm');revalidatePath('/crm/vehicles/[id]','page');return{ok:true,message};};
async function vehicleFor(form:FormData,fleet:string){
 const supplied=String(form.get('vehicle_id')||'');if(supplied)return checkedId(supplied);
 const reg=String(form.get('registration')||'').trim();if(!reg)return null;
 const rows=await rest<{id:string}[]>('/rest/v1/vehicles?select=id&fleet_id=eq.'+checkedId(fleet)+'&registration=eq.'+normaliseRegistration(reg)+'&limit=1');
 if(!rows.length)throw new RestError('No matching vehicle in that fleet. Check the registration.',400);return rows[0].id;
}
export async function saveProfile(form:FormData):Promise<ActionResult>{try{
 await writer();const data=profileSchema.parse(Object.fromEntries(form));
 const rows=await rest<{id:string}[]>('/rest/v1/crm_vehicle_profiles?select=id&vehicle_id=eq.'+data.vehicle_id+'&fleet_id=eq.'+data.fleet_id);
 await rest('/rest/v1/crm_vehicle_profiles'+(rows[0]?'?id=eq.'+rows[0].id:''),{method:rows[0]?'PATCH':'POST',body:data});
 revalidatePath('/crm/vehicles/'+data.vehicle_id);return done('Vehicle details saved. Insurance cover has not changed.');
}catch(e){return fail(e);}}
export async function addContact(form:FormData):Promise<ActionResult>{try{
 await writer();const data=contactSchema.parse(Object.fromEntries(form)),id=String(form.get('id')||'');
 if(id){const rows=await rest<{id:string}[]>('/rest/v1/crm_contacts?select=id&id=eq.'+checkedId(id)+'&fleet_id=eq.'+data.fleet_id);if(!rows.length)throw new RestError('Contact not found.',404);}
 await rest('/rest/v1/crm_contacts'+(id?'?id=eq.'+id:''),{method:id?'PATCH':'POST',body:data});return done(id?'Contact updated.':'Contact added.');
}catch(e){return fail(e);}}
export async function addTask(form:FormData):Promise<ActionResult>{try{
 await writer();const fleet=checkedId(form.get('fleet_id'));
 const data=taskSchema.parse({...Object.fromEntries(form),vehicle_id:await vehicleFor(form,fleet)});
 await rest('/rest/v1/crm_tasks',{body:data});return done('Task created.');
}catch(e){return fail(e);}}
export async function updateTask(form:FormData):Promise<ActionResult>{try{
 await writer();const id=checkedId(form.get('id')),status=z.enum(taskStatuses).parse(form.get('status'));
 const rows=await rest<Task[]>('/rest/v1/crm_tasks?select=*&id=eq.'+id);
 if(!rows.length)throw new RestError('Task not found in your fleet.',404);
 // Limit the patch to task state and work notes. Fleet and insurance records cannot be changed here.
 const detail=z.string().trim().max(4000).parse(form.get('detail')||'');
 const due=String(form.get('due_on')||'');if(due)parseDate(due);
 const rawCost=String(form.get('cost')||''),cost=rawCost?z.number().min(0).max(10000000).parse(Number(rawCost)):null;
 await rest('/rest/v1/crm_tasks?id=eq.'+id,{method:'PATCH',body:{status,detail,due_on:due||null,cost}});
 return done('Task updated.');
}catch(e){return fail(e);}}
export async function addDocument(form:FormData):Promise<ActionResult>{try{
 await writer();const fleet=checkedId(form.get('fleet_id')),vehicle=await vehicleFor(form,fleet);
 const title=z.string().trim().min(1,'Enter a document title.').max(200).parse(form.get('title'));
 const file=form.get('file');if(!(file instanceof File)||!file.size)throw new RestError('Choose a PDF or photo.',400);
 if(file.size>maxFileBytes)throw new RestError('Choose a file under 4 MB.',400);
 const bytes=new Uint8Array(await file.arrayBuffer()),kind=sniffFile(bytes);if(!kind)throw new RestError('Use a PDF, JPG, PNG or WebP file.',400);
 const expires=String(form.get('expires_on')||'');if(expires)parseDate(expires);
 const path=fleet+'/'+crypto.randomUUID()+'.'+kind.ext;
 await uploadFile(path,bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength) as ArrayBuffer,kind.type,'fleet-documents');
 try{await rest('/rest/v1/crm_documents',{body:{fleet_id:fleet,vehicle_id:vehicle,title,storage_path:path,file_name:file.name.slice(0,200),content_type:kind.type,size_bytes:file.size,expires_on:expires||null}});}catch(e){await deleteFile(path,'fleet-documents');throw e;}
 return done('Document uploaded securely.');
}catch(e){return fail(e);}}
