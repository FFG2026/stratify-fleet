# Stratify web (Next.js)

Next.js 15 + TypeScript version of the portal. See `PROJECT_STATUS.md` in the repo root for status and the cutover plan.

```
cp .env.example .env.local   # fill in the dev project's URL and PUBLISHABLE key (never the service-role key)
npm install
npm run dev                  # http://localhost:3000
npm run typecheck && npm test
npm run build && npm run e2e # real-browser test against a stand-in database (needs Playwright + Chromium)
```

All data access happens on the server under the signed-in person's own token, so row-level security and the permission checks inside each database function decide what they see and change. Nothing in `web/` may use the service-role key.
