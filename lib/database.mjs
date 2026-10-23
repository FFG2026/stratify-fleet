import {parseDate} from './coverage.mjs';
export function londonDate(iso) {
 return new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/London',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(iso));
}
export function londonMidnight(value) {
 const timestamp=parseDate(value);
 const atMidnightUTC=new Date(timestamp);
 const parts=new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/London',timeZoneName:'shortOffset'}).formatToParts(atMidnightUTC);
 const offset=parts.find(p=>p.type==='timeZoneName').value==='GMT+1'?3600000:0;
 return new Date(timestamp-offset).toISOString();
}
export function nextDate(value){return new Date(parseDate(value)+86400000).toISOString().slice(0,10);}
export function normaliseWorkspace({organisations,policies,vehicles,coverage_periods,audit_logs,memberships}){
 const byId=new Map(vehicles.map(v=>[v.id,v]));
 return {
  memberships,
  organisations:organisations.map(o=>({...o,kind:o.kind==='fleet'?'customer':o.kind})),
  policies:policies.map(p=>({...p,reference:p.policy_number,customer_id:p.fleet_id,starts_on:p.valid_from,ends_on:p.valid_to?nextDate(p.valid_to):null})),
  coverage_periods:coverage_periods.filter(c=>!c.voided_at).map(c=>({...c,registration:byId.get(c.vehicle_id)?.registration||'Unknown',make:byId.get(c.vehicle_id)?.make_model||'',model:'',starts_on:londonDate(c.cover_start),ends_on:c.cover_end?londonDate(c.cover_end):null,submission_status:'not_connected'})),
  audit_events:audit_logs.map(a=>({...a,registration:a.after_state?.registration||a.before_state?.registration||a.entity_type,created_at:a.occurred_at}))
 };
}

export function normaliseCoverage(rows){
 return rows.filter(c=>!c.voided_at).map(c=>({
  ...c,registration:c.vehicle?.registration||'Unknown',make:c.vehicle?.make_model||'',model:'',
  starts_on:londonDate(c.cover_start),ends_on:c.cover_end?londonDate(c.cover_end):null,submission_status:'not_connected'
 }));
}
