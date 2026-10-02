# Prime Assist QA rebuild — reviewable source package

This package creates a separate QA service. It does not change or deploy the existing services. It includes two small Navigator wrappers and their shared core so QA can verify the exact Navigator behavior version used for every response.

## Where every file goes

Create a new private GitHub repository named `prime-assist-qa-engine`. Upload the CONTENTS of `qa/`, preserving these paths at the repository top level:

- `package.json`
- `src/server.mjs`
- `src/store.mjs`
- `src/runner.mjs`
- `src/domain.mjs`
- `public/index.html`
- `data/development.json`
- `data/validation.json`
- `data/legacy-holdout.json`
- `data/legacy-single.json`
- `test/pipeline.test.mjs`

Do not upload the outer package folder or ZIP as the application. Do not overwrite the existing V4 repository.

Commit message: `Build durable QA engine`

Commit description: `Persist jobs and enforce gates`

Render: this new repository does not affect the old service. Later create a NEW Render service. Root Directory blank; Build Command `npm install`; Start Command `npm start`; Node 22 or later. No persistent disk is required: the new engine uses Postgres for its state.

In the existing Netlify deployment folder, these four files go directly into `netlify/functions/`:

- `navigate.js` — replace the existing file
- `navigate-preview.js` — replace the existing file
- `navigator-core.js` — add
- `policy.json` — add

`navigator/test/navigator.test.mjs` is a local verification file; it does not go into Netlify functions. This README and TEST-RESULTS.md are instructions, not runtime files.

Keep the existing `app.js`, `index.html`, `styles.css`, and `netlify.toml`. The response fields remain compatible with the inspected frontend. The core preserves the existing behavioral policy, but moves it into the model instruction field and retains up to 100 validated history entries instead of silently truncating to twelve. This is a real behavior change and must be tested before launch. The wrappers need Node 22-compatible execution. No web lookup has been added.

## Configuration

New Render service:

- `DATABASE_URL`: the Neon/Postgres connection string. Tables use the new `paqa_` prefix; old `qa_jobs` and `paos_` tables are not changed.
- `OPENAI_API_KEY`: existing API key.
- `QA_ADMIN_KEY`: a new random secret of at least 32 characters. Used to access the QA dashboard; not stored in the browser.
- `QA_PREVIEW_KEY`: a DIFFERENT random secret of at least 32 characters.
- `QA_TARGET_ORIGIN`: `https://melodious-empanada-9409f1.netlify.app` (or the actual test deployment origin).

Netlify:

- Keep `OPENAI_API_KEY`.
- Add `QA_PREVIEW_KEY` with exactly the same value as the new QA service.

Do not paste keys into chat, GitHub, or screenshots. The old QA service will not authenticate against the replacement preview function, so use the new QA service after installing the adapter. Keep the old services as references; do not run both against the replacement preview endpoint.

## What is enforced

1. Save a candidate: the patch, Navigator fingerprint, and all test suites become immutable snapshots in Postgres.
2. Run development, then validation, then the legacy holdout. The server enforces the order; there is no import route that manufactures eligibility or passed validation.
3. Every candidate conversation must pass. Technical failures, missing tests, regressions, and critical failures block a gate. Matching a failing baseline cannot pass.
4. Each model or Navigator request uses a durable call counter; each stage is capped at 240 requests, including failed requests and retries. Model repair is one separately initiated model request per click.
5. Baseline and candidate maintain separate conversations. Candidate requests use the deployed preview endpoint with its matching patch fingerprint.
6. The queue, worker lease, partial response checkpoints, evaluations, and summaries live in Postgres. After a process restart, an expired lease can be reclaimed after two minutes. An in-flight request that had not been checkpointed can be repeated and charged again; this is at-least-once execution, not exactly-once billing.
7. Technical failures stop the stage and can be retried explicitly with the same frozen candidate. Successful conversations are retained. Repeated worker crashes stop after three automatic attempts.
8. Automated repair sees only development failures. It creates a new candidate rather than changing the tested patch.
9. Holdout details are absent from the dashboard and repair routes. Only summaries appear. Database administrators still have access; this is workflow isolation, not encryption from the operator.
10. Human approval requires three passed gates and a written review note. It records approval only; it does not deploy.

## Limits and required live acceptance checks

- The old holdout is historical and already exposed. It is preserved as a regression gate, not evidence of unseen generalization. Add independently authored, genuinely fresh tests before using the system to claim public-release readiness. No test result guarantees absence of unknown failures.
- The answer generator and evaluator still use the same model. Deterministic structure checks supplement model grading; independent human review remains necessary. This rebuild does not solve factual verification or add resource lookup.
- The preserved single-turn suite is archived, not an active gate, because some requirements conflict with the newer one-variable clarification policy. The active suites contain 10 development conversations/20 turns, 6 validation conversations/11 turns, and 12 legacy holdout conversations/23 turns.
- No PAOS dashboard repair is included in this package. That is a separate change after the QA foundation is proven.
- Live Neon schema creation, lease recovery, Netlify execution, dependencies, and actual model responses have not been verified in the local environment. Use the tests below before relying on production behavior.

After deployment: confirm the Navigator GET `/api/navigate` reports protocol 1 and a fingerprint; confirm unauthorized preview calls return 401; create one candidate and run development; restart the QA process mid-run and verify recovery from its checkpoints; confirm a failing development gate prevents validation; confirm a technical failure is not behavioral evidence; attempt approval before all gates pass and verify rejection. Do not start high-volume runs before this acceptance check.

Run all local tests from the extracted outer package folder:

`node --test qa/test/*.test.mjs navigator/test/*.test.mjs`

Run QA-only tests from the new repository:

`npm test`

## API

All `/api/` routes require `x-qa-key: QA_ADMIN_KEY`. The dashboard asks for this key in a password field and keeps it only in the current page.

- `GET /api/candidates`: status summaries
- `POST /api/candidates` with `{ "patch": "..." }`: save frozen candidate
- `POST /api/candidates/:id/run`: run next allowed gate
- `POST /api/candidates/:id/retry`: retry only a technical failure
- `POST /api/candidates/:id/repair`: propose a new patch from development failures
- `GET /api/candidates/:id/evidence`: development evidence only
- `POST /api/candidates/:id/approve` with `{ "note": "..." }`: record human review after all gates pass

No automatic promotion, old job migration, background departments, or database deletion is performed.
