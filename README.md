# CV Fit MVP

A Next.js frontend and Express API for private CV/JD analysis, backed by Supabase, OpenAI, and PayOS.

## Requirements

- Node.js 20+
- A Supabase project
- Google Gemini API key
- PayOS credentials for payment flows

## Setup

1. Run `npm install` at the repository root.
2. In Supabase Dashboard → **SQL Editor**, open a new query, paste the full contents of
   `supabase/migrations/001_initial_schema.sql`, then click **Run** once.
3. Copy `web/.env.example` to `web/.env.local`. Set the project URL and publishable key.
   These are browser-safe values from **Project Settings → API Keys**.
4. Run `npm run db:check` to verify that Supabase is reachable and all four tables exist.
5. Copy `api/.env.example` to `api/.env`. Use the same project URL and publishable key
   for `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY`; set `SUPABASE_SECRET_KEY` from
   Supabase **Project Settings → API Keys**. This key is private and must only be in
   `api/.env`, never in a `NEXT_PUBLIC_` variable. `SUPABASE_JWKS_URL` defaults to the
   project's standard JWKS endpoint if omitted.
6. AI and PayOS settings are optional for starting the app. Create a Gemini API key in
   Google AI Studio and set `GEMINI_API_KEY` in `api/.env` to enable analysis. Set the
   three `PAYOS_*` credentials to enable checkout/webhooks.
7. Run `npm run dev`, then open `http://localhost:3000`.

The web app runs at `http://localhost:3000`, and the API runs at `http://localhost:4000`.
Check `http://localhost:4000/health/ready` for an authenticated database readiness
probe; it reports clearly if the schema has not been applied.
Auth users get one trial analysis credit. Each analysis consumes one credit; analyses made
while credits remain include the mock-interview layer. A successful 29,000 VND PayOS
payment grants three credits. If an analysis was made without enough remaining credits
to include Mock Interview, the user can pay and spend one of the new credits to generate
and unlock its interview questions. Configure the public webhook URL as
`https://<your-api-host>/api/payment/webhook`.

## Deployment

Deploy `web` to Vercel and `api` to a Node.js host such as Render. Set the environment
variables from `.env.example` in each service. Use the deployed frontend origin for
`WEB_ORIGIN`, and update the PayOS return, cancel, and webhook URLs accordingly.

CV uploads are limited to 5 MB and PDF files. Raw extracted text is stored for the
account owner; Gemini receives only the masked text. The analysis prompt requires
verbatim CV evidence for matched skills, projects, and education, and the API verifies
those quotes against the stored CV before saving. Never expose the Supabase secret key,
Gemini key, or PayOS credentials to the browser.

The Express API verifies user access tokens against the project's JWKS endpoint,
issuer, and `authenticated` audience before protected routes run. It accepts the
current `SUPABASE_PUBLISHABLE_KEY` / `SUPABASE_SECRET_KEY` names; the former
`SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` names remain supported for migration.
