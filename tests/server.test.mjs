import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
process.env.SUPABASE_URL='https://unit.supabase.invalid';
process.env.SUPABASE_PUBLISHABLE_KEY='test-publishable';
process.env.APP_ORIGIN='http://localhost:3000';
process.env.DEMO_MODE='false';
const {makeServer}=await import('../server.mjs');
const server=makeServer();
const policy='22222222-2222-4222-8222-222222222222';
const report='33333333-3333-4333-8333-333333333333';
const headers={cookie:'stratify=test-session',origin:'http://localhost:3000'};
function request(path,method='GET',body,requestHeaders={}){
 return new Promise(resolve=>{
  const req=Readable.from(body?[JSON.stringify(body)]:[]);Object.assign(req,{url:path,method,headers:requestHeaders});
  const res={headers:{},headersSent:false,setHeader(k,v){this.headers[k]=v;},writeHead(status,h){this.status=status;Object.assign(this.headers,h);this.headersSent=true;},end(text){resolve({status:this.status,headers:this.headers,text:String(text),json:()=>JSON.parse(String(text))});}};
  server.emit('request',req,res);
 });
}
function stubFetch(options={}){
 const calls=[],realFetch=globalThis.fetch;
 globalThis.fetch=async(url,requestOptions)=>{
  calls.push([url,requestOptions]);const parsed=new URL(url);const query=parsed.searchParams;
  let data=[],status=200;const responseHeaders={};
  if(url.includes('/auth/v1/token'))data={access_token:'test-session',expires_in:3600};
  else if(url.includes('/auth/v1/user'))data={id:'11111111-1111-4111-8111-111111111111',email:'test@example.invalid'};
  else if(url.includes('/rpc/add_vehicle_cover'))data='created-period';
  else if(url.includes('/rest/v1/policies'))data=[{id:policy,fleet_id:'f',policy_number:'TEST',valid_from:'2026-01-01'}];
  else if(url.includes('/rest/v1/organisations'))data=[{id:'f',kind:'fleet',name:'Test Fleet'}];
  else if(url.includes('/rest/v1/coverage_periods')){
   const offset=Number(query.get('offset')||0),limit=Number(query.get('limit')||25);
   data=Array.from({length:Math.min(limit,Math.max(0,600-offset))},(_,i)=>({id:'period'+(offset+i),policy_id:policy,cover_start:'2026-10-01T00:00:00Z',cover_end:null,vehicle:{registration:'AB26CDE',make_model:'Ford Transit'}}));
   if(!options.noCount)responseHeaders['content-range']=offset+'-'+(offset+data.length-1)+'/600';
  }else if(url.includes('/rest/v1/reconciliation_lines')){
   const offset=Number(query.get('offset')||0);
   data=Array.from({length:offset===0?500:100},(_,i)=>({id:offset+i,days:10,registration:'AB26CDE',policy_id:policy}));
  }else if(url.includes('/rest/v1/reconciliations')){
   data=options.hiddenReport?[]:[{id:report,policy_id:policy,month_start:'2026-10-01',status:'provisional',total_vehicle_days:6000,rules_snapshot:{end_day_charged:true},generated_at:'2026-10-23T12:00:00Z'}];
   responseHeaders['content-range']='0-0/'+data.length;
  }
  return new Response(requestOptions.method==='HEAD'?null:JSON.stringify(data),{status,headers:responseHeaders});
 };
 return {calls,restore:()=>{globalThis.fetch=realFetch;}};
}
test('API requires a session, rejects cross-origin writes and hides local files',async()=>{
 assert.equal((await request('/api/workspace')).status,401);
 assert.equal((await request('/api/fleet')).status,401);
 assert.equal((await request('/api/reconciliations/'+report)).status,401);
 assert.equal((await request('/api/login','POST',{email:'a',password:'b'},{origin:'https://evil.invalid'})).status,403);
 assert.equal((await request('/.env')).status,404);assert.equal((await request('/../server.mjs')).status,404);
 const home=await request('/');assert.equal(home.status,200);assert.match(home.text,/Stratify/);
});
test('workspace loads only recent periods and server totals; login remains HttpOnly',async()=>{
 const mock=stubFetch();
 try{
  const login=await request('/api/login','POST',{email:'test@example.invalid',password:'test-password'},{origin:'http://localhost:3000'});
  assert.equal(login.status,200);assert.match(login.headers['Set-Cookie'],/HttpOnly; SameSite=Strict/);
  const response=await request('/api/workspace','GET',null,headers);
  assert.equal(response.status,200);const data=response.json();
  assert.equal(data.coverage_periods.length,5);assert.equal(data.summary.periods,600);assert.equal(data.summary.covered,600);
  assert.equal(data.coverage_periods[0].make,'Ford Transit');
  assert(!mock.calls.some(([url])=>url.includes('/rest/v1/vehicles?')));
  assert(mock.calls.some(([url,o])=>url.includes('/coverage_periods?')&&o.method==='HEAD'));
 }finally{mock.restore();}
});
test('fleet pagination retrieves the 600th vehicle without downloading earlier pages',async()=>{
 const mock=stubFetch();
 try{
  const res=await request('/api/fleet?offset=575&limit=25&q=AB26&policy='+policy,'GET',null,headers);
  assert.equal(res.status,200);assert.equal(res.json().rows.length,25);assert.equal(res.json().total,600);
  assert.equal(res.json().rows.at(-1).id,'period599');
  const call=mock.calls.find(([url])=>url.includes('/coverage_periods?'));
  assert.equal(new URL(call[0]).searchParams.get('offset'),'575');assert.equal(call[1].headers.Prefer,'count=exact');
  assert.equal((await request('/api/fleet?q=a*,id.gt.0','GET',null,headers)).status,400);
 }finally{mock.restore();}
});
test('saved reports are filtered, reopened with every line, and hidden reports return 404',async()=>{
 let mock=stubFetch();
 try{
  const list=await request('/api/reconciliations?month=2026-10&policy='+policy,'GET',null,headers);
  assert.equal(list.status,200);assert.equal(list.json().total,1);
  const reopened=await request('/api/reconciliations/'+report,'GET',null,headers);
  assert.equal(reopened.status,200);assert.equal(reopened.json().lines.length,600);
  assert.equal(reopened.json().report.rules_snapshot.end_day_charged,true);
  assert(mock.calls.some(([url])=>url.includes('reconciliation_lines?')&&url.includes('offset=500')));
 }finally{mock.restore();}
 mock=stubFetch({hiddenReport:true});
 try{
  assert.equal((await request('/api/reconciliations/'+report,'GET',null,headers)).status,404);
  assert(!mock.calls.some(([url])=>url.includes('reconciliation_lines?')));
 }finally{mock.restore();}
});
test('missing result counts are surfaced instead of displaying misleading totals',async()=>{
 const mock=stubFetch({noCount:true});
 try{assert.equal((await request('/api/fleet','GET',null,headers)).status,502);}finally{mock.restore();}
});
test('coverage additions still call the permission-checked RPC with London midnight',async()=>{
 const mock=stubFetch();
 try{
  const add=await request('/api/coverage','POST',{policy_id:policy,registration:'AB26 CDE',make:'Ford',model:'Transit',starts_on:'2099-07-02'},headers);
  assert.equal(add.status,201);const rpc=JSON.parse(mock.calls.find(([url])=>url.includes('/rpc/add_vehicle_cover'))[1].body);
  assert.equal(rpc.p_fleet_id,'f');assert.equal(rpc.p_effective_at,'2099-07-01T23:00:00.000Z');assert.equal(rpc.p_registration,'AB26CDE');
 }finally{mock.restore();}
});
