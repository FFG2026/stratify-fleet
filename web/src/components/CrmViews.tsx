import Link from 'next/link';
import { Badge, Pagination } from './ui';
import { TaskUpdate } from './CrmForms';
import { BookingUpdate, InvoiceForm } from './MaintenanceForms';
import { labelOf, bookingLabel, overdueBack, dueState, type Task, type Contact, type CrmDocument, type DueItem } from '@/lib/crm';
import { today } from '@/lib/dates';
import { orgName } from '@/lib/data';
import type { Context } from '@/lib/types';

export const money=(n:number|string|null)=>n===null?'—':new Intl.NumberFormat('en-GB',{style:'currency',currency:'GBP'}).format(Number(n));
export function TaskCards({rows,contacts,disabled,invoices=[],demo=false}:{rows:Task[];contacts:Contact[];disabled:boolean;invoices?:CrmDocument[];demo?:boolean}){
 return <div className="crm-task-list">{!rows.length&&<div className="empty">No tasks match this view.</div>}{rows.map(t=><article className="crm-task-card" key={t.id}>
  <div className="crm-task-heading"><div><span className="eyebrow">{labelOf(t.category)} · {labelOf(t.priority)}</span><h3>{t.title}</h3><p className="subtext">Due {t.due_on||'not set'} · {contacts.find(c=>c.id===t.assignee_id)?.name||'Unassigned / contact outside this page'}</p></div><Badge warn={t.status==='awaiting_approval'||(!['completed','cancelled'].includes(t.status)&&!!t.due_on&&t.due_on<today())}>{labelOf(t.status)}</Badge></div>
  <p className="subtext">Supplier: {contacts.find(c=>c.id===t.supplier_id)?.company||'Not selected / contact outside this page'} · Recorded cost: {money(t.cost)}</p>
  {t.vehicle_id&&<Link prefetch={false} className="textbtn" href={'/crm/vehicles/'+t.vehicle_id}>Open vehicle →</Link>}
  {t.booking_stage?<BookingCard task={t} contacts={contacts} disabled={disabled} invoices={invoices.filter(d=>d.task_id===t.id)} demo={demo}/>:<><TaskUpdate task={t} disabled={disabled}/>{t.category!=='task'&&t.vehicle_id&&!['completed','cancelled'].includes(t.status)&&<details className="crm-disclosure"><summary>Set up a garage booking →</summary><BookingUpdate task={t} contacts={contacts} disabled={disabled}/></details>}</>}
 </article>)}</div>;
}
function BookingCard({task:t,contacts,disabled,invoices,demo}:{task:Task;contacts:Contact[];disabled:boolean;invoices:CrmDocument[];demo:boolean}){
 return <div className="maintenance-booking"><div className="maintenance-flags"><Badge>{bookingLabel(t.booking_stage!)}</Badge>{overdueBack(t,today())&&<Badge warn>Overdue back</Badge>}{t.approval_required&&!['completed','cancelled'].includes(t.status)&&<Badge warn>Awaiting approval</Badge>}</div>
 <p><strong>{t.vehicle?.registration||'Linked vehicle'}</strong></p><dl className="maintenance-facts"><div><dt>Appointment</dt><dd>{t.appointment_on||'—'}</dd></div><div><dt>Expected back</dt><dd>{t.expected_return_on||'—'}</dd></div><div><dt>Estimate</dt><dd>{money(t.estimated_cost??null)}</dd></div><div><dt>Actual cost</dt><dd>{money(t.cost)}</dd></div></dl>
 {['completed','cancelled'].includes(t.status)?<BookingUpdate task={t} contacts={contacts} disabled={disabled}/>:<details className="crm-disclosure"><summary>Update booking →</summary><BookingUpdate key={t.updated_at} task={t} contacts={contacts} disabled={disabled}/></details>}
 <div className="maintenance-invoices"><strong>Invoices</strong>{invoices.map(d=><p key={d.id}>{demo?<span className="muted">{d.file_name} · Example record</span>:<a href={'/crm/file/'+d.id} target="_blank" rel="noreferrer">{d.file_name} ↗</a>}</p>)}{!invoices.length&&<p className="subtext">No invoice shown.</p>}<Link prefetch={false} className="textbtn" href={'/crm?view=documents&fleet='+t.fleet_id+'&vehicle='+t.vehicle_id}>All vehicle documents →</Link><details className="crm-disclosure"><summary>＋ Attach invoice</summary><InvoiceForm task={t} disabled={disabled}/></details></div></div>;
}
export function DocumentRows({ctx,rows}:{ctx:Context;rows:CrmDocument[]}){return <><div className="table-scroll"><table><thead><tr><th>Document</th><th>Fleet</th><th>Expiry</th><th>File</th></tr></thead><tbody>{rows.map(d=><tr key={d.id}><td><strong>{d.title}</strong><span className="subtext">{d.file_name}</span></td><td>{orgName(ctx,d.fleet_id)}</td><td>{d.expires_on||'No expiry'}{d.expires_on&&<span className="subtext">{dueState(d.expires_on,today())}</span>}</td><td>{ctx.demo?<span className="muted">Example record</span>:<a className="textbtn" href={'/crm/file/'+d.id} target="_blank" rel="noreferrer">Open securely ↗</a>}</td></tr>)}</tbody></table></div>{!rows.length&&<div className="empty">No documents yet.</div>}</>;}
export function CalendarList({items,ctx,offset=0,base}:{items:DueItem[];ctx:Context;offset?:number;base:URLSearchParams}){
 return <section className="panel"><div className="panel-header"><h2>Overdue and next 30 days</h2><Badge>{items.length} due items</Badge></div><div className="panel-body crm-calendar">{items.slice(offset,offset+25).map(i=><Link prefetch={false} href={i.href} key={i.id} className="crm-calendar-item"><time dateTime={i.due_on}>{new Date(i.due_on+'T12:00:00Z').toLocaleDateString('en-GB',{day:'numeric',month:'short'})}</time><div><strong>{i.title}</strong><span className="subtext">{orgName(ctx,i.fleet_id)} · {i.source}</span></div><Badge warn={i.due_on<today()}>{dueState(i.due_on,today())}</Badge></Link>)}{!items.length&&<p>No overdue or upcoming dated work.</p>}</div><Pagination total={items.length} offset={offset} base={base}/></section>;
}
