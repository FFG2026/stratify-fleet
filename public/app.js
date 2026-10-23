import {insuredDays,csv} from '/coverage.mjs';
const $=s=>document.querySelector(s);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const state={page:'overview',month:new Date().toLocaleDateString('en-CA',{timeZone:'Europe/London'}).slice(0,7),search:'',policy:'',status:'all',offset:0,data:null,user:null,demo:false,savedReport:null,fleetPage:null,fleetLoading:false,fleetError:'',removalPage:null,removalSearch:'',removalOffset:0,historyPage:null,historyOffset:0,historyLoading:false,pageRequest:0,coverMode:'add',members:null,membersOrg:'',dash:null,dashError:'',insurerFilter:''};
const dateToday=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/London',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const brandLogo='<img class="brand-logo" src="/stratify-logo.png" alt="Stratify" width="2048" height="688">';
const names={overview:['Platform overview','Your insurers, customers and operations. In one place.'],insurer:['Insurer dashboard','Confidence across every fleet in your book.'],customer:['Fleet dashboard','Your fleet, covered. Every change accounted for.'],fleet:['Vehicle register','A single source of truth for every vehicle.'],changes:['Manage cover','Precise effective dates. A permanent record of every change.'],reconciliation:['Reconciliation','Coverage reconciled down to the vehicle.'],users:['Users','Who can sign in, and what each person can see.']};
const planned={drivers:['Drivers & licences','Driver records, documents and licence-check permissions.'],claims:['Claims / FNOL','Incident reporting, photos, third-party details and shared claim progress.'],crm:['Fleet CRM','Fleet contacts, activity history and driver communications.']};
const api=async(path,options={})=>{const res=await fetch('/api/'+path,{...options,headers:{'Content-Type':'application/json'}});const data=await res.json();if(!res.ok){if(res.status===401&&state.user){state.user=null;login();}throw new Error(data.error||'Request failed.');}return data;};
function notify(message){$('#message').textContent=message;clearTimeout(state.timer);state.timer=setTimeout(()=>$('#message').textContent='',6500);}
function policyFor(row){return state.data.policies.find(p=>p.id===row.policy_id);}
function endFor(row){const end=policyFor(row)?.ends_on;return row.ends_on&&(!end||row.ends_on<end)?row.ends_on:end||row.ends_on;}
function active(row){const today=dateToday();return row.starts_on<=today&&(!endFor(row)||endFor(row)>today);}
function status(row){return active(row)?'Covered':row.starts_on>dateToday()?'Scheduled':'Removed / expired';}
function org(id){return state.data.organisations.find(o=>o.id===id)?.name||'—';}
function periods(){if(!state.demo&&state.page==='fleet')return state.fleetPage?.rows||[];return state.data.coverage_periods.filter(r=>(!state.policy||r.policy_id===state.policy)&&(!state.search||(r.registration+' '+r.make+' '+r.model).toLowerCase().includes(state.search.toLowerCase()))&&(state.status==='all'||(state.status==='active'?active(r):state.status==='closed'?!!r.ends_on:state.status==='scheduled'?r.starts_on>dateToday():!r.ends_on)));}
function reports(){if(state.savedReport){const map=new Map();for(const line of state.savedReport.lines){const key=line.policy_id+':'+line.registration;const row=map.get(key);if(row)row.days+=line.days;else map.set(key,{...line,days:line.days});}return [...map.values()];}if(!state.demo)return [];const result=new Map();for(const row of periods()){const days=insuredDays(row.starts_on,endFor(row),state.month);if(!days)continue;const key=row.policy_id+':'+row.registration;const existing=result.get(key);if(existing)existing.days+=days;else result.set(key,{...row,days});}return [...result.values()];}
const badge=(text,warn=false)=>'<span class="badge'+(warn?' warning':'')+'">'+esc(text)+'</span>';
function roles(){return (state.data?.memberships||[]).filter(m=>m.active).map(m=>m.role);}
function canChange(){return !state.demo&&roles().some(r=>['platform_super_admin','insurer_admin','fleet_admin','fleet_manager'].includes(r));}
function canManageUsers(){return !state.demo&&roles().some(r=>['platform_super_admin','insurer_admin','fleet_admin'].includes(r));}
function manageableOrgs(){
 const m=(state.data?.memberships||[]).filter(x=>x.active);
 if(m.some(x=>x.role==='platform_super_admin'))return state.data.organisations;
 const own=new Set(m.filter(x=>['insurer_admin','fleet_admin'].includes(x.role)).map(x=>x.organisation_id));
 return state.data.organisations.filter(o=>own.has(o.id)||(o.kind==='customer'&&own.has(o.insurer_id)));
}
const roleLabels={platform_super_admin:'Platform administrator',insurer_admin:'Insurer administrator',insurer_claims:'Insurer claims',insurer_accounts:'Insurer accounts',fleet_admin:'Fleet administrator',fleet_manager:'Fleet manager',fleet_accounts:'Fleet accounts',driver:'Driver'};
const rolesForKind=kind=>kind==='platform'?['platform_super_admin']:kind==='insurer'?['insurer_admin','insurer_claims','insurer_accounts']:['fleet_admin','fleet_manager','fleet_accounts','driver'];
function usersPage(){
 if(!canManageUsers())return '<section class="panel"><div class="panel-body"><h2>User management</h2><p>This page is available to platform, insurer and fleet administrators.</p></div></section>';
 const orgs=manageableOrgs(),current=orgs.find(o=>o.id===state.membersOrg)||orgs[0];
 if(!current)return '<section class="panel"><div class="panel-body"><p>No organisations are available to manage.</p></div></section>';
 const page=state.members;
 const roleOptions=selected=>rolesForKind(current.kind).map(r=>'<option value="'+r+'" '+(r===selected?'selected':'')+'>'+esc(roleLabels[r])+'</option>').join('');
 const rows=(page?.rows||[]).map(r=>{
  const self=!r.pending&&r.user_id===state.user.id;
  return '<tr><td><strong>'+esc(r.email)+'</strong>'+(self?'<div class="subtext">This is you</div>':'')+'</td><td>'+(r.pending||self?esc(roleLabels[r.role]):'<select data-member-role="'+esc(r.id)+'" aria-label="Role for '+esc(r.email)+'">'+roleOptions(r.role)+'</select>')+'</td><td>'+(r.pending?badge('Invitation pending',true):r.active?badge('Active'):badge('Switched off',true))+'</td><td>'+(r.pending?'<button data-revoke="'+esc(r.id)+'">Cancel invitation</button>':self?'—':'<button data-member-active="'+esc(r.id)+'" data-next="'+(!r.active)+'">'+(r.active?'Switch off access':'Restore access')+'</button>')+'</td></tr>';
 }).join('');
 return '<div class="notice"><strong>Who can see what.</strong> Platform administrators see everything. Insurer users see their own customers and those customers\' vehicles. Fleet users see only their own fleet. These limits are enforced by the database. You cannot change your own access, and an organisation always keeps one active administrator.</div>'
  +'<div class="filters"><label>Organisation<select id="members-org">'+orgs.map(o=>'<option value="'+esc(o.id)+'" '+(o.id===current.id?'selected':'')+'>'+esc(o.name)+' ('+esc(o.kind==='customer'?'fleet customer':o.kind)+')</option>').join('')+'</select></label></div>'
  +'<div class="panel"><div class="panel-header"><h2>People in '+esc(current.name)+'</h2></div>'+(state.membersLoading?'<p class="panel-body" role="status">Loading people...</p>':'')+(state.membersError?'<div class="notice" role="alert">'+esc(state.membersError)+'</div>':'')+'<div class="table-scroll"><table><thead><tr><th>EMAIL</th><th>ROLE</th><th>STATUS</th><th>ACTION</th></tr></thead><tbody>'+rows+'</tbody></table></div>'+(page&&!page.rows.length&&!state.membersLoading?'<div class="empty">No one has been added yet.</div>':'')+'</div>'
  +'<div class="panel"><div class="panel-header"><h2>Add a person</h2></div><div class="panel-body"><form id="member-form" class="filters"><label>Email<input name="email" type="email" required maxlength="254" autocomplete="off"></label><label>Role<select name="role">'+roleOptions('')+'</select></label><button class="primary" type="submit">Add person</button></form><p class="subtext">If the person already has a Stratify login they get access immediately. Otherwise the invitation is held and applies the first time they sign in with that email address. No email is sent from here yet, so create their login first and tell them it is ready.</p></div></div>';
}
function canGenerate(){return !state.demo&&roles().some(r=>['platform_super_admin','insurer_admin','insurer_accounts','fleet_admin','fleet_accounts'].includes(r));}
function visiblePage(key){if(state.demo)return true;const r=roles();return key==='overview'?r.includes('platform_super_admin'):key==='insurer'?r.some(role=>role==='platform_super_admin'||role.startsWith('insurer_')):true;}
function render(){
 const [title,subtitle]=names[state.page]||planned[state.page]||names.overview;
 const icons=['◈','▦','⌂','▤','⇄','▥','◎'];
 const initials=(state.user.email||'S').slice(0,2).toUpperCase();
 $('#app').innerHTML='<div class="shell"><aside class="sidebar"><div class="brand">'+brandLogo+'</div><nav aria-label="Main navigation"><div class="nav-label">Workspace</div>'+Object.entries(names).filter(([key])=>key!=='users'||canManageUsers()).map(([key,[label]],i)=>'<button data-page="'+key+'" class="'+(state.page===key?'active':'')+'" '+(state.page===key?'aria-current="page"':'')+'><span class="nav-icon">'+icons[i]+'</span>'+esc(label)+'</button>').join('')+'<div class="nav-label expand-label">Expand your workspace</div>'+Object.entries(planned).map(([key,[label]])=>'<button data-page="'+key+'" class="future '+(state.page===key?'active':'')+'" '+(state.page===key?'aria-current="page"':'')+'>'+esc(label)+'<span class="soon">SOON</span></button>').join('')+'</nav><div class="sidebar-footer"><strong>Designed for the road ahead.</strong><br>Fleet insurance, connected.<br><span>STRATIFY PLATFORM · DEVELOPMENT</span></div></aside><div class="main"><header class="topbar"><label class="workspace-picker"><span class="sr-only">Policy workspace</span><select id="workspace-policy"><option value="">All authorised workspaces</option>'+state.data.policies.map(p=>'<option value="'+esc(p.id)+'" '+(p.id===state.policy?'selected':'')+'>'+esc(org(p.customer_id))+' · '+esc(p.reference)+'</option>').join('')+'</select></label><div class="account">'+badge(state.demo?'DEMO · READ-ONLY':'DEVELOPMENT',true)+'<span class="avatar">'+esc(initials)+'</span><span class="email">'+esc(state.user.email)+'</span>'+'<button id="logout">'+(state.demo?'Exit demo':'Sign out')+'</button>'+'</div></header><main><div class="breadcrumb">STRATIFY &nbsp; / &nbsp; '+(state.page==='overview'?'PLATFORM CONTROL':state.page==='reconciliation'?'FINANCE':'WORKSPACE')+'</div><div class="heading"><div><h1>'+esc(state.page==='overview'?'A clear view of your entire portfolio.':title)+'</h1><p>'+esc(subtitle)+'</p></div><div class="actions">'+pageActions()+'</div></div>'+(state.demo?'<div class="notice">Demonstration workspace · Fictional records · Saving is disabled. Selected month: '+esc(state.month)+'.</div>':'')+content()+'<p class="workspace-note">◇ '+(state.demo?'Demo workspace · Synthetic data':'Development workspace · Authorised records only')+' · No live MIB / MID connection</p></main></div></div>';
 bind();
}
function pageActions(){
 if(planned[state.page])return '<button data-page="customer">← Fleet dashboard</button>';
 if(state.page==='overview')return '<button data-page="insurer">Open insurer workspace →</button><button class="primary" data-page="reconciliation">Review reconciliation →</button>';
 if(state.page==='insurer')return '<button data-page="fleet">View vehicle register</button><button class="primary" data-page="reconciliation">Review reconciliation →</button>';
 if(state.page==='changes')return '<button data-page="fleet">← Vehicle register</button>';
 if(state.page==='reconciliation')return '<button id="print-report">↓ PDF / Print</button>';
 return '<button data-page="reconciliation">Open reconciliation →</button><button class="primary" data-page="changes">＋ Add vehicle</button>';
}
function filters(includeSearch=true){return '<div class="filters">'+(includeSearch?'<label>Search vehicles<input id="search" maxlength="80" type="search" placeholder="Registration, make or model" value="'+esc(state.search)+'"></label>':'')+'<label>Policy<select id="policy"><option value="">All authorised policies</option>'+state.data.policies.map(p=>'<option value="'+esc(p.id)+'" '+(p.id===state.policy?'selected':'')+'>'+esc(p.reference)+'</option>').join('')+'</select></label>'+(state.page==='reconciliation'?'<label>Report month<input id="month" type="month" value="'+esc(state.month)+'" required></label>':'')+'</div>';}
function stats(){
 const rows=periods(),count=state.data.summary?.covered??rows.filter(active).length;
 return '<div class="stats">'+[['Covered vehicles',count,'As at '+dateToday()],['Customers',state.data.organisations.filter(o=>o.kind==='customer').length,'Within your permitted portfolio'],['Policies',state.data.policies.length,'Authorised policy records'],['Coverage periods',state.data.summary?.periods??rows.length,'Historical and current records']].map(([label,value,note])=>'<div class="stat"><div class="stat-label">'+label+'</div><div class="stat-number">'+Number(value).toLocaleString('en-GB')+'</div><div class="stat-note">'+esc(note)+'</div></div>').join('')+'</div>';
}
function content(){
 if(planned[state.page])return '<section class="panel planned-panel"><div class="panel-body"><span class="badge warning">PLANNED MODULE</span><h2>'+esc(planned[state.page][0])+'</h2><p>'+esc(planned[state.page][1])+'</p><p>This module is on the roadmap. It is not available yet.</p><button data-page="customer">Return to fleet dashboard →</button></div></section>';
 if(!visiblePage(state.page))return '<section class="panel"><div class="panel-body"><h2>'+esc(names[state.page][0])+' access</h2><p>This dashboard requires '+(state.page==='overview'?'platform administrator':'insurer or platform administrator')+' membership. Your current account has not been assigned this access.</p><button data-page="customer">Open your fleet dashboard →</button></div></section>';
 if(state.page==='fleet')return stats()+filters()+(state.fleetLoading?'<p role="status">Loading vehicles...</p>':'')+(state.fleetError?'<div class="notice" role="alert">'+esc(state.fleetError)+'</div>':'')+'<div class="panel"><div class="panel-header"><h2>Coverage register</h2><label>Show<select id="status"><option value="all">All periods</option><option value="active" '+(state.status==='active'?'selected':'')+'>Currently covered</option><option value="closed" '+(state.status==='closed'?'selected':'')+'>Closed periods</option><option value="scheduled" '+(state.status==='scheduled'?'selected':'')+'>Scheduled additions</option></select></label></div>'+fleetTable(periods(),true)+'</div>';
 if(state.page==='users')return usersPage();
 if(state.page==='changes')return changeForms();
 if(state.page==='reconciliation')return reportPage();
 return dashboard();
}
function activityPanel(){return '<div class="panel"><div class="panel-header"><h2>Coverage activity</h2><button class="textbtn" data-page="changes">Manage cover →</button></div><div class="panel-body"><div class="timeline">'+(state.data.audit_events.slice(0,5).map(e=>'<div class="event"><strong>'+esc(e.registration)+'</strong> · '+esc(e.action.replaceAll('_',' '))+'<p>'+esc(new Date(e.created_at).toLocaleString('en-GB',{timeZone:'Europe/London'}))+'</p></div>').join('')||'<div class="event"><strong>Workspace ready</strong><p>Recorded changes will appear here with their effective dates and audit history.</p></div>')+'</div></div></div>';}
function liveDashboard(){
 if(state.dashError)return '<div class="notice" role="alert">'+esc(state.dashError)+'</div>';
 const d=state.dash;if(!d)return '<p role="status">Loading live figures...</p>';
 const fleets=d.fleets,sum=k=>fleets.reduce((a,f)=>a+Number(f[k]||0),0),c=d.counts;
 const insurers=state.data.organisations.filter(o=>o.kind==='insurer');
 const pickInsurer=state.page==='insurer'&&insurers.length>1?'<div class="filters"><label>Insurer<select id="insurer-filter"><option value="">All authorised insurers</option>'+insurers.map(o=>'<option value="'+esc(o.id)+'" '+(o.id===state.insurerFilter?'selected':'')+'>'+esc(o.name)+'</option>').join('')+'</select></label></div>':'';
 const statCards=[['Fleet customers',fleets.length,'In this view'],['Vehicles on cover',sum('vehicles_on_cover'),'Covered right now'],['Added / removed (7 days)',c.added7+' / '+c.removed7,'Recorded changes'],['Scheduled changes',c.scheduledAdds+c.scheduledRemovals,c.scheduledAdds+' additions · '+c.scheduledRemovals+' removals in the next 7 days']];
 const stat='<div class="stats">'+statCards.map(([l,v,n])=>'<div class="stat"><div class="stat-label">'+esc(l)+'</div><div class="stat-number">'+(typeof v==='number'?v.toLocaleString('en-GB'):esc(v))+'</div><div class="stat-note">'+esc(n)+'</div></div>').join('')+'</div>';
 const fleetName=id=>fleets.find(f=>f.fleet_id===id)?.fleet_name||org(id);
 const events='<div class="panel"><div class="panel-header"><h2>Latest changes</h2><button class="textbtn" data-page="changes">Manage cover →</button></div><div class="panel-body"><div class="timeline">'+(d.events.map(e=>'<div class="event"><strong>'+esc(e.details?.registration||'Vehicle')+'</strong> · '+esc(e.event_type==='cover_added'?'added to cover':e.event_type==='cover_removed'?'removed from cover':'cover record corrected')+' · '+esc(fleetName(e.fleet_id))+'<p>Effective '+esc(new Date(e.effective_at).toLocaleDateString('en-GB',{timeZone:'Europe/London'}))+' · recorded '+esc(new Date(e.recorded_at).toLocaleString('en-GB',{timeZone:'Europe/London'}))+'</p></div>').join('')||'<div class="event"><strong>No changes recorded yet</strong><p>Vehicles added or removed will appear here.</p></div>')+'</div></div></div>';
 const attention='<section class="panel sage"><div class="panel-body"><div class="cardhead"><h2>Needs your attention</h2>'+badge('Live')+'</div><div class="attention"><span class="attention-icon">'+esc(String(c.scheduledAdds+c.scheduledRemovals))+'</span><div><h3>Scheduled cover changes</h3><p>Taking effect in the next 7 days.</p></div></div><div class="attention"><span class="attention-icon">'+esc(String(c.provisionalReports))+'</span><div><h3>Provisional reconciliations</h3><p>Generated in the last 30 days. None can be finalised yet.</p></div><button class="textbtn" data-page="reconciliation" aria-label="Open reconciliation">↗</button></div><div class="attention"><span class="attention-icon">⇄</span><div><h3>MIB / MID integration</h3><p>Not connected. No external submissions are sent.</p></div></div></div></section>';
 const table='<section class="panel"><div class="panel-header"><div><h2>Fleet portfolio</h2><p class="subtext">Vehicles per customer, from live records</p></div><span class="muted">'+fleets.length+' fleets</span></div><div class="table-scroll"><table><thead><tr><th>Customer</th><th>Insurer</th><th>Vehicles</th><th>On cover</th><th>Scheduled</th><th>Workspace</th></tr></thead><tbody>'+fleets.map(f=>{const pol=state.data.policies.find(p=>p.customer_id===f.fleet_id);return '<tr><td><div class="company"><span class="company-logo">'+esc(f.fleet_name.slice(0,1))+'</span><strong>'+esc(f.fleet_name)+'</strong></div></td><td>'+esc(org(f.insurer_id))+'</td><td>'+Number(f.vehicles_total).toLocaleString('en-GB')+'</td><td>'+Number(f.vehicles_on_cover).toLocaleString('en-GB')+'</td><td>'+Number(f.vehicles_scheduled).toLocaleString('en-GB')+'</td><td>'+(pol?'<button class="textbtn" data-open-policy="'+esc(pol.id)+'">Open fleet ↗</button>':'—')+'</td></tr>';}).join('')+'</tbody></table></div>'+(!fleets.length?'<div class="empty">No fleet customers in this view.</div>':'')+'</section>';
 return pickInsurer+stat+'<div class="grid-two">'+events+attention+'</div>'+table;
}
function dashboard(){
 if(!state.demo&&(state.page==='overview'||state.page==='insurer'))return liveDashboard();
 const customers=state.data.organisations.filter(o=>o.kind==='customer');
 const insurers=state.data.organisations.filter(o=>o.kind==='insurer');
 const membership=roles().length;
 const attention='<section class="panel sage"><div class="panel-body"><div class="cardhead"><h2>Needs your attention</h2>'+badge('Workspace checks')+'</div><div class="attention"><span class="attention-icon">'+(membership||state.demo?'✓':'!')+'</span><div><h3>Organisation access</h3><p>'+(state.demo?'Demonstration workspace':membership?'Your membership controls which records you can view.':'Your account needs an organisation membership before records are available.')+'</p></div></div><div class="attention"><span class="attention-icon">▥</span><div><h3>Month-end reconciliation</h3><p>Review saved statements and insured vehicle-days.</p></div><button class="textbtn" data-page="reconciliation" aria-label="Open reconciliation">↗</button></div><div class="attention"><span class="attention-icon">⇄</span><div><h3>MIB / MID integration</h3><p>Not connected. No external submissions are sent.</p></div></div></div></section>';
 const portfolio='<section class="panel"><div class="panel-header"><div><h2>Fleet portfolio</h2><p class="subtext">Customers in your authorised workspace</p></div><span class="muted">'+customers.length+' fleets</span></div><div class="table-scroll"><table><thead><tr><th>Customer</th><th>Insurer</th><th>Policies</th><th>Workspace</th></tr></thead><tbody>'+customers.map(o=>{const policies=state.data.policies.filter(p=>p.customer_id===o.id);const insurerNames=[...new Set(policies.map(p=>org(p.insurer_id)))];return '<tr><td><div class="company"><span class="company-logo">'+esc(o.name.slice(0,1))+'</span><strong>'+esc(o.name)+'</strong></div></td><td>'+esc(insurerNames.join(', ')||'—')+'</td><td>'+policies.length+'</td><td>'+(policies.length?'<button class="textbtn" data-open-policy="'+esc(policies[0].id)+'">Open fleet ↗</button>':'—')+'</td></tr>';}).join('')+'</tbody></table></div>'+(!customers.length?'<div class="empty">No authorised organisations yet. Your administrator must assign organisation membership.</div>':'')+'</section>';
 const insurerList=state.page==='overview'?'<div class="notice">'+insurers.length+' insurer workspaces · '+customers.length+' fleet customers · All figures reflect records available to your signed-in account.</div>':'';
 return stats()+'<div class="grid-two">'+activityPanel()+attention+'</div>'+insurerList+portfolio+'<div class="panel"><div class="panel-header"><h2>Recent coverage periods</h2><button class="textbtn" data-page="fleet">View vehicle register →</button></div>'+fleetTable(state.data.coverage_periods.slice(0,5),false)+'</div>';
}
function fleetTable(rows,paginated){
 const page=paginated&&state.demo?rows.slice(state.offset,state.offset+25):rows;
 return '<div class="table-scroll"><table><thead><tr><th>REGISTRATION</th><th>VEHICLE</th><th>POLICY</th><th>START DATE</th><th>REMOVAL DATE</th><th>STATUS</th></tr></thead><tbody>'+page.map(r=>'<tr><td><span class="registration">'+esc(r.registration)+'</span></td><td><strong>'+esc(r.make)+'</strong><div class="subtext">'+esc(r.model)+'</div></td><td>'+esc(policyFor(r)?.reference)+'</td><td>'+esc(r.starts_on)+'</td><td>'+esc(r.ends_on||'Open period')+'</td><td>'+badge(status(r),!active(r))+'</td></tr>').join('')+'</tbody></table></div>'+(!rows.length?'<div class="empty">No vehicles match this view.</div>':'')+(paginated?pagination(state.demo?rows.length:state.fleetPage?.total||0):'');
}
function pagination(length){return '<div class="pagination"><span>'+ (length?state.offset+1:0)+'–'+Math.min(length,state.offset+25)+' of '+length+'</span><div class="actions"><button id="prev" '+(!state.offset?'disabled':'')+'>Previous</button><button id="next" '+(state.offset+25>=length?'disabled':'')+'>Next</button></div></div>';}
function changeForms(){
 return '<div class="tabs" role="tablist" aria-label="Coverage change"><button role="tab" id="add-tab" aria-controls="add-panel" aria-selected="'+(state.coverMode==='add')+'" data-cover-mode="add" class="'+(state.coverMode==='add'?'active':'')+'">＋ Add vehicle</button><button role="tab" id="remove-tab" aria-controls="remove-panel" aria-selected="'+(state.coverMode==='remove')+'" data-cover-mode="remove" class="'+(state.coverMode==='remove'?'active':'')+'">− Remove vehicle</button></div><div class="notice">Development rules: coverage starts on the addition date and ends before the removal date. Same-day removal and backdated changes require an approval process and are currently blocked. No MID submissions are sent.</div><div class="cover-layout"><div><section class="panel" role="tabpanel" id="add-panel" aria-labelledby="add-tab" '+(state.coverMode==='add'?'':'hidden')+'><div class="panel-header"><h2>Add vehicle to a policy</h2>'+badge('Effective date required')+'</div><div class="panel-body"><form id="add-form"><label>Policy<select name="policy_id" required><option value="">Select a policy</option>'+state.data.policies.map(p=>'<option value="'+esc(p.id)+'">'+esc(p.reference)+' · '+esc(org(p.customer_id))+'</option>').join('')+'</select></label><div class="form-grid"><label>Registration<span class="lookup-row"><input name="registration" required maxlength="12" placeholder="e.g. AB26 CDE" autocomplete="off"><button type="button" id="lookup-reg">Look up</button></span></label><label>Cover starts on<input name="starts_on" type="date" min="'+dateToday()+'" value="'+dateToday()+'" required></label><label>Make<input name="make" maxlength="100" required placeholder="e.g. Ford"></label><label>Model<input name="model" maxlength="100" required placeholder="e.g. Transit Custom"></label></div><div id="lookup-result" class="form-note" role="status" aria-live="polite"></div><div class="form-note">This records a coverage instruction in the development workspace. Insurance and MID workflows require insurer approval before production use.</div><button class="primary" '+(!canChange()?'disabled':'')+'>Record addition</button></form></div></section><section class="panel" role="tabpanel" id="remove-panel" aria-labelledby="remove-tab" '+(state.coverMode==='remove'?'':'hidden')+'><div class="panel-header"><h2>Remove a vehicle</h2></div><div class="panel-body"><label>Find a vehicle<input id="removal-search" type="search" maxlength="80" value="'+esc(state.removalSearch)+'" placeholder="Registration or vehicle name"></label><p class="form-note">Showing up to 25 open periods. Search to narrow the list.</p><div class="actions"><button id="removal-prev" '+(!state.removalOffset?'disabled':'')+'>Previous</button><button id="removal-next" '+(state.demo||state.removalOffset+25>=(state.removalPage?.total||0)?'disabled':'')+'>Next</button></div><form id="remove-form"><label>Open coverage period<select name="period_id" required><option value="">Select a vehicle</option>'+(state.demo?state.data.coverage_periods.filter(r=>!r.ends_on):(state.removalPage?.rows||[])).map(r=>'<option value="'+esc(r.id)+'">'+esc(r.registration)+' · '+esc(policyFor(r)?.reference)+' · from '+esc(r.starts_on)+'</option>').join('')+'</select></label><label>First date without cover<input type="date" name="ends_on" min="'+dateToday()+'" required></label><div class="form-note">The removal date is excluded from insured days. Closing a period preserves its history. Re-adding a vehicle creates a new period.</div><button '+(!canChange()?'disabled':'')+'>Record removal</button></form></div></section></div>'+activityPanel()+'</div>';
}
function reportPage(){
 const rows=reports();return '<div class="notice"><strong>Provisional report.</strong> '+(state.savedReport?'Saved database report '+esc(state.savedReport.report.id)+'. Rules snapshot: '+esc(state.savedReport.report.rules_source)+'.':'Select a policy and generate a report, or reopen a saved report below. Reports retain the rules and rates used at generation.')+' Saved reports follow their stored rules snapshot. The date-only preview includes the start date and excludes the removal date. Report finalisation is not available.</div>'+filters(false)+'<div class="panel"><div class="panel-header"><h2>Vehicle-day statement</h2><div class="actions"><button id="generate" class="primary">Generate saved report</button><button id="export">Export CSV ↓</button></div></div><div class="report-summary"><div><strong>'+rows.length.toLocaleString('en-GB')+'</strong><span>VEHICLES IN MONTH</span></div><div><strong>'+rows.reduce((n,r)=>n+r.days,0).toLocaleString('en-GB')+'</strong><span>INSURED VEHICLE-DAYS</span></div><div><strong>'+esc(state.month)+'</strong><span>REPORTING MONTH</span></div></div><div class="table-scroll"><table><thead><tr><th>REGISTRATION</th><th>CUSTOMER</th><th>POLICY</th><th>INSURED DAYS</th><th>REPORT STATUS</th></tr></thead><tbody>'+rows.slice(state.offset,state.offset+25).map(r=>'<tr><td><span class="registration">'+esc(r.registration)+'</span></td><td>'+esc(org(policyFor(r)?.customer_id))+'</td><td>'+esc(policyFor(r)?.reference)+'</td><td><strong>'+r.days+'</strong></td><td>'+badge('Provisional',true)+'</td></tr>').join('')+'</tbody></table></div>'+(!rows.length?'<div class="empty">'+(!state.demo&&!state.savedReport?'Generate or open a saved report to view insured days.':'No insured days in this month.')+'</div>':'')+pagination(rows.length)+'</div>'+historyPanel();
}
function setupMobileNavigation(){
 const sidebar=$('.sidebar');if(!sidebar)return;
 const nav=sidebar.querySelector('nav');nav.id='workspace-navigation';
 sidebar.insertAdjacentHTML('afterbegin','<div class="mobile-navigation-header"><a class="mobile-navigation-brand" href="/" aria-label="Stratify home">'+brandLogo+'</a><button type="button" id="menu-toggle" aria-controls="workspace-navigation" aria-expanded="false" aria-label="Open navigation menu"><span class="hamburger" aria-hidden="true"><span></span><span></span><span></span></span><span>Menu</span></button></div>');
 const toggle=$('#menu-toggle');
 const close=()=>{sidebar.classList.remove('menu-open');toggle.setAttribute('aria-expanded','false');toggle.setAttribute('aria-label','Open navigation menu');};
 toggle.onclick=()=>{
  const open=sidebar.classList.toggle('menu-open');
  toggle.setAttribute('aria-expanded',String(open));
  toggle.setAttribute('aria-label',open?'Close navigation menu':'Open navigation menu');
 };
 sidebar.onkeydown=e=>{if(e.key==='Escape'){close();toggle.focus();}};
 nav.addEventListener('click',e=>{if(e.target.closest('[data-page]'))close();});
}
function bind(){
 setupMobileNavigation();
 if($('#insurer-filter'))$('#insurer-filter').onchange=e=>{state.insurerFilter=e.target.value;state.dash=null;refreshPage();};
 if($('#members-org'))$('#members-org').onchange=e=>{state.membersOrg=e.target.value;state.members=null;refreshPage();};
 if($('#member-form'))$('#member-form').onsubmit=e=>{e.preventDefault();const d=Object.fromEntries(new FormData(e.target));e.target.querySelector('button').disabled=true;memberAction('members',{org:state.membersOrg,email:d.email,role:d.role},r=>r.result==='added'?'Added. They have access now.':'Invitation saved. It applies when they first sign in.');};
 document.querySelectorAll('[data-member-role]').forEach(el=>el.onchange=()=>memberAction('members/role',{membership:el.dataset.memberRole,role:el.value},()=>'Role updated and recorded in the audit trail.'));
 document.querySelectorAll('[data-member-active]').forEach(el=>el.onclick=()=>{el.disabled=true;memberAction('members/active',{membership:el.dataset.memberActive,active:el.dataset.next==='true'},()=>el.dataset.next==='true'?'Access restored.':'Access switched off.');});
 document.querySelectorAll('[data-revoke]').forEach(el=>el.onclick=()=>{el.disabled=true;memberAction('members/revoke',{invitation:el.dataset.revoke},()=>'Invitation cancelled.');});
 if($('#print-report'))$('#print-report').onclick=()=>window.print();
 document.querySelectorAll('[data-cover-mode]').forEach(button=>button.onclick=()=>{state.coverMode=button.dataset.coverMode;render();$('#'+state.coverMode+'-tab')?.focus();});
 document.querySelectorAll('[data-open-policy]').forEach(button=>button.onclick=()=>{state.policy=button.dataset.openPolicy;state.savedReport=null;state.offset=0;state.page='fleet';refreshPage();});
 if($('#workspace-policy'))$('#workspace-policy').onchange=e=>{if(!['fleet','changes','reconciliation'].includes(state.page))state.page='fleet';state.policy=e.target.value;state.savedReport=null;state.offset=0;state.removalOffset=0;state.historyOffset=0;refreshPage();};

 if($('#removal-search'))$('#removal-search').oninput=e=>{state.removalSearch=e.target.value;state.removalOffset=0;clearTimeout(state.searchTimer);state.searchTimer=setTimeout(()=>refreshPage('removal-search'),250);};
 if($('#removal-prev'))$('#removal-prev').onclick=()=>{state.removalOffset=Math.max(0,state.removalOffset-25);refreshPage();};
 if($('#removal-next'))$('#removal-next').onclick=()=>{state.removalOffset+=25;refreshPage();};
 if($('#history-prev'))$('#history-prev').onclick=()=>{state.historyOffset=Math.max(0,state.historyOffset-25);refreshPage();};
 if($('#history-next'))$('#history-next').onclick=()=>{state.historyOffset+=25;refreshPage();};
 document.querySelectorAll('[data-report]').forEach(button=>button.onclick=async()=>{
  button.disabled=true;const request=++state.pageRequest;
  try{const report=await api('reconciliations/'+button.dataset.report);if(request!==state.pageRequest||state.page!=='reconciliation')return;state.savedReport=report;state.offset=0;render();notify('Opened the saved report snapshot.');}catch(e){notify(e.message);button.disabled=false;}
 });

 document.querySelectorAll('[data-page]').forEach(el=>el.onclick=()=>{state.page=el.dataset.page;state.offset=0;state.fleetPage=null;state.dash=null;state.dashError='';state.fleetError='';refreshPage();});
 if($('#policy'))$('#policy').onchange=e=>{state.policy=e.target.value;state.savedReport=null;state.offset=0;state.removalOffset=0;state.historyOffset=0;refreshPage();};
 if($('#status'))$('#status').onchange=e=>{state.status=e.target.value;state.offset=0;refreshPage();};
 if($('#month'))$('#month').onchange=e=>{if(!e.target.value)return;state.month=e.target.value;state.savedReport=null;state.offset=0;state.historyOffset=0;refreshPage();};
 if($('#search'))$('#search').oninput=e=>{state.search=e.target.value;state.offset=0;clearTimeout(state.searchTimer);state.searchTimer=setTimeout(()=>refreshPage('search'),250);};
 if($('#prev'))$('#prev').onclick=()=>{state.offset=Math.max(0,state.offset-25);refreshPage();};
 if($('#next'))$('#next').onclick=()=>{state.offset+=25;refreshPage();};
 if($('#logout'))$('#logout').onclick=async()=>{try{await api('logout',{method:'POST',body:'{}'});state.user=null;state.data=null;state.demo=false;state.policy='';state.savedReport=null;state.page='overview';state.offset=0;await init();}catch(e){notify(e.message);}};
 if($('#lookup-reg'))$('#lookup-reg').onclick=async e=>{
   const form=$('#add-form'),out=$('#lookup-result'),btn=e.target,reg=form.elements.registration.value.trim();
   if(!reg){out.textContent='Enter a registration first.';return;}
   btn.disabled=true;out.textContent='Looking up…';
   try{
    const v=await api('vehicle-lookup?reg='+encodeURIComponent(reg));
    form.elements.registration.value=v.registration;form.elements.make.value=v.make;
    const bits=[v.colour,v.fuelType&&v.fuelType.toLowerCase(),v.yearOfManufacture].filter(Boolean).join(' · ');
    out.textContent='DVLA found: '+v.make+(bits?' ('+bits+')':'')+'. Now enter the model. This does not confirm the vehicle is insured.';
   }catch(error){out.textContent=error.message;}
   btn.disabled=false;
  };
 for(const [id,path] of [['add-form','coverage'],['remove-form','removal']])if($('#'+id))$('#'+id).onsubmit=async e=>{
   e.preventDefault();const button=e.target.querySelector('button:not([type=button])');button.disabled=true;
   try{await api(path,{method:'POST',body:JSON.stringify(Object.fromEntries(new FormData(e.target)))});await load();notify('Coverage change recorded and added to the audit trail.');}catch(error){notify(error.message);button.disabled=!canChange();}
 };
 if($('#generate')){
  $('#generate').disabled=!canGenerate()||!state.policy;
  $('#generate').onclick=async e=>{
   e.target.disabled=true;const request=++state.pageRequest,policy=state.policy,month=state.month;
   try{
    const result=await api('reconciliation',{method:'POST',body:JSON.stringify({policy_id:policy,month})});
    if(request!==state.pageRequest||state.page!=='reconciliation')return;
    state.savedReport=result;state.offset=0;
    await loadHistory();
    if(request!==state.pageRequest)return;
    render();notify('Saved provisional reconciliation generated.');
   }catch(error){notify(error.message);if(request===state.pageRequest)e.target.disabled=false;}
  };
 }
 if($('#export')){$('#export').disabled=!state.demo&&!state.savedReport;$('#export').onclick=()=>{const data=csv([['Report status','Month','Policy','Customer','Registration','Insured days','Report ID','Rules source'],...reports().map(r=>['PROVISIONAL',state.month,policyFor(r)?.reference,org(policyFor(r)?.customer_id),r.registration,r.days,state.savedReport?.report.id||'UNSAVED DATE PREVIEW',state.savedReport?JSON.stringify(state.savedReport.report.rules_snapshot):'London dates; start included, removal excluded'])]);const url=URL.createObjectURL(new Blob([data],{type:'text/csv;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download='stratify-provisional-'+state.month+'.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};}
}
async function load(){state.data=await api('workspace');if(!visiblePage(state.page))state.page='customer';await refreshPage();}

function historyPanel(){
 if(state.demo)return '<div class="panel"><div class="panel-body"><h2>Saved report history</h2><p>Available when the development database is connected.</p></div></div>';
 const page=state.historyPage||{rows:[],total:0};
 return '<div class="panel"><div class="panel-header"><h2>Saved reports for '+esc(state.month)+'</h2>'+badge('Stored snapshots')+'</div>'+(state.historyLoading?'<p class="panel-body" role="status">Loading report history...</p>':'')+'<div class="table-scroll"><table><thead><tr><th>GENERATED</th><th>POLICY</th><th>VEHICLE-DAYS</th><th>STATUS</th><th>OPEN</th></tr></thead><tbody>'+page.rows.map(r=>'<tr><td>'+esc(new Date(r.generated_at).toLocaleString('en-GB',{timeZone:'Europe/London'}))+'</td><td>'+esc(policyFor({policy_id:r.policy_id})?.reference||'Fleet-wide report')+'</td><td>'+esc(r.total_vehicle_days)+'</td><td>'+badge(r.status,true)+'</td><td><button data-report="'+esc(r.id)+'">Open report</button></td></tr>').join('')+'</tbody></table></div>'+(!page.total?'<div class="empty">No saved reports for these filters.</div>':'')+'<div class="pagination"><span>'+page.total+' saved reports</span><div class="actions"><button id="history-prev" '+(!state.historyOffset?'disabled':'')+'>Previous</button><button id="history-next" '+(state.historyOffset+25>=page.total?'disabled':'')+'>Next</button></div></div></div>';
}
async function loadMembers(request){
 const orgs=manageableOrgs();if(!orgs.length)return;
 if(!orgs.some(o=>o.id===state.membersOrg))state.membersOrg=orgs[0].id;
 state.membersLoading=true;state.membersError='';
 try{const result=await api('members?org='+encodeURIComponent(state.membersOrg));if(request===undefined||request===state.pageRequest)state.members=result;}
 catch(e){state.membersError=e.message;state.members={rows:[]};}
 state.membersLoading=false;
}
async function memberAction(path,payload,message){
 try{const result=await api(path,{method:'POST',body:JSON.stringify(payload)});await loadMembers();render();notify(message(result));}
 catch(e){notify(e.message);await loadMembers();render();}
}
async function loadHistory(){
 const params=new URLSearchParams({month:state.month,offset:String(state.historyOffset),limit:'25'});
 if(state.policy)params.set('policy',state.policy);
 state.historyPage=await api('reconciliations?'+params);
}
async function refreshPage(focusId){
 const request=++state.pageRequest,page=state.page;
 const focus=focusId?{id:focusId,position:$('#'+focusId)?.selectionStart}:null;
 state.fleetError='';
 if(state.demo){render();return;}
 state.fleetLoading=page==='fleet';state.historyLoading=page==='reconciliation';
 if(page==='fleet')state.fleetPage=null;
 if(page==='changes')state.removalPage=null;
 render();
 if(focus&&$('#'+focus.id)){const el=$('#'+focus.id);el.focus();if(focus.position!=null)el.setSelectionRange(focus.position,focus.position);}
 try{
  if(page==='fleet'||page==='changes'){
   const params=new URLSearchParams({q:page==='changes'?state.removalSearch:state.search,status:page==='changes'?'open':state.status,offset:String(page==='changes'?state.removalOffset:state.offset),limit:'25'});
   if(state.policy)params.set('policy',state.policy);
   const result=await api('fleet?'+params);
   if(request!==state.pageRequest)return;
   if(page==='fleet')state.fleetPage=result;else state.removalPage=result;
  }
  if(page==='reconciliation'){
   const params=new URLSearchParams({month:state.month,offset:String(state.historyOffset),limit:'25'});if(state.policy)params.set('policy',state.policy);
   const result=await api('reconciliations?'+params);if(request!==state.pageRequest)return;state.historyPage=result;
  }
  if(page==='users'&&canManageUsers()){await loadMembers(request);}
  if((page==='overview'||page==='insurer')&&visiblePage(page)){
   const params=new URLSearchParams();if(page==='insurer'&&state.insurerFilter)params.set('insurer',state.insurerFilter);
   try{const result=await api('dashboard'+(params.size?'?'+params:''));if(request!==state.pageRequest)return;state.dash=result;state.dashError='';}catch(e){if(request!==state.pageRequest)return;state.dashError=e.message;}
  }
 }catch(e){if(request!==state.pageRequest)return;state.fleetError=e.message;notify(e.message);}
 if(request!==state.pageRequest)return;
 state.fleetLoading=false;state.historyLoading=false;render();
 if(focus&&$('#'+focus.id)){const el=$('#'+focus.id);el.focus();if(focus.position!==null&&focus.position!==undefined)el.setSelectionRange(focus.position,focus.position);}
}

function login(configured=true){
 const demoLogin=typeof location!=='undefined'&&location.pathname==='/demo';
 $('#app').innerHTML='<main class="login"><div class="brand">'+brandLogo+'</div><div class="eyebrow">Fleet insurance workspace</div><h1>'+(demoLogin?'Demo sign in':'Welcome back.')+'</h1><p>'+(demoLogin?'Sign in with your dedicated demo account to explore fictional fleets.':'Sign in to your authorised fleet workspace.')+'</p>'+(!configured?'<div class="notice">The development database is not connected yet. Configure the project URL and publishable key before signing in.</div>':'')+'<form id="login-form"><label>Email address<input type="email" name="email" autocomplete="username" required></label><label>Password<input type="password" name="password" autocomplete="current-password" required></label><button class="primary" '+(!configured?'disabled':'')+'>Sign in</button></form><p class="form-note">Access is by invitation. Your organisation membership determines which records you can view.</p></main>';
 $('#login-form').onsubmit=async e=>{e.preventDefault();const button=e.target.querySelector('button');button.disabled=true;try{await api('login',{method:'POST',body:JSON.stringify(Object.fromEntries(new FormData(e.target)))});state.user=await api('me');state.demo=!!state.user.demo;if(state.demo)state.month='2026-09';await load();}catch(error){notify(error.message);button.disabled=false;}};
}
async function init(){try{const status=await api('status');state.demo=status.demo;if(state.demo)state.month='2026-09';if(!status.configured&&!status.demo)return login(false);try{state.user=await api('me');state.demo=!!state.user.demo;if(state.demo)state.month='2026-09';}catch{return login();}await load();}catch(e){$('#app').innerHTML='<main class="login"><h1>Workspace unavailable</h1><p>'+esc(e.message)+'</p><button id="retry">Try again</button></main>';$('#retry').onclick=init;}}
init();
