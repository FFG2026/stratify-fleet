const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const invalid=message=>Object.assign(new Error(message),{status:400});
export function checkedId(value){if(!uuid.test(value||''))throw invalid('Select a valid record.');return value;}
export function pageOptions(params){
 const offset=Number(params.get('offset')||0),limit=Number(params.get('limit')||25);
 if(!Number.isInteger(offset)||offset<0||offset>1000000||!Number.isInteger(limit)||limit<1||limit>100)throw invalid('Invalid page range.');
 return {offset,limit};
}
export function fleetQuery(params,now=new Date()){
 const {offset,limit}=pageOptions(params);
 const query=new URLSearchParams({select:'id,vehicle_id,fleet_id,policy_id,cover_start,cover_end,voided_at,vehicle:vehicles!inner(registration,make_model),policy:policies!inner(valid_to,active)',voided_at:'is.null',order:'cover_start.desc,id.asc',offset:String(offset),limit:String(limit)});
 const policy=params.get('policy');if(policy)query.set('policy_id','eq.'+checkedId(policy));
 const search=(params.get('q')||'').trim();
 if(search.length>80||/[^a-zA-Z0-9 -]/.test(search))throw invalid('Search using letters, numbers, spaces or hyphens.');
 if(search)query.set('vehicle.or','(registration.ilike.*'+search.replace(/\s/g,'')+'*,make_model.ilike.*'+search+'*)');
 const status=params.get('status')||'all';
 if(!['all','active','closed','scheduled','open'].includes(status))throw invalid('Invalid fleet status.');
 if(status==='active'){
  query.set('cover_start','lte.'+now.toISOString());
  query.set('or','(cover_end.is.null,cover_end.gt.'+now.toISOString()+')');
  query.set('policy.active','eq.true');
  const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/London',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
  query.set('policy.or','(valid_to.is.null,valid_to.gte.'+today+')');
 }
 if(status==='closed')query.set('cover_end','not.is.null');
 if(status==='scheduled')query.set('cover_start','gt.'+now.toISOString());
 if(status==='open')query.set('cover_end','is.null');
 return {query,offset,limit};
}
export function historyQuery(params){
 const {offset,limit}=pageOptions(params);
 const query=new URLSearchParams({select:'*',order:'generated_at.desc,id.desc',offset:String(offset),limit:String(limit)});
 const policy=params.get('policy');if(policy)query.set('policy_id','eq.'+checkedId(policy));
 const month=params.get('month');
 if(month){if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))throw invalid('Invalid month.');query.set('month_start','eq.'+month+'-01');}
 return {query,offset,limit};
}
