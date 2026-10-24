import {describe,it,expect} from 'vitest';
import {demoDriverFiles,demoDriverFile,demoDriverList} from '@/lib/demo-drivers';
import {checkedId} from '@/lib/ids';

describe('fictional driver workspace',()=>{
 it('opens every directory row as its own fictional file and rejects unknown IDs',()=>{
  const files=demoDriverFiles();expect(files.length).toBeGreaterThan(0);
  for(const f of files){const p=f.profile!;expect(checkedId(p.user_id)).toBe(p.user_id);expect(demoDriverFile(p.user_id)?.profile).toEqual(p);expect(p.licence_number).toBe('DEMO RECORD ONLY');expect(f.codes).toEqual([]);}
  expect(demoDriverFile('00000000-0000-4000-8000-000000000000')).toBeNull();
 });
 it('filters by fleet and name and paginates without mixing driver files',()=>{
  const fleet=demoDriverFiles()[0].profile!.fleet_id;
  const page=demoDriverList({fleet,q:'Alex',limit:1});expect(page.total).toBe(1);expect(page.rows[0].fleet_id).toBe(fleet);expect(page.rows[0].full_name).toBe('Alex Morgan');
  const first=demoDriverList({limit:2}),next=demoDriverList({limit:2,offset:2});expect(first.rows.map(r=>r.user_id).some(id=>next.rows.some(r=>r.user_id===id))).toBe(false);
  expect(demoDriverList({q:'unknown name'}).total).toBe(0);
 });
});
