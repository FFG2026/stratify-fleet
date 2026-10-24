import { z } from 'zod';
import { parseDate } from './dates';
import type { Context } from './types';

export const taskStatuses = ['open','in_progress','awaiting_approval','completed','cancelled'] as const;
export const taskCategories = ['task','mot','tax','service','repair','tyre','inspection','breakdown'] as const;
export const operationalStatuses = ['available','off_road','maintenance','disposed'] as const;
export const labelOf = (s: string) => s.replaceAll('_',' ').replace(/^./,c=>c.toUpperCase());
export const canReadCrm = (ctx: Context) => ctx.demo || ctx.memberships.some(m=>m.active && ['platform_super_admin','fleet_admin','fleet_manager','fleet_accounts'].includes(m.role));
export const canWriteCrm = (ctx: Context) => !ctx.demo && ctx.memberships.some(m=>m.active && ['platform_super_admin','fleet_admin','fleet_manager'].includes(m.role));
const optionalDate = z.preprocess(v=>v===''||v==null?null:v,z.string().refine(v=>{try{parseDate(v);return true;}catch{return false;}},'Enter a valid date.').nullable());
const optionalNumber = (max: number, integer=false) => z.preprocess(v=>v===''||v==null?null:Number(v), (integer?z.number().int():z.number()).min(0).max(max).nullable());
const optionalId = z.preprocess(v=>v===''||v==null?null:v,z.uuid().nullable());
export const bookingStages=['booked','checked_in','work_underway','ready_to_collect','completed','cancelled'] as const;
export const bookingLabel=(stage:string)=>stage==='completed'?'Collected / completed':labelOf(stage);
export const bookingFields=z.object({
 booking_stage:z.enum(bookingStages),supplier_id:z.uuid('Choose a garage.'),
 appointment_on:z.string().refine(v=>{try{parseDate(v);return true;}catch{return false;}},'Choose a valid appointment date.'),
 expected_return_on:z.string().refine(v=>{try{parseDate(v);return true;}catch{return false;}},'Choose a valid expected return date.'),
 estimated_cost:optionalNumber(10000000),cost:optionalNumber(10000000),
 taken_off_road:z.boolean(),approval_required:z.boolean(),completion_mileage:optionalNumber(5000000,true),
 next_service_on:optionalDate,next_service_mileage:optionalNumber(5000000,true),detail:z.string().trim().max(4000)
}).superRefine((v,c)=>{
 if(v.expected_return_on<v.appointment_on)c.addIssue({code:'custom',message:'Expected return cannot be before the appointment.'});
 if(v.booking_stage==='completed'){
  if(v.completion_mileage===null||v.cost===null)c.addIssue({code:'custom',message:'Record collection mileage and actual cost before completing.'});
  if(v.approval_required)c.addIssue({code:'custom',message:'Resolve the approval flag before completing.'});
  if(v.next_service_mileage!==null&&v.completion_mileage!==null&&v.next_service_mileage<=v.completion_mileage)c.addIssue({code:'custom',message:'Next service mileage must exceed collection mileage.'});
 }else if(v.completion_mileage!==null||v.next_service_on!==null||v.next_service_mileage!==null)c.addIssue({code:'custom',message:'Record mileage and next service when completing collection.'});
});
export function nextBookingStages(stage:string|null|undefined):readonly string[]{
 switch(stage){case 'booked':return ['booked','checked_in','cancelled'];case 'checked_in':return ['checked_in','work_underway','cancelled'];case 'work_underway':return ['work_underway','ready_to_collect','cancelled'];case 'ready_to_collect':return ['ready_to_collect','work_underway','completed','cancelled'];case 'completed':case 'cancelled':return [stage];default:return ['booked','checked_in'];}
}
export const profileSchema = z.object({
 fleet_id:z.uuid(),vehicle_id:z.uuid(),depot:z.string().trim().max(120),
 operational_status:z.enum(operationalStatuses), mileage:optionalNumber(5000000,true),mileage_recorded_on:optionalDate,
 mot_due:optionalDate,tax_due:optionalDate,service_due:optionalDate,service_due_mileage:optionalNumber(5000000,true),replacement_due:optionalDate,
 ownership:z.enum(['owned','leased','hired']),monthly_payment:optionalNumber(1000000),notes:z.string().trim().max(4000)
}).refine(v=>v.mileage===null || v.mileage_recorded_on!==null,{message:'Record the date of the mileage reading.',path:['mileage_recorded_on']});
export const contactSchema = z.object({fleet_id:z.uuid(),name:z.string().trim().min(1,'Enter a contact name.').max(160),kind:z.enum(['fleet','garage','recovery','leasing','insurer','other']),company:z.string().trim().max(160),email:z.union([z.email(),z.literal('')]),phone:z.string().trim().max(40),notes:z.string().trim().max(4000)});
export const taskSchema = z.object({fleet_id:z.uuid(),vehicle_id:optionalId,title:z.string().trim().min(1,'Enter a task title.').max(200),category:z.enum(taskCategories),priority:z.enum(['low','normal','high','urgent']),due_on:optionalDate,assignee_id:optionalId,supplier_id:optionalId,detail:z.string().trim().max(4000),cost:optionalNumber(10000000)});
export function safeSearch(value: string|undefined): string {
 const q=(value||'').trim();if(q.length>80 || !/^[\p{L}\p{N} @._'\-]*$/u.test(q))throw new Error('Use up to 80 letters, numbers or spaces to search.');return q;
}
export function pageOffset(value?:string){const n=Number(value||0);if(!Number.isSafeInteger(n)||n<0||n>1000000)throw new Error('Invalid page.');return n;}
export type VehicleProfile = z.infer<typeof profileSchema> & {id:string;updated_at:string};
export type CrmVehicle = {id:string;fleet_id:string;registration:string;make_model:string|null;profile:VehicleProfile|null;availability?:string|null};
export type Contact = z.infer<typeof contactSchema> & {id:string;active:boolean;created_at:string};
export type Task = z.infer<typeof taskSchema> & Omit<Partial<z.infer<typeof bookingFields>>,'supplier_id'|'detail'|'cost'|'booking_stage'> & {id:string;status:typeof taskStatuses[number];created_at:string;updated_at:string;completed_on?:string|null;booking_stage?:typeof bookingStages[number]|null;vehicle?:{registration:string}|null};
export type CrmDocument = {id:string;fleet_id:string;vehicle_id:string|null;task_id?:string|null;title:string;storage_path:string;file_name:string;content_type:string;size_bytes:number;expires_on:string|null;created_at:string};
export type CrmEvent = {id:string;fleet_id:string;vehicle_id:string|null;entity_type:string;action:string;occurred_at:string;after_state:Record<string,unknown>};
export type DueItem = {id:string;fleet_id:string;vehicle_id:string|null;title:string;due_on:string;source:string;href:string};
export const isOpen = (t:Task)=>!['completed','cancelled'].includes(t.status);
export const bookingUnavailable=(t:Task)=>t.category!=='task'&&isOpen(t)&&(!t.booking_stage||t.taken_off_road||['checked_in','work_underway','ready_to_collect'].includes(t.booking_stage));
export const overdueBack=(t:Task,date:string)=>!!t.booking_stage&&isOpen(t)&&!!t.expected_return_on&&t.expected_return_on<date;
export function vehicleAvailability(v:CrmVehicle,tasks:Task[]):string|null{
 const status=v.profile?.operational_status||null;
 if(status==='off_road'||status==='disposed')return status;
 return tasks.some(t=>t.vehicle_id===v.id&&t.fleet_id===v.fleet_id&&bookingUnavailable(t))?'maintenance':status;
}
export function dueState(date:string|null,today:string){return !date?'No date':date<today?'Overdue':date===today?'Due today':'Upcoming';}
export function profileReminders(vehicles:CrmVehicle[]):DueItem[]{
 return vehicles.flatMap(v=>{
  if(!v.profile || v.profile.operational_status==='disposed')return [];
  return (['mot_due','tax_due','service_due','replacement_due'] as const).flatMap(key=>v.profile?.[key]?[{id:v.id+'-'+key,fleet_id:v.fleet_id,vehicle_id:v.id,title:v.registration+' · '+labelOf(key.replace('_due','')),due_on:v.profile[key]!,source:'Vehicle date',href:'/crm/vehicles/'+v.id}]:[]);
 });
}
