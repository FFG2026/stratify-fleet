import 'server-only';
import { rest, countRows } from '@/lib/rest';
import { checkedId } from '@/lib/ids';
import { today } from '@/lib/dates';
import { demoPeriods, demoPolicies, demoOrgs } from '@/lib/demo';
import { safeSearch, pageOffset, profileReminders, isOpen, vehicleAvailability, type CrmVehicle, type VehicleProfile, type Contact, type Task, type CrmDocument, type CrmEvent, type DueItem } from './crm';
import type { Context, Page } from './types';

export type CrmParams={fleet?:string;q?:string;offset?:string;status?:string;category?:string;due?:string;vehicle?:string;view?:string;policy?:string};
const day=(n:number)=>new Date(Date.parse(today()+'T12:00:00Z')+n*86400000).toISOString().slice(0,10);
export function demoCrm(){
 const fleets=demoOrgs.filter(o=>o.kind==='customer');
 const vehicles:CrmVehicle[]=demoPeriods.map((v,i)=>{
  const fleet_id=demoPolicies.find(p=>p.id===v.policy_id)!.customer_id;
  return {id:v.id,fleet_id,registration:v.registration,make_model:v.make,profile:{id:'profile-'+v.id,fleet_id,vehicle_id:v.id,depot:['Birmingham','Manchester','Bristol'][i%3],operational_status:i%37===0?'maintenance':i%53===0?'off_road':'available',mileage:24000+i*53,mileage_recorded_on:today(),mot_due:day(i%90-5),tax_due:day(i%180+10),service_due:day(i%40-4),service_due_mileage:30000+i*53,replacement_due:day(180+i%180),ownership:i%3?'leased':'owned',monthly_payment:i%3?425:null,notes:'Fictional demonstration vehicle.',updated_at:today()}};
 });
 const contacts:Contact[]=fleets.flatMap(f=>[
  {id:'manager-'+f.id,fleet_id:f.id,name:'Alex Morgan',kind:'fleet' as const,company:f.name,email:'alex@example.invalid',phone:'',notes:'Fleet manager — fictional contact.',active:true,created_at:today()},
  {id:'garage-'+f.id,fleet_id:f.id,name:'Service desk',kind:'garage' as const,company:'Greenway Vehicle Services',email:'service@example.invalid',phone:'',notes:'Fictional preferred repairer.',active:true,created_at:today()}
 ]);
 const tasks:Task[]=fleets.flatMap(f=>Array.from({length:6},(_,i)=>({id:'task-'+f.id+'-'+i,fleet_id:f.id,vehicle_id:vehicles.find(v=>v.fleet_id===f.id)!.id,title:['Book MOT','Annual service','Replace rear tyres','Approve repair estimate','Check fleet documents','Collect repaired vehicle'][i],category:(['mot','service','tyre','repair','task','repair'] as const)[i],status:(['open','in_progress','open','awaiting_approval','open','completed'] as const)[i],priority:i===0?'high':'normal',due_on:day(i*3-3),assignee_id:'manager-'+f.id,supplier_id:i===4?null:'garage-'+f.id,detail:'Fictional example. Review the vehicle and record the next action.',cost:i===5?245:null,created_at:today(),updated_at:today()})));
 const documents:CrmDocument[]=fleets.map(f=>({id:'doc-'+f.id,fleet_id:f.id,vehicle_id:null,title:'Fleet operating handbook — example',storage_path:'',file_name:'example-handbook.pdf',content_type:'application/pdf',size_bytes:0,expires_on:day(60),created_at:today()}));
 return {vehicles:vehicles.map(v=>({...v,availability:vehicleAvailability(v,tasks)})),contacts,tasks,documents};
}
const scope=(fleet?:string)=>fleet?'&fleet_id=eq.'+checkedId(fleet):'';
export const selectedFleet=(ctx:Context,p:CrmParams)=>p.fleet || ctx.policies.find(x=>x.id===p.policy)?.customer_id || '';
function demoPage<T>(rows:T[],offset:number):Page<T>{return{rows:rows.slice(offset,offset+25),total:rows.length,offset,limit:25};}
export async function crmVehicles(ctx:Context,p:CrmParams):Promise<Page<CrmVehicle>>{
 const q=safeSearch(p.q),offset=pageOffset(p.offset),fleet=selectedFleet(ctx,p);
 if(ctx.demo)return demoPage(demoCrm().vehicles.filter(v=>(!fleet||v.fleet_id===fleet)&&(!q||(v.registration+' '+v.make_model).toLowerCase().replace(/\s/g,'').includes(q.toLowerCase().replace(/\s/g,'')))),offset);
 const query=new URLSearchParams({select:'id,fleet_id,registration,make_model,profiles:crm_vehicle_profiles(*)',order:'registration.asc,id.asc',offset:String(offset),limit:'25'});
 if(fleet)query.set('fleet_id','eq.'+checkedId(fleet));if(q)query.set('or',`(registration.ilike.*${q.replace(/\s/g,'')}*,make_model.ilike.*${q}*)`);
 const page=await rest<{rows:(Omit<CrmVehicle,'profile'>&{profiles:VehicleProfile[]|VehicleProfile|null})[];total:number}>('/rest/v1/vehicles?'+query,{count:true});
 const statuses=page.rows.length?await rest<{id:string;operational_status:string|null}[]>('/rest/v1/crm_vehicle_availability?select=id,operational_status&id=in.('+page.rows.map(v=>checkedId(v.id)).join(',')+')'):[];
 return {...page,offset,limit:25,rows:page.rows.map(v=>({...v,availability:statuses.find(s=>s.id===v.id)?.operational_status??null,profile:Array.isArray(v.profiles)?v.profiles[0]||null:v.profiles}))};
}
export async function crmVehicle(ctx:Context,id:string):Promise<CrmVehicle|null>{
 if(ctx.demo)return demoCrm().vehicles.find(v=>v.id===id)||null;
 const rows=await rest<(Omit<CrmVehicle,'profile'>&{profiles:VehicleProfile[]|VehicleProfile|null})[]>('/rest/v1/vehicles?select=id,fleet_id,registration,make_model,profiles:crm_vehicle_profiles(*)&id=eq.'+checkedId(id));
 const v=rows[0];if(!v)return null;const statuses=await rest<{operational_status:string|null}[]>('/rest/v1/crm_vehicle_availability?select=operational_status&id=eq.'+checkedId(id));return {...v,availability:statuses[0]?.operational_status??null,profile:Array.isArray(v.profiles)?v.profiles[0]||null:v.profiles};
}
export async function crmList<K extends 'tasks'|'contacts'|'documents'>(ctx:Context,kind:K,p:CrmParams):Promise<Page<K extends 'tasks'?Task:K extends 'contacts'?Contact:CrmDocument>>{
 type Row=K extends 'tasks'?Task:K extends 'contacts'?Contact:CrmDocument;
 const fleet=selectedFleet(ctx,p),q=safeSearch(p.q),offset=pageOffset(p.offset);
 if(p.status&&!['open','in_progress','awaiting_approval','completed','cancelled'].includes(p.status))throw new Error('Unknown task status.');
 if(ctx.demo){let rows=demoCrm()[kind] as Row[];rows=rows.filter(r=>(!fleet||r.fleet_id===fleet)&&(!p.vehicle||('vehicle_id'in r && r.vehicle_id===p.vehicle))&&(!q||JSON.stringify(r).toLowerCase().includes(q.toLowerCase())));if(kind==='tasks')rows=rows.filter(r=>{const t=r as Task;return(!p.status||t.status===p.status)&&(!p.category||t.category!=='task')&&(!p.due||(isOpen(t)&&!!t.due_on&&t.due_on<=day(p.due==='overdue'?-1:30)));});return demoPage(rows,offset);}
 const query=new URLSearchParams({select:'*',order:kind==='contacts'?'name.asc,id.asc':kind==='tasks'?'due_on.asc.nullslast,id.asc':'created_at.desc,id.desc',offset:String(offset),limit:'25'});
 if(fleet)query.set('fleet_id','eq.'+checkedId(fleet));if(p.vehicle)query.set('vehicle_id','eq.'+checkedId(p.vehicle));
 if(kind==='contacts')query.set('active','eq.true');
 if(kind==='tasks'){if(p.status)query.set('status','eq.'+p.status);if(p.category)query.set('category','neq.task');if(p.due){query.set('status','not.in.(completed,cancelled)');query.set('due_on','lte.'+day(p.due==='overdue'?-1:30));}}
 if(q)query.set('or',kind==='contacts'?`(name.ilike.*${q}*,company.ilike.*${q}*,email.ilike.*${q}*)`:`(title.ilike.*${q}*)`);
 const page=await rest<{rows:Row[];total:number}>('/rest/v1/crm_'+kind+'?'+query,{count:true});return{...page,offset,limit:25};
}
export async function crmSummary(ctx:Context,fleet?:string){
 if(ctx.demo){const d=demoCrm(),vs=d.vehicles.filter(v=>!fleet||v.fleet_id===fleet),ts=d.tasks.filter(t=>!fleet||t.fleet_id===fleet);return{vehicles:vs.length,offRoad:vs.filter(v=>['off_road','maintenance'].includes(v.availability||'')).length,open:ts.filter(isOpen).length,overdue:ts.filter(t=>isOpen(t)&&t.due_on&&t.due_on<today()).length};}
 const s=scope(fleet),[vehicles,offRoad,open,overdue]=await Promise.all([countRows('vehicles','id=not.is.null'+s),countRows('crm_vehicle_availability','operational_status=in.(off_road,maintenance)'+s),countRows('crm_tasks','status=not.in.(completed,cancelled)'+s),countRows('crm_tasks','status=not.in.(completed,cancelled)&due_on=lt.'+today()+s)]);return{vehicles,offRoad,open,overdue};
}
export async function crmDue(ctx:Context,fleet?:string):Promise<{items:DueItem[];limited:boolean}>{
 let vehicles:CrmVehicle[],tasks:Task[],documents:CrmDocument[];
 if(ctx.demo){const d=demoCrm();vehicles=d.vehicles.filter(v=>!fleet||v.fleet_id===fleet);tasks=d.tasks.filter(t=>!fleet||t.fleet_id===fleet);documents=d.documents.filter(t=>!fleet||t.fleet_id===fleet);}
 else{
  const s=scope(fleet),end=day(30);
  const [profiles,t,d]=await Promise.all([
   rest<(VehicleProfile&{vehicle:{registration:string;make_model:string}})[]>('/rest/v1/crm_vehicle_profiles?select=*,vehicle:vehicles!inner(registration,make_model)&operational_status=neq.disposed&or=(mot_due.lte.'+end+',tax_due.lte.'+end+',service_due.lte.'+end+',replacement_due.lte.'+end+')&order=id.asc&limit=500'+s),
   rest<Task[]>('/rest/v1/crm_tasks?select=*&status=not.in.(completed,cancelled)&due_on=lte.'+end+'&order=due_on.asc,id.asc&limit=500'+s),
   rest<CrmDocument[]>('/rest/v1/crm_documents?select=*&expires_on=lte.'+end+'&order=expires_on.asc,id.asc&limit=500'+s)
  ]);vehicles=profiles.map(p=>({id:p.vehicle_id,fleet_id:p.fleet_id,registration:p.vehicle.registration,make_model:p.vehicle.make_model,profile:p}));tasks=t;documents=d;
 }
 const items=[...profileReminders(vehicles),...tasks.filter(isOpen).filter(t=>t.due_on).map(t=>({id:t.id,fleet_id:t.fleet_id,vehicle_id:t.vehicle_id,title:t.title,due_on:t.due_on!,source:'Task',href:'/crm?view=tasks&fleet='+t.fleet_id})),...documents.filter(d=>d.expires_on).map(d=>({id:d.id,fleet_id:d.fleet_id,vehicle_id:d.vehicle_id,title:d.title,due_on:d.expires_on!,source:'Document expiry',href:'/crm?view=documents&fleet='+d.fleet_id}))].filter(i=>i.due_on<=day(30)).sort((a,b)=>a.due_on.localeCompare(b.due_on)||a.id.localeCompare(b.id));
 return{items,limited:!ctx.demo&&(vehicles.length===500||tasks.length===500||documents.length===500)};
}
export async function crmEvents(ctx:Context,vehicle:string):Promise<CrmEvent[]>{
 if(ctx.demo)return[{id:'example',fleet_id:demoCrm().vehicles.find(v=>v.id===vehicle)?.fleet_id||'atlas',vehicle_id:vehicle,entity_type:'crm_vehicle_profiles',action:'insert',occurred_at:today()+'T09:00:00Z',after_state:{notes:'Fictional vehicle profile created'}}];
 return rest<CrmEvent[]>('/rest/v1/crm_events?select=*&vehicle_id=eq.'+checkedId(vehicle)+'&order=occurred_at.desc,id.desc&limit=25');
}
