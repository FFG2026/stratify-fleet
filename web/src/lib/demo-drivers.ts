import { demoOrgs } from './demo';
import { today } from './dates';
import type { DriverFile, DriverRow } from './data';

// Generated in memory only; no real driver, file or licence-check service is accessed.
export function demoDriverFiles():DriverFile[]{
 const date=today(),base=Date.parse(date+'T12:00:00Z'),day=(n:number)=>new Date(base+n*86400000).toISOString().slice(0,10),stamp=day(-10)+'T10:00:00Z';
 const names=['Alex Morgan','Jamie Taylor','Sam Carter','Jordan Ellis','Casey Brooks','Riley Hughes'];
 return demoOrgs.filter(o=>o.kind==='customer').flatMap((fleet,f)=>names.map((name,i)=>{
  const user_id='d0000000-0000-4000-8000-'+String(f*6+i+1).padStart(12,'0');
  return {
   profile:{user_id,fleet_id:fleet.id,full_name:name,date_of_birth:`${1984+i}-05-12`,licence_number:'DEMO RECORD ONLY',phone:null,no_claims_declared_at:i===2?null:stamp,no_convictions_declared_at:stamp,updated_at:stamp},
   docs:(i===1?['licence_front']:['licence_front','licence_back','right_to_work']).map((kind,d)=>({id:user_id+'-doc-'+d,user_id,kind,file_name:kind.replaceAll('_','-')+'-example.pdf',content_type:'application/pdf',size_bytes:120000,uploaded_at:stamp,expires_on:day(300)})),
   consents:['licence_check','data_sharing'].map(kind=>({user_id,kind,given:i!==1,version:'demo',recorded_at:stamp})),
   records:[{id:user_id+'-job',user_id,kind:'employment' as const,title:fleet.name,detail:'Delivery driver — fictional demonstration',start_date:day(i===1?-180:-1500),end_date:null,amount:null,at_fault:null,points:null},...(i===2?[{id:user_id+'-claim',user_id,kind:'claim' as const,title:'Minor reversing damage — fictional',detail:'Example bumper repair. No injuries.',start_date:day(-120),end_date:null,amount:450,at_fault:true,points:null}]:[])],
   codes:[],checks:i===1?[]:[{id:user_id+'-check',checked_at:stamp,checked_by_email:'demo@example.invalid',status:'valid',points:0,entitlements:'B · Example only',endorsements:'None — fictional example',notes:'Demonstration result. No DVLA check was performed.',next_check_due:day(i===3?-1:170)}]
  };
 }));
}
export function demoDriverFile(id:string):DriverFile|null{return demoDriverFiles().find(f=>f.profile?.user_id===id)||null;}
export function demoDriverList({q='',fleet,offset=0,limit=25}:{q?:string;fleet?:string;offset?:number;limit?:number}){
 const files=demoDriverFiles().filter(f=>(!fleet||f.profile!.fleet_id===fleet)&&f.profile!.full_name.toLowerCase().includes(q.trim().toLowerCase())).sort((a,b)=>a.profile!.full_name.localeCompare(b.profile!.full_name));
 const rows:DriverRow[]=files.slice(offset,offset+limit).map(f=>({...f.profile!,lastCheck:f.checks[0]||null,docKinds:f.docs.map(d=>d.kind),licenceCheck:f.consents.some(c=>c.kind==='licence_check'&&c.given),dataSharing:f.consents.some(c=>c.kind==='data_sharing'&&c.given),jobs:f.records.filter(r=>r.kind==='employment'),claims:f.records.filter(r=>r.kind==='claim').length,convictions:0}));
 return{rows,total:files.length};
}
