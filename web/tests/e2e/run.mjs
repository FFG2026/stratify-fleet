// Browser test against the built app and a stand-in database. Run: npm run build && node tests/e2e/run.mjs
// Needs Playwright with a Chromium (PLAYWRIGHT_BROWSERS_PATH); set PLAYWRIGHT_MODULE if it lives elsewhere.
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { startFake } from './fake-supabase.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || '/opt/npm-tools/node_modules/playwright');
const FAKE = 54399, APP = 3100, base = `http://127.0.0.1:${APP}`;
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok }); console.log((ok ? 'PASS ' : 'FAIL ') + name + (ok ? '' : '  -> ' + detail)); };

const { server: fake } = await startFake(FAKE);
const app = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '-p', String(APP)], {
  cwd: new URL('../../', import.meta.url).pathname,
  env: { ...process.env, SUPABASE_URL: `http://127.0.0.1:${FAKE}`, SUPABASE_PUBLISHABLE_KEY: 'test-publishable', NODE_ENV: 'production', DVLA_VES_API_KEY: '' },
  stdio: ['ignore', 'pipe', 'pipe']
});
let appLog = ''; app.stdout.on('data', d => appLog += d); app.stderr.on('data', d => appLog += d);
for (let i = 0; i < 60; i++) { try { await fetch(base + '/login'); break; } catch { await new Promise(r => setTimeout(r, 500)); } }

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined, args: ['--no-sandbox'] });
const problems = [];

async function session(email, viewport = { width: 1280, height: 900 }) {
  const context = await browser.newContext({ viewport, acceptDownloads: true });
  const page = await context.newPage();
  page.on('console', m => { if (['error', 'warning'].includes(m.type())) problems.push(`[${email}] console ${m.type()}: ${m.text()}`); });
  page.on('pageerror', e => problems.push(`[${email}] pageerror: ${e.message}`));
  await page.goto(base + '/login');
  await page.fill('input[name=email]', email);
  await page.fill('input[name=password]', 'pw');
  await Promise.all([page.waitForURL(u => !u.pathname.startsWith('/login')), page.click('button.primary')]);
  return { context, page };
}
// Pages stream in; wait for the network to settle so we read the finished page, not the loading state.
const text = async page => { await page.waitForLoadState('networkidle'); return page.locator('body').innerText(); };
const calls = async () => (await (await fetch(`http://127.0.0.1:${FAKE}/__calls`)).json());

try {
  // ---- unauthenticated
  { const c = await browser.newContext(); const p = await c.newPage();
    await p.goto(base + '/fleet'); check('signed-out visitors are sent to the login page', new URL(p.url()).pathname === '/login', p.url());
    const r = await fetch(base + '/login'); const csp = r.headers.get('content-security-policy') || '';
    check('login page sends a nonce-based CSP with no unsafe inline scripts', /script-src 'self' 'nonce-[^']+' 'strict-dynamic'/.test(csp) && !/script-src[^;]*unsafe-inline/.test(csp) && /frame-ancestors 'none'/.test(csp), csp);
    await p.fill('input[name=email]', 'platform@example.test'); await p.fill('input[name=password]', 'wrong'); await p.click('button.primary');
    await p.waitForSelector('[role=alert]:has-text("Unable to sign in")'); check('wrong password gives one generic message', true);
    await c.close(); }

  // ---- platform administrator
  { const { context, page } = await session('platform@example.test');
    check('platform admin lands on the platform overview', new URL(page.url()).pathname === '/overview', page.url());
    let t = await text(page);
    check('overview shows all three fleets from live figures', ['Northbank Logistics', 'Riverside Couriers', 'Hilltop Plumbing'].every(n => t.includes(n)) && t.includes('Fleet customers'), t.slice(0, 300));
    check('overview shows scheduled/attention panel', t.includes('Needs your attention') && t.includes('Not connected'));
    check('navigation includes Users for an administrator', await page.locator('nav a:has-text("Users")').count() === 1);
    const cookies = await context.cookies();
    const sb = cookies.filter(c => c.name.startsWith('sb-'));
    check('session cookie is HttpOnly and not readable by page scripts', sb.length > 0 && sb.every(c => c.httpOnly) && !(await page.evaluate(() => document.cookie)).includes('sb-'), JSON.stringify(sb.map(c => [c.name, c.httpOnly])));
    check('access token is not present in page HTML', !(await page.content()).includes('tok-platform'));

    await page.click('nav a:has-text("Insurer dashboard")'); await page.waitForURL('**/insurer');
    check('platform admin sees the insurer picker', await page.locator('select').filter({ hasText: 'All authorised insurers' }).count() === 1);

    await page.goto(base + '/fleet'); t = await text(page);
    check('vehicle register lists vehicles with status', t.includes('AB10XYZ') && t.includes('Covered') && t.includes('1–25 of 39'), t.slice(0, 400));
    await page.fill('input[name=q]', 'CD1'); await page.click('form[method=get] button'); await page.waitForURL(/q=CD1/);
    t = await text(page); check('search narrows the register', t.includes('CD10XYZ') && !t.includes('AB10XYZ'), t.slice(0, 300));
    await page.goto(base + '/fleet'); await page.click('a:has-text("Next")'); await page.waitForURL(/offset=25/);
    check('pagination moves to the next page', (await text(page)).includes('26–39 of 39'));

    // add vehicle
    await page.goto(base + '/changes');
    check('lookup is reported as not set up when no key exists', await (async () => {
      await page.fill('input[name=registration]', 'AB26 CDE'); await page.click('button:has-text("Look up")');
      await page.waitForSelector('text=not set up yet'); return true; })());
    await page.selectOption('select[name=policy_id]', { label: 'POL-1 · Northbank Logistics' });
    await page.fill('input[name=make]', 'Ford'); await page.fill('input[name=model]', 'Transit Custom');
    const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
    await page.fill('input[name=starts_on]', tomorrow);
    await page.click('button:has-text("Record addition")');
    await page.waitForSelector('text=Coverage change recorded');
    const addCall = (await calls()).filter(c => c.rpc === 'add_vehicle_cover').pop();
    check('add vehicle calls the database function with fleet, normalised registration and London-midnight date',
      addCall && addCall.body.p_fleet_id === '20000000-0000-4000-8000-000000000001' && addCall.body.p_registration === 'AB26CDE' && addCall.body.p_make_model === 'Ford Transit Custom' && addCall.body.p_effective_at.startsWith(new Date(Date.parse(tomorrow) - 3600000 * (Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', timeZoneName: 'shortOffset' }).formatToParts(new Date(tomorrow)).find(p => p.type === 'timeZoneName').value === 'GMT+1' ? 1 : 0)).toISOString().slice(0, 10)), JSON.stringify(addCall));
    // backdating blocked
    await page.selectOption('select[name=policy_id]', { label: 'POL-1 · Northbank Logistics' });
    await page.fill('input[name=registration]', 'ZZ11AAA'); await page.fill('input[name=make]', 'Ford'); await page.fill('input[name=model]', 'X');
    await page.evaluate(() => { document.querySelector('input[name=starts_on]').removeAttribute('min'); });
    await page.fill('input[name=starts_on]', '2026-01-02'); await page.click('button:has-text("Record addition")');
    await page.waitForSelector('text=Backdating approval is not available'); check('backdated additions are refused by the portal', true);

    // remove vehicle
    await page.click('a[role=tab]:has-text("Remove vehicle")'); await page.waitForURL(/mode=remove/);
    await page.locator('select[name=period_id]').selectOption({ index: 1 });
    await page.fill('input[name=ends_on]', tomorrow); await page.click('button:has-text("Record removal")');
    await page.waitForSelector('text=Coverage change recorded');
    check('remove vehicle calls the database function', (await calls()).some(c => c.rpc === 'remove_vehicle_cover'));

    // reconciliation
    await page.goto(base + '/reconciliation');
    check('generate is disabled until one policy is chosen', await page.locator('button:has-text("Generate saved report")').isDisabled());
    await page.selectOption('select >> nth=1', { label: 'POL-1' }).catch(() => {});
    await page.goto(base + `/reconciliation?month=2026-10&policy=30000000-0000-4000-8000-000000000001`);
    await page.click('button:has-text("Generate saved report")'); await page.waitForURL(/report=/);
    t = await text(page);
    check('generated report opens with vehicle-day totals and history', t.includes('Saved database report') && t.includes('INSURED VEHICLE-DAYS') && t.includes('Stored snapshots') && t.includes('27'), t.slice(0, 500));
    const [download] = await Promise.all([page.waitForEvent('download'), page.click('a:has-text("Export CSV")')]);
    const csvText = await (async () => { const s = await download.createReadStream(); let d = ''; for await (const c of s) d += c; return d; })();
    check('CSV export has the provisional header and rows', csvText.startsWith('"Report status"') && csvText.includes('PROVISIONAL') && csvText.split('\r\n').length > 20, csvText.slice(0, 120));

    // users
    await page.goto(base + '/users'); t = await text(page);
    check('users page lists people and shows the pending invitation', t.includes('customer@example.test') && t.includes('Invitation pending'));
    await page.selectOption('select >> nth=0', { label: 'Northbank Logistics (fleet customer)' }).catch(() => {});
    await page.goto(base + '/users?org=20000000-0000-4000-8000-000000000001'); t = await text(page);
    check('own row is marked and has no controls', t.includes('This is you'));
    await page.locator('select[aria-label="Role for driver@example.test"]').selectOption('fleet_accounts');
    await page.waitForSelector('text=Role updated');
    check('role change calls change_member_role', (await calls()).some(c => c.rpc === 'change_member_role' && c.body.p_role === 'fleet_accounts'));
    await page.fill('input[name=email]', 'New.Person@Example.com'); await page.selectOption('form.filters select[name=role]', 'fleet_manager');
    await page.click('button:has-text("Add person")'); await page.waitForSelector('text=Invitation saved');
    check('add person lower-cases the email and sends org and role', (await calls()).some(c => c.rpc === 'add_member' && c.body.p_email === 'new.person@example.com' && c.body.p_role === 'fleet_manager'));
    await page.click('button:has-text("Cancel invitation")'); await page.waitForTimeout(500);
    check('cancel invitation calls revoke_invitation', (await calls()).some(c => c.rpc === 'revoke_invitation'));

    await page.goto(base + '/drivers'); check('planned modules render a roadmap page', (await text(page)).includes('PLANNED MODULE'));
    await page.goto(base + '/nope'); check('unknown pages return a not-found page', (await text(page)).toLowerCase().includes('404') || (await text(page)).toLowerCase().includes('not found'));

    await page.click('button:has-text("Sign out")'); await page.waitForURL('**/login');
    await page.goto(base + '/overview'); check('after sign-out protected pages need a new login', new URL(page.url()).pathname === '/login');
    await context.close(); }

  // ---- insurer
  { const { context, page } = await session('insurer@example.test');
    check('insurer lands on the insurer dashboard', new URL(page.url()).pathname === '/insurer', page.url());
    let t = await text(page);
    check('insurer sees only their own customers', t.includes('Northbank Logistics') && t.includes('Riverside Couriers') && !t.includes('Hilltop Plumbing'), t.slice(0, 300));
    check('insurer has no insurer picker', await page.locator('select').filter({ hasText: 'All authorised insurers' }).count() === 0);
    await page.goto(base + '/overview'); t = await text(page);
    check('insurer cannot use the platform overview', t.includes('requires platform administrator'), t.slice(0, 200));
    await page.goto(base + '/fleet'); t = await text(page);
    check('insurer register excludes other insurers\' vehicles', t.includes('AB10XYZ') && !t.includes('EF10XYZ'));
    await context.close(); }

  // ---- fleet customer
  { const { context, page } = await session('customer@example.test');
    check('customer lands on the fleet dashboard', new URL(page.url()).pathname === '/customer', page.url());
    let t = await text(page);
    check('customer sees only their own fleet', t.includes('Northbank Logistics') && !t.includes('Riverside Couriers') && !t.includes('Hilltop'), t.slice(0, 400));
    await page.goto(base + '/insurer'); t = await text(page);
    check('customer cannot use the insurer dashboard', t.includes('requires insurer or platform administrator'));
    await page.goto(base + '/fleet'); t = await text(page);
    check('customer register shows only their vehicles', t.includes('AB10XYZ') && !t.includes('CD10XYZ'));
    await page.goto(base + '/changes');
    check('customer can add vehicles (form enabled)', !(await page.locator('button:has-text("Record addition")').isDisabled()));
    await context.close(); }

  // ---- account with no membership
  { const { context, page } = await session('nobody@example.test');
    await page.goto(base + '/customer'); const t = await text(page);
    check('an account with no membership sees no records and a clear message', t.includes('needs an organisation membership'), t.slice(0, 400));
    await page.goto(base + '/changes');
    check('and cannot submit cover changes', await page.locator('button:has-text("Record addition")').isDisabled());
    await page.goto(base + '/users'); check('and cannot manage users', (await text(page)).includes('available to platform, insurer and fleet administrators'));
    await context.close(); }

  // ---- demo
  { const { context, page } = await session('demo@stratifyfleet.co.uk');
    let t = await text(page);
    check('demo account is clearly marked read-only with fictional records', t.includes('DEMO · READ-ONLY') && t.includes('Fictional records'));
    await page.goto(base + '/fleet'); t = await text(page);
    check('demo register serves fictional fleet data', t.includes('1–25 of 1285'), t.slice(0, 300));
    await page.goto(base + '/changes'); check('demo cannot record changes', await page.locator('button:has-text("Record addition")').isDisabled());
    await page.goto(base + '/reconciliation'); t = await text(page);
    check('demo reconciliation shows a date-only preview', t.includes('INSURED VEHICLE-DAYS') && t.includes('2026-09'));
    const before = (await calls()).length;
    check('demo made no database data requests beyond sign-in', (await calls()).filter(c => c.rpc && c.rpc !== 'claim_invitations').length === 0 && before >= 0);
    await context.close(); }

  // ---- mobile
  { const { context, page } = await session('platform@example.test', { width: 390, height: 800 });
    await page.goto(base + '/fleet');
    check('mobile has no horizontal page scroll', await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
    await page.click('#menu-toggle'); check('mobile menu opens', await page.locator('.sidebar.menu-open').count() === 1);
    await context.close(); }

  check('no console errors, CSP violations or page errors in any session', problems.length === 0, problems.slice(0, 5).join(' | '));
} catch (error) {
  check('browser test ran to completion', false, error.stack || String(error));
} finally {
  await browser.close(); app.kill(); fake.close();
}
const failed = results.filter(r => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) { console.log('App log tail:\n' + appLog.split('\n').slice(-15).join('\n')); process.exit(1); }
