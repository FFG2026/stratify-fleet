// Browser test against the built app and a stand-in database. Run: npm run build && node tests/e2e/run.mjs
// Needs Playwright with a Chromium (PLAYWRIGHT_BROWSERS_PATH); set PLAYWRIGHT_MODULE if it lives elsewhere.
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { startFake } from './fake-supabase.mjs';
import { killListener } from './ports.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || '/opt/npm-tools/node_modules/playwright');
const FAKE = Number(process.env.FAKE_PORT || 54387), APP = Number(process.env.APP_PORT || 3187), base = `http://127.0.0.1:${APP}`;
const results = [];
const t0 = Date.now();
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok }); console.log(`[${String(Math.round((Date.now() - t0) / 1000)).padStart(3)}s] ` + (ok ? 'PASS ' : 'FAIL ') + name + (ok ? '' : '  -> ' + detail)); };

killListener(APP); killListener(FAKE); await new Promise(r => setTimeout(r, 500));
const { server: fake } = await startFake(FAKE);
const app = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '-p', String(APP)], {
  cwd: new URL('../../', import.meta.url).pathname,
  env: { ...process.env, SUPABASE_URL: `http://127.0.0.1:${FAKE}`, SUPABASE_PUBLISHABLE_KEY: 'test-publishable', NODE_ENV: 'production', DVLA_VES_API_KEY: '', SUPABASE_SERVICE_ROLE_KEY: 'test-service-role' },
  stdio: ['ignore', 'pipe', 'pipe']
});
let appLog = ''; app.stdout.on('data', d => appLog += d); app.stderr.on('data', d => appLog += d);
for (let i = 0; i < 60; i++) { try { await fetch(base + '/login'); break; } catch { await new Promise(r => setTimeout(r, 500)); } }

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined, args: ['--no-sandbox'] });
const problems = [];
let lastPage = null;
const net = [];

async function session(email, viewport = { width: 1280, height: 900 }, pw = 'pw') {
  const context = await browser.newContext({ viewport, acceptDownloads: true });
  const page = await context.newPage(); lastPage = page;
  page.on('console', m => { if (['error', 'warning'].includes(m.type()) && !/Failed to load resource.*404/.test(m.text())) problems.push(`[${email}] console ${m.type()}: ${m.text()}`); });
  page.on('response', r => net.push(`${r.status()} ${r.request().method()} ${r.url().replace(base, '')}`));
  page.on('requestfailed', r => net.push(`FAILED ${r.method()} ${r.url().replace(base, '')} ${r.failure()?.errorText}`));
  page.on('pageerror', e => problems.push(`[${email}] pageerror at ${page.url()}: ${e.message}`));
  await go(page, base + '/login');
  await page.fill('input[name=email]', email);
  await page.fill('input[name=password]', pw);
  await Promise.all([page.waitForURL(u => !['/login', '/'].includes(u.pathname), { waitUntil: 'commit' }), page.click('button.primary')]);
  await page.waitForLoadState('networkidle');
  return { context, page };
}
// Pages stream in; wait for the network to settle so we read the finished page, not the loading state.
const getFile = (page, path) => page.evaluate(async u => { const r = await fetch(u, { credentials: 'same-origin', redirect: 'manual' }); return { status: r.status, type: r.headers.get('content-type'), len: (await r.arrayBuffer()).byteLength }; }, path);
const urlHas = (page, pattern) => page.waitForFunction(([src, glob]) => glob ? location.pathname.endsWith(src) : new RegExp(src).test(location.pathname + location.search), typeof pattern === 'string' ? [pattern.replace('**', ''), true] : [pattern.source, false], { timeout: 20000 });
const go = async (page, url) => { await page.goto(url); await page.waitForLoadState('networkidle'); };
const text = async page => {
  // Every finished page has a heading in <main>; the loading state does not.
  await page.waitForSelector('main h1, main h2', { timeout: 20000 }).catch(() => {});
  await page.waitForLoadState('networkidle');
  return page.locator('body').innerText();
};
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
    check('overview shows all three fleets from live figures', ['Northbank Logistics', 'Riverside Couriers', 'Hilltop Plumbing'].every(n => t.includes(n)) && t.includes('Fleet customers'), t.slice(-400));
    check('overview shows scheduled/attention panel', t.includes('Needs your attention') && t.includes('Not connected'));
    check('navigation includes Users for an administrator', await page.locator('nav a:has-text("Users")').count() === 1);
    const cookies = await context.cookies();
    const sb = cookies.filter(c => c.name.startsWith('sb-'));
    check('session cookie is HttpOnly and not readable by page scripts', sb.length > 0 && sb.every(c => c.httpOnly) && !(await page.evaluate(() => document.cookie)).includes('sb-'), JSON.stringify(sb.map(c => [c.name, c.httpOnly])));
    check('access token is not present in page HTML', !(await page.content()).includes('tok-platform'));

    await page.click('nav a:has-text("Insurer dashboard")'); await urlHas(page, '**/insurer'); await text(page);
    check('platform admin sees the insurer picker', await page.locator('select').filter({ hasText: 'All authorised insurers' }).count() === 1);

    await go(page, base + '/fleet'); t = await text(page);
    check('vehicle register lists vehicles with status', t.includes('AB10XYZ') && t.includes('Covered') && t.includes('1–25 of 39'), t.slice(-400));
    await page.fill('input[name=q]', 'CD1'); await page.click('form[method=get] button'); await urlHas(page, /q=CD1/);
    t = await text(page); check('search narrows the register', t.includes('CD10XYZ') && !t.includes('AB10XYZ'), t.slice(-400));
    await go(page, base + '/fleet'); await page.click('a:has-text("Next")'); await urlHas(page, /offset=25/);
    check('pagination moves to the next page', (await text(page)).includes('26–39 of 39'));

    // add vehicle
    await go(page, base + '/changes');
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
    await page.selectOption('select[name=policy_id]', { label: 'POL-1 · Northbank Logistics' });
    await page.fill('input[name=registration]', 'ZZ11AAA'); await page.fill('input[name=make]', 'Ford'); await page.fill('input[name=model]', 'X');
    await page.evaluate(() => { document.querySelector('input[name=starts_on]').removeAttribute('min'); });
    await page.fill('input[name=starts_on]', '2026-01-02'); await page.click('button:has-text("Record addition")');
    await page.waitForSelector('text=Backdating approval is not available'); check('backdated additions are refused by the portal', true);

    // remove vehicle
    await page.click('a[role=tab]:has-text("Remove vehicle")'); await urlHas(page, /mode=remove/);
    check('removal record button is off until a vehicle is chosen', await page.locator('button:has-text("Record removal")').isDisabled());
    await page.fill('input[placeholder="Start typing a registration"]', 'ab10');
    await page.waitForSelector('[data-testid=chosen-vehicle]');
    check('typing a registration finds the vehicle and fills in its details', (await page.locator('[data-testid=chosen-vehicle]').innerText()).includes('AB10XYZ'));
    await page.fill('input[name=ends_on]', tomorrow); await page.click('button:has-text("Record removal")');
    await page.waitForSelector('text=Coverage change recorded');
    check('remove vehicle calls the database function', (await calls()).some(c => c.rpc === 'remove_vehicle_cover'));

    // reconciliation
    await go(page, base + '/reconciliation');
    t = await text(page);
    check('reconciliation shows a live list of vehicles with cover before any report is generated', t.includes('Live preview') && t.includes('AB10XYZ') && !t.includes('AB19XYZ') && /\b31\b/.test(t), t.slice(0, 700));
    check('generate is disabled until one policy is chosen', await page.locator('button:has-text("Generate saved report")').isDisabled());
    await page.selectOption('select >> nth=1', { label: 'POL-1' }).catch(() => {});
    await go(page, base + `/reconciliation?month=2026-10&policy=30000000-0000-4000-8000-000000000001`);
    await page.click('button:has-text("Generate saved report")'); await urlHas(page, /report=/);
    t = await text(page);
    check('generated report opens with vehicle-day totals and history', t.includes('Saved database report') && t.includes('INSURED VEHICLE-DAYS') && t.includes('Stored snapshots') && t.includes('27'), t.slice(-500));
    const [download] = await Promise.all([page.waitForEvent('download'), page.click('a:has-text("Export CSV")')]);
    const csvText = await (async () => { const s = await download.createReadStream(); let d = ''; for await (const c of s) d += c; return d; })();
    check('CSV export has the provisional header and rows', csvText.startsWith('"Report status"') && csvText.includes('PROVISIONAL') && csvText.split('\r\n').length > 20, csvText.slice(0, 120));

    // users
    await go(page, base + '/users?org=20000000-0000-4000-8000-000000000001'); t = await text(page);
    check('users page lists people and shows the pending invitation', t.includes('customer@example.test') && t.includes('Invitation pending'), t.slice(-300));
    await page.locator('select[aria-label="Role for driver@example.test"]').selectOption('fleet_accounts');
    await page.waitForSelector('text=Role updated');
    check('role change calls change_member_role', (await calls()).some(c => c.rpc === 'change_member_role' && c.body.p_role === 'fleet_accounts'));
    await page.fill('input[name=email]', 'New.Person@Example.com'); await page.selectOption('form.filters select[name=role]', 'fleet_manager');
    await page.click('button:has-text("Add person")'); await page.waitForSelector('text=Invitation saved');
    check('add person lower-cases the email and sends org and role', (await calls()).some(c => c.rpc === 'add_member' && c.body.p_email === 'new.person@example.com' && c.body.p_role === 'fleet_manager'));
    await page.fill('input[name=email]', 'Temp.Login@Example.com'); await page.fill('input[name=password]', 'Temporary-pass-1'); await page.selectOption('form.filters select[name=role]', 'fleet_manager');
    await page.click('button:has-text("Add person")'); await page.waitForSelector('text=Login created');
    { const cs = await calls();
      check('adding with a password creates a flagged login after add_member and records an audit entry', cs.some(c => c.admin === 'create_user' && c.body.email === 'temp.login@example.com' && c.body.app_metadata?.must_change_password === true && c.body.email_confirm === true) && cs.some(c => c.rpc === 'record_member_login' && c.body.p_email === 'temp.login@example.com') && JSON.stringify(cs).indexOf('Temporary-pass-1') === -1, JSON.stringify(cs.filter(c => c.admin)));
      check('the page never shows the password back', !(await text(page)).includes('Temporary-pass-1')); }
    await page.fill('input[name=email]', 'short@example.com'); await page.fill('input[name=password]', 'short'); await page.selectOption('form.filters select[name=role]', 'driver');
    await page.click('button:has-text("Add person")');
    await page.waitForFunction(() => document.querySelector('input[name=password]')?.validity?.tooShort === true || /at least 8/.test(document.body.innerText));
    check('a short temporary password is refused', !(await calls()).some(c => c.body?.email === 'short@example.com'));
    await page.click('button:has-text("Cancel invitation")'); await page.waitForTimeout(500);
    check('cancel invitation calls revoke_invitation', (await calls()).some(c => c.rpc === 'revoke_invitation'));

    await go(page, base + '/crm'); check('planned modules render a roadmap page', (await text(page)).includes('PLANNED MODULE'));
    await go(page, base + '/nope'); check('unknown pages return a not-found page', (await text(page)).includes('Page not found'));

    await go(page, base + '/overview');
    await page.click('button:has-text("Sign out")'); await urlHas(page, '**/login');
    await go(page, base + '/overview'); check('after sign-out protected pages need a new login', new URL(page.url()).pathname === '/login');
    await context.close(); }

  // ---- insurer
  { const { context, page } = await session('insurer@example.test');
    check('insurer lands on the insurer dashboard', new URL(page.url()).pathname === '/insurer', page.url());
    let t = await text(page);
    check('insurer sees only their own customers', t.includes('Northbank Logistics') && t.includes('Riverside Couriers') && !t.includes('Hilltop Plumbing'), t.slice(-400));
    check('insurer menu hides the platform overview', !(await page.locator('nav a').allInnerTexts()).some(x => /Platform overview/.test(x)));
    check('insurer has no insurer picker', await page.locator('select').filter({ hasText: 'All authorised insurers' }).count() === 0);
    await go(page, base + '/overview'); t = await text(page);
    check('insurer cannot use the platform overview', t.includes('requires platform administrator'), t.slice(-300));
    await go(page, base + '/fleet'); t = await text(page);
    check('insurer register excludes other insurers\' vehicles', t.includes('AB10XYZ') && !t.includes('EF10XYZ'));
    await context.close(); }

  // ---- first sign-in with a temporary password
  { const { context, page } = await session('temp.login@example.com', undefined, 'Temporary-pass-1');
    check('a login with a temporary password is sent to choose its own', new URL(page.url()).pathname === '/change-password', page.url());
    await page.goto(base + '/customer'); await page.waitForLoadState('networkidle'); check('the rest of the app is closed until the password is changed', new URL(page.url()).pathname === '/change-password', page.url());
    await page.fill('input[name=password]', 'Temporary-pass-1'); await page.fill('input[name=again]', 'Temporary-pass-1'); await page.click('button.primary');
    await page.waitForSelector('text=different from the temporary'); check('reusing the temporary password is refused', true);
    await page.fill('input[name=password]', 'A-much-better-pass-9'); await page.fill('input[name=again]', 'A-much-better-pass-9'); await page.click('button.primary');
    await page.waitForURL(u => u.pathname !== '/change-password'); await page.waitForLoadState('networkidle');
    check('after choosing a password the person reaches the workspace', ['/customer', '/'].includes(new URL(page.url()).pathname) && !(await text(page)).includes('Choose your password'), page.url());
    await context.close(); }

  // ---- driver
  let t2 = '';
  { const { context, page } = await session('driver@example.test');
    check('a driver lands on the driver dashboard', new URL(page.url()).pathname === '/driver', page.url());
    const nav = await page.locator('nav a').allInnerTexts();
    check('a driver has only Driver dashboard, Drivers & licences and Claims / FNOL', JSON.stringify(nav.map(s => s.replace(/[^A-Za-z/& ]/g, '').trim())) === JSON.stringify(['Driver dashboard', 'Drivers & licences', 'Claims / FNOL']), JSON.stringify(nav));
    const t = await text(page);
    check('driver sees the vehicle on cover now with dates, and earlier cover', t.includes('AB10XYZ') && t.includes('Ford Transit') && t.includes('01/01/2026') && t.includes('no end date') && t.includes('Previously on cover') && t.includes('ZZ99OLD') && t.includes('01/03/2026'), t.slice(0, 900));
    await go(page, base + '/fleet'); check('a driver cannot open the fleet register', new URL(page.url()).pathname === '/driver', page.url());
    await go(page, base + '/reconciliation'); check('a driver cannot open reconciliation', new URL(page.url()).pathname === '/driver', page.url());
    await go(page, base + '/drivers'); t2 = await text(page);
    check('a driver sees their own file: details, documents, permissions and history', ['Your file', 'Your details', 'Documents', 'Permissions', 'Job history, last 3 years', 'Claims history', 'Motoring convictions', 'licence-front.png', 'Acme Haulage', 'Rear-end collision'].every(s => t2.includes(s)) && !t2.includes('Danny Rival') && !t2.includes('Assign a driver'), t2.slice(0, 700));
    check('the file checklist shows progress', /\d of 8 complete/.test(t2));
    await page.setInputFiles('input[aria-label="Right to work: choose a file"]', { name: 'rtw.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==', 'base64') });
    await page.locator('form.upload', { hasText: 'Right to work' }).locator('button').click(); await page.waitForSelector('text=Uploaded. Your fleet and its insurers can now see it.');
    { const cs = await calls();
      check('an upload goes to private storage in the driver\'s own folder, then is recorded', cs.some(c => c.storage === 'POST' && c.path.startsWith('driver-documents/20000000-0000-4000-8000-000000000001/a0000000-0000-4000-8000-000000000006/') && c.path.endsWith('.png')) && cs.some(c => c.rpc === 'add_driver_document' && c.body.p_kind === 'right_to_work' && c.body.p_type === 'image/png'), JSON.stringify(cs.filter(c => c.storage || c.rpc === 'add_driver_document'))); }
    await page.setInputFiles('input[aria-label="Other documents: choose a file"]', { name: 'bad.png', mimeType: 'image/png', buffer: Buffer.from('<script>alert(1)</script>') });
    await page.locator('form.upload', { hasText: 'Other documents' }).locator('button').click(); await page.waitForSelector('text=Upload a photo (JPG, PNG or WebP) or a PDF.');
    check('a file that is not really a picture or PDF is refused', !(await calls()).some(c => c.rpc === 'add_driver_document' && c.body.p_kind === 'other'));
    await page.locator('input[aria-label="Sharing my details"]').click(); await page.waitForSelector('text=Permission recorded');
    check('ticking a permission records it with the wording agreed to', (await calls()).some(c => c.rpc === 'record_driver_consent' && c.body.p_kind === 'data_sharing' && c.body.p_given === true && c.body.p_version === 'v1' && /insurers of that fleet/.test(c.body.p_statement)));
    await page.fill('form:has(input[value=employment]) input[name=title]', 'Bluebell Couriers'); await page.fill('form:has(input[value=employment]) input[name=start]', '2020-02-01'); await page.fill('form:has(input[value=employment]) input[name=end]', '2021-12-31');
    await page.locator('form:has(input[value=employment]) button:has-text("Add")').click(); await page.waitForSelector('text=Added.');
    check('adding a job calls add_driver_record', (await calls()).some(c => c.rpc === 'add_driver_record' && c.body.p_kind === 'employment' && c.body.p_title === 'Bluebell Couriers'));
    await page.click('button[aria-label="Remove licence-front.png"]'); await page.waitForTimeout(1500);
    check('removing a file deletes it from storage', (await calls()).some(c => c.rpc === 'remove_driver_document') && (await calls()).some(c => c.storage === 'DELETE'));
    await go(page, base + '/drivers/a0000000-0000-4000-8000-000000000006'); check('a driver cannot open the staff view of a driver', new URL(page.url()).pathname === '/drivers', page.url());
    const direct = await getFile(page, '/drivers/file/d1000000-0000-4000-8000-000000000002'); check('a driver cannot fetch another driver\'s document', direct.status === 404, String(direct.status));
    await context.close(); }

  // ---- fleet customer
  { const { context, page } = await session('customer@example.test');
    check('customer lands on the fleet dashboard', new URL(page.url()).pathname === '/customer', page.url());
    let t = await text(page);
    check('customer sees only their own fleet', t.includes('Northbank Logistics') && !t.includes('Riverside Couriers') && !t.includes('Hilltop'), t.slice(-400));
    check('customer dashboard has no Customers box and its boxes are links', !(await page.locator('.stat-label:has-text("Customers")').count()) && await page.locator('a.stat-link:has-text("Scheduled additions")').getAttribute('href') === '/fleet?status=scheduled' && await page.locator('a.stat-link:has-text("Covered vehicles")').count() === 1);
    await go(page, base + '/insurer'); t = await text(page);
    await go(page, base + '/users'); check('fleet user sees no organisation picker on Users', await page.getByText('People in').count() === 1 && await page.locator('label:has-text("Organisation")').count() === 0);
    check('customer cannot use the insurer dashboard', t.includes('requires insurer or platform administrator'));
    await go(page, base + '/users?org=20000000-0000-4000-8000-000000000001'); t = await text(page);
    check('own row is marked "This is you" and has no controls', t.includes('This is you'), t.slice(-300));
    await go(page, base + '/drivers'); t = await text(page);
    check('fleet staff see their own drivers but not another fleet\'s', t.includes('Dana Driver') && !t.includes('Danny Rival') && /licence check permission/i.test(t) && t.includes('Given'), t.slice(0, 700));
    await page.fill('input[name=q]', 'dan'); await page.waitForSelector('#driver-suggestions a:has-text("Dana Driver")');
    check('typing part of a name suggests matching drivers', (await page.locator('#driver-suggestions a').allInnerTexts()).join('|') === 'Dana Driver');
    await page.click('#driver-suggestions a:has-text("Dana Driver")'); await urlHas(page, /\/drivers\/a0000000/);
    t = await text(page);
    check('the driver detail shows details, documents, permissions and history to staff', ['Dana Driver', 'DRIVE803148DA9AB', 'licence-front.png', 'Given', 'Acme Haulage', 'Rear-end collision', 'Declared none'].every(s => t.includes(s)) && !(await page.locator('form.upload').count()), t.slice(0, 800));
    const doc = await getFile(page, '/drivers/file/d1000000-0000-4000-8000-000000000001');
    check('staff can open a driver document and it is audited first', doc.status === 200 && /image\/png/.test(doc.type || '') && (await calls()).some(c => c.rpc === 'log_driver_document_view'), String(doc.status));
    const rival = await getFile(page, '/drivers/file/d1000000-0000-4000-8000-000000000002'); check('staff cannot open a document from a fleet they cannot see', rival.status === 404, String(rival.status));
    await go(page, base + '/drivers?view=assignments'); t = await text(page);
    check('fleet staff see current driver assignments', t.includes('Assign a driver to a vehicle') && t.includes('driver@example.test') && t.includes('AB10XYZ') && t.includes('Current'), t.slice(0, 600));
    await page.selectOption('select[name=user]', { label: 'driver@example.test' }); await page.fill('input[name=registration]', 'ab10 xyz'); await page.click('button:has-text("Assign")');
    await page.waitForSelector('text=assigned. The driver can see it now');
    check('assigning calls the database function with the vehicle, driver and date', (await calls()).some(c => c.rpc === 'assign_driver' && c.body.p_user === 'a0000000-0000-4000-8000-000000000006' && c.body.p_vehicle === 'f1000000-0000-4000-8000-000000000001' && /^\d{4}-\d\d-\d\d$/.test(c.body.p_from)));
    await page.click('button:has-text("End today")'); await page.waitForTimeout(500);
    check('ending an assignment calls end_assignment', (await calls()).some(c => c.rpc === 'end_assignment'));
    await go(page, base + '/fleet'); t = await text(page);
    check('customer register shows only their vehicles', t.includes('AB10XYZ') && !t.includes('CD10XYZ'));
    await go(page, base + '/fleet');
    check('customer register has a Remove link on open periods', await page.locator('a[aria-label="Remove AB10XYZ"]').count() === 1);
    await page.click('a[aria-label="Remove AB10XYZ"]'); await urlHas(page, /mode=remove/);
    await page.waitForSelector('[data-testid=chosen-vehicle]');
    check('Remove link opens the removal form with that vehicle chosen', (await page.locator('[data-testid=chosen-vehicle]').innerText()).includes('AB10XYZ'));
    const custNav = await page.locator('nav a').allInnerTexts();
    check('customer menu hides the platform and insurer dashboards', !custNav.some(x => /Platform overview|Insurer dashboard/.test(x)) && custNav.some(x => /Fleet dashboard/.test(x)), custNav.join('|'));
    await go(page, base + '/changes');
    check('customer can add vehicles (form enabled)', !(await page.locator('button:has-text("Record addition")').isDisabled()));
    await context.close(); }

  // ---- account with no membership
  { const { context, page } = await session('nobody@example.test');
    await go(page, base + '/customer'); const t = await text(page);
    check('an account with no membership sees no records and a clear message', t.includes('needs an organisation membership'), t.slice(-400));
    await go(page, base + '/changes');
    check('and cannot submit cover changes', await page.locator('button:has-text("Record addition")').isDisabled());
    await go(page, base + '/users'); check('and cannot manage users', (await text(page)).includes('available to platform, insurer and fleet administrators'));
    await context.close(); }

  // ---- demo
  { const { context, page } = await session('demo@stratifyfleet.co.uk');
    let t = await text(page);
    check('demo account is clearly marked read-only with fictional records', t.includes('DEMO · READ-ONLY') && t.includes('Fictional records'));
    await go(page, base + '/fleet'); t = await text(page);
    check('demo register serves fictional fleet data', t.includes('1–25 of 1285'), t.slice(-400));
    await go(page, base + '/changes'); check('demo cannot record changes', await page.locator('button:has-text("Record addition")').isDisabled());
    await go(page, base + '/reconciliation'); t = await text(page);
    check('demo reconciliation shows a date-only preview', t.includes('INSURED VEHICLE-DAYS') && t.includes('2026-09'));
    const before = (await calls()).length;
    const dbLog = await (await fetch(`http://127.0.0.1:${FAKE}/__log`)).json();
    check('demo made no database data requests beyond sign-in', dbLog.filter(l => l.includes('tok-demo') && l.includes('/rest/v1/')).length === 0 && before >= 0, dbLog.filter(l => l.includes('tok-demo')).join(' | '));
    await context.close(); }

  // ---- mobile
  { const { context, page } = await session('platform@example.test', { width: 390, height: 800 });
    await go(page, base + '/fleet');
    const wide = await page.evaluate(() => [...document.querySelectorAll('body *')].filter(e => e.getBoundingClientRect().right > window.innerWidth + 1 && !e.closest('.table-scroll') && !e.closest('nav')).slice(0, 4).map(e => e.tagName + '.' + e.className + ' ' + Math.round(e.getBoundingClientRect().right)).join(' | '));
    check('mobile has no horizontal page scroll', await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), wide);
    await page.click('#menu-toggle'); check('mobile menu opens', await page.locator('.sidebar.menu-open').count() === 1);
    await context.close(); }

  check('no console errors, CSP violations or page errors in any session', problems.length === 0, problems.slice(0, 5).join(' | '));
} catch (error) {
  check('browser test ran to completion', false, error.stack || String(error));
  try { console.log('DB REQUEST LOG TAIL:\n' + (await (await fetch(`http://127.0.0.1:${FAKE}/__log`)).json()).slice(-30).join('\n')); } catch { /* fake already stopped */ }
  console.log('NETWORK TAIL:\n' + net.slice(-14).join('\n'));
  if (lastPage) console.log('PAGE AT FAILURE:', lastPage.url(), '\n' + (await lastPage.locator('main').innerText().catch(() => '')).slice(0, 900));
} finally {
  await browser.close(); try { process.kill(-app.pid); } catch { /* already stopped */ } fake.close(); killListener(APP);
}
const failed = results.filter(r => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) { console.log('App log tail:\n' + appLog.split('\n').slice(-15).join('\n')); process.exit(1); }
