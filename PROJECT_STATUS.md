# Stratify project status
Last updated: 27 October 2026

## Architecture
- Repository: FFG2026/stratify-fleet; branch feat/portal-foundation.
- Brand: Stratify, formerly Stratum.
- Dependency-free Node.js 22+ server, browser ES modules, Supabase Auth/PostgREST/RPC.
- Supabase project: stratify-fleet, ref zdhkjqrpmrxcupwirnzk, eu-west-1.
- Original Sites project appgprj_6adb05ed372c81918d9270cb8dc0d2be is unchanged.
- No public deployment or live MID/MIB integration.
- GitHub visibility was public at inspection. No credentials, real customer data or local .env are committed.

## Existing work discovered
The database already had five migrations, six fictional organisations, three policies, 630 fictional vehicles and 643 coverage periods, plus rate cards. No Auth profiles or organisation memberships were present at initial inspection. These were pre-existing work, not created by this branch.

Recovered migrations:
- 20261023092447_core_tenancy
- 20261023092541_coverage
- 20261023092624_reconciliation
- 20261023092625_my_permissions
- 20261023092645_pin_search_path

The alternate fresh schema drafted before the connection was available was discarded without applying it.

## Implemented in this branch
- Six responsive screen implementations: platform, insurer, customer, fleet, changes, reconciliation.
- Email/password login, HttpOnly session cookie, origin checks and logout.
- Tenant-filtered workspace through existing RLS; role-aware primary navigation and change controls.
- Adapter to existing fleet_id/policy_number/timestamp coverage schema.
- Add/remove instructions call add_vehicle_cover/remove_vehicle_cover; previous periods remain.
- Provisional day preview and CSV export, with formula injection protection.
- Saved database reconciliation generation, paginated line retrieval and CSV rules snapshot.
- Read-only fictional demo mode, local setup, bootstrap guidance, recovered migrations and optional clean-dev seed.

## Initial milestone verification
- Eight automated Node tests PASS: date boundaries, leap year, removal/re-addition, DST midnight conversion, registration input, CSV safety, existing-schema adapter, API session/origin guards, HttpOnly login cookie, 600-row batch pagination and RPC mapping.
- Syntax checks PASS.
- Database transaction test PASS under authenticated fleet_admin: own-tenant read, other-tenant read denial, add/remove/re-add, overlap rejection, audit and pending MID records, direct table-write denial, backdate denial, unaffiliated identity denial. Test data was rolled back.
- Database transaction test PASS under fleet_accounts: provisional report generation, stored rules snapshot, positive day lines, matching totals, tenant isolation. Test data was rolled back.
- Security advisors report intentional authenticated SECURITY DEFINER RPCs. These have explicit permission checks and fixed search paths. No linter setting was disabled.
- Browser inspection could not run: tab operations returned a session ownership error. Local HTTP requests returned EACCES. No end-to-end browser or real-user Auth success is claimed.
- Original Sites source retrieval failed; source helper stopped. Both master Word and markdown reads returned no readable content; a prepared byte transfer was not available locally. The supplied conversation brief guided this milestone. Full master document alignment still needs verification.

## Environment names
SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, APP_ORIGIN, PORT, DEMO_MODE. No service-role credential required. Local environment values are excluded from Git.

## Open business rules and limitations
- Date-only preview: London calendar labels, addition included, removal excluded.
- Saved reports: use existing database rules/default snapshot; preview and saved values may differ for partial days, rates or configured rules.
- Insurer agreement needed on same-day cover, backdates, rate changes, taxes/fees, expiry, rounding and corrections.
- Saved report reopening is implemented; finalisation and approvals are not implemented.
- Access cookie expires after at most one hour; session refresh/recovery and onboarding UI are outstanding.
- Fleet data is paginated on the server. Organisation/policy metadata and a chosen saved report's full lines are still fetched in batches; add scoped metadata loading and streamed exports as the dataset grows.
- User management and insurer/customer provisioning UI, white-label tenancy, claims/FNOL, compliance and fleet CRM are planned.
- No real user was provisioned and no customer email was sent.

## Next milestone
1. Create the first verified admin Auth user and membership.
2. Run browser -> login -> 600-vehicle fleet -> add/remove -> saved reconciliation on a working preview host.
3. Compare all six screens against the original prototype and read the master brief in full.
4. Agree billing rules and add report finalisation, approvals and scoped server-side pagination.
5. Configure deployment only when instructed; do not treat this branch as production ready.

## Second development increment — 23 October 2026
- Purchased domain confirmed by user: stratifyfleet.co.uk, registered with Cloudflare. DNS/hosting have not been changed.
- Vehicle register now requests one database page at a time, with policy, registration/vehicle-name search and active/closed/scheduled filters. Dashboard totals use database counts and only five recent periods are loaded.
- Removal selector searches and pages open periods instead of building a 600-option dropdown.
- Added paginated saved report history by month and policy; users can reopen and export the original saved lines and rules snapshot.
- Connected reconciliation no longer pretends five recently loaded periods form a full month preview. It requires a generated/reopened report; fictional demo mode retains its illustrative preview.
- Changed API queries remain protected by the existing user-token RLS; hidden report IDs return 404 before reading lines.
- Both vehicle change forms disable submission for read-only roles.
- Added tests for query injection/range validation, the last page of a 600-vehicle fleet, stored report reopening, cross-tenant hidden reports, bounded dashboard loading and six-screen rendering.
- Added GitHub Actions Node 22/24 checks. Validation: GitHub Actions passed syntax and automated tests on Node 22 and 24 (run 39938141459), after the selected local environment became unavailable. In-process six-screen rendering checks also passed. Real browser and live sign-in tests remain outstanding.
- No schema changes, real-user provisioning, invitation emails, domain DNS edits or public deployment were made in this increment.

Next: create the first verified administrator account, run real browser sign-in and coverage/report flows on a working preview host, then agree final billing rules and implement approvals/finalisation.


## Original prototype design restored — 23 October 2026

Recovered the original Stratum Site source at commit 212fa8957375c6117c759787109ff8a73593ed10. Restored its forest-green (#142e28 / #193830), sage and cream palette; 230px desktop sidebar; six main screen labels; three planned-module tabs; compact header; stat cards; portfolio table; and tabbed Add / Remove forms. Retained Stratify branding and the connected portal's authenticated API, pagination, saved reports, CSV export and role checks. Dashboard cards use authorised database records instead of the prototype's illustrative portfolio totals and charts.

All nine navigation entries are visible. Restricted platform/insurer dashboards display a membership explanation rather than exposing their content. Drivers & licences, Claims / FNOL and Fleet CRM have explicit planned-module pages. Policy workspace selection opens the filtered register (or updates the current cover/report screen).

Validation: syntax checks, 23 automated tests, static build passed. Browser visual QA was blocked by the cloud browser URL policy; responsive rules are present but rendered desktop/mobile appearance is unverified.

User manually deployed feat/portal-foundation to Vercel and configured Supabase settings; screenshots show successful sign-in as owen@dcfgroup.co.uk, with no authorised organisations. Administrator membership still needs provisioning. Vercel team API access remains unavailable, so this change is pushed to GitHub; deployment readiness is not verified. Custom domain is not yet linked.


## Approved logo and dedicated demo account — 23 October 2026

Added the approved flowing-S Stratify logo to login and sidebar, static build and local file whitelist.

User clarified that fictional data must belong to a dedicated demo login, not be available through the main account or public Explore demo buttons. Removed the unshipped cookie-based public demo. `/demo` is a dedicated sign-in page, using normal Supabase email/password authentication. Server verifies each user and selects fixtures only for the confirmed email `demo@stratifyfleet.co.uk` (configurable through DEMO_ACCOUNT_EMAIL). Main users retain their existing RLS-scoped workspace. Demo user has no organisation memberships and must not be granted any.

User provisioning remains pending: existing Supabase lookup found only owen@dcfgroup.co.uk, no demo user. No Supabase users, memberships or permissions changed. Create the demo user through the dashboard with Auto Confirm enabled; choose its password there.

Dataset: Alder Mutual, Northstar Assurance, Haven Commercial; Atlas Logistics (600), Swiftline Couriers (180), Meridian Transport (420), Oak & Co Services (85); 1,285 vehicles, four policies, September additions/removals and audit examples. Demo is read-only; no database REST queries or writes are issued for demo users. Existing preview CSV and pagination supported.

Validation: syntax checks, 24 tests, static build. Browser visual QA remains blocked by browser URL policy. Vercel deployment remains a manual user step due unavailable team access.

## User management — 23 October 2026 (branch feat/user-management)
Three access levels, all enforced by the database (RLS + permission checks inside every function):
- Platform administrator: every insurer, customer, vehicle and rate.
- Insurer administrator: their own organisation and its fleet customers.
- Fleet administrator: their own fleet only.

Added (migration `20261023180000_member_management.sql`, already applied to the dev project):
- `membership.manage` granted to insurer_admin and fleet_admin (development assumption — review).
- `invitations` table; `list_members`, `add_member`, `change_member_role`, `set_member_active`, `revoke_invitation`, `claim_invitations` functions.
- Safeguards: nobody can change or switch off their own access; an organisation always keeps one active administrator; roles must suit the organisation kind (an insurer can never create a platform administrator); invitations are claimed only by a CONFIRMED email at sign-in.
- Server routes `/api/members*` (input validation only; the database decides) and a Users screen visible to administrators.

Verification: `tests/member_management.sql` (23 database checks, run in a rolled-back transaction on the dev project, all PASS) plus 30 Node tests (members API, claim at sign-in, demo account blocked, Users page per role). Real browser sign-in as each role has NOT been done.

Not built: sending invitation emails (needs a server-side Supabase admin credential, which this app deliberately does not hold) — create the login in Supabase first, then add the person here. No audit view in the UI yet; membership changes and invitations are written to `audit_logs`.

## Live insurer and platform dashboards — 23 October 2026 (branch feat/live-dashboards)
- New `/api/dashboard`: per-fleet vehicle counts (from the `fleet_overview` view), changes recorded in the last 7 days, cover changes scheduled for the next 7 days, provisional reconciliations from the last 30 days, and the latest 8 changes. Every count runs under the signed-in user's own token, so row-level security limits it to what they may see. Insurer dashboard has an insurer filter for platform administrators.
- Platform overview and Insurer dashboard now show these live figures instead of reusing fleet pages. No premium estimate is shown: rates are only visible to insurer/platform roles and billing rules are not agreed.
- Verified: 33 Node tests; database counts run as the insurer login (Northbank 600 vehicles / 573 on cover, Riverside 20 / 20, no scheduled changes yet). Real browser check still outstanding.
- Limit: with very many fleets the fleet list is capped at 1,000 and passed in the query; move to a database function if a tenant has more.

## Billing assumptions stated by the owner (not yet confirmed with an insurer)
- A vehicle is charged for the full day it goes on cover, even if added at 23:59, and for the full day it is removed. This matches the current default (start day and end day both charged). Reports stay marked provisional until an insurer confirms.
- Tax on insurance is Insurance Premium Tax (IPT), not VAT. The rate and whether quoted premiums already include it are NOT confirmed; the `vat_rate` column is a placeholder at 0 and the reports show tax separately.
- Future-dated additions (add from a chosen date) are supported by the Add vehicle date picker. Backdating stays blocked: a vehicle is on or off cover, with no approval workflow planned for now.

## Registration lookup — 23 October 2026 (branch feature/vehicle-lookup)
- Add vehicle form has a "Look up" button. It calls `/api/vehicle-lookup`, which asks the DVLA Vehicle Enquiry Service (VES) and fills in Make. DVLA does not return the model, so the person still types it. The result is a convenience only: it does not confirm cover or ownership and nothing is stored.
- Off by default: it works only when `DVLA_VES_API_KEY` is set on the server (never in browser code). Without it the button says lookup is not set up and the form still works by hand.
- Signed-in users only; the demo account is blocked; 30 lookups a minute per user per server instance.
- **Key availability:** on 23 Oct 2026 the DVLA VES page said new VES API registrations were closed for system upgrades. A paid supplier (for example UK Vehicle Data) is the fallback and would need its own small adapter in `lib/vehicle-lookup.mjs`.
- Verified: 40 Node tests with a stubbed DVLA response. NOT yet tested against the real DVLA service (no key) or in a real browser.

## Next.js version of the portal — 23 October 2026 (branch feature/nextjs-portal, folder `web/`)
Built alongside the live portal; **nothing deployed and the live site is untouched.** Same database, same logins, same environment variable names (`SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `DEMO_ACCOUNT_EMAIL`, `DVLA_VES_API_KEY`).
- Stack: Next.js 15 (App Router) + TypeScript. Pages are server-rendered under the signed-in person's own token; every write is a server action that validates input (zod) and calls the same database functions as before, which re-check permissions. The browser never talks to Supabase and never sees a key or token.
- Sign-in: `@supabase/ssr` session cookie, forced HttpOnly + SameSite=Lax + Secure in production; the middleware validates the token with Supabase Auth on every request. Sign-in claims pending invitations (confirmed email only), as before.
- Security headers: nonce-based Content-Security-Policy (no inline scripts or styles), frame-ancestors none, nosniff, no-store. Custom 404 because Next's default one uses inline styles.
- Screens ported (feature parity with the live portal): Platform overview and Insurer dashboard (live figures), Fleet dashboard, Vehicle register (search/filter/pagination), Manage cover (add with DVLA lookup, remove, future-dated additions, backdating blocked), Reconciliation (generate, history, open, CSV export, print), Users (add/role/switch off/restore/cancel invitation), planned modules, read-only demo account.
- Deliberate differences: the Add person role has no default (you must choose); sidebar/links do not prefetch; no `loading.tsx` loading screen (it made server-action responses hang intermittently in testing).
- Verification: typecheck, production build with no warnings, 14 unit tests, and a real-browser test (`npm run e2e`, Playwright + Chromium) against a **stand-in database** with logins for platform, insurer, fleet and demo accounts: 49 checks, 3 consecutive clean runs. The stand-in does not model row-level security; tenant isolation is still proven by the SQL tests in `tests/*.sql` against the real database.
- NOT yet done: sign-in and clicking through with the real Supabase logins and real data; a Vercel preview; any DVLA call (no key yet).
- Cutover plan (needs Owen): create a second Vercel project from this repo with Root Directory `web`, copy the environment variables, test on its preview URL with the three real logins, then either move the domains to it or change the existing project's Root Directory to `web` and framework to Next.js. The old portal stays available on `main` until then. Add `https://<preview-url>` to the Supabase Auth redirect URLs only if you test there.

## Vercel cutover to the Next.js portal (23 Oct 2026)
- The `stratify-fleet` Vercel project now builds `web/` (Root Directory `web`, framework Next.js). Same Supabase env names, domains unchanged.
- Gotcha found: the repo-root `vercel.json` (old portal) sets `"framework": null`. Vercel applied that, so `web/` was built as a plain static site ("No framework detected"), served only `public/`, and every page returned Vercel's own 404. Fixed by `web/vercel.json` declaring `"framework": "nextjs"`. Do not delete it.
- First attempt went live broken for a few minutes; production was put back on the old portal (PR #4 deployment) by promoting it, then the fix was verified on previews of both Vercel projects before merging (PR #6).
- Rollback if needed: Vercel > Deployments > promote the PR #4 deployment (17aa29c). Note that promoting stops new deployments taking the domain automatically until the latest one is promoted.
- Extra project `stratify-web` (same repo, Root Directory `web`) was created for testing and can be deleted. Temporary branch `debug/vercel-404` can be deleted.
- Not yet verified on the live domain: sign-in with the real platform, insurer and customer logins. Supabase Auth Site URL / redirect URLs still need confirming as https://www.stratifyfleet.co.uk. DVLA lookup stays off until DVLA_VES_API_KEY is set.

## Logins with a temporary password (24 Oct 2026)
- Users page: an administrator can type a temporary password (8+ characters) when adding someone who has no login yet. The portal runs `add_member` first (permission, role and organisation checks in the database), then creates the Supabase Auth login (email confirmed, `app_metadata.must_change_password = true`) and records `member.login_created` in the audit trail via `record_member_login`. The password is never stored, logged or shown back.
- First sign-in sends the person to /change-password; the rest of the app and all server actions are closed until they choose their own password. The flag lives in `app_metadata`, which people cannot edit themselves; it is cleared server-side only after Supabase accepts the new password.
- Needs `SUPABASE_SERVICE_ROLE_KEY` as a server-only Vercel variable. Without it the password field reports that login creation is not set up; the invite-only path still works. The key is read only in `web/src/lib/admin-auth.ts` (server-only) and is never sent to the browser.
- Supabase "leaked password protection" is off on the dev project (advisor warning); enable it under Auth settings (Pro plan feature).
- Migration `20261024070000_member_login_audit.sql` applied to the dev project.

## Driver workspace (24 Oct 2026)
- A person whose only role is `driver` gets a separate workspace: menu is Driver dashboard, Drivers & licences, Claims / FNOL. They are redirected away from the fleet dashboard, register, manage cover, reconciliation and users.
- Drivers have no direct read access to vehicles or cover (verified in the dev database: 0 rows). They see only what `my_cover()` returns: their own assignments and the cover periods on those vehicles that overlap them.
- New table `vehicle_assignments` (RLS: select only; writes through `assign_driver` / `end_assignment`, which need `coverage.add` on the fleet, require the person to be an active driver there, and write audit entries). Migration `20261024090000_driver_assignments.sql`, applied to the dev project.
- Fleet administrators and managers assign drivers on the Drivers & licences screen (driver, registration, from date; "End today" ends an assignment). Backdated assignment dates are allowed because assignment is not cover; cover dates come only from the coverage records.
- Drivers & licences (licence records) and Claims / FNOL are still planned modules; drivers see the roadmap page for each.

## Driver records: documents, permissions, history (24 Oct 2026)
- **Driver side (Drivers & licences):** details (name, date of birth, licence number, phone), uploads (licence front/back, right to work, proof of address, other; JPG/PNG/WebP/PDF up to 4 MB, photos shrunk in the browser, file type checked from the file's first bytes), two permissions (licence check, sharing with fleet and insurers; the exact wording agreed is stored with each answer, append-only, withdrawable), three-year job history with gap detection (gaps over 7 days are flagged), claims history (five years, or "none" declaration), motoring convictions (or "none"), and a progress checklist.
- **Fleet and insurer side:** `/drivers` directory with name suggestions as you type, fleet filter, per-driver completeness, and a read-only driver page. Fleet staff see their fleet; insurer staff see the fleets they insure (`organisations.insurer_id`), the same rule as vehicles; platform administrators see all. New permission `driver.read` (platform, insurer admin, insurer claims, fleet admin, fleet manager). Vehicle assignments moved to the "Vehicle assignments" tab.
- **Files:** private Supabase Storage bucket `driver-documents`, path `<fleet id>/<driver id>/<file>`; read and write as the signed-in person so storage rules decide access. Staff open files through `/drivers/file/<id>`, which writes `driver.document_viewed` to the audit trail before sending anything.
- **Verified in the dev database** (transaction, rolled back): a driver sees only their own rows and files; cannot write into another folder; staff cannot write; the same fleet's admin and the insuring insurer see the driver; a different insurer sees nothing.
- **Not built / assumptions:** no DVLA licence check is performed (the permission is recorded only; no DVLA endpoint or credential is assumed); consent wording is a draft and needs review by a legal adviser; no retention or deletion policy yet; no virus scanning; claims made through the portal will join the claims history when Claims / FNOL is built; fleet staff cannot yet request a document or mark one as checked.
- Migration `20261024100000_driver_records.sql` applied to the dev project.

## Licence checks and iPhone photos (24 Oct 2026)
- **Manual DVLA check, recorded in the portal.** The DVLA's online check for employers needs the last 8 characters of the licence number and a check code the driver makes on gov.uk (works once, lasts 21 days; checked on the DVLA page on 24 Oct 2026). The driver pastes the code on their page (needs the licence-check permission first). Staff see the 8 characters and the code with Copy buttons, a one-click link (new tab, `noopener`) to the DVLA check, and a form to record the result (valid / not valid / could not check, points, entitlements, endorsements, notes, check-again date). History is append-only and visible to the driver, fleet and insurers. The portal never calls the DVLA. GB licences only; a link to the Northern Ireland (DVA) service is shown.
- Recording a check needs `driver.check` on the driver's fleet and a current licence-check permission from the driver; it marks the newest unused code as used and writes `driver.licence_checked` to the audit trail. Migration `20261024120000_licence_checks.sql` applied to the dev project; verified in a rolled-back transaction (no code without permission, drivers cannot record their own check, the other insurer sees and can do nothing).
- **iPhone:** JPG/PNG/WebP are accepted as before (iOS converts its HEIC photos to JPEG for such file pickers). HEIC chosen from the Files app is now converted in the browser before upload. Not tested on a real iPhone.

## Fleet CRM — first operational release (24 October 2026)

- Checked GitHub before implementation: main had advanced 35 commits to `60f8846`, including the Next.js cutover, user management and driver records. Licence checks/HEIC support then landed at `7409b5f`; rebased onto it and preserved its CSS and driver changes.
- Vercel project inspection remains blocked by missing Future FG team authorization (403). Generated the supported team-consent link; no Vercel settings, credentials, domains or deployment promotions were changed. Live deployment/browser verification remains outstanding.
- Built in the active `web/` Next.js app. Fleet CRM is now a normal navigation item for platform admins, insurer admins, fleet admins/managers and fleet accounts; drivers have no CRM access. Demo login shows fictional populated CRM data.
- Seven sections: overview, vehicles, tasks, maintenance board, calendar, contacts, documents. Server-side search and pagination; summary counts use HEAD queries. Calendar shows overdue dates and the next 30 days, paged in the UI, with an explicit limit notice at 500 records per source. Maintenance board shows the current page of jobs, with status/due filters and pagination.
- Vehicle profiles hold depot, availability, dated mileage readings, MOT/tax/service dates, service mileage, ownership, lease/hire payment, replacement/return date and notes. Details link existing insurance periods (latest 25), tasks, documents and latest 25 CRM events. Mileage-based service distance is shown from the last recorded reading. No live MOT/tax lookup is performed by CRM.
- Contacts can be added/edited. Tasks record category, priority, due date, assigned contact, supplier, notes and cost; updates preserve event/audit history. Assignment is to a fleet contact, not an authenticated workflow inbox; messages are not sent automatically. The awaiting-approval status is a work state, not a formal financial approval/segregation-of-duties workflow.
- PDF/JPG/PNG/WebP files up to 4 MB are stored in private `fleet-documents`; metadata and bytes use the signed-in user's token and RLS. Upload metadata failure attempts to remove only the unregistered file. Downloads verify metadata access and stream as attachments with no-store/sandbox headers. Documents are retained as versions (no hard-delete/overwrite flow). CRM file viewing does not yet add a separate download audit event; upload/record changes do.
- Database migration `20261024070557_fleet_crm.sql` applied to the connected Supabase project (version returned by the database). New fleet-scoped tables: crm_vehicle_profiles, crm_contacts, crm_tasks, crm_documents, crm_events. Native RLS grants read-only access to insurer admins/fleet accounts and write access to fleet admins/managers/platform admins. Composite foreign keys reject cross-fleet vehicle/contact references. CRM writes do not alter coverage.
- Trigger-only `private.crm_audit` validates authenticated CRM permission and preserves record identity, writes append-only application events and the existing immutable audit log. Direct event writes and record hard deletion are not granted. No new public SECURITY DEFINER RPCs. Advisors show the pre-existing authenticated RPC and leaked-password notices; no new CRM advisor findings. Advisory reference: https://supabase.com/docs/guides/database/database-linter.
- Validation: production Next.js build and typecheck; 31 web unit tests (includes six new CRM checks); real-database transaction checks in `tests/fleet_crm.sql` passed and rolled back (writes, tenant isolation, foreign vehicle/contact rejection, immutable identity, audit, insurer/accounts read-only, driver denial, storage path permissions and unchanged coverage). Added a Next.js test/build job to Portal checks; legacy checks retained.
- Next increments: external notification delivery, richer cost reports/exports and replacement analysis, document retention/scanning, authenticated assignee notifications, full linked driver/claim timelines, calendar source pagination beyond its declared limit, telematics/fuel-card connections and formal repair approvals. These are not represented as complete.

## Claims / FNOL (24 Oct 2026)
- **Flow:** a driver or the fleet reports an incident (`reported`); the fleet reviews it ("Mark as reviewed"), then sends it to the insurer with one button (`submitted`). The insurer starts a review (`under_review`), can ask for more information (`awaiting_information`, shown under the claim on the fleet side; the fleet answers, optionally with files), and closes it with an outcome (settled, declined, no claim pursued, other). The insurer can reopen. Claims stay live until closed.
- **Incident details:** date and time (UK time), place, description, whether anyone was injured (and details), police attended and reference, whether the vehicle can be driven, other party and witnesses, photos. Review needs the police, other-party and photo answers to be complete, or "no photos available" ticked.
- **Insurer-logged claims:** an insurer can log a claim directly against one of its fleets; it is visible to the insurer straight away and the fleet gets an in-portal notification.
- **Rules built in:** any edit or photo change before sending cancels the review; after sending, details are locked and evidence cannot be removed (only added); unsent reports are invisible to the insurer; internal notes stay with the organisation that wrote them; every file view is audited.
- **Assumptions to confirm:** notifications are in-portal only (no email yet); outcome labels are generic and chosen by the insurer; "on cover at incident" comes from the portal's vehicle register only and is not a cover decision; nothing is sent to MID/MIB; a driver can edit and add photos only while the report is unsent.
- **Storage:** private bucket `claim-files`, path `<fleet id>/<claim id>/<file>`, 4 MB per file (photos are shrunk in the browser; HEIC converted).
- **Verified:** migrations `20261024140000`, `141000`, `142000` applied to dev; 120 database isolation checks (rolled back); 40 unit tests; 116 browser checks against the stand-in database. **Not verified:** real photo upload through Supabase storage from the deployed app and real iPhone behaviour.

## Insurer drivers page, national driver search, CRM and Manage cover (24 Oct 2026)
- **Insurer menu:** Fleet CRM and Manage cover are for fleets only. They are hidden from insurer roles, the pages redirect insurers away, and `insurer_admin` no longer has `crm.read` in the database. Platform admins keep both. (Manage cover is hidden in the screens only; the cover functions themselves still check permissions in the database.)
- **Drivers & licences for insurers:** choose a company first (with a find-a-company box), then see its drivers. The vehicle-assignments tab is fleet-only.
- **National driver database (opt-in):** a new, separate, unticked permission on the driver's page ("National driver database (optional)", wording stored with each answer). Only drivers who ticked it can be found. Insurer roles (and platform admins) can search by name (at least three letters; a date of birth narrows it and is otherwise hidden, only the birth year shows) and open a history: job history, claims and convictions, all marked as entered by the driver and not verified. Licence number, phone, documents and licence-check results are not shared. Withdrawing removes the driver from searches immediately. Every search (what was typed, how many results) and every record opened is written to the audit log against the searcher.
- **Needs a decision before real use:** UK GDPR lawful basis, privacy notice, a data protection impact assessment, retention, and whether insurers may keep what they see (the consent wording tells drivers they may). Self-declared claims and convictions about a named person need legal review. Not built: rate limits on searching, a driver-facing view of who has searched them, matching on licence number, pulling in claims reported through the portal.
- **Verified:** migration `20261024150000` applied to dev; 11 database checks (rolled back) in `supabase/tests/national_search.sql`; 128 browser checks against the stand-in database.

## Unassigned vehicles, reports and cover timestamps (24 Oct 2026)
- **Fleet dashboard:** a "Vehicles without a driver" box (count of vehicles on cover today with no current driver assignment) with two CSV downloads: unassigned vehicles only, and all vehicles with their drivers. Both include the cover start and the exact time each vehicle was added to the portal (UK time). Assignments are taken as current today; a vehicle with several drivers has one row each.
- **Closing the "add it after the accident" loophole:** adding a vehicle "from today" used to start cover at 00:00 today. Now today means the moment it is recorded, and a fleet cannot start or end cover at any earlier time (two minutes of slack). Only a role with `coverage.backdate` (insurer admins) can record an earlier time, and that stays visible because every cover period keeps its own immutable `created_at` (set by the database) next to the cover start. Enforced in the database by trigger `coverage_periods_timing` (migration `20261024160000`), not just in the screens.
- **Where the timestamp shows:** vehicle register (new "Added to portal" column), the CSV reports, and the claim page ("Cover added to the portal", with a red warning to fleet and insurer when the cover was recorded after the incident or the vehicle had no cover at the incident time).
- **Not changed / to confirm:** a start date in the future still begins at midnight London time on that day (a start time is a possible later addition). Removal "from today" now means from the moment it is recorded. Cover recorded before this change keeps whatever start time it was saved with. The warning is information from the portal's own records, not a cover decision, and nothing goes to MID/MIB.
- **Verified:** 7 database checks (`supabase/tests/cover_timing.sql`, rolled back), 135 browser checks, 41 unit tests.

## Workflow sweep: platform → insurer → customer → drivers and vehicles (24 Oct 2026)
Checked against the code and the dev database. Nothing was changed by the sweep itself.

**Works today:** members of any organisation can be added by email (instant if they already have a login, otherwise an invitation that applies at first sign-in); a temporary password can be set (needs `SUPABASE_SERVICE_ROLE_KEY` in Vercel); an insurer admin manages its own fleets' members, a fleet admin its own; nobody can change their own access; an organisation cannot lose its last admin; roles are checked against organisation type. Fleets add and remove vehicles on a policy (cover cannot be recorded earlier than now), assign drivers, and drivers fill in their own file. Claims, national search, reports and audit logging work end to end. Every public table has row-level security.

**Gaps, most important first**
1. **No way to create an insurer, a customer or a policy in the portal.** They only exist as seed data (3 fleets and 2 insurers, all marked fictional). The database has no function for it, so "platform creates insurers and customers, assigns a customer to an insurer" and "insurer adds a new customer" cannot be done at all, and a customer with no policy cannot add a vehicle. Also no way to move a customer to another insurer (the link is fixed at creation), or to start, renew or end a policy.
2. **No first administrator step for a new customer.** After creating a customer someone must add its first `fleet_admin` on the Users page (platform and insurer admins can). Two of the three dev fleets have no admin.
3. **Rates and billing rules have no screen.** Daily rates (`set_daily_rate`) and billing rules (`set_billing_rules`) exist in the database only. Neither insurer has rules set, so reconciliation runs on the default assumption. An insurer cannot configure its own pricing.
4. **A driver who changes fleet keeps the old fleet's record.** `driver_profiles.fleet_id` is set once; saving again does not move it, so the old fleet keeps seeing the driver's profile and documents. A driver with memberships in two fleets gets an arbitrary one (`driver_fleet()` takes the first match).
5. **Switching a driver off leaves traces.** Their profile, open vehicle assignments and (if opted in) their national database entry stay live, still showing the old fleet. Assignments should end and the national entry should be hidden when the driver membership is switched off.
6. **No password reset, no two-factor sign-in, leaked-password protection is off.** There is no "forgot password" screen, so a locked-out user needs an administrator to set a new temporary password (which itself needs the service-role key). Admin accounts should have two-factor.
7. **No invitation or notification emails.** Invitations are passed on by hand; claim and cover notifications are in-portal only.
8. **Same registration can sit in two fleets at once** (uniqueness is per fleet). A vehicle could be on cover with two customers, or stay on an old fleet after a sale, with no warning.
9. **Insurer admins can still add and remove cover through the database** (they hold `coverage.add/remove/backdate`); only the screens are hidden. Decide whether that is intended; backdating is the deliberate exception.
10. **No audit log screen**, even though everything writes to it. **No MID/MIB status screens** (`mipd.read` is unused). **No white-label settings** (logo and colours are fixed to Stratify). **No DVLA vehicle lookup** until the API key is added, so make and model are typed by hand.
11. **Housekeeping:** `private.check_claim_fields` has no pinned search path (Supabase warning); the 48 other security-definer warnings are the intended design (each function checks the caller inside); remove or clearly label the fictional dev organisations before real customers are added; make the GitHub repository private.

**Suggested order:** (1) organisation and policy creation with first-admin invite, including change-of-insurer and policy renewal; (3) rates and billing rules screen; (4)-(5) driver move/switch-off fixes; (6) password reset, leaked-password protection and two-factor for admins; (7) email; then the rest.

## Organisation onboarding (hole A from the workflow sweep) — built, works through UI, backend and DB
- Platform admins create insurers; platform admins and an insurer's own admins create that insurer's customers. Each creation invites the first administrator (and can create a temporary login). Duplicate names refused per kind.
- Customer page (`/organisations/[id]`): add policy, set a policy's last day, renew (moves every vehicle on cover to the new policy with no gap; each keeps its original "added to portal" time via `coverage_periods.first_recorded_at`), optional daily rate at renewal.
- Platform only: move a customer to another insurer — refused while it has a live policy, vehicle on cover or open claim. The old insurer loses sight of that customer's history immediately. Everything is audited.
- Tests: `supabase/tests/org_onboarding.sql` (13 checks, rolled back); e2e 141/141.
- Assumption to review: insurer admins can create customers and policies for their own insurer only.

## Rates and billing rules screen (hole B) — built, works through UI, backend and DB
- `/rates` (platform, insurer admin: view and change; insurer accounts: view only). Billing rules history per insurer and daily-rate history per policy; forms call `set_billing_rules` / `set_daily_rate`. Append-only: a new entry applies from its date and earlier ones are kept.
- No defaults are supplied: start-day and end-day charging have no pre-selected answer, tax rate starts at 0 and is labelled unconfirmed (IPT rate and whether quoted rates include it are still Owen's/the insurer's to confirm).
- Tests: `supabase/tests/rates.sql` (9 checks); e2e 147/147.
## Maintenance bookings (24 Oct 2026)
- Fleet CRM Maintenance now follows booked → checked in → work underway → ready to collect → collected/completed, plus cancellation. The board, task list and vehicle record share the workflow. Existing maintenance tasks can be set up as bookings with a garage and dates; otherwise their availability behaviour is retained.
- Booking details: active fleet garage contact, appointment/expected-return dates, estimated and actual cost, notes, explicit off-road flag and an awaiting-approval flag. Approval is a work flag managed by CRM editors, not a separate financial authorisation role. Invoices are private fleet documents linked by fleet, vehicle and task; uploads use the existing 4 MB/type restrictions.
- Future bookings stay available unless explicitly off road. Checked-in/work/ready vehicles remain unavailable until collection or cancellation, considering all linked active jobs and preserving manually recorded availability. No insurance record is changed. Overdue-return and approval filters/counts are available, and the in-portal calendar includes appointments and expected returns.
- Completing collection requires actual cost and mileage. The database atomically updates mileage and any supplied next-service date/mileage on the vehicle, rejects falling mileage, prevents skipped stages/closed-job rewrites and rejects stale updates. Next-service fields left blank preserve recorded service dates. Closed jobs still accept new invoice documents.
- Demo login contains booking, garage-work, overdue and invoice examples. Garages are read in pages within the signed-in user's fleet scope, rather than being limited to the first contacts page.
- Validation: production Next build and 45 web unit tests; rolled-back live database checks in `tests/maintenance_bookings.sql` cover lifecycle, availability, collection rollback, invoice vehicle matching, permission/tenant isolation, audit and unchanged insurance. Supabase security advisor has no new maintenance finding. Visual browser/iPhone behaviour and live invoice upload have not been verified in this session.

## Driver integrity (hole C) — built in the database; verified by isolation tests
- A person can be an active driver for only one customer at a time (trigger; the message does not say which customer). Sign-in is never blocked by this: a blocked invitation just stays pending.
- Switching a driver off (or changing their role) ends their open vehicle assignments in that customer. Staff of a customer see a driver's profile, documents, consents and records only while the driver is currently active there (RLS plus the storage policy), so a former employer loses sight of them.
- Moving to a new customer (switch off, then add): the profile follows the driver; uploaded documents are retired; licence-check and data-sharing permissions are reset to "not given" for the new customer so they must be given again. Records created at the old customer stay hidden from the new one. The national-database consent is the driver's own and is not reset.
- National search still finds a driver who has left every customer (shown as "No current customer"). The database lets such a driver withdraw from the national database, **but there is no screen yet for a driver with no customer to do it** — open item.
- The same registration cannot be on cover for two customers at overlapping times (the message does not reveal the other customer).
- `driver_fleet()` now picks deterministically (oldest active driver membership).
- Known limits: retired document files remain in storage (unreachable by staff; delete them when a retention rule is agreed). Old-customer records are retained, not deleted — retention periods need a legal decision.
- Tests: `supabase/tests/driver_integrity.sql` (13 checks), `national_search.sql` updated (11 checks).

## Password reset and two-step sign-in (hole D)
- **Forgot password**: `/forgot-password` (link on the sign-in page) emails a reset link; the answer is identical whether or not the address has an account, and nothing is sent for the demo account. The link lands on `/auth/callback` (accepts both a `code` and a `token_hash` link), which signs the person in and sends them to `/reset-password`. An expired or used link goes to a clear "request a new one" page; the `next` address can never leave the site (unit-tested).
- **Two-step sign-in (authenticator app)**: people turn it on at `/security` (Security link in the top bar). Afterwards sign-in goes password → `/mfa` code. It is enforced in the database too (`private.mfa_ok()` in `require_user()` and `accessible_orgs()`): a session that has not passed the second step gets no organisation data and cannot run any function, even if someone calls the API directly. People without it are unaffected. Tests: `supabase/tests/mfa.sql` (6 checks); e2e 159/159.
- **Optional enforcement for administrators**: set `REQUIRE_MFA_FOR_ADMINS=true` and platform, insurer and customer administrators are sent to `/security` until they have set it up (and cannot turn it off). Left OFF by default so nobody is locked out.
- **Needs Owen (Supabase dashboard / Vercel), cannot be done from code:**
  1. Authentication → URL configuration: set the Site URL to the live address and add `<live address>/auth/callback` to the Redirect URLs allow-list; also set `SITE_URL` in Vercel to the live address.
  2. Authentication → SMTP: set up a real email sender. Supabase's built-in sender is for testing only (very low limit, may not deliver to outside addresses), so reset emails will be unreliable until this is done.
  3. Authentication → Email templates → "Reset password": no change needed for the default link to work.
  4. Authentication → Providers → Email → enable "Leaked password protection" (a paid-plan feature).
  5. Multi-factor must be enabled for TOTP (Authentication → Multi-factor, normally on by default).
- **Lost phone**: there are no recovery codes yet. An administrator at Supabase (Authentication → Users) has to remove the person's factor. A recovery-code feature is a sensible next step before requiring this for all administrators.

## Email (hole E) — built; sends nothing until a provider key is set
- Provider-agnostic sender (`web/src/lib/email.ts`, currently Resend over HTTPS). With `RESEND_API_KEY` and `EMAIL_FROM` unset it does nothing and the portal behaves exactly as before.
- Sent after the action has finished (never delays or breaks the screen): (1) an "you have access" email when someone is added or invited to an organisation, including the first administrator of a new insurer or customer; it never contains a password; (2) a headline-plus-link email for every claim notification (new claim, sent to insurer, information requested, update, closed, etc.) to the same people who see it in the portal.
- Claim emails carry only the headline and a link: no names, vehicle, location or amounts leave the portal by email.
- Recipient lookup is a database function callable only with the service key (`claim_notification_emails`), which hands each notification out once. Needs `SUPABASE_SERVICE_ROLE_KEY` as well. Tests: `supabase/tests/claim_emails.sql` (4 checks), `web/tests/email.test.ts` (5), e2e unchanged.
- **Needs Owen**: choose a provider (Resend assumed), verify a sending domain, then set `RESEND_API_KEY`, `EMAIL_FROM` and `SITE_URL` in Vercel. Password-reset emails are separate and go through Supabase's own SMTP setting (see hole D).
- Not built: email for the fleet's own driver-licence reminders, digest emails, per-user email preferences.

## Audit log, branding, MID/MIB status, cleanup (hole F)
- **Audit log** (`/audit`; platform, insurer admin, customer admin): who did what and when, filtered by organisation and action prefix, 50 per page. Each person sees only organisations they are allowed to audit. It shows who, when, action, subject and note — not the before/after data.
- **Branding** (`/branding`; platform, insurer admin): an insurer sets a name shown under the logo and an accent colour, shown to its staff and its customers' people (including drivers). Pale colours are refused for readability. The Stratify logo stays. **Not built: uploading the insurer's own logo.**
- **MID / MIB status** (`/integrations`; platform, insurer admin, customer admin): read-only. States plainly that the portal is NOT connected, nothing has been sent, and a submission never confirms or creates cover; shows how many prepared records sit in each submission status. No endpoints or credentials invented.
- `private.check_claim_fields` now has a pinned search path (advisor warning fixed).
- Tests: `supabase/tests/audit_branding.sql` (11 checks); unit 57; e2e 169/169.
- Not done on purpose: the GitHub repository is NOT made private automatically (a private repo can stop the free Vercel plan deploying from an organisation repo). Decision for Owen.
- Decision still with Owen: whether insurer admins should keep the ability to add and remove cover (currently kept).

## IPT and cover permissions — decisions from Owen (24 Oct 2026)
- **IPT**: the insurer quotes a daily rate plus IPT, so rates are entered excluding tax and IPT is added on top. Standard rate is 12% (unchanged since 1 June 2017, per GOV.UK); a 20% higher rate exists for travel insurance, appliance cover and some insurance sold alongside vehicles, not ordinary motor fleet cover. The billing rules form now pre-fills 0.12 (editable); saved reports show net, IPT and gross to insurer/platform roles. Existing reports keep the 0% they were generated with; only new billing rules and new reports use 12%. Neither insurer has billing rules yet, so nothing changes until each insurer saves them. Insurers should still confirm the treatment on their own policies.
- **Insurer admins keep add and remove cover.** Decision confirmed by Owen; no change needed.

## Installable app (PWA)
- Web app manifest (`/manifest.webmanifest`), icons cut from the logo's S mark, iOS home-screen meta, and a minimal service worker (`public/sw.js`) that caches nothing (offline shows a plain message), so signed-in data is never stored by the app.
- "Install on phone" page (`/install`) in the nav for every role including drivers: iPhone (Safari → Share → Add to Home Screen), Android (Chrome → Install app), desktop, plus a one-tap install button where the browser offers it.
- Manifest, service worker and icons bypass the sign-in middleware so browsers can fetch them.
- Not yet checked on a real phone: Owen to try the install on an iPhone and an Android.

## CUE queue on the claim page (26 Oct 2026, branch feature/cue-queue)
- **What it is:** CUE (Claims and Underwriting Exchange, run by the MIB) is the insurer's own claims-history contribution, so the control is **insurer side only**. On a claim that has been sent, the insurer sees a "Claims and Underwriting Exchange (CUE)" panel with one button, **Queue for CUE**. It prepares a CUE-ready record from the claim's FNOL data (claim and insurer reference, policy, policyholder, vehicle, driver name, incident date/place, injury yes/no, police, third parties, counts of witnesses and files, outcome) and queues it. Fleets and drivers never see it.
- **Not connected:** nothing is transmitted to CUE. The status reads "Queued · not transmitted". The record can be downloaded (JSON) per version so the insurer can enter it through its own CUE route. Every download and every queue is written to the audit trail; the queue also adds an insurer-only line to the claim timeline.
- **Versions:** pressing again after the claim changes (for example a reference or outcome) adds version 2, 3 and so on; earlier versions are kept. Pressing with nothing changed is refused.
- **Minimised on purpose:** the record leaves out the free-text description, injury details, phone numbers and witness names. Easy to widen in `private.cue_payload` if the insurer's CUE format needs more.
- **Field mapping is NOT confirmed.** The real CUE contribution format comes from the MIB/insurer; the record is the portal's own structured FNOL data under the label `stratify.cue_record.v1`.
- **MID/MIB status page** shows CUE record counts by status to insurer-side users.
- **Database:** migration `20261026160000_cue_queue.sql` (table `cue_submissions`, `queue_cue_submission`, `log_cue_download`, `private.cue_payload`). **Applied to the project on 26 Oct 2026** (via ChatGPT's Supabase connector; checks: table exists, RLS on, three functions present, 0 rows, security advisors show only the two expected authenticated SECURITY DEFINER warnings). Database test `supabase/tests/cue.sql` **PASSED (35 checks) on 26 Oct 2026**, run in a rolled-back block; afterwards no test users and no CUE rows remained. It covers: insurer can queue, fleet/driver/other insurer cannot, unsent claims refused, duplicate refused, version 2 after a change, direct writes refused, record excludes narrative/injury text/phones/witness names, audit and insurer-only timeline events.
- **Verified:** typecheck, 68 unit tests (9 new for CUE wording/file naming), production build. **Not verified:** the browser e2e suite, the button on the live site with a real claim, and real iPhone/desktop behaviour.
- **Next:** onboard with the MIB as a data contributor (or confirm the insurer's own route), agree the field mapping, then add a connector that moves records from queued to submitted/accepted/rejected.

## Telematics page (26 Oct 2026, branch feature/telematics)
- New page `/telematics` (nav: Telematics). Provider-agnostic: **no telematics provider is connected**. Data comes in by CSV upload (template on the page); a provider feed can later call the same `import_telematics` function.
- Migration `20261026200000_telematics.sql`: `telematics_events`, `telematics_trips`, permissions `telematics.read` / `telematics.manage`, `import_telematics()` (whole batch or nothing, duplicates skipped, max 2000 rows, driver matched from vehicle assignments, crash alert notifies the fleet, audited) and `telematics_vehicle_totals()` (vehicle level only).
- Visibility: fleet admin/manager and platform read driver-level records. Insurer admin/claims read vehicle totals only; drivers are never named to the insurer. Drivers cannot see the page yet.
- Score: 100 minus 2 per weighted event per 100 miles (speeding x2, severity 1–3; crash alerts shown, not scored); needs 50 miles. Indicative only, not an underwriting rating.
- Crash alerts link to "Report a claim" (no prefill yet).
- **Applied to Supabase (26 Oct 2026)**: `telematics` and `telematics_driver_distinct` (two overlapping assignments for the same person count as one driver). `supabase/tests/telematics.sql` passed on the live project (27 checks, rolled back).
- Before using driver scores for real: DPIA, tell drivers (ICO worker-monitoring guidance), choose a first provider.

## Insurer claims inbox and book/loss MI (27 Oct 2026, branch cursor/insurer-inbox-book-mi-4250)
- **What it is:** a handler inbox and book MI strip. Not a claims-paying system: no reserves, payments, recoveries or invented loss ratio.
- **Inbox** (`/claims` for insurer and demo): queues Mine / Unassigned / Waiting on fleet / Overdue. Three clocks — first touch (4h, 2h if injury), fleet reply (due date or 5 days), decision (10 days from first touch). Fleet-reply overdue is date-only vs Europe/London today.
- **Assignment:** `handler_id`, `handler_email`, `assigned_at`, `first_touched_at` on `claims`. RPCs `assign_claim_handler` and `list_claim_handlers`. Starting review, asking for information, or logging a claim auto-takes if unassigned and stamps first touch. Assignment events are insurer-only; the fleet UI never shows a handler.
- **Book and loss** (insurer dashboard): vehicles on cover, earned YTD from **locked** reconciliations only ("No locked months" until a month is locked), claims per vehicle-year, open claims, cover-after, median wait to first touch, licence overdue, on cover with no driver. No incurred, no loss ratio.
- **Demo:** five fictional inbox rows and four fleet MI rows so the screens are visible without a live book. Saving, take and assign are disabled.
- **Database:** migration `20261027080000_claim_inbox.sql`. Isolation test `supabase/tests/inbox.sql`. **Not yet applied** to the live project.
- **Not in this increment:** MFA on claims reads, report lock/finalise, MID/CUE connectors, paying a claim.
