// A small stand-in for Supabase (auth + REST) used ONLY by the browser test. It is not a model of row-level security:
// real tenant isolation is proven by the database tests in ../../../tests/*.sql. This checks the portal's screens and forms.
import { createServer } from 'node:http';
import { createClaims } from './fake-claims.mjs';

const ids = {
  platform: '10000000-0000-4000-8000-000000000001', i1: '10000000-0000-4000-8000-000000000002', i2: '10000000-0000-4000-8000-000000000003',
  f1: '20000000-0000-4000-8000-000000000001', f2: '20000000-0000-4000-8000-000000000002', f3: '20000000-0000-4000-8000-000000000003',
  p1: '30000000-0000-4000-8000-000000000001', p2: '30000000-0000-4000-8000-000000000002', p3: '30000000-0000-4000-8000-000000000003'
};
const users = {
  'platform@example.test': { id: 'a0000000-0000-4000-8000-000000000001', role: 'platform_super_admin', org: ids.platform, see: 'all' },
  'insurer@example.test': { id: 'a0000000-0000-4000-8000-000000000002', role: 'insurer_admin', org: ids.i1, see: [ids.i1, ids.f1, ids.f2] },
  'customer@example.test': { id: 'a0000000-0000-4000-8000-000000000003', role: 'fleet_admin', org: ids.f1, see: [ids.f1] },
  'demo@stratifyfleet.co.uk': { id: 'a0000000-0000-4000-8000-000000000004', role: null, org: null, see: [] },
  'driver@example.test': { id: 'a0000000-0000-4000-8000-000000000006', role: 'driver', org: ids.f1, see: [] },
  'mfa@example.test': { id: 'a0000000-0000-4000-8000-000000000007', role: 'insurer_admin', org: ids.i1, see: [ids.i1, ids.f1, ids.f2], factors: [{ id: 'fac-mfa', status: 'verified', factor_type: 'totp' }], jwt: true },
  'enrol@example.test': { id: 'a0000000-0000-4000-8000-000000000008', role: 'insurer_admin', org: ids.i1, see: [ids.i1, ids.f1, ids.f2], factors: [] },
  'nobody@example.test': { id: 'a0000000-0000-4000-8000-000000000005', role: null, org: null, see: [] }
};
const allOrgs = [
  { id: ids.platform, kind: 'platform', name: 'Stratify Platform', insurer_id: null },
  { id: ids.i1, kind: 'insurer', name: 'Example Mutual', insurer_id: null },
  { id: ids.i2, kind: 'insurer', name: 'Sample Underwriters', insurer_id: null },
  { id: ids.f1, kind: 'fleet', name: 'Northbank Logistics', insurer_id: ids.i1 },
  { id: ids.f2, kind: 'fleet', name: 'Riverside Couriers', insurer_id: ids.i1 },
  { id: ids.f3, kind: 'fleet', name: 'Hilltop Plumbing', insurer_id: ids.i2 }
];
const allPolicies = [
  { id: ids.p1, policy_number: 'POL-1', fleet_id: ids.f1, insurer_id: ids.i1, valid_from: '2026-01-01', valid_to: null },
  { id: ids.p2, policy_number: 'POL-2', fleet_id: ids.f2, insurer_id: ids.i1, valid_from: '2026-01-01', valid_to: null },
  { id: ids.p3, policy_number: 'POL-3', fleet_id: ids.f3, insurer_id: ids.i2, valid_from: '2026-01-01', valid_to: null }
];
const periods = [];
for (const [fleet, policy, prefix, n] of [[ids.f1, ids.p1, 'AB', 30], [ids.f2, ids.p2, 'CD', 5], [ids.f3, ids.p3, 'EF', 4]]) {
  for (let i = 0; i < n; i++) periods.push({
    id: `c${fleet.slice(1, 2)}000000-0000-4000-8000-${String(i).padStart(12, '0')}`, vehicle_id: `d${fleet.slice(1, 2)}000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
    fleet_id: fleet, policy_id: policy, cover_start: '2026-01-01T09:00:00Z', created_at: '2026-01-01T09:00:05Z', cover_end: i % 10 === 9 ? '2026-03-17T17:00:00Z' : null, voided_at: null,
    vehicle: { registration: `${prefix}${String(10 + i)}XYZ`, make_model: 'Example Van ' + i }
  });
}
const report = { id: 'e0000000-0000-4000-8000-000000000001', fleet_id: ids.f1, policy_id: ids.p1, month_start: '2026-10-01', status: 'provisional', rules_source: 'default-assumption', rules_snapshot: { start_day_charged: true, end_day_charged: true }, generated_at: '2026-10-20T10:00:00Z', total_vehicle_days: 810, opening_vehicles: 27, additions: 0, removals: 0, closing_vehicles: 27, premium_net: '6650.10' };
const lines = periods.filter(p => p.fleet_id === ids.f1).slice(0, 27).map((p, i) => ({ id: i + 1, reconciliation_id: report.id, fleet_id: ids.f1, policy_id: ids.p1, registration: p.vehicle.registration, days: 30, first_charged_date: '2026-10-01', last_charged_date: '2026-10-30', daily_rate: '8.2100', charge: '246.30' }));

export function startFake(port) {
  const calls = [], reqlog = [];
  const claims = createClaims(ids);
  const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
  const mkjwt = (email, aal) => b64({ alg: 'HS256', typ: 'JWT' }) + '.' + b64({ sub: users[email].id, email, aal, role: 'authenticated', aud: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 }) + '.c2ln';
  const byToken = token => {
    if (!token.startsWith('tok-') && token.split('.').length === 3) { try { const email = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()).email; return users[email] ? [email, users[email]] : undefined; } catch { return undefined; } }
    return Object.entries(users).find(([email]) => token === 'tok-' + email);
  };
  const authUser = (email, u) => ({ id: u.id, email, aud: 'authenticated', role: 'authenticated', email_confirmed_at: '2026-01-01T00:00:00Z', app_metadata: u.mustChange ? { must_change_password: true } : {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z', factors: u.factors || [] });
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    let raw = ''; for await (const c of req) raw += c;
    const body = raw && /json/.test(req.headers['content-type'] || '') ? JSON.parse(raw) : null;
    const json = (status, data, headers = {}) => { res.writeHead(status, { 'Content-Type': 'application/json', ...headers }); res.end(req.method === 'HEAD' ? undefined : JSON.stringify(data)); };
    if (url.pathname === '/__log') return json(200, reqlog);
    if (!url.pathname.startsWith('/__')) reqlog.push(`${new Date().toISOString().slice(14, 23)} ${req.method} ${url.pathname}${url.search.slice(0, 60)} <- ${((req.headers.authorization || '').slice(11, 26))}`);
    if (url.pathname === '/__calls') return json(200, calls);
    if (url.pathname === '/__reset') { calls.length = 0; return json(200, {}); }
    if (url.pathname === '/auth/v1/token') {
      const email = String(body?.email || '').toLowerCase(), u = users[email];
      if (!u || body.password !== (u.pw || 'pw')) return json(400, { error: 'invalid_grant', error_description: 'Invalid login credentials' });
      const now = Math.floor(Date.now() / 1000);
      const jwt = 'x.' + Buffer.from(JSON.stringify({ sub: u.id, email, exp: now + 3600, role: 'authenticated', aud: 'authenticated' })).toString('base64url') + '.x';
      void jwt;
      return json(200, { access_token: u.jwt ? mkjwt(email, 'aal1') : 'tok-' + email, token_type: 'bearer', expires_in: 3600, expires_at: now + 3600, refresh_token: 'ref-' + email, user: authUser(email, u) });
    }
    if (url.pathname.startsWith('/auth/v1/admin/')) {
      if (!/Bearer test-service-role$/.test(req.headers.authorization || '')) return json(401, { msg: 'bad key' });
      if (req.method === 'POST' && url.pathname === '/auth/v1/admin/users') {
        const email = String(body.email).toLowerCase();
        if (users[email]) return json(422, { error_code: 'email_exists', msg: 'exists' });
        calls.push({ admin: 'create_user', body: { ...body, password: '(hidden)' }, passwordLength: String(body.password).length });
        users[email] = { id: 'a0000000-0000-4000-8000-0000000000' + String(50 + Object.keys(users).length), role: 'fleet_manager', org: ids.f1, see: [ids.f1], pw: body.password, mustChange: body.app_metadata?.must_change_password === true };
        return json(200, { id: users[email].id });
      }
      if (req.method === 'PUT') { const hit = Object.values(users).find(x => url.pathname.endsWith('/' + x.id)); if (!hit) return json(404, { msg: 'no user' }); hit.mustChange = body.app_metadata?.must_change_password === true; calls.push({ admin: 'update_user', mustChange: hit.mustChange }); return json(200, { id: hit.id }); }
    }
    const token = (req.headers.authorization || '').replace('Bearer ', '');
    const found = byToken(token);
    if (url.pathname.startsWith('/storage/v1/object/')) {
      if (!found) return json(401, { message: 'invalid JWT' });
      const rest = url.pathname.replace('/storage/v1/object/', '');
      calls.push({ storage: req.method, path: rest, as: found[0], bytes: raw.length });
      if (req.method === 'GET') { res.writeHead(200, { 'Content-Type': 'image/png' }); return res.end(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==', 'base64')); }
      return json(200, { Key: rest });
    }
    if (url.pathname === '/auth/v1/recover') { calls.push({ auth: 'recover', email: body?.email, redirect: url.searchParams.get('redirect_to') }); return json(200, {}); }
    if (url.pathname.startsWith('/auth/v1/factors')) {
      if (!found) return json(401, { message: 'invalid JWT' });
      const [fe, fu] = found; fu.factors ??= [];
      const parts = url.pathname.split('/').filter(Boolean);
      if (req.method === 'POST' && parts.length === 3) {
        const f = { id: 'fac-' + (fu.factors.length + 1) + '-' + Date.now(), status: 'unverified', factor_type: 'totp' }; fu.factors.push(f); calls.push({ auth: 'enrol', as: fe });
        return json(200, { id: f.id, type: 'totp', friendly_name: body.friendly_name, totp: { qr_code: 'data:image/svg+xml;utf-8,<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"></svg>', secret: 'JBSWY3DPEHPK3PXP', uri: 'otpauth://totp/Stratify' } });
      }
      if (req.method === 'POST' && parts[4] === 'challenge') return json(200, { id: 'chal-1', type: 'totp', expires_at: Math.floor(Date.now() / 1000) + 300 });
      if (req.method === 'POST' && parts[4] === 'verify') {
        if (body.code !== '123456') return json(400, { error_code: 'mfa_verification_failed', msg: 'Invalid TOTP code entered' });
        const f = fu.factors.find(x => x.id === parts[3]); if (f) f.status = 'verified'; calls.push({ auth: 'verified', as: fe });
        const now = Math.floor(Date.now() / 1000);
        return json(200, { access_token: fu.jwt ? mkjwt(fe, 'aal2') : 'tok-' + fe, token_type: 'bearer', expires_in: 3600, expires_at: now + 3600, refresh_token: 'ref-' + fe, user: authUser(fe, fu) });
      }
      if (req.method === 'DELETE') { fu.factors = fu.factors.filter(x => x.id !== parts[3]); calls.push({ auth: 'unenrol', as: fe }); return json(200, { id: parts[3] }); }
    }
    if (url.pathname === '/auth/v1/user') {
      if (!found) return json(401, { message: 'invalid JWT' });
      if (req.method === 'PUT') { if (body.password === found[1].pw) return json(422, { error_code: 'same_password', message: 'New password should be different from the old password.' }); found[1].pw = body.password; calls.push({ admin: 'password_changed', as: found[0] }); }
      return json(200, authUser(found[0], found[1]));
    }
    if (url.pathname === '/auth/v1/logout') return json(204, {});
    if (!found) return json(401, { message: 'JWT expired' });
    const [email, u] = found;
    const sees = id => u.see === 'all' || u.see.includes(id);
    const q = url.searchParams, off = Number(q.get('offset') || 0), lim = Number(q.get('limit') || 1000);
    // The real database rejects a repeated select parameter; so does this stand-in.
    if (q.getAll('select').length > 1) return json(400, { message: 'Invalid query: select given more than once' });
    const page = (rows, headers = {}) => {
      const slice = rows.slice(off, off + lim);
      const range = slice.length ? `${off}-${off + slice.length - 1}/${rows.length}` : `*/${rows.length}`;
      return json(off >= rows.length && rows.length ? 416 : 200, slice, { 'Content-Range': range, ...headers });
    };
    const path = url.pathname.replace('/rest/v1/', '');
    if (path.startsWith('rpc/')) {
      const name = path.slice(4);
      calls.push({ rpc: name, as: email, body });
      try { const out = claims.rpc(name, body, u, email); if (out !== undefined) return json(200, out); } catch (e) { if (e.http) return json(e.http, { message: e.message }); throw e; }
      if (name === 'list_members') return json(200, body.p_org === ids.f1 ? [
        { id: 'b0000000-0000-4000-8000-000000000001', user_id: users['customer@example.test'].id, email: 'customer@example.test', role: 'fleet_admin', active: true, pending: false },
        { id: 'b0000000-0000-4000-8000-000000000002', user_id: 'zz', email: 'manager@example.test', role: 'fleet_manager', active: true, pending: false },
        { id: 'b0000000-0000-4000-8000-000000000004', user_id: users['driver@example.test'].id, email: 'driver@example.test', role: 'driver', active: true, pending: false },
        { id: 'c0000000-0000-4000-8000-000000000003', user_id: null, email: 'pending@example.test', role: 'fleet_accounts', active: true, pending: true }
      ] : [{ id: 'b0000000-0000-4000-8000-000000000009', user_id: u.id, email, role: u.role, active: true, pending: false }]);
      if (name === 'search_national_drivers') {
        if (!['insurer_admin', 'platform_super_admin'].includes(u.role)) return json(403, { message: 'permission denied' });
        return json(200, String(body.p_name).toLowerCase().includes('dana') ? [{ user_id: users['driver@example.test'].id, full_name: 'Dana Driver', birth_year: 1988, date_of_birth: body.p_dob ? '1988-03-14' : null, fleet_name: 'Northbank Logistics (FICTIONAL)' }] : []);
      }
      if (name === 'national_driver_file') {
        if (!['insurer_admin', 'platform_super_admin'].includes(u.role)) return json(403, { message: 'permission denied' });
        return json(200, { user_id: body.p_user, full_name: 'Dana Driver', date_of_birth: '1988-03-14', fleet_name: 'Northbank Logistics (FICTIONAL)', no_claims_declared_at: null, no_convictions_declared_at: '2026-09-01T10:00:00Z', shared_since: '2026-09-02T10:00:00Z',
          records: [{ kind: 'employment', title: 'Acme Haulage', detail: 'HGV driver', start_date: '2019-01-01', end_date: null, amount: null, at_fault: null, points: null }, { kind: 'claim', title: 'Rear-ended at lights', detail: null, start_date: '2022-05-04', end_date: null, amount: 1200, at_fault: false, points: null }] });
      }
      if (name === 'create_insurer') return json(200, '10000000-0000-4000-8000-000000000009');
      if (name === 'create_customer') { if (!['insurer_admin', 'platform_super_admin'].includes(u.role)) return json(403, { message: 'permission denied' }); return json(200, ids.f1); }
      if (['create_policy', 'renew_policy'].includes(name)) return json(200, '30000000-0000-4000-8000-000000000009');
      if (name === 'set_daily_rate' || name === 'set_billing_rules') { if (!['insurer_admin', 'platform_super_admin'].includes(u.role)) return json(403, { message: 'permission denied' }); return json(200, '40000000-0000-4000-8000-000000000001'); }
      if (name === 'my_branding') return json(200, ['insurer@example.test', 'customer@example.test'].includes(email) ? [{ display_name: 'Example Mutual Fleet', accent: '#1A5C4B' }] : []);
      if (name === 'set_branding') { if (u.role !== 'insurer_admin' && u.role !== 'platform_super_admin') return json(403, { message: 'permission denied' }); return json(200, null); }
      if (name === 'audit_feed') { if (!['insurer_admin', 'platform_super_admin', 'fleet_admin'].includes(u.role)) return json(200, []); const all = [{ id: 3, occurred_at: '2026-10-22T10:00:00Z', actor_email: 'customer@example.test', actor_kind: 'user', organisation_id: ids.f1, action: 'coverage.added', entity_type: 'coverage_period', note: null, total: 2 }, { id: 2, occurred_at: '2026-10-21T10:00:00Z', actor_email: null, actor_kind: 'system', organisation_id: ids.f1, action: 'claim.created', entity_type: 'claim', note: 'Fictional', total: 2 }]; return json(200, body.p_action ? all.filter(a => a.action.startsWith(body.p_action)).map(a => ({ ...a, total: 1 })) : all); }
      if (name === 'add_member') return json(200, 'invited');
      if (name === 'my_cover') return json(200, email === 'driver@example.test' ? [
        { assignment_id: 'e0000000-0000-4000-8000-000000000001', vehicle_id: 'v1', registration: 'AB10XYZ', make_model: 'Ford Transit', assigned_from: '2026-01-01', assigned_to: null, cover_start: '2026-01-01T09:00:00Z', cover_end: null },
        { assignment_id: 'e0000000-0000-4000-8000-000000000002', vehicle_id: 'v2', registration: 'ZZ99OLD', make_model: 'Vauxhall Vivaro', assigned_from: '2026-01-01', assigned_to: '2026-03-01', cover_start: '2026-01-01T09:00:00Z', cover_end: '2026-03-01T00:00:00Z' }
      ] : []);
      if (name === 'add_check_code') return json(200, 'c1000000-0000-4000-8000-000000000002');
      if (name === 'record_licence_check') return json(200, 'c2000000-0000-4000-8000-000000000002');
      if (name === 'remove_driver_document') return json(200, ids.f1 + '/' + users['driver@example.test'].id + '/old.png');
      if (name === 'assign_driver' || name === 'end_assignment') return json(200, 'e0000000-0000-4000-8000-000000000009');
      if (name === 'generate_reconciliation') return json(200, report.id);
      if (name === 'add_vehicle_cover' || name === 'remove_vehicle_cover') return json(200, 'f0000000-0000-4000-8000-000000000001');
      return json(200, null);
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') return json(405, { message: 'writes must go through functions' });
    { const rows = claims.get(path, q, u); if (rows) return page(rows); }
    const driverId = users['driver@example.test'].id, rivalId = 'a0000000-0000-4000-8000-000000000077';
    const profiles = [
      { user_id: driverId, fleet_id: ids.f1, full_name: 'Dana Driver', date_of_birth: '1988-03-14', licence_number: 'DRIVE803148DA9AB', phone: '07700900123', no_claims_declared_at: null, no_convictions_declared_at: '2026-09-01T10:00:00Z', updated_at: '2026-09-01T10:00:00Z' },
      { user_id: rivalId, fleet_id: ids.f2, full_name: 'Danny Rival', date_of_birth: null, licence_number: null, phone: null, no_claims_declared_at: null, no_convictions_declared_at: null, updated_at: '2026-09-01T10:00:00Z' }
    ];
    const mine = r => (u.role === 'driver' ? r.user_id === u.id : sees(r.fleet_id));
    if (path === 'driver_profiles') {
      const name = (q.get('full_name') || '').replace('ilike.', '').replaceAll('*', '').toLowerCase(), uid = (q.get('user_id') || '').replace('eq.', '');
      return page(profiles.filter(r => mine(r) && (!name || r.full_name.toLowerCase().includes(name)) && (!uid || r.user_id === uid || (uid.startsWith('in.') && uid.includes(r.user_id))) && (!q.get('fleet_id') || r.fleet_id === q.get('fleet_id').replace('eq.', ''))));
    }
    if (path === 'driver_documents') {
      const docs = [
        { id: 'd1000000-0000-4000-8000-000000000001', user_id: driverId, fleet_id: ids.f1, kind: 'licence_front', file_name: 'licence-front.png', content_type: 'image/png', size_bytes: 68, uploaded_at: '2026-09-02T10:00:00Z', expires_on: null, storage_path: ids.f1 + '/' + driverId + '/a.png' },
        { id: 'd1000000-0000-4000-8000-000000000002', user_id: rivalId, fleet_id: ids.f2, kind: 'right_to_work', file_name: 'rival.pdf', content_type: 'application/pdf', size_bytes: 10, uploaded_at: '2026-09-02T10:00:00Z', expires_on: null, storage_path: ids.f2 + '/' + rivalId + '/b.pdf' }
      ];
      const id = (q.get('id') || '').replace('eq.', ''), uid = (q.get('user_id') || '');
      return json(200, docs.filter(r => mine(r) && (!id || r.id === id) && (!uid.startsWith('eq.') || r.user_id === uid.slice(3)) && (!uid.startsWith('in.') || uid.includes(r.user_id))));
    }
    if (path === 'driver_consent_current') return json(200, [{ user_id: driverId, fleet_id: ids.f1, kind: 'licence_check', given: true, version: 'v1', recorded_at: '2026-09-03T10:00:00Z' }].filter(r => mine(r) && (!(q.get('user_id') || '').startsWith('eq.') || r.user_id === q.get('user_id').slice(3))));
    const byUser = rows => rows.filter(r => mine(r) && (!(q.get('user_id') || '').startsWith('eq.') || r.user_id === q.get('user_id').slice(3)) && (!(q.get('user_id') || '').startsWith('in.') || q.get('user_id').includes(r.user_id)));
    if (path === 'driver_check_codes') return json(200, byUser([{ id: 'c1000000-0000-4000-8000-000000000001', user_id: driverId, fleet_id: ids.f1, code: 'AB12 CD34', created_at: new Date().toISOString(), used_at: null }]));
    if (path === 'licence_checks') return json(200, byUser([{ id: 'c2000000-0000-4000-8000-000000000001', user_id: driverId, fleet_id: ids.f1, checked_at: '2026-09-10T10:00:00Z', checked_by_email: 'customer@example.test', status: 'valid', points: 0, entitlements: 'B, BE', endorsements: null, notes: 'First check', next_check_due: '2027-03-10' }]));
    if (path === 'driver_records') return json(200, [
      { id: 'r1000000-0000-4000-8000-000000000001', user_id: driverId, fleet_id: ids.f1, kind: 'employment', title: 'Acme Haulage', detail: 'HGV driver', start_date: '2022-01-01', end_date: null, amount: null, at_fault: null, points: null },
      { id: 'r1000000-0000-4000-8000-000000000002', user_id: driverId, fleet_id: ids.f1, kind: 'claim', title: 'Rear-end collision', detail: null, start_date: '2025-02-01', end_date: null, amount: 1250, at_fault: false, points: null }
    ].filter(r => mine(r) && (!(q.get('user_id') || '').startsWith('eq.') || r.user_id === q.get('user_id').slice(3))));
    if (path === 'vehicles') return json(200, (q.get('registration') || '') === 'eq.AB10XYZ' ? [{ id: 'f1000000-0000-4000-8000-000000000001' }] : []);
    if (path === 'vehicle_assignments' && (q.get('assigned_from') || '').startsWith('lte.')) return json(200, [{ vehicle_id: periods.find(p => p.fleet_id === ids.f1).vehicle_id, user_id: users['driver@example.test'].id, assigned_from: '2026-01-01' }]);
    if (path === 'vehicle_assignments') return json(200, [{ id: 'e0000000-0000-4000-8000-000000000001', user_id: users['driver@example.test'].id, vehicle_id: 'v1', assigned_from: '2026-01-01', assigned_to: null, vehicle: { registration: 'AB10XYZ', make_model: 'Ford Transit' } }]);
    if (path === 'org_branding') return json(200, [{ display_name: 'Example Mutual Fleet', accent: '#1A5C4B' }]);
    if (path === 'mipd_submissions') return page((q.get('submission_status') || '') === 'eq.queued' ? [{ id: 1 }, { id: 2 }, { id: 3 }] : []);
    if (path === 'billing_rules') return json(200, [{ id: 'br1', effective_from: '2026-01-01', start_day_charged: true, end_day_charged: true, timezone: 'Europe/London', rounding_dp: 2, vat_rate: 0, note: 'Fictional' }]);
    if (path === 'rate_cards') return json(200, [{ id: 'rc1', policy_id: (q.get('policy_id') || '').replace('eq.', ''), effective_from: '2026-01-01', daily_rate: 8.21, note: 'Fictional' }]);
    if (path === 'organisations') return page(allOrgs.filter(o => sees(o.id)));
    if (path === 'policies') {
      const id = (q.get('id') || '').replace('eq.', '');
      return page(allPolicies.filter(p => sees(p.fleet_id) && (!id || p.id === id)));
    }
    if (path === 'memberships') return json(200, u.role ? [{ organisation_id: u.org, role: u.role, active: true }] : []);
    if (path === 'coverage_periods') {
      let rows = periods.filter(p => sees(p.fleet_id));
      const pol = (q.get('policy_id') || '').replace('eq.', ''); if (pol) rows = rows.filter(p => p.policy_id === pol);
      const id = (q.get('id') || '').replace('eq.', ''); if (id) rows = rows.filter(p => p.id === id);
      if (q.get('cover_end') === 'is.null') rows = rows.filter(p => !p.cover_end);
      if (q.get('cover_end') === 'not.is.null') rows = rows.filter(p => p.cover_end);
      const search = q.get('vehicle.or'); if (search) { const m = /registration\.ilike\.\*([^,]*)\*/.exec(search); if (m) rows = rows.filter(p => p.vehicle.registration.toLowerCase().includes(m[1].toLowerCase())); }
      if (q.get('select') === 'id') return page(rows);
      return page(rows);
    }
    if (path === 'audit_logs') return page([{ id: 1, occurred_at: '2026-10-22T10:00:00Z', action: 'coverage.added', entity_type: 'coverage_period', before_state: null, after_state: { registration: 'AB10XYZ' } }].filter(() => u.see === 'all' || u.see.length));
    if (path === 'fleet_overview') return page(allOrgs.filter(o => o.kind === 'fleet' && sees(o.id)).map(o => ({ fleet_id: o.id, fleet_name: o.name, insurer_id: o.insurer_id, vehicles_total: periods.filter(p => p.fleet_id === o.id).length, vehicles_on_cover: periods.filter(p => p.fleet_id === o.id && !p.cover_end).length, vehicles_scheduled: 0 })));
    if (path === 'coverage_events') return page(q.get('select') === 'id' ? [{ id: 1 }, { id: 2 }] : [{ id: 'ev1', fleet_id: ids.f1, event_type: 'cover_added', effective_at: '2026-10-22T00:00:00Z', recorded_at: '2026-10-22T10:00:00Z', details: { registration: 'AB10XYZ' } }]);
    if (path === 'reconciliations') {
      const id = (q.get('id') || '').replace('eq.', '');
      const rows = [report].filter(r => sees(r.fleet_id) && (!id || r.id === id));
      return q.get('select') === 'id' ? page(rows) : page(rows);
    }
    if (path === 'reconciliation_lines') return page(lines);
    return json(404, { message: 'unknown table ' + path });
  });
  return new Promise(resolve => server.listen(port, '127.0.0.1', () => resolve({ server, calls })));
}
