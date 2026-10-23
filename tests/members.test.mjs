import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {memberEmail,memberRole} from '../lib/members.mjs';
process.env.SUPABASE_URL='https://unit.supabase.invalid';
process.env.SUPABASE_PUBLISHABLE_KEY='test-publishable';
process.env.APP_ORIGIN='http://localhost:3000';
process.env.DEMO_MODE='false';
const {makeServer}=await import('../server.mjs');
const server=makeServer();
const org='44444444-4444-4444-8444-444444444444';
const membership='55555555-5555-4555-8555-555555555555';
const headers={cookie:'stratify=test-session',origin:'http://localhost:3000'};
function request(path,method='GET',body,requestHeaders=headers){
 return new Promise(resolve=>{
  const req=Readable.from(body?[JSON.stringify(body)]:[]);Object.assign(req,{url:path,method,headers:requestHeaders});
  const res={headers:{},headersSent:false,setHeader(k,v){this.headers[k]=v;},writeHead(status,h){this.status=status;Object.assign(this.headers,h);this.headersSent=true;},end(text){resolve({status:this.status,text:String(text),json:()=>JSON.parse(text)});}};
  server.emit('request',req,res);
 });
}
function stub(user={}){
 const calls=[],real=globalThis.fetch;
 globalThis.fetch=async(url,options)=>{
  calls.push([url,options]);
  if(url.includes('/auth/v1/user'))return new Response(JSON.stringify({id:'11111111-1111-4111-8111-111111111111',email:'admin@example.invalid',email_confirmed_at:'2026-10-23T12:00:00Z',...user}));
  if(url.includes('/rpc/list_members'))return new Response(JSON.stringify([{id:membership,email:'a@example.invalid',role:'fleet_admin',active:true,pending:false}]));
  if(url.includes('/rpc/add_member'))return new Response(JSON.stringify('invited'));
  if(url.includes('/rpc/claim_invitations'))return new Response('1');
  return new Response('null');
 };
 return {calls,restore:()=>{globalThis.fetch=real;}};
}
test('member input is validated before reaching the database',()=>{
 assert.equal(memberEmail('  New.Person@Example.com '),'new.person@example.com');
 for(const bad of ['','nope','a@b','a b@c.com',null,'x'.repeat(260)+'@example.com'])assert.throws(()=>memberEmail(bad));
 assert.equal(memberRole('fleet_manager'),'fleet_manager');
 assert.throws(()=>memberRole('root'));assert.throws(()=>memberRole('owner'));
});
test('member endpoints need a session, a same-origin request and valid ids',async()=>{
 assert.equal((await request('/api/members?org='+org,'GET',undefined,{})).status,401);
 const s=stub();
 try{
  assert.equal((await request('/api/members','POST',{org,email:'a@example.invalid',role:'fleet_admin'},{cookie:headers.cookie,origin:'https://evil.invalid'})).status,403);
  assert.equal((await request('/api/members?org=not-an-id')).status,400);
  assert.equal((await request('/api/members','POST',{org,email:'bad',role:'fleet_admin'})).status,400);
  assert.equal((await request('/api/members','POST',{org,email:'a@example.invalid',role:'superuser'})).status,400);
  assert.equal((await request('/api/members/active','POST',{membership,active:'yes'})).status,400);
  assert.equal(s.calls.some(([url])=>url.includes('/rpc/add_member')),false);
 }finally{s.restore();}
});
test('valid requests call the permission-checking database functions with the user token only',async()=>{
 const s=stub();
 try{
  const added=await request('/api/members','POST',{org,email:'New@Example.invalid',role:'fleet_manager'});
  assert.equal(added.status,201);assert.equal(added.json().result,'invited');
  const call=s.calls.find(([url])=>url.includes('/rpc/add_member'));
  assert.deepEqual(JSON.parse(call[1].body),{p_org:org,p_email:'new@example.invalid',p_role:'fleet_manager'});
  assert.equal(call[1].headers.Authorization,'Bearer test-session');
  assert.equal((await request('/api/members?org='+org)).json().rows.length,1);
  for(const [path,body,rpc] of [['/api/members/role',{membership,role:'fleet_manager'},'change_member_role'],['/api/members/active',{membership,active:false},'set_member_active'],['/api/members/revoke',{invitation:membership},'revoke_invitation']]){
   assert.equal((await request(path,'POST',body)).status,200);
   assert.ok(s.calls.some(([url])=>url.includes('/rpc/'+rpc)),rpc);
  }
 }finally{s.restore();}
});
test('signing in claims pending invitations, except for the demo account',async()=>{
 let s=stub();
 try{const me=await request('/api/me');assert.equal(me.status,200);assert.ok(s.calls.some(([url])=>url.includes('/rpc/claim_invitations')));assert.equal(me.json().id,'11111111-1111-4111-8111-111111111111');}finally{s.restore();}
 s=stub({email:'demo@stratifyfleet.co.uk'});
 try{await request('/api/me');assert.equal(s.calls.some(([url])=>url.includes('/rpc/claim_invitations')),false);}finally{s.restore();}
});
test('the demo account cannot manage users',async()=>{
 const s=stub({email:'demo@stratifyfleet.co.uk'});
 try{assert.equal((await request('/api/members?org='+org)).status,404);assert.equal((await request('/api/members','POST',{org,email:'a@example.invalid',role:'fleet_admin'})).status,403);}finally{s.restore();}
});
