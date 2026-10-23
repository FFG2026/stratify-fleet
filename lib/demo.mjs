// Synthetic prototype records only. Never contains connected Supabase data.
const insurers=[{id:'alder',name:'Alder Mutual'},{id:'north',name:'Northstar Assurance'},{id:'haven',name:'Haven Commercial'}];
const fleets=[{id:'atlas',name:'Atlas Logistics',insurer:'alder',n:600},{id:'swift',name:'Swiftline Couriers',insurer:'alder',n:180},{id:'meridian',name:'Meridian Transport',insurer:'north',n:420},{id:'oak',name:'Oak & Co Services',insurer:'haven',n:85}];
const models=['Ford Transit 350','Mercedes-Benz Sprinter','Volkswagen Crafter','Vauxhall Movano','Renault Master'];
export const demo={
 organisations:[...insurers.map(o=>({...o,kind:'insurer'})),...fleets.map(f=>({id:f.id,name:f.name,kind:'customer',insurer_id:f.insurer}))],
 policies:fleets.map((f,i)=>({id:'demo-policy-'+f.id,reference:'FLT-'+(28491+i),customer_id:f.id,insurer_id:f.insurer,starts_on:'2026-01-01',ends_on:'2027-01-01'})),
 coverage_periods:fleets.flatMap((f,fi)=>Array.from({length:f.n},(_,i)=>({
  id:f.id+'-'+i,policy_id:'demo-policy-'+f.id,
  registration:`${['BX','LM','NK','YH'][fi]}${22+i%5} ${String.fromCharCode(65+Math.floor(i/676)%26,65+Math.floor(i/26)%26,65+i%26)}`,
  make:models[i%5],model:'',depot:['Birmingham','Manchester','Bristol'][i%3],
  starts_on:i<12?'2026-09-15':'2026-09-01',ends_on:i>=12&&i<20?'2026-09-21':null,
  submission_status:'not_connected'
 }))),
 audit_events:fleets.flatMap((f,i)=>[{id:f.id+'-add',registration:f.name,action:'12_vehicles_added',created_at:'2026-09-15T08:00:00Z'},{id:f.id+'-remove',registration:f.name,action:'8_vehicles_removed',created_at:'2026-09-20T08:00:00Z'}]),
 memberships:[]
};
