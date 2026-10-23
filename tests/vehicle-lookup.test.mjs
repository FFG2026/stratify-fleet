import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {lookupVehicle,tidyMake,createLimiter,lookupConfigured} from '../lib/vehicle-lookup.mjs';
process.env.SUPABASE_URL='https://unit.supabase.invalid';
process.env.SUPABASE_PUBLISHABLE_KEY='test-publishable';
process.env.APP_ORIGIN='http://localhost:3000';
process.env.DEMO_MODE='false';
const env={DVLA_VES_API_KEY:'secret-test-key'};
const ves=(status,data)=>async(url,options)=>{ves.last={url,options};return new Response(data===undefined?null:JSON.stringify(data),{status});};
const ok={registrationNumber:'AB12CDE',make:'FORD',colour:'WHITE',fuelType:'DIESEL',yearOfManufacture:2021,taxStatus:'Taxed',motStatus:'Valid',motExpiryDate:'2027-03-01',engineCapacity:1996,dateOfLastV5CIssued:'2021-05-05'};

test('make names are tidied but known acronyms stay capitals',()=>{
 assert.equal(tidyMake('FORD'),'Ford');assert.equal(tidyMake('MERCEDES-BENZ'),'Mercedes-Benz');
 assert.equal(tidyMake('LAND ROVER'),'Land Rover');assert.equal(tidyMake('BMW'),'BMW');assert.equal(tidyMake(' vauxhall '),'Vauxhall');
});
test('lookup sends only the registration, with the key in a header, and returns a trimmed summary',async()=>{
 const result=await lookupVehicle('ab12 cde',{env,fetchImpl:ves(200,ok)});
 assert.equal(ves.last.options.headers['x-api-key'],'secret-test-key');
 assert.deepEqual(JSON.parse(ves.last.options.body),{registrationNumber:'AB12CDE'});
 assert.equal(result.make,'Ford');assert.equal(result.registration,'AB12CDE');assert.equal(result.yearOfManufacture,2021);
 assert.equal('dateOfLastV5CIssued' in result,false);assert.equal(JSON.stringify(result).includes('secret-test-key'),false);
});
test('lookup failures give plain messages and never leak the key',async()=>{
 await assert.rejects(lookupVehicle('AB12CDE',{env:{},fetchImpl:ves(200,ok)}),e=>e.status===503);
 await assert.rejects(lookupVehicle('!!',{env,fetchImpl:ves(200,ok)}),e=>e.status===400);
 await assert.rejects(lookupVehicle('AB12CDE',{env,fetchImpl:ves(404,{})}),e=>e.status===404&&/no vehicle/i.test(e.message));
 await assert.rejects(lookupVehicle('AB12CDE',{env,fetchImpl:ves(429,{})}),e=>e.status===429);
 await assert.rejects(lookupVehicle('AB12CDE',{env,fetchImpl:ves(500,{})}),e=>e.status===502&&!e.message.includes('secret'));
 await assert.rejects(lookupVehicle('AB12CDE',{env,fetchImpl:async()=>{throw new Error('boom secret-test-key');}}),e=>e.status===502&&!e.message.includes('secret'));
 await assert.rejects(lookupVehicle('AB12CDE',{env,fetchImpl:ves(200,{colour:'RED'})}),e=>e.status===502);
 await assert.rejects(lookupVehicle('AB12CDE',{env:{...env,DVLA_VES_URL:'http://insecure.invalid'},fetchImpl:ves(200,ok)}),e=>e.status===503);
});
test('limiter allows a burst then blocks, and recovers after the window',()=>{
 let t=0;const allow=createLimiter(3,1000,()=>t);
 assert.ok(allow('u')&&allow('u')&&allow('u'));assert.equal(allow('u'),false);assert.ok(allow('other'));
 t=1001;assert.ok(allow('u'));
});
test('lookupConfigured reflects whether a key is set',()=>{assert.equal(lookupConfigured({}),false);assert.equal(lookupConfigured(env),true);});

const {makeServer}=await import('../server.mjs');
const server=makeServer();
function request(path,method='GET',body,headers={cookie:'stratify=test-session',origin:'http://localhost:3000'}){
 return new Promise(resolve=>{
  const req=Readable.from(body?[JSON.stringify(body)]:[]);Object.assign(req,{url:path,method,headers});
  const res={headers:{},headersSent:false,setHeader(k,v){this.headers[k]=v;},writeHead(status,h){this.status=status;Object.assign(this.headers,h);this.headersSent=true;},end(text){resolve({status:this.status,text:String(text),json:()=>JSON.parse(text)});}};
  server.emit('request',req,res);
 });
}
function stubAll(email='admin@example.invalid'){
 const real=globalThis.fetch,calls=[];
 globalThis.fetch=async(url,options)=>{
  calls.push(url);
  if(String(url).includes('/auth/v1/user'))return new Response(JSON.stringify({id:'11111111-1111-4111-8111-111111111111',email,email_confirmed_at:'2026-10-23T12:00:00Z'}));
  if(String(url).includes('driver-vehicle-licensing'))return new Response(JSON.stringify(ok));
  return new Response('null');
 };
 return {calls,restore:()=>{globalThis.fetch=real;delete process.env.DVLA_VES_API_KEY;}};
}
test('lookup endpoint needs a session, reports status, and returns the DVLA make when a key is set',async()=>{
 assert.equal((await request('/api/vehicle-lookup?reg=AB12CDE','GET',undefined,{})).status,401);
 const s=stubAll();
 try{
  assert.equal((await request('/api/vehicle-lookup?reg=AB12CDE')).status,503);
  assert.equal((await request('/api/status')).json().lookup,false);
  process.env.DVLA_VES_API_KEY='secret-test-key';
  assert.equal((await request('/api/status')).json().lookup,true);
  const found=await request('/api/vehicle-lookup?reg=ab12%20cde');
  assert.equal(found.status,200);assert.equal(found.json().make,'Ford');assert.equal(found.text.includes('secret-test-key'),false);
  assert.equal((await request('/api/vehicle-lookup')).status,400);
 }finally{s.restore();}
});
test('the demo account cannot use the lookup allowance',async()=>{
 const s=stubAll('demo@stratifyfleet.co.uk');process.env.DVLA_VES_API_KEY='secret-test-key';
 try{const r=await request('/api/vehicle-lookup?reg=AB12CDE');assert.equal(r.status,404);assert.equal(s.calls.some(u=>String(u).includes('driver-vehicle-licensing')),false);}
 finally{s.restore();}
});
