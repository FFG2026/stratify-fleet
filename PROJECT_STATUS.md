# Stratify project status
Last updated: 23 October 2026

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
