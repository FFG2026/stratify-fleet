import {describe,it,expect,vi} from 'vitest';
vi.mock('server-only',()=>({}));
const mockedRest=vi.hoisted(()=>({rest:vi.fn(),countRows:vi.fn()}));
vi.mock('@/lib/rest',()=>mockedRest);
import {canReadCrm,canWriteCrm,profileSchema,safeSearch,pageOffset,profileReminders,taskSchema,vehicleAvailability,bookingFields,nextBookingStages,overdueBack} from '@/lib/crm';
import {crmVehicles,crmList,crmSummary,demoCrm,bookingSummary,crmDue} from '@/lib/crm-data';
import {demoOrgs,demoPolicies} from '@/lib/demo';
import type {Context} from '@/lib/types';
const ctx:Context={user:{id:'demo',email:'demo'},demo:true,orgs:demoOrgs,policies:demoPolicies,memberships:[]};
describe('fleet CRM permissions, validation and demo',()=>{
 it('keeps future bookings available, blocks checked-in/explicit off-road jobs, and waits for every job to close',()=>{
  const d=demoCrm(),v={...d.vehicles[0],profile:{...d.vehicles[0].profile!,operational_status:'available' as const}};
  const t={...d.tasks[0],vehicle_id:v.id,fleet_id:v.fleet_id,category:'service' as const,booking_stage:'booked' as const,taken_off_road:false};
  expect(vehicleAvailability(v,[t])).toBe('available');
  expect(vehicleAvailability(v,[{...t,taken_off_road:true}])).toBe('maintenance');
  for(const stage of ['checked_in','work_underway','ready_to_collect'] as const)expect(vehicleAvailability(v,[{...t,booking_stage:stage}])).toBe('maintenance');
  expect(vehicleAvailability(v,[{...t,booking_stage:'completed',status:'completed'},{...t,booking_stage:'checked_in',id:'second'}])).toBe('maintenance');
  expect(vehicleAvailability(v,[{...t,booking_stage:'completed',status:'completed'}])).toBe('available');
  expect(nextBookingStages('booked')).not.toContain('completed');expect(nextBookingStages('ready_to_collect')).toContain('completed');
 });
 it('validates booking dates and requires mileage, cost and resolved approval at collection',()=>{
  const booking={booking_stage:'booked',supplier_id:'20000000-0000-4000-8000-000000000001',appointment_on:'2026-11-01',expected_return_on:'2026-11-02',estimated_cost:'250',cost:'',taken_off_road:false,approval_required:false,completion_mileage:'',next_service_on:'',next_service_mileage:'',detail:''};
  expect(bookingFields.safeParse(booking).success).toBe(true);
  expect(bookingFields.safeParse({...booking,expected_return_on:'2026-10-31'}).success).toBe(false);
  expect(bookingFields.safeParse({...booking,booking_stage:'completed'}).success).toBe(false);
  const complete={...booking,booking_stage:'completed',completion_mileage:'50000',cost:'0',next_service_mileage:'60000'};
  expect(bookingFields.safeParse(complete).success).toBe(true);
  expect(bookingFields.safeParse({...complete,approval_required:true}).success).toBe(false);
  expect(bookingFields.safeParse({...complete,next_service_mileage:'49000'}).success).toBe(false);
 });
 it('filters booking stages, delays and approval flags and includes both appointment and return reminders',async()=>{
  const stage=await crmList(ctx,'tasks',{fleet:'atlas',stage:'booked'});expect(stage.rows).toHaveLength(1);expect(stage.rows[0].booking_stage).toBe('booked');
  const late=await crmList(ctx,'tasks',{fleet:'atlas',back:'1'});expect(late.rows).toHaveLength(1);expect(overdueBack(late.rows[0],'9999-01-01')).toBe(true);
  const approvals=await crmList(ctx,'tasks',{fleet:'atlas',approval:'1'});expect(approvals.rows.every(t=>t.approval_required)).toBe(true);
  const summary=await bookingSummary(ctx,'atlas');expect(summary).toEqual({booked:1,inGarage:2,late:1,approval:1});
  const due=await crmDue(ctx,'atlas');expect(due.items.some(i=>i.source==='Garage appointment')).toBe(true);expect(due.items.some(i=>i.source==='Expected return')).toBe(true);
 });
 it('retains the selected stage when combining a live overdue-return filter and fleet scope',async()=>{
  mockedRest.rest.mockResolvedValueOnce({rows:[],total:0});
  const fleet='20000000-0000-4000-8000-000000000001';
  await crmList({...ctx,demo:false},'tasks',{fleet,stage:'booked',back:'1'});
  const url=mockedRest.rest.mock.calls.at(-1)![0] as string,q=new URLSearchParams(url.split('?')[1]);
  expect(q.get('fleet_id')).toBe('eq.'+fleet);expect(q.get('booking_stage')).toBe('eq.booked');expect(q.get('and')).toBe('(booking_stage.not.is.null)');expect(q.get('expected_return_on')).toMatch(/^lt\./);
 });
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
   expect(canReadCrm(c)).toBe(!['driver','insurer_admin'].includes(role));expect(canWriteCrm(c)).toBe(['platform_super_admin','fleet_admin','fleet_manager'].includes(role));
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
