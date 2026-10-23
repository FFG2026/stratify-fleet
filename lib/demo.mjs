export const demo = {
  organisations: [{id:'demo-insurer',name:'Meridian Insurance (demo)',kind:'insurer'},{id:'demo-customer',name:'Northfield Logistics (demo)',kind:'customer'}],
  policies: [{id:'demo-policy',reference:'DEMO-FLT-2026-001',customer_id:'demo-customer',insurer_id:'demo-insurer',starts_on:'2026-01-01',ends_on:'2027-01-01'}],
  coverage_periods: Array.from({length:72},(_,i)=>({id:'demo-'+i,policy_id:'demo-policy',registration:'DEMO'+String(i+1).padStart(3,'0'),make:i%3?'Ford':'Mercedes-Benz',model:i%3?'Transit Custom':'Sprinter',starts_on:i%7===0?'2026-10-12':'2026-01-01',ends_on:i%11===0?'2026-10-19':null,submission_status:'not_connected'})),
  audit_events:[{id:'demo-event',action:'coverage_added',created_at:'2026-10-12T09:30:00Z',registration:'DEMO001'}]
};
