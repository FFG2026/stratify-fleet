import test from 'node:test';
import assert from 'node:assert/strict';
import {insuredDays,normaliseRegistration,csv,parseDate} from '../lib/coverage.mjs';
import {londonMidnight,londonDate,normaliseWorkspace} from '../lib/database.mjs';
test('leap years, month boundaries, removal excluded, open cover',()=>{
 assert.equal(insuredDays('2024-01-20',null,'2024-02'),29);
 assert.equal(insuredDays('2026-10-01','2026-11-01','2026-10'),31);
 assert.equal(insuredDays('2026-10-31','2026-11-03','2026-11'),2);
 assert.equal(insuredDays('2026-10-05','2026-10-05','2026-10'),0);
 assert.equal(insuredDays('2026-12-01',null,'2026-10'),0);
});
test('re-addition remains two nonoverlapping periods',()=>{
 assert.equal(insuredDays('2026-10-01','2026-10-10','2026-10')+insuredDays('2026-10-20',null,'2026-10'),21);
});
test('DST boundaries count calendar days',()=>{
 assert.equal(insuredDays('2026-03-28','2026-03-31','2026-03'),3);
 assert.equal(londonMidnight('2026-03-29'),'2026-03-29T00:00:00.000Z');
 assert.equal(londonMidnight('2026-03-30'),'2026-03-29T23:00:00.000Z');
 assert.equal(londonMidnight('2026-10-25'),'2026-10-24T23:00:00.000Z');
});
test('invalid dates and registration format',()=>{
 assert.throws(()=>parseDate('2026-02-29'));assert.throws(()=>insuredDays('2026-10-12','2026-10-10','2026-10'));
 assert.equal(normaliseRegistration(' ab26 cde '),'AB26CDE');assert.throws(()=>normaliseRegistration('<script>'));
});
test('CSV quoting and spreadsheet formula injection',()=>{
 assert.equal(csv([['=1+1','a"b','a,b']]),'"\'=1+1","a""b","a,b"');
});
test('adapter preserves IDs, maps existing schema, excludes voided periods',()=>{
 const data=normaliseWorkspace({organisations:[{id:'f',kind:'fleet'}],policies:[{id:'p',fleet_id:'f',policy_number:'P1',valid_from:'2026-01-01',valid_to:'2026-12-31'}],vehicles:[{id:'v',registration:'AB26CDE',make_model:'Ford Transit'}],coverage_periods:[{id:'c',vehicle_id:'v',cover_start:'2026-07-01T23:00:00Z',cover_end:null},{id:'void',voided_at:'2026-01-01'}],audit_logs:[],memberships:[]});
 assert.equal(data.organisations[0].kind,'customer');assert.equal(data.policies[0].ends_on,'2027-01-01');
 assert.equal(data.coverage_periods.length,1);assert.equal(data.coverage_periods[0].starts_on,'2026-07-02');
 assert.equal(londonDate('2026-07-01T23:00:00Z'),'2026-07-02');
});
