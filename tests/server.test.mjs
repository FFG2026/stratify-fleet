import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
process.env.SUPABASE_URL='https://unit.supabase.invalid';
process.env.SUPABASE_PUBLISHABLE_KEY='test-publishable';
process.env.APP_ORIGIN='http://localhost:3000';
process.env.DEMO_MODE='false';
const {makeServer}=await import('../server.mjs');
const server=makeServer();
function request(path,method='GET',body,headers={}){
 return new Promise((resolve,reject)=>{
  const req=Readable.from(body?[JSON.stringify(body)]:[]);Object.assign(req,{url:path,method,headers});
  const res={headers:{},headersSent:false,setHeader(k,v){this.headers[k]=v;},writeHead(status,headers){this.status=status;Object.assign(this.headers,headers);this.headersSent=true;},end(text){resolve({status:this.status,headers:this.headers,text:String(text),json:()=>JSON.parse(String(text))});}};
  server.emit('request',req,res);
 });
}
test('API requires session, rejects cross-origin writes and hides local files',async()=>{
 assert.equal((await request('/api/workspace')).status,401);
 assert.equal((await request('/api/login','POST',{email:'a',password:'b'},{origin:'https://evil.invalid'})).status,403);
 assert.equal((await request('/.env')).status,404);
 assert.equal((await request('/../server.mjs')).status,404);
 const home=await request('/');assert.equal(home.status,200);assert.match(home.text,/Stratify/);
});
test('login sets HttpOnly cookie, workspace paginates beyond 600, mutations map existing RPC',async()=>{
 const calls=[];
 const realFetch=globalThis.fetch;
 globalThis.fetch=async(url,options)=>{
  calls.push([url,options]);
  let data;
  if(url.includes('/auth/v1/token'))data={access_token:'test-session',expires_in:3600};
  else if(url.includes('/auth/v1/user'))data={id:'11111111-1111-4111-8111-111111111111',email:'test@example.invalid'};
  else if(url.includes('/rpc/add_vehicle_cover'))data='created-period';
  else if(url.includes('/rest/v1/policies'))data=[{id:'22222222-2222-4222-8222-222222222222',fleet_id:'f',policy_number:'TEST',valid_from:'2026-01-01'}];
  else if(url.includes('/rest/v1/vehicles')){
   const offset=Number(new URL(url).searchParams.get('offset')||0);data=Array.from({length:offset===0?500:100},(_,i)=>({id:'v'+(offset+i),registration:'AA11AAA'}));
  } else if(url.includes('/rest/v1/organisations'))data=[{id:'f',kind:'fleet',name:'Test Fleet'}];
  else data=[];
  return new Response(JSON.stringify(data),{status:200});
 };
 try{
  const login=await request('/api/login','POST',{email:'test@example.invalid',password:'test-password'},{origin:'http://localhost:3000'});
  assert.equal(login.status,200);assert.match(login.headers['Set-Cookie'],/HttpOnly; SameSite=Strict/);
  const headers={cookie:'stratify=test-session',origin:'http://localhost:3000'};
  const workspace=await request('/api/workspace','GET',null,headers);
  assert.equal(workspace.status,200);assert.equal(workspace.json().policies[0].reference,'TEST');
  assert(calls.some(([url])=>url.includes('/vehicles?')&&url.includes('offset=500')));
  const add=await request('/api/coverage','POST',{policy_id:'22222222-2222-4222-8222-222222222222',registration:'AB26 CDE',make:'Ford',model:'Transit',starts_on:'2099-07-02'},headers);
  assert.equal(add.status,201);
  const rpc=JSON.parse(calls.find(([url])=>url.includes('/rpc/add_vehicle_cover'))[1].body);
  assert.equal(rpc.p_fleet_id,'f');assert.equal(rpc.p_effective_at,'2099-07-01T23:00:00.000Z');
  assert.equal(rpc.p_registration,'AB26CDE');
 }finally{globalThis.fetch=realFetch;}
});
