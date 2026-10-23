import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { demo } from './lib/demo.mjs';
import { normaliseRegistration, parseDate, monthBounds } from './lib/coverage.mjs';
import {londonMidnight,londonDate,normaliseWorkspace} from './lib/database.mjs';
const root = new URL('./public/', import.meta.url);
const demoMode = process.env.DEMO_MODE === 'true';
const base = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_PUBLISHABLE_KEY;
const port = Number(process.env.PORT || 3000);
const origin = process.env.APP_ORIGIN || 'http://localhost:' + port;
const secure = new URL(origin).protocol === 'https:' ? '; Secure' : '';
const cookieName = secure ? '__Host-stratify' : 'stratify';
const routes = new Map([['/', ['index.html','text/html']], ['/app.js',['app.js','text/javascript']], ['/style.css',['style.css','text/css']], ['/coverage.mjs',['../lib/coverage.mjs','text/javascript']]]);
const failure = (message, status = 400) => Object.assign(new Error(message), { status });
function token(req) {
  const value = (req.headers.cookie || '').split('; ').find(c => c.startsWith(cookieName + '='));
  return value ? decodeURIComponent(value.slice(cookieName.length + 1)) : '';
}
async function body(req) {
  let text=''; for await (const chunk of req) { text += chunk; if(text.length > 16384) throw failure('Request too large.',413); }
  try { return JSON.parse(text); } catch { throw failure('Invalid JSON.'); }
}
async function sb(path, access, options = {}) {
  const response = await fetch(base+path, { ...options, signal:AbortSignal.timeout(15000), headers:{apikey:key, Authorization:'Bearer '+(access || key), 'Content-Type':'application/json', ...options.headers} });
  const text = await response.text(); let data; try { data=JSON.parse(text); } catch { data=null; }
  if(!response.ok) throw failure(response.status === 401 ? 'Please sign in again.' : (data?.message || data?.msg || 'Database request failed.'), response.status);
  return data;
}
async function allRows(table, access, query = 'order=id.asc') {
  const rows=[];
  for(let offset=0;;offset+=500) {
    const batch = await sb('/rest/v1/'+table+'?select=*&'+query+'&offset='+offset+'&limit=500',access);
    rows.push(...batch); if(batch.length < 500) return rows;
    if(offset >= 100000) throw failure('Please narrow the report.',422);
  }
}
export function makeServer() { return createServer(async (req,res) => {
  const send=(status,data)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(data));};
  res.setHeader('Cache-Control','no-store');
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Referrer-Policy','same-origin');
  res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  try {
    const url = new URL(req.url,origin);
    if(req.method !== 'GET' && req.headers.origin !== origin) throw failure('Request origin rejected.',403);
    if(url.pathname === '/api/status' && req.method === 'GET') return send(200,{demo:demoMode,configured:!!(base&&key)});
    if(url.pathname.startsWith('/api/')) {
      if(demoMode) {
        if(req.method !== 'GET') throw failure('Demo is read-only. Connect the development database to save changes.',403);
        if(url.pathname === '/api/me') return send(200,{email:'Demo workspace',demo:true});
        if(url.pathname === '/api/workspace') return send(200,demo);
        throw failure('Not found.',404);
      }
      if(!base || !key) throw failure('Development database is not configured.',503);
      if(url.pathname === '/api/login' && req.method === 'POST') {
        const {email,password} = await body(req);
        if(typeof email !== 'string'|| typeof password !== 'string') throw failure('Email and password are required.');
        let data;
        try { data=await sb('/auth/v1/token?grant_type=password',null,{method:'POST',body:JSON.stringify({email,password})}); }
        catch { throw failure('Unable to sign in. Check your details.',401); }
        res.setHeader('Set-Cookie',cookieName+'='+encodeURIComponent(data.access_token)+'; HttpOnly; SameSite=Strict; Path=/; Max-Age='+Math.min(data.expires_in,3600)+secure);
        return send(200,{ok:true});
      }
      const access=token(req); if(!access) throw failure('Please sign in.',401);
      const user=await sb('/auth/v1/user',access);
      if(url.pathname === '/api/me' && req.method === 'GET') return send(200,{email:user.email});
      if(url.pathname === '/api/logout' && req.method === 'POST') {
        await sb('/auth/v1/logout',access,{method:'POST'});
        res.setHeader('Set-Cookie',cookieName+'=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0'+secure);return send(200,{ok:true});
      }
      if(url.pathname === '/api/workspace' && req.method === 'GET') {
        const [organisations,policies,vehicles,coverage_periods,audit_logs,memberships]=await Promise.all([
          allRows('organisations',access),allRows('policies',access),allRows('vehicles',access),allRows('coverage_periods',access),
          sb('/rest/v1/audit_logs?select=*&order=occurred_at.desc&limit=25',access),
          sb('/rest/v1/memberships?select=organisation_id,role,active&user_id=eq.'+user.id,access)
        ]);
        return send(200,normaliseWorkspace({organisations,policies,vehicles,coverage_periods,audit_logs,memberships}));
      }
      if(url.pathname === '/api/coverage' && req.method === 'POST') {
        const data=await body(req); normaliseRegistration(data.registration);parseDate(data.starts_on);
        if(data.starts_on < londonDate(new Date())) throw failure('Backdating approval is not available in this portal yet.');
        if(!/^[a-f0-9-]{36}$/i.test(data.policy_id)) throw failure('Select a valid policy.');
        const policies=await sb('/rest/v1/policies?select=*&id=eq.'+data.policy_id,access);
        if(!policies.length) throw failure('Policy not accessible.',403);
        return send(201,await sb('/rest/v1/rpc/add_vehicle_cover',access,{method:'POST',body:JSON.stringify({p_fleet_id:policies[0].fleet_id,p_policy_id:data.policy_id,p_registration:normaliseRegistration(data.registration),p_make_model:(String(data.make||'')+' '+String(data.model||'')).trim().slice(0,200),p_effective_at:londonMidnight(data.starts_on)})}));
      }
      if(url.pathname === '/api/removal' && req.method === 'POST') {
        const data=await body(req);parseDate(data.ends_on);
        if(data.ends_on < londonDate(new Date())) throw failure('Backdating approval is not available in this portal yet.');
        if(!/^[a-f0-9-]{36}$/i.test(data.period_id)) throw failure('Select a valid coverage period.');
        const periods=await sb('/rest/v1/coverage_periods?select=*&id=eq.'+data.period_id,access);
        if(!periods.length) throw failure('Coverage period not accessible.',403);
        if(periods[0].cover_end || periods[0].voided_at) throw failure('This period is already closed or voided.');
        if(data.ends_on <= londonDate(periods[0].cover_start)) throw failure('Removal must be on a later calendar date.');
        return send(200,await sb('/rest/v1/rpc/remove_vehicle_cover',access,{method:'POST',body:JSON.stringify({p_vehicle_id:periods[0].vehicle_id,p_effective_at:londonMidnight(data.ends_on)})}));
      }
      if(url.pathname === '/api/reconciliation' && req.method === 'POST') {
        const data=await body(req);monthBounds(data.month);
        if(!/^[a-f0-9-]{36}$/i.test(data.policy_id)) throw failure('Select one policy to generate a saved report.');
        const policies=await sb('/rest/v1/policies?select=*&id=eq.'+data.policy_id,access);
        if(!policies.length) throw failure('Policy not accessible.',403);
        const id=await sb('/rest/v1/rpc/generate_reconciliation',access,{method:'POST',body:JSON.stringify({p_fleet_id:policies[0].fleet_id,p_policy_id:data.policy_id,p_month:data.month+'-01'})});
        const [reports,lines]=await Promise.all([sb('/rest/v1/reconciliations?select=*&id=eq.'+id,access),allRows('reconciliation_lines',access,'reconciliation_id=eq.'+id+'&order=id.asc')]);
        return send(201,{report:reports[0],lines});
      }
      throw failure('Not found.',404);
    }
    if(req.method !== 'GET') throw failure('Method not allowed.',405);
    const file=routes.get(url.pathname);if(!file) throw failure('Not found.',404);
    res.writeHead(200,{'Content-Type':file[1]+'; charset=utf-8'});res.end(await readFile(new URL(file[0],root)));
  } catch(e) { if(!res.headersSent) send(e.status || 500,{error:e.status ? e.message : 'Unable to complete the request.'});else res.end(); }
}); }
if(process.argv[1] === fileURLToPath(import.meta.url)) makeServer().listen(port,'127.0.0.1',()=>console.log('Stratify development: '+origin+(demoMode?' (read-only demo)':'')));
