'use client';
import { useState } from 'react';
import { useAction } from './useAction';
import { createBooking, saveBooking, addDocument } from '@/app/(app)/crm/actions';
import { bookingLabel, nextBookingStages, taskCategories, labelOf, type Task, type Contact, type CrmVehicle } from '@/lib/crm';

type Props={fleets:{id:string;name:string}[];fleet:string;contacts:Contact[];disabled:boolean;vehicle?:CrmVehicle};
function Outcome({result}:{result:{ok:boolean;message:string}|null}){return <p role="status" aria-live="polite" className={'form-note'+(result&&!result.ok?' form-error':'')}>{result?.message}</p>;}
function BookingFields({task,contacts,stage,setStage}:{task?:Task;contacts:Contact[];stage:string;setStage:(s:string)=>void}){
 const garages=contacts.filter(c=>c.kind==='garage'&&c.active);
 return <><div className="form-grid">
  <label>Booking stage<select name="booking_stage" value={stage} onChange={e=>setStage(e.target.value)}>{nextBookingStages(task?.booking_stage).map(s=><option value={s} key={s}>{bookingLabel(s)}</option>)}</select></label>
  <label>Garage<select name="supplier_id" required defaultValue={task?.supplier_id||''}><option value="">Select a garage</option>{task?.supplier_id&&!garages.some(c=>c.id===task.supplier_id)&&<option value={task.supplier_id}>Current garage (outside this contact page)</option>}{garages.map(c=><option key={c.id} value={c.id}>{c.company||c.name} · {c.name}</option>)}</select></label>
  <label>Appointment date<input name="appointment_on" type="date" required defaultValue={task?.appointment_on||task?.due_on||''}/></label>
  <label>Expected return date<input name="expected_return_on" type="date" required defaultValue={task?.expected_return_on||task?.due_on||''}/></label>
  <label>Estimated cost (£)<input name="estimated_cost" type="number" min="0" max="10000000" step="0.01" defaultValue={task?.estimated_cost??''}/></label>
  <label>Actual cost (£){stage==='completed'?' *':''}<input name="cost" type="number" min="0" max="10000000" step="0.01" required={stage==='completed'} defaultValue={task?.cost??''}/></label>
 </div><div className="maintenance-options"><label><input type="checkbox" name="taken_off_road" defaultChecked={task?.taken_off_road}/> Take off road before check-in</label><label><input type="checkbox" name="approval_required" defaultChecked={task?.approval_required}/> Awaiting approval</label></div>
 <p className="form-note">Booked vehicles remain available until check-in unless taken off road. The approval flag tracks work awaiting a decision; fleet managers can resolve it.</p>
 {stage==='completed'&&<fieldset className="maintenance-completion"><legend>Confirm collection</legend><div className="form-grid">
  <label>Collection mileage<input name="completion_mileage" type="number" min="0" max="5000000" step="1" required/></label>
  <label>Next service date (optional)<input name="next_service_on" type="date"/></label>
  <label>Next service mileage (optional)<input name="next_service_mileage" type="number" min="0" max="5000000" step="1"/></label>
 </div><p className="form-note">Mileage and any next-service values entered here update the vehicle record when collection is confirmed.</p></fieldset>}
 <label>Work notes<textarea name="detail" rows={3} maxLength={4000} defaultValue={task?.detail||''}/></label></>;
}
export function BookingForm({fleets,fleet,contacts,disabled,vehicle}:Props){
 const [stage,setStage]=useState('booked'),[chosenFleet,setFleet]=useState(vehicle?.fleet_id||fleet);
 const {pending,result,onSubmit}=useAction(createBooking,true,()=>setStage('booked'));
 return <form onSubmit={onSubmit}><fieldset disabled={disabled||pending}>
 <div className="form-grid">{vehicle?<><input type="hidden" name="fleet_id" value={vehicle.fleet_id}/><input type="hidden" name="vehicle_id" value={vehicle.id}/></>:<><label>Fleet<select name="fleet_id" value={chosenFleet} onChange={e=>setFleet(e.target.value)} required><option value="">Select fleet</option>{fleets.map(f=><option key={f.id} value={f.id}>{f.name}</option>)}</select></label><label>Vehicle registration<input name="registration" maxLength={12} required placeholder="AB26 CDE"/></label></>}
 <label>Job title<input name="title" required maxLength={200} placeholder="Annual service and brake inspection"/></label>
 <label>Maintenance type<select name="category" defaultValue="service">{taskCategories.filter(c=>c!=='task').map(c=><option key={c} value={c}>{labelOf(c)}</option>)}</select></label>
 <label>Priority<select name="priority" defaultValue="normal">{['low','normal','high','urgent'].map(p=><option value={p} key={p}>{labelOf(p)}</option>)}</select></label>
 <input type="hidden" name="assignee_id" value=""/>
 </div><BookingFields key={chosenFleet} contacts={contacts.filter(c=>c.fleet_id===chosenFleet)} stage={stage} setStage={setStage}/>
 <p className="form-note">Add the garage under Contacts first. Only active garage contacts in the chosen fleet are shown.</p><button className="primary">Create maintenance booking</button></fieldset><Outcome result={result}/></form>;
}
export function BookingUpdate({task,contacts,disabled}:{task:Task;contacts:Contact[];disabled:boolean}){
 const {pending,result,onSubmit}=useAction(saveBooking,false),[stage,setStage]=useState<string>(task.booking_stage||'booked');
 if(['completed','cancelled'].includes(task.status))return <p className="form-note">{task.completed_on?'Collected '+task.completed_on+'. ':''}{task.completion_mileage!=null?'Mileage: '+task.completion_mileage.toLocaleString('en-GB')+'. ':''}This job is closed.</p>;
 return <form onSubmit={onSubmit}><input type="hidden" name="id" value={task.id}/><input type="hidden" name="updated_at" value={task.updated_at}/><fieldset disabled={disabled||pending}><BookingFields task={task} contacts={contacts.filter(c=>c.fleet_id===task.fleet_id)} stage={stage} setStage={setStage}/><button className="primary">{task.booking_stage?'Save booking':'Set up booking for this job'}</button></fieldset><Outcome result={result}/></form>;
}
export function InvoiceForm({task,disabled}:{task:Task;disabled:boolean}){
 const {pending,result,onSubmit}=useAction(addDocument);
 return <form onSubmit={onSubmit}><fieldset disabled={disabled||pending}><input type="hidden" name="fleet_id" value={task.fleet_id}/><input type="hidden" name="vehicle_id" value={task.vehicle_id||''}/><input type="hidden" name="task_id" value={task.id}/><input type="hidden" name="title" value={'Invoice · '+task.title}/><label>Invoice PDF or photo (up to 4 MB)<input type="file" name="file" required accept="application/pdf,image/jpeg,image/png,image/webp"/></label><button>Upload invoice</button></fieldset><Outcome result={result}/></form>;
}
