import test from 'node:test';
import assert from 'node:assert/strict';
import {fleetQuery,historyQuery,pageOptions} from '../lib/queries.mjs';
const policy='22222222-2222-4222-8222-222222222222';
test('fleet pages are bounded, stable, scoped and searched on the joined vehicle',()=>{
 const {query,offset,limit}=fleetQuery(new URLSearchParams({policy,q:'AB26 CDE',offset:'575',limit:'25'}));
 assert.equal(offset,575);assert.equal(limit,25);assert.equal(query.get('offset'),'575');
 assert.equal(query.get('policy_id'),'eq.'+policy);assert.equal(query.get('voided_at'),'is.null');
 assert.match(query.get('select'),/vehicle:vehicles!inner/);
 assert.equal(query.get('vehicle.or'),'(registration.ilike.*AB26CDE*,make_model.ilike.*AB26 CDE*)');
 assert.equal(query.get('order'),'cover_start.desc,id.asc');
});
test('active, closed, scheduled and open filters reflect their labels',()=>{
 const now=new Date('2026-10-23T12:00:00Z');
 const {query}=fleetQuery(new URLSearchParams({status:'active'}),now);
 assert.equal(query.get('cover_start'),'lte.'+now.toISOString());assert.match(query.get('or'),/cover_end.gt/);
 assert.equal(query.get('policy.active'),'eq.true');assert.equal(query.get('policy.or'),'(valid_to.is.null,valid_to.gte.2026-10-23)');
 assert.equal(fleetQuery(new URLSearchParams({status:'closed'})).query.get('cover_end'),'not.is.null');
 assert.equal(fleetQuery(new URLSearchParams({status:'open'})).query.get('cover_end'),'is.null');
 assert.match(fleetQuery(new URLSearchParams({status:'scheduled'}),now).query.get('cover_start'),/^gt\./);
});
test('query syntax injection and invalid page ranges are rejected',()=>{
 for(const params of [{q:'a*,id.gt.0'},{policy:'bad-id'},{status:'unknown'},{limit:'101'},{offset:'-1'},{offset:'1.5'},{q:'a'.repeat(81)}])
  assert.throws(()=>fleetQuery(new URLSearchParams(params)),error=>error.status===400);
 assert.deepEqual(pageOptions(new URLSearchParams()),{offset:0,limit:25});
});
test('report history uses saved month and policy filters',()=>{
 const {query}=historyQuery(new URLSearchParams({month:'2026-10',policy,offset:'25'}));
 assert.equal(query.get('month_start'),'eq.2026-10-01');assert.equal(query.get('policy_id'),'eq.'+policy);
 assert.equal(query.get('order'),'generated_at.desc,id.desc');
 assert.throws(()=>historyQuery(new URLSearchParams({month:'2026-13'})));
});
