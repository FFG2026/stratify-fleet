import Link from 'next/link';
import { redirect, notFound } from 'next/navigation';
import { getContext, homeFor, orgName, normalisePeriod } from '@/lib/data';
import { canReadCrm, canWriteCrm, labelOf } from '@/lib/crm';
import { crmVehicle, crmList, crmEvents, bookingInvoices, crmGarages } from '@/lib/crm-data';
import { rest } from '@/lib/rest';
import { demoPeriods } from '@/lib/demo';
import { PageHeader, Notice, FleetTable } from '@/components/ui';
import { ProfileEditor, TaskForm, DocumentForm } from '@/components/CrmForms';
import { DocumentRows, TaskCards } from '@/components/CrmViews';
import { BookingForm } from '@/components/MaintenanceForms';

export default async function VehicleRecord({params}:{params:Promise<{id:string}>}){
 const ctx=await getContext();if(!ctx)redirect('/login');if(!canReadCrm(ctx))redirect(homeFor(ctx));
 const {id}=await params;let vehicle;try{vehicle=await crmVehicle(ctx,id);}catch{notFound();}if(!vehicle)notFound();
 const [tasks,contactPage,docs,events,garages]=await Promise.all([crmList(ctx,'tasks',{vehicle:id}),crmList(ctx,'contacts',{fleet:vehicle.fleet_id}),crmList(ctx,'documents',{vehicle:id}),crmEvents(ctx,id),crmGarages(ctx,vehicle.fleet_id)]);
 const contacts={rows:[...new Map([...contactPage.rows,...garages].map(c=>[c.id,c])).values()]};
 // Coverage is read from the existing insurance records; CRM never writes to them.
 const cover=ctx.demo?demoPeriods.filter(v=>v.id===id):(await rest<Parameters<typeof normalisePeriod>[0][]>('/rest/v1/coverage_periods?select=*,vehicle:vehicles!inner(registration,make_model)&vehicle_id=eq.'+id+'&voided_at=is.null&order=cover_start.desc,id.desc&limit=25')).map(normalisePeriod);
 const disabled=!canWriteCrm(ctx),fleets=ctx.orgs.filter(o=>o.kind==='customer'),props={fleets,fleet:vehicle.fleet_id,vehicle,disabled};
 const invoices=await bookingInvoices(ctx,tasks.rows);
 return <><PageHeader title={vehicle.registration} subtitle={(vehicle.make_model||'Vehicle record')+' · '+orgName(ctx,vehicle.fleet_id)} actions={<Link prefetch={false} className="button-link" href={'/crm?view=vehicles&fleet='+vehicle.fleet_id}>← Vehicles</Link>}/><Notice>Availability and maintenance records do not change insurance cover. Dates below are recorded by your team; no live MOT, tax or telematics checks are performed.</Notice><section className="panel panel-body"><h2>Vehicle details</h2><ProfileEditor vehicle={vehicle} disabled={disabled}/></section><section className="panel"><div className="panel-header"><h2>Insurance history</h2><span className="muted">Latest 25 periods</span></div><FleetTable ctx={ctx} rows={cover}/></section><section className="panel panel-body"><h2>Tasks and maintenance</h2><p className="form-note">Latest page of {tasks.total} linked tasks. <Link href={'/crm?view=tasks&fleet='+vehicle.fleet_id} prefetch={false}>See all fleet tasks →</Link></p><TaskCards rows={tasks.rows} contacts={contacts.rows} disabled={disabled} invoices={invoices} demo={ctx.demo}/><details className="crm-disclosure"><summary>＋ Book maintenance</summary><BookingForm {...props} contacts={contacts.rows}/></details><details className="crm-disclosure"><summary>＋ Create linked task</summary><TaskForm {...props} contacts={contacts.rows}/></details></section><section className="panel"><div className="panel-header"><h2>Vehicle documents</h2><span className="muted">Latest 25 files</span></div><DocumentRows ctx={ctx} rows={docs.rows}/><details className="crm-disclosure panel-body"><summary>＋ Upload document</summary><DocumentForm {...props}/></details></section><section className="panel panel-body"><h2>Vehicle timeline</h2><p className="form-note">Latest 25 CRM changes. Insurance periods are shown above.</p><div className="timeline">{events.map(e=><div className="event" key={e.id}><strong>{labelOf(e.entity_type.replace('crm_',''))} · {labelOf(e.action)}</strong><p>{new Date(e.occurred_at).toLocaleString('en-GB',{timeZone:'Europe/London'})}</p><p>{String(e.after_state.title||e.after_state.notes||e.after_state.operational_status||'Record updated')}</p></div>)}{!events.length&&<p>No operational changes recorded yet.</p>}</div></section></>;
}
