# Stratify Fleet

Development portal for multiple insurers and fleet customers. The original Stratum Sites prototype remains unchanged.

## Run locally
Requires Node.js 22+; no package installation is needed.

1. Copy `.env.example` to `.env`.
2. Set `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` and `APP_ORIGIN`.
3. Run `npm run dev` and open http://localhost:3000.
4. For a fictional, read-only preview, set `DEMO_MODE=true` instead. Demo mode never writes to Supabase.

Run `npm test` and `npm run check` for automated checks.

## Connected development database
The inspected Supabase project is named **stratify-fleet** (not stratify-fleet-dev), in eu-west-1. It already contained the tenancy, coverage and reconciliation schema plus fictional data. This implementation adapts to that existing schema; no replacement schema was applied.

The five migration files were recovered directly from that database's migration history. For a **new empty** Supabase development project, apply them in timestamp order, then optionally run `supabase/seed.sql`. Do not reapply them to the existing project. The optional seed refuses to run on a populated organisation table.

## First administrator
No real administrator account was created and no invitation email was sent.

Create/invite the intended administrator using Supabase Auth's dashboard. Then, as a trusted database administrator, create a membership linking that exact Auth user ID to the existing platform organisation with role `platform_super_admin`. See `supabase/bootstrap_admin.sql`; replace the UUID placeholder and verify the selected user before running it.

A normal sign-in or self-created Auth account grants **no** organisation access. Membership controls data permissions. Other role names and their permission grants are defined in the migrations.

## What is included
- Platform, insurer and customer views, limited by database permissions.
- Searchable fleet list with 25-row pages and coverage history.
- Add/remove forms connected to the existing permission-checked database RPCs.
- London date handling and immutable prior coverage periods.
- Date-only provisional preview and CSV export.
- Saved provisional reconciliation using the existing database calculation and rules snapshot.
- Audit trail; MID records are not sent.
- Session access tokens in HttpOnly, SameSite cookies; no service-role key.

## Scope limits
This is the first development milestone, not a production insurance system. No production deployment was made. Browser and live sign-in verification remain outstanding because this executor could not make HTTP connections and its browser session rejected tab access.

The app uses a small dependency-free Node server and ES modules because this repository was empty and the prior prototype source could not be retrieved. It does not claim to reproduce the inaccessible prototype exactly.

Sessions expire after at most one hour; refresh, password recovery, invitations/membership UI, report finalisation, backdating approvals, insurer acceptance, white-label provisioning, claims and driver compliance are later work. Vehicle searches use server-side 25-row pages. The dashboard fetches five recent periods and database totals; organisation/policy metadata is still loaded in batches. Saved report line exports retrieve all lines in 500-row batches.

The existing database permits backdating for specific privileged roles. This portal blocks backdated edits pending an approval workflow; those underlying database permissions were preserved.

Reports remain provisional. Do not use the date-only preview for invoices. Saved reports use the stored database rules snapshot, which can differ from preview assumptions. Rates, removal-day treatment, partial days, taxes/fees, corrections and policy expiry treatment require insurer sign-off. The existing database's reconciliation function is preserved, including its development default assumptions.

See `PROJECT_STATUS.md` for validation and next steps.

## Current increment: larger fleets and report history
The vehicle register uses database pagination and search; the dashboard loads only recent periods and counts. The removal picker also searches/paginates open periods. Saved reconciliations can be reopened by month/policy and exported from their original snapshot.

The domain **stratifyfleet.co.uk** has been purchased. It is not connected to hosting yet; keep APP_ORIGIN on localhost for development. No DNS changes have been made.

GitHub Actions runs syntax and unit/API/render checks on Node 22 and 24. The selected local environment became unavailable during this increment; GitHub CI subsequently passed syntax and automated checks on Node 22 and 24. Browser sign-in and production readiness are still outstanding.
