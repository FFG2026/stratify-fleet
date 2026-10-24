import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getContext, homeFor, orgName } from '@/lib/data';
import { crmVehicles, crmList, crmSummary, crmDue, selectedFleet, bookingSummary, bookingInvoices, crmGarages, type CrmParams } from '@/lib/crm-data';
import { canReadCrm, canWriteCrm, labelOf, pageOffset, taskStatuses, bookingStages, bookingLabel } from '@/lib/crm';
import { PageHeader, Stats, Badge, Notice, Pagination } from '@/components/ui';
import { ContactForm, TaskForm, DocumentForm } from '@/components/CrmForms';
import { CalendarList, DocumentRows, TaskCards } from '@/components/CrmViews';
import { ParamSelect } from '@/components/ParamSelect';
import { BookingForm } from '@/components/MaintenanceForms';

const tabs=[['overview','Overview'],['vehicles','Vehicles'],['tasks','Tasks'],['maintenance','Maintenance'],['calendar','Calendar'],['contacts','Contacts'],['documents','Documents']];
export default async function FleetCrm({searchParams}:{searchParams:Promise<CrmParams>}){
 const ctx=await getContext();if(!ctx)redirect('/login');if(!canReadCrm(ctx))redirect(homeFor(ctx));
 const p=await searchParams,view=tabs.some(([v])=>v===p.view)?p.view!:'overview',fleet=selectedFleet(ctx,p),fleets=ctx.orgs.filter(o=>o.kind==='customer'),disabled=!canWriteCrm(ctx);
 if(fleet&&!fleets.some(f=>f.id===fleet))return <Notice alert>That fleet is not available in your workspace.</Notice>;
 const base=new URLSearchParams();for(const [k,v]of Object.entries(p))if(v)base.set(k,v);base.set('view',view);
 const link=(v:string)=>'/crm?'+new URLSearchParams({view:v,...(fleet?{fleet}:{})});
 const formProps={fleets,fleet,disabled};
 let body;
 try{
 if(view==='overview'){
  const [s,due]=await Promise.all([crmSummary(ctx,fleet),crmDue(ctx,fleet)]);
  body=<><Stats items={[
   ['Vehicles',s.vehicles,'Your operational fleet',link('vehicles')],['Unavailable',s.offRoad,'Off road or in maintenance',link('vehicles')],['Open tasks',s.open,'Work requiring action',link('tasks')],['Overdue tasks',s.overdue,'Dated work past its deadline',link('tasks')+'&due=overdue']
  ]}/><div className="crm-intro"><div><span className="eyebrow">Your fleet, organised</span><h2>Know what needs doing. Keep every vehicle moving.</h2><p>Keep records, documents and work together. Availability is separate from insurance cover.</p></div><Link className="button-link primary" prefetch={false} href={link('tasks')+'#new-task'}>＋ Create task</Link></div>{due.limited&&<Notice>This view reached its 500-record limit in one or more sources. Choose a fleet to narrow the results.</Notice>}<CalendarList items={due.items} ctx={ctx} base={base}/><div className="crm-shortcuts">{[['vehicles','Vehicle records','MOT, tax, mileage, servicing and lease details.'],['maintenance','Maintenance board','Follow repairs from an open job to completion.'],['contacts','Your fleet network','Managers, garages, recovery and leasing contacts.']].map(([v,title,note])=><Link className="panel panel-body" prefetch={false} href={link(v)} key={v}><h2>{title} →</h2><p>{note}</p></Link>)}</div></>;
 }else if(view==='vehicles'){
  const page=await crmVehicles(ctx,{...p,fleet});
  body=<section className="panel"><div className="panel-header"><h2>Vehicle records</h2><span className="muted">Unknown availability means no operational profile has been saved.</span></div><div className="table-scroll"><table><thead><tr><th>Vehicle</th><th>Fleet / depot</th><th>Availability</th><th>Mileage</th><th>Next dates</th><th></th></tr></thead><tbody>{page.rows.map(v=><tr key={v.id}><td><strong className="registration">{v.registration}</strong><span className="subtext">{v.make_model}</span></td><td>{orgName(ctx,v.fleet_id)}<span className="subtext">{v.profile?.depot||'Depot not set'}</span></td><td><Badge warn={!!v.availability&&v.availability!=='available'}>{v.availability?labelOf(v.availability):'Not recorded'}</Badge></td><td>{v.profile?.mileage?.toLocaleString('en-GB')??'—'}</td><td>MOT: {v.profile?.mot_due||'Not recorded'}<span className="subtext">Service: {v.profile?.service_due||'Not recorded'}</span></td><td><Link prefetch={false} className="textbtn" href={'/crm/vehicles/'+v.id}>Open record →</Link></td></tr>)}</tbody></table></div>{!page.total&&<div className="empty">No vehicles match. Add insured vehicles through Manage cover.</div>}<Pagination total={page.total} offset={page.offset} base={base}/></section>;
 }else if(view==='contacts'){
  const page=await crmList(ctx,'contacts',{...p,fleet});
  body=<><section className="panel"><div className="table-scroll"><table><thead><tr><th>Contact</th><th>Type</th><th>Fleet</th><th>Email / phone</th><th>Notes</th></tr></thead><tbody>{page.rows.map(c=><tr key={c.id}><td><strong>{c.name}</strong><span className="subtext">{c.company}</span></td><td>{labelOf(c.kind)}</td><td>{orgName(ctx,c.fleet_id)}</td><td>{c.email?<a href={'mailto:'+c.email}>{c.email}</a>:'—'}<span className="subtext">{c.phone}</span></td><td className="crm-note-cell">{c.notes||'—'}</td></tr>)}</tbody></table></div>{!page.total&&<div className="empty">No contacts yet.</div>}<Pagination total={page.total} offset={page.offset} base={base}/></section><section className="panel panel-body"><h2>Add a contact</h2><ContactForm {...formProps}/></section></>;
  body=<>{body}{!disabled&&page.rows.map(c=><details className="panel panel-body crm-disclosure" key={c.id}><summary>Edit contact: {c.name}</summary><ContactForm {...formProps} contact={c}/></details>)}</>;
 }else if(view==='documents'){
  const page=await crmList(ctx,'documents',{...p,fleet});body=<><section className="panel"><DocumentRows ctx={ctx} rows={page.rows}/><Pagination total={page.total} offset={page.offset} base={base}/></section><section className="panel panel-body"><h2>Upload document</h2><p>Private files for this fleet, with optional vehicle and expiry date.</p><DocumentForm {...formProps}/></section></>;
 }else if(view==='calendar'){
  const due=await crmDue(ctx,fleet);body=<>{due.limited&&<Notice>The calendar reached its record limit. Select a fleet to narrow the results.</Notice>}<Notice>These are in-portal reminders. Email, SMS and push notifications are not enabled.</Notice><CalendarList ctx={ctx} items={due.items} offset={pageOffset(p.offset)} base={base}/></>;
 }else if(view==='maintenance'){
  const [page,contactPage,s,garages]=await Promise.all([crmList(ctx,'tasks',{...p,fleet,category:'maintenance'}),crmList(ctx,'contacts',{fleet}),bookingSummary(ctx,fleet),crmGarages(ctx,fleet)]);
  const contacts={rows:[...new Map([...contactPage.rows,...garages].map(c=>[c.id,c])).values()]};
  const invoices=await bookingInvoices(ctx,page.rows);
  const cards=(rows:typeof page.rows)=><TaskCards rows={rows} contacts={contacts.rows} disabled={disabled} invoices={invoices} demo={ctx.demo}/>;
  body=<><Stats items={[
   ['Booked',s.booked,'Upcoming garage visits',link('maintenance')+'&stage=booked'],['In garage',s.inGarage,'Checked in through collection',link('maintenance')],['Overdue back',s.late,'Past the expected return date',link('maintenance')+'&back=1'],['Awaiting approval',s.approval,'Jobs waiting for a decision',link('maintenance')+'&approval=1']
  ]}/><div className="crm-intro"><div><span className="eyebrow">Maintenance bookings</span><h2>From the garage booking to the keys back.</h2><p>Book ahead, check in, track the work and confirm collection. Insurance cover is unchanged.</p></div><a className="button-link primary" href="#new-booking">＋ Book maintenance</a></div>
  <div className="filters"><ParamSelect name="stage" label="Booking stage" value={p.stage||''} options={[{value:'',label:'All stages'},...bookingStages.map(s=>({value:s,label:bookingLabel(s)})),{value:'legacy',label:'Existing maintenance tasks'}]}/><ParamSelect name="back" label="Expected return" value={p.back||''} options={[{value:'',label:'Any return date'},{value:'1',label:'Overdue back'}]}/><ParamSelect name="approval" label="Approval" value={p.approval||''} options={[{value:'',label:'All jobs'},{value:'1',label:'Awaiting approval'}]}/></div>
  <p className="form-note">Board shows this page of {page.total} matching jobs. Use filters and pagination to see more. Booked vehicles stay available until check-in or an explicit off-road flag.</p>
  <div className="crm-board maintenance-board">{bookingStages.map(s=><section key={s} className="crm-board-column"><h2>{bookingLabel(s)}</h2>{cards(page.rows.filter(t=>t.booking_stage===s))}</section>)}</div>
  {page.rows.some(t=>!t.booking_stage)&&<section className="panel panel-body"><h2>Existing maintenance tasks</h2><p>These retain their current availability rules. Open a task below to set up its booking and garage details.</p>{cards(page.rows.filter(t=>!t.booking_stage))}</section>}
  {invoices.length===100&&<Notice>Showing the latest 100 invoice files across this page. Use All vehicle documents to find older files.</Notice>}<Pagination total={page.total} offset={page.offset} base={base}/>
  <section className="panel panel-body" id="new-booking"><h2>Book maintenance</h2><BookingForm {...formProps} contacts={contacts.rows}/></section></>;
 }else{
  const [page,contactPage,garages]=await Promise.all([crmList(ctx,'tasks',{...p,fleet}),crmList(ctx,'contacts',{fleet}),crmGarages(ctx,fleet)]);
  const contacts={rows:[...new Map([...contactPage.rows,...garages].map(c=>[c.id,c])).values()]};
  const invoices=await bookingInvoices(ctx,page.rows);
  body=<><div className="filters"><ParamSelect name="status" label="Task status" value={p.status||''} options={[{value:'',label:'All statuses'},...taskStatuses.map(s=>({value:s,label:labelOf(s)}))]}/><ParamSelect name="due" label="Due work" value={p.due||''} options={[{value:'',label:'Any date'},{value:'overdue',label:'Overdue'},{value:'upcoming',label:'Overdue + next 30 days'}]}/></div><TaskCards rows={page.rows} contacts={contacts.rows} disabled={disabled} invoices={invoices} demo={ctx.demo}/><Pagination total={page.total} offset={page.offset} base={base}/><section id="new-task" className="panel panel-body"><h2>Create a task or maintenance job</h2><p>Assign a fleet contact, supplier and due date. Contacts shown are the first 25 for the selected fleet.</p><TaskForm {...formProps} contacts={contacts.rows}/></section></>;
 }
 }catch(e){body=<Notice alert>{e instanceof Error?e.message:'Unable to load fleet CRM.'}</Notice>;}
 return <><PageHeader title="Fleet CRM" subtitle="Your vehicles, people and work. Connected." actions={<Link prefetch={false} className="button-link" href={link('calendar')}>View calendar →</Link>}/><nav className="crm-tabs" aria-label="Fleet CRM sections">{tabs.map(([v,label])=><Link prefetch={false} key={v} href={link(v)} className={view===v?'active':''} aria-current={view===v?'page':undefined}>{label}</Link>)}</nav><div className="filters"><ParamSelect name="fleet" label="Fleet" value={fleet} resetParams={['offset','policy']} options={[{value:'',label:'All authorised fleets'},...fleets.map(f=>({value:f.id,label:f.name}))]}/>{!['overview','calendar'].includes(view)&&<form method="get" className="crm-search"><input type="hidden" name="view" value={view}/><input type="hidden" name="fleet" value={fleet}/><label>Search<input name="q" type="search" maxLength={80} defaultValue={p.q||''} placeholder={view==='vehicles'?'Registration or vehicle':view==='contacts'?'Name, company or email':'Title'}/></label><button>Search</button></form>}</div>{disabled&&<p className="form-note">{ctx.demo?'Explore the fictional fleet records below. Demo changes are disabled.':'You have read-only access to Fleet CRM.'}</p>}{body}</>;
}
