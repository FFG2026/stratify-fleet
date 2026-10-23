import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {readFile} from 'node:fs/promises';
import {insuredDays,csv} from '../lib/coverage.mjs';
process.env.SUPABASE_URL='https://unit.supabase.invalid';
process.env.SUPABASE_PUBLISHABLE_KEY='test-publishable';
process.env.APP_ORIGIN='http://localhost:3000';
process.env.DEMO_MODE='false';
const {makeServer}=await import('../server.mjs');
const server=makeServer();
const f1='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',f2='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',ins='cccccccc-cccc-4ccc-8ccc-cccccccccccc',ins2='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const headers={cookie:'stratify=test-session',origin:'http://localhost:3000'};
function request(path,requestHeaders=headers){
 return new Promise(resolve=>{
  const req=Readable.from([]);Object.assign(req,{url:path,method:'GET',headers:requestHeaders});
  const res={headers:{},headersSent:false,setHeader(k,v){this.headers[k]=v;},writeHead(status,h){this.status=status;Object.assign(this.headers,h);this.headersSent=true;},end(text){resolve({status:this.status,json:()=>JSON.parse(text)});}};
  server.emit('request',req,res);
 });
}
function stub(){
 const calls=[],real=globalThis.fetch;
 globalThis.fetch=async(url,options)=>{
  calls.push(url);
  if(url.includes('/auth/v1/user'))return new Response(JSON.stringify({id:'11111111-1111-4111-8111-111111111111',email:'a@example.invalid',email_confirmed_at:'2026-10-23T12:00:00Z'}));
  if(url.includes('/rest/v1/fleet_overview'))return new Response(JSON.stringify([{fleet_id:f1,fleet_name:'Fleet One',insurer_id:ins,vehicles_total:600,vehicles_on_cover:560,vehicles_scheduled:3},{fleet_id:f2,fleet_name:'Fleet Two',insurer_id:ins2,vehicles_total:20,vehicles_on_cover:20,vehicles_scheduled:0}]));
  if(options.method==='HEAD')return new Response(null,{headers:{'content-range':'0-0/7'}});
  return new Response(JSON.stringify([{id:'e1',fleet_id:f1,event_type:'cover_added',effective_at:'2026-10-23T00:00:00Z',recorded_at:'2026-10-23T09:00:00Z',details:{registration:'AB12CDE'}}]));
 };
 return {calls,restore:()=>{globalThis.fetch=real;}};
}
test('dashboard needs a session and rejects a malformed insurer filter',async()=>{
 assert.equal((await request('/api/dashboard',{})).status,401);
 const s=stub();try{assert.equal((await request('/api/dashboard?insurer=nope')).status,400);}finally{s.restore();}
});
test('dashboard counts run with the user token, scoped to the fleets the user can see',async()=>{
 const s=stub();
 try{
  const all=await request('/api/dashboard');assert.equal(all.status,200);
  const body=all.json();assert.equal(body.fleets.length,2);assert.equal(body.counts.added7,7);assert.equal(body.events[0].details.registration,'AB12CDE');
  assert.ok(s.calls.filter(u=>u.includes('/coverage_events')||u.includes('/coverage_periods')||u.includes('/reconciliations')).every(u=>u.includes('fleet_id=in.(')));
  const one=await request('/api/dashboard?insurer='+ins);assert.deepEqual(one.json().fleets.map(f=>f.fleet_id),[f1]);
  assert.ok(!s.calls.some(u=>u.includes('fleet_id=in.(')&&u.includes(f2)&&u.includes('insurer')));
 }finally{s.restore();}
});
const source=await readFile(new URL('../public/app.js',import.meta.url),'utf8');
test('live dashboards render real figures for platform and insurer views',async()=>{
 const app={innerHTML:''},document={querySelector:s=>s==='#app'?app:null,querySelectorAll:()=>[]};
 const run=new Function('document','insuredDays','csv',source.replace(/^import .*?;\n/gm,'').replace(/\ninit\(\);\s*$/,'')+';return {state,render};');
 const view=run(document,insuredDays,csv);
 view.state.demo=false;view.state.user={id:'u',email:'a@example.invalid'};
 view.state.data={organisations:[{id:ins,kind:'insurer',name:'Insurer One'},{id:ins2,kind:'insurer',name:'Insurer Two'},{id:f1,kind:'customer',name:'Fleet One',insurer_id:ins}],policies:[{id:'p1',customer_id:f1,insurer_id:ins,reference:'POL-1'}],coverage_periods:[],audit_events:[],memberships:[{role:'platform_super_admin',organisation_id:'x',active:true}]};
 view.state.dash={fleets:[{fleet_id:f1,fleet_name:'Fleet One',insurer_id:ins,vehicles_total:600,vehicles_on_cover:560,vehicles_scheduled:3}],counts:{added7:4,removed7:2,scheduledAdds:3,scheduledRemovals:1,provisionalReports:2},events:[{id:'e',fleet_id:f1,event_type:'cover_removed',effective_at:'2026-10-23T00:00:00Z',recorded_at:'2026-10-23T09:00:00Z',details:{registration:'AB12CDE'}}]};
 for(const page of ['overview','insurer']){
  view.state.page=page;view.render();const html=app.innerHTML;
  assert(!html.includes('undefined'));assert.match(html,/560/);assert.match(html,/4 \/ 2/);assert.match(html,/AB12CDE/);assert.match(html,/removed from cover/);assert.match(html,/Fleet One/);
 }
 assert.match(app.innerHTML,/id="insurer-filter"/);
 view.state.page='overview';view.render();assert.doesNotMatch(app.innerHTML,/id="insurer-filter"/);
 view.state.dash=null;view.render();assert.match(app.innerHTML,/Loading live figures/);
 view.state.dashError='Please sign in again.';view.render();assert.match(app.innerHTML,/Please sign in again/);
});
