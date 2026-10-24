import {describe,it,expect,vi} from 'vitest';
vi.mock('server-only',()=>({}));
const mockedRest=vi.hoisted(()=>({rest:vi.fn(),countRows:vi.fn()}));
vi.mock('@/lib/rest',()=>mockedRest);
import {canReadCrm,canWriteCrm,profileSchema,safeSearch,pageOffset,profileReminders,taskSchema,vehicleAvailability} from '@/lib/crm';
import {crmVehicles,crmList,crmSummary,demoCrm} from '@/lib/crm-data';
import {demoOrgs,demoPolicies} from '@/lib/demo';
import type {Context} from '@/lib/types';
const ctx:Context={user:{id:'demo',email:'demo'},demo:true,orgs:demoOrgs,policies:demoPolicies,memberships:[]};
describe('fleet CRM permissions, validation and demo',()=>{
 it('keeps a vehicle unavailable until every maintenance task is closed, without losing its recorded status',()=>{
  const d=demoCrm(),v={...d.vehicles[0],profile:{...d.vehicles[0].profile!,operational_status:'available' as const}};
  const t={...d.tasks[0],vehicle_id:v.id,fleet_id:v.fleet_id,category:'repair' as const};
  expect(vehicleAvailability(v,[t])).toBe('maintenance');
  expect(vehicleAvailability({...v,profile:null},[t])).toBe('maintenance');
  expect(vehicleAvailability(v,[{...t,status:'completed'}, {...t,id:'second',status:'in_progress'}])).toBe('maintenance');
  expect(vehicleAvailability(v,[{...t,status:'completed'},{...t,status:'cancelled'}])).toBe('available');
  expect(vehicleAvailability(v,[{...t,category:'task'}])).toBe('available');
  expect(vehicleAvailability(v,[{...t,fleet_id:'other'}])).toBe('available');
  for(const status of ['off_road','disposed','maintenance'] as const){expect(vehicleAvailability({...v,profile:{...v.profile,operational_status:status}},[])).toBe(status);}
 });
 it('allows fleet staff to manage, insurer/accounts to read, and denies drivers',()=>{
  for(const role of ['platform_super_admin','fleet_admin','fleet_manager','insurer_admin','fleet_accounts','driver']){
   const c={...ctx,demo:false,memberships:[{organisation_id:'f',active:true,role}]};
   expect(canReadCrm(c)).toBe(role!=='driver');expect(canWriteCrm(c)).toBe(['platform_super_admin','fleet_admin','fleet_manager'].includes(role));
  }expect(canReadCrm(ctx)).toBe(true);expect(canWriteCrm(ctx)).toBe(false);
 });
 it('rejects query syntax injection and invalid pagination',()=>{
  for(const value of ['x*,id.gt.0','a%','(x)','a'.repeat(81)])expect(()=>safeSearch(value)).toThrow();
  expect(safeSearch("O'Neil")).toBe("O'Neil");for(const value of ['-1','1.5','Infinity'])expect(()=>pageOffset(value)).toThrow();
 });
 it('keeps the 600th Atlas vehicle in its own paginated fleet without database calls',async()=>{
  mockedRest.rest.mockClear();const page=await crmVehicles(ctx,{fleet:'atlas',offset:'575'});expect(page.total).toBe(600);expect(page.rows).toHaveLength(25);expect(page.rows.at(-1)?.id).toBe('atlas-599');expect(page.rows.every(v=>v.fleet_id==='atlas')).toBe(true);expect(mockedRest.rest).not.toHaveBeenCalled();
 });
 it('filters maintenance, closed tasks and overdue work consistently',async()=>{
  const page=await crmList(ctx,'tasks',{fleet:'atlas',category:'maintenance'});expect(page.rows.every(t=>t.category!=='task')).toBe(true);
  const overdue=await crmList(ctx,'tasks',{fleet:'atlas',due:'overdue'});expect(overdue.rows).toHaveLength(1);expect(overdue.rows[0].title).toBe('Book MOT');
  const s=await crmSummary(ctx,'atlas');expect(s.vehicles).toBe(600);expect(s.open).toBe(5);
 });
 it('retains missing due dates as unknown and does not remind for disposed vehicles',()=>{
  const v=demoCrm().vehicles[0];expect(profileReminders([{...v,profile:null}])).toEqual([]);
  expect(profileReminders([{...v,profile:{...v.profile!,operational_status:'disposed'}}])).toEqual([]);
 });
 it('validates mileage dates, real calendar dates, money and linked IDs',()=>{
  const p={...demoCrm().vehicles[0].profile!,fleet_id:'20000000-0000-4000-8000-000000000001',vehicle_id:'30000000-0000-4000-8000-000000000001'};
  expect(profileSchema.safeParse(p).success).toBe(true);expect(profileSchema.safeParse({...p,mileage_recorded_on:''}).success).toBe(false);expect(profileSchema.safeParse({...p,mot_due:'2026-02-30'}).success).toBe(false);expect(profileSchema.safeParse({...p,monthly_payment:-1}).success).toBe(false);
  const task={...demoCrm().tasks[0],fleet_id:p.fleet_id,vehicle_id:p.vehicle_id,assignee_id:'',supplier_id:''};expect(taskSchema.safeParse(task).success).toBe(true);expect(taskSchema.safeParse({...task,assignee_id:'fake'}).success).toBe(false);
 });
});
