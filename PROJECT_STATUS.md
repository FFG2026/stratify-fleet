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

## Hosting preparation — 23 October 2026
- Added api/index.mjs serverless adapter, explicit API rewrites, static dist build, Node 22 configuration and Dublin function region.
- Shared request handling supports both Vercel's parsed JSON bodies and local raw requests.
- HTTPS cookies use Secure/HttpOnly; write origins are limited to the canonical URL and Vercel-provided deployment URLs.
- Local verification in the restored Linux workspace: all 22 tests, syntax checks and npm run build PASS.
- Intended Vercel workspace discovered from existing projects: Future FG, team_BCmWbr3PwbVdwCuWvVUj9i1k.
- BLOCKED: Vercel get_team returned 403/not authorised for future-fg. Project creation was rejected by automatic approval review due to unclear destination authorisation and potential source disclosure. No hosting project, environment variables, deployment or DNS changes were made.
- Next action: confirm the intended workspace and grant the Vercel connection access to it, then deploy the reviewed Git commit and verify its URL before linking Cloudflare DNS.
