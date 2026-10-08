# Prime Assist

Prime Assist contains the Netlify customer Navigator and the Render QA engine. The QA engine compares frozen candidate patches against the deployed Navigator, keeps evidence in Postgres, and enforces development → validation → final regression gates.

## Applications

| Folder | Application | Hosting configuration |
| --- | --- | --- |
| `qa/` | Administrator QA dashboard, API, and worker | Render root `qa`, build `npm install`, start `npm start`, Node 22+ |
| `navigator/` | Customer interface and Navigator functions | Netlify base `navigator`, publish `public`, functions `netlify/functions` |

The customer interface presents one current answer, keeps earlier exchanges expandable, preserves follow-up context, and offers retry without duplicating successful history. Start over aborts pending work. Responses are escaped before rendering. Conversation state lives in the current page and is lost on refresh. No verified resource lookup is implemented.

The Netlify configuration publishes only `navigator/public/`. Backend source and test files remain outside the published directory. Existing manually deployed Netlify sites must explicitly deploy this application or connect to this repository; a GitHub commit alone does not update such a site.

## Configuration

Render needs `DATABASE_URL`, `OPENAI_API_KEY`, `QA_ADMIN_KEY`, `QA_PREVIEW_KEY`, and `QA_TARGET_ORIGIN`. The current target is `https://melodious-empanada-9409f1.netlify.app`. Database tables use the `paqa_` prefix.

Netlify needs `OPENAI_API_KEY` and the same `QA_PREVIEW_KEY` as Render. Use distinct administrator and preview keys. Never commit credentials. The dashboard uses the administrator key only in its current page.

## QA behavior

- Candidates freeze their patch, Navigator fingerprint, and test suites. A version mismatch stops testing.
- Each gate requires complete, passing candidate evidence. Technical failures, regressions, and critical failures block progression. A failing baseline does not excuse a failing candidate.
- Each stage has a durable 240-request budget, including failed requests and retries. Temporary HTTP 502/503/504 failures get at most two retries. HTTP 429 and other errors stop the stage.
- Baseline and candidate histories remain separate. Completed conversations, completed turns, and partial response/grading checkpoints survive interrupted runs. Retrying a technical failure keeps successful work. An uncheckpointed request may still be repeated and charged after a crash.
- Worker leases expire after two minutes and renew every fifteen seconds. Three repeated worker crashes stop a job.
- Automatic repair uses only completed development failure evidence and creates a new candidate.
- Administrators can inspect development and validation evidence. Final-gate evidence becomes available only after that run completes. Reviewed final cases must be treated as regression cases on future revisions.
- Approval requires all three passing gates and a written review note. Approval records review; it does not deploy a patch.

The historical final suite has already been exposed and is a regression gate, not proof of unseen generalization. Fresh independently authored scenarios and human review are needed before release-readiness claims. Model grading is supplemented by structural checks, but the answer generator and evaluator use the same model.

## Tests

From the repository root:

```sh
node --test qa/test/*.test.mjs navigator/test/*.test.mjs navigator/test/*.test.cjs
```

From `qa/`, `npm test` runs the pipeline tests. Customer tests use a mocked document and network; they verify conversation state, duplicate submission protection, recovery, safe rendering, and cancellation. They do not replace visual/mobile browser checks or live Netlify acceptance tests.

## QA API

All `/api/` routes require `x-qa-key: QA_ADMIN_KEY`.

| Method | Route | Purpose |
| --- | --- | --- |
| GET | `/api/candidates` | Candidate summaries |
| POST | `/api/candidates` | Freeze a patch |
| POST | `/api/candidates/:id/run` | Run the next eligible gate |
| POST | `/api/candidates/:id/retry` | Resume a technical failure |
| POST | `/api/candidates/:id/repair` | Propose a new patch from development failures |
| GET | `/api/candidates/:id/evidence?stage=development` | Inspect development evidence; stage also accepts `validation` or completed `holdout` |
| POST | `/api/candidates/:id/approve` | Record human review with a note |

Navigator GET `/api/navigate` returns its fingerprint without a model call. Customer POST `/api/navigate` accepts `question`, optional `location`, and validated conversation `history`. Candidate testing uses POST `/api/navigate-preview`, with preview authorization and a matching expected version.
