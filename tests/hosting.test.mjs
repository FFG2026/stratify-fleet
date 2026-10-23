import test from 'node:test';
import assert from 'node:assert/strict';
process.env.APP_ORIGIN='https://stratifyfleet.co.uk';
process.env.VERCEL_URL='stratify-test.vercel.app';
process.env.SUPABASE_URL='https://unit.supabase.invalid';
process.env.SUPABASE_PUBLISHABLE_KEY='test-publishable';
process.env.DEMO_MODE='false';
const {default:handler}=await import('../api/index.mjs');
function request(path,{method='GET',origin,body}={}){
 return new Promise(resolve=>{
  const req={url:path,method,headers:{origin},body,query:Object.fromEntries(new URL(path,'https://local.invalid').searchParams)};
  const res={headersSent:false,headers:{},setHeader(k,v){this.headers[k]=v;},writeHead(status,h){this.status=status;this.headersSent=true;Object.assign(this.headers,h);},end(text){resolve({status:this.status,headers:this.headers,data:JSON.parse(String(text))});}};
  handler(req,res);
 });
}
test('Vercel rewrite routes status and preserves query parameters',async()=>{
 const r=await request('/api/index?__route=status');assert.equal(r.status,200);assert.equal(r.data.configured,true);
 assert.equal((await request('/api/index?__route=fleet&offset=25')).status,401);
 assert.equal((await request('/api/index?__route=../server.mjs')).status,400);
});
test('Vercel parsed login body, HTTPS cookie and allowed deployment origin',async()=>{
 const original=globalThis.fetch;let payload;
 globalThis.fetch=async(url,options)=>{payload=JSON.parse(options.body);return new Response(JSON.stringify({access_token:'test-token',expires_in:3600}),{status:200});};
 try{
  const r=await request('/api/index?__route=login',{method:'POST',origin:'https://stratify-test.vercel.app',body:{email:'test@example.invalid',password:'test-password'}});
  assert.equal(r.status,200);assert.equal(payload.email,'test@example.invalid');
  assert.match(r.headers['Set-Cookie'],/^__Host-stratify=/);assert.match(r.headers['Set-Cookie'],/HttpOnly; SameSite=Strict/);assert.match(r.headers['Set-Cookie'],/; Secure$/);
  const blocked=await request('/api/index?__route=login',{method:'POST',origin:'https://evil.invalid',body:{}});
  assert.equal(blocked.status,403);
 }finally{globalThis.fetch=original;}
});
