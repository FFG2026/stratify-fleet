import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {demo} from '../lib/demo.mjs';
import {insuredDays,csv} from '../lib/coverage.mjs';
// In-process rendering checks. These do not replace a browser test.
const source=await readFile(new URL('../public/app.js',import.meta.url),'utf8');
function ui(){
 const app={innerHTML:''},document={querySelector:s=>s==='#app'?app:null,querySelectorAll:()=>[]};
 const run=new Function('document','insuredDays','csv',source.replace(/^import .*?;\n/gm,'').replace(/\ninit\(\);\s*$/,'')+';return {state,render,reports};');
 const result=run(document,insuredDays,csv);result.state.data=structuredClone(demo);result.state.user={email:'Demo'};result.state.demo=true;
 return {...result,app};
}
test('all six screen functions render without undefined values',()=>{
 const view=ui();
 for(const page of ['overview','insurer','customer','fleet','changes','reconciliation']){
  view.state.page=page;view.render();assert(view.app.innerHTML.length>1000);assert(!view.app.innerHTML.includes('undefined'));
 }
});
test('server page 24 displays its supplied 25 rows without slicing it a second time',()=>{
 const view=ui();view.state.demo=false;view.state.page='fleet';view.state.offset=575;
 view.state.fleetPage={rows:demo.coverage_periods.slice(0,25),total:600};
 view.render();assert.equal((view.app.innerHTML.match(/class="registration"/g)||[]).length,25);
 assert.match(view.app.innerHTML,/576–600 of 600/);
});
test('saved report uses its stored lines even after coverage records change',()=>{
 const view=ui();view.state.demo=false;view.state.page='reconciliation';
 view.state.data.coverage_periods=[];view.state.savedReport={report:{id:'report-id',rules_source:'default-assumption'},lines:[{registration:'AA11AAA',policy_id:'demo-policy',days:12},{registration:'AA11AAA',policy_id:'demo-policy',days:3}]};
 view.render();assert.equal(view.reports()[0].days,15);assert.match(view.app.innerHTML,/report-id/);
});
test('unprivileged users cannot submit either vehicle change form',()=>{
 const view=ui();view.state.demo=false;view.state.page='changes';view.state.data.memberships=[];
 view.render();assert.match(view.app.innerHTML,/<button class="primary" disabled>Record addition/);assert.match(view.app.innerHTML,/<button disabled>Record removal/);
});
test('restored navigation keeps all tabs visible without exposing restricted dashboards',()=>{
 const view=ui();view.state.demo=false;view.state.data.memberships=[];view.state.page='overview';
 view.render();
 for(const label of ['Platform overview','Insurer dashboard','Fleet dashboard','Vehicle register','Manage cover','Reconciliation','Drivers &amp; licences','Claims / FNOL','Fleet CRM'])assert(view.app.innerHTML.includes(label));
 assert.match(view.app.innerHTML,/requires platform administrator membership/);
 assert(!view.app.innerHTML.includes('Fleet portfolio'));
 for(const page of ['drivers','claims','crm']){view.state.page=page;view.render();assert.match(view.app.innerHTML,/not available yet/);}
});
test('Users page: only administrators see it, each sees only the organisations they may manage',()=>{
 const orgs=[{id:'plat',kind:'platform',name:'Platform'},{id:'ins1',kind:'insurer',name:'Insurer One'},{id:'ins2',kind:'insurer',name:'Insurer Two'},{id:'f1',kind:'customer',name:'Fleet One',insurer_id:'ins1'},{id:'f2',kind:'customer',name:'Fleet Two',insurer_id:'ins2'}];
 const as=(role,organisation_id)=>{
  const view=ui();view.state.demo=false;view.state.user={id:'u1',email:'me@example.invalid'};
  view.state.data={...structuredClone(demo),organisations:orgs,memberships:[{role,organisation_id,active:true}]};
  view.state.page='users';view.state.members={rows:[{id:'m1',user_id:'u2',email:'other@example.invalid',role:'fleet_manager',active:true,pending:false},{id:'m2',user_id:'u1',email:'me@example.invalid',role:'fleet_admin',active:true,pending:false},{id:'i1',email:'new@example.invalid',role:'fleet_manager',active:true,pending:true}]};
  view.render();return view.app.innerHTML;
 };
 const platform=as('platform_super_admin','plat'),insurer=as('insurer_admin','ins1'),fleet=as('fleet_admin','f1'),claims=as('insurer_claims','ins1');
 assert(!platform.includes('undefined')&&!insurer.includes('undefined')&&!fleet.includes('undefined'));
 assert.match(platform,/Insurer Two/);assert.match(platform,/Fleet Two/);
 assert.match(insurer,/Fleet One/);assert.doesNotMatch(insurer,/Insurer Two|Fleet Two/);
 assert.doesNotMatch(fleet,/Insurer One|Fleet Two|Insurer Two/);
 assert.doesNotMatch(claims,/members-org/);assert.doesNotMatch(claims,/data-page="users"/);
 assert.match(platform,/data-page="users"/);
 // you cannot edit your own row; invitations can be cancelled; others can be switched off
 assert.doesNotMatch(fleet,/Role for me@example/);assert.match(fleet,/Role for other@example/);assert.match(fleet,/Cancel invitation/);assert.match(fleet,/Switch off access/);
 const demoView=ui();demoView.state.page='users';demoView.render();assert.doesNotMatch(demoView.app.innerHTML,/data-page="users"/);
});
