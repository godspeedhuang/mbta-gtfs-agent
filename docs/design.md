# Design: MBTA GTFS Agent

Take-home for the MIT Transit Lab RA position, **Agentic AI track**.
A natural-language, auditable interface over MBTA static GTFS for a service planner.

## 1. Problem framing

**User:** an MBTA service planner. Their recurring question is "does the scheduled
service on route X meet the standard?" — headway by period, span of service, which
routes serve a station, how two routes compare. Today that is a half-day of SQL or
Excel per question.

**What the artifact does:** the planner asks in plain English; an agent writes and runs
DuckDB SQL against the static GTFS feed, returns a table / chart / map, and every
answer carries the evidence that produced it: the SQL, the service date it resolved
to, the row count, and the caveats (which reference stop, which trips were excluded).

**Why static GTFS fits:** static GTFS *is* the scheduled service. It answers planner
questions exactly and cannot answer operations questions (on-time performance, current
vehicle positions). The agent must know the difference and say so.

**Non-goals (see ASSUMPTIONS.md when written):** multi-agency reuse, user-uploaded
feeds, RAG over policy documents, fine-tuning, auth, persistence across devices.

## 2. Architecture

```
browser                                        Next.js server
┌──────────────────────────────────────┐       ┌───────────────────────────┐
│ DuckDB-WASM  ← public/gtfs/*.parquet │       │ POST /api/chat            │
│ @sqlrooms/ai chat                    │◄─────►│ AI SDK streamText         │──► Parley
│   tools (run in browser):            │  UI   │ model = env OPENAI_MODEL  │   (OpenAI-
│   query · chart · map_layer          │ stream│ baseURL = env             │    compatible)
│ sql-editor drawer · DeckJsonMap      │       └───────────────────────────┘
└──────────────────────────────────────┘
build: scripts/prepare-gtfs.ts   data/gtfs/*.txt ──DuckDB──► public/gtfs/*.parquet
```

- **Tools execute in the browser** (sqlrooms `createAiSlice`); the server only talks
  to the model. Data never leaves the user's machine.
- **`/api/chat` is the provider boundary.** Swapping Parley for any OpenAI-compatible
  endpoint is one env var. Swapping AI SDK `streamText` for a LangGraph graph later
  is possible through `@ai-sdk/langchain` without touching the frontend.
- No Python, no CopilotKit, no database server. Rationale recorded in README.

**Stack:** Next.js (App Router) · `@sqlrooms/{room-shell,duckdb,ai,vega,deck,sql-editor,ui}` 0.29 ·
Vercel AI SDK · deck.gl 9 · Mapbox GL · Tailwind · pnpm. Starting point: sqlrooms
`examples/ai-nextjs`.

## 3. Data

**Source:** MBTA static GTFS, feed version *Fall 2026, version D* (2026-09-04 → 2026-12-12),
from https://cdn.mbta.com/MBTA_GTFS.zip. All modes loaded (bus, subway, light rail,
commuter rail, ferry). Prompt and demo questions focus on bus + Red Line.

**Tables loaded** (core GTFS + MBTA extensions that matter):
`agency, routes, trips, stop_times, stops, calendar, calendar_dates, shapes,
route_patterns, directions`. Fares, pathways, facilities are not loaded.

**Pipeline:** `scripts/prepare-gtfs.ts` reads `data/gtfs/*.txt` with Node DuckDB
(`read_csv(..., all_varchar=true, quote='"')` — `trips.txt` has quoted commas) and
writes zstd parquet to `public/gtfs/`. Parquet files (~10 MB total) are committed so
the feed version is pinned and README numbers stay reproducible; the script exists to
regenerate from a newer feed.

**Load at startup:** sqlrooms room config lists each parquet as a table. Types are
cast in views, not at load: times stay `VARCHAR` because GTFS times exceed 24:00.

### GTFS facts the agent must know (goes into the system prompt)

- route → trips → stop_times → stops; `service_id` (calendar + calendar_dates) decides
  which day a trip runs; `shape_id` gives geometry.
- **Service on a date** = `calendar` rows where the weekday flag is 1 and date ∈
  [start_date, end_date] **∪** `calendar_dates` with exception_type 1 **−**
  `calendar_dates` with exception_type 2.
- **Times** are strings, may exceed `24:00:00` (next-morning trips of the same service
  day). Convert with `split_part` to minutes; never cast to `TIME`.
- **Stops:** `location_type` 0 = stop/platform, 1 = parent station, 2 = entrance,
  3 = generic node. Street bus stops near a station often have *no* parent
  (e.g. stop 110 near Harvard). "Routes serving Harvard" must aggregate children
  under `place-harsq` and match nearby street stops by name/coordinates.
- **`route_patterns.route_pattern_typicality`** (MBTA): 1 typical (one per direction;
  branched routes like Red Line have two), 2 deviation, 3 highly atypical (short-turns,
  a few trips/day), 4 diversion (detours, shuttles, snow routes), 5 canonical reference
  pattern **not scheduled to operate**.
- **`directions.txt`** gives human names ("Outbound → Harvard Square").

## 4. Definitions

### Headway
For a route + direction + service date:
1. Keep only trips whose `route_pattern_typicality = 1` (exclude short-turns, diversions,
   and the unscheduled canonical pattern 5).
2. Reference stop = the first stop shared by all kept patterns in that direction
   (for unbranched routes: the origin; for Red Line southbound: Alewife).
3. Sort departures at the reference stop; headway = gap between consecutive departures.
4. Report the **median** gap per period, plus trip count. Never `60 / trips`.
5. The answer must name the reference stop and the number of excluded trips.

### Periods (default, overridable by the user)
AM peak 07:00–09:00 · midday 09:00–15:00 · PM peak 15:00–18:30 · evening 18:30–24:00 ·
late night 24:00+ (GTFS notation).

### Service date
The agent resolves any date the user names (weekday name, "next Saturday", a holiday,
an explicit date) to a concrete `YYYYMMDD` within the feed window, applies the calendar
rule above, and **states the resolved date in every answer**. Default when unspecified:
the next Wednesday inside the feed window. Fallback if this proves unreliable: three
fixed representative dates (Wed / Sat / Sun) — decision recorded in ASSUMPTIONS.md.

## 5. Agent

**Loop:** AI SDK `streamText` with `stopWhen: stepCountIs(8)`; client-side tools via
sqlrooms. Model and endpoint from env.

**Tools (all execute in the browser):**

| tool | input | output | notes |
|---|---|---|---|
| `query` (sqlrooms default) | `sql` | materialized table shown inline with SQL + row count | guarded: `SELECT`/`WITH` only, auto `LIMIT 1000` |
| `chart` (`createVegaChartTool({editable:true})`) | `sql`, Vega-Lite spec | inline chart, user can edit SQL and spec | prompt includes one example line-chart spec |
| `map_layer` (custom) | `sql`, `kind: 'stops' \| 'routes'` | deck.gl layer on the right-hand map | contract: stops → `lat, lon, label, value`; routes → `shape_id, label, value`. Missing columns → error returned to the agent to rewrite. `value` drives colour (higher = worse, red). |

**System prompt contents:**
1. Persona and scope: MBTA service planner; scheduled service only; refuse (with reason)
   questions that need real-time or historical actual data.
2. Schema summary of loaded tables + the GTFS facts in §3.
3. The headway / period / date definitions in §4, verbatim.
4. Tool-selection rule: time dimension → chart, spatial → map, else table. Always run
   `query` first; chart/map reuse its SQL.
5. Answer format: resolved service date · result · caveats (reference stop, exclusions,
   parent-station merging) · one-line "how I computed this".
6. Two or three few-shot examples taken from `eval/questions.json`.

**Guardrails:** SQL allowlist check before execution; `LIMIT 1000` appended when absent;
step cap 8; scope limits in prompt. DuckDB-WASM is a browser sandbox, so these are
design signals, not a security boundary (say so in README).

## 6. UI

Fixed dark theme (sqlrooms dark tokens, Mapbox `dark-v11`). English only.

```
┌ header: MBTA GTFS · Fall 2026 ver. D · 2026-09-04 → 12-12 · model: <id> · tokens: <n> ┐
├──────────────────────────────┬──────────────────────────────────────────────────┤
│ chat                         │ map (DeckJsonMap, full height)                   │
│  - user turn                 │                                                  │
│  - assistant: text           │                                                  │
│    ▸ query  [SQL ▾] table    │                                                  │
│    ▸ chart                   ├──────────────────────────────────────────────────┤
│    ▸ map_layer → "added"     │ SQL editor drawer (opens from any answer's SQL;  │
│                              │ edit → re-run → table/map update)                │
└──────────────────────────────┴──────────────────────────────────────────────────┘
```

Token counter sums AI SDK `usage` per turn. Suggested prompts under the composer =
the six demo questions.

## 7. Demo questions (also the eval set)

| # | question | expected tool(s) | what it proves |
|---|---|---|---|
| 1 | What is the scheduled headway on Route 1 by hour on a weekday? | query, chart | definitions applied, evidence attached |
| 2 | Which bus routes run every 10 minutes or better during the AM peak? | query, map_layer(routes) | filtering + map |
| 3 | Which routes serve Harvard, and what are the first and last departures? | query, map_layer(stops) | parent-station caveat |
| 4 | Compare Route 1 and Route 66: weekday peak vs. Saturday headway. | query | comparison table, date resolution |
| 5 | *(no new prompt)* user edits Q4's SQL to a Sunday, re-runs | sql-editor | auditability |
| 6 | Is Route 1 running on time right now? | none | scope limit, honest refusal |

Each question in `eval/questions.json` carries: prompt, reference SQL, expected key
numbers (e.g. Q1 AM-peak median = 8). `pnpm eval` (a) runs reference SQL in Node
DuckDB and asserts the numbers — the data/definition check; (b) posts each prompt to
`/api/chat` and checks the expected numbers appear in the final answer — the model
check. Run once per model for the README comparison table.

## 8. Deployment

- **Local:** `pnpm install && pnpm dev` with `.env` from `.env.example`.
- **Docker:** `output: 'standalone'`; `Dockerfile` (build → copy standalone → `node server.js`);
  `docker-compose.yml` with `env_file: .env`. This is the "small agency self-hosts it"
  story.
- **Vercel Hobby:** `/api/chat` as a function with `maxDuration = 'max'`; parquet in
  `public/`. Precondition to verify first: Parley reachable from a non-MIT network.
  If not, README documents local/Docker only.
- **CI:** GitHub Actions on push: `pnpm build` + `pnpm eval --data-only` (no LLM calls).

## 9. Repository layout

```
app/                 Next.js app router (page, /api/chat/route.ts)
components/          room shell, panels, header
lib/                 store (sqlrooms slices), tools, prompt, sql-guard
scripts/prepare-gtfs.ts
public/gtfs/*.parquet
data/                raw feed + notes (gitignored)
eval/questions.json  eval/run.ts
docs/design.md       this file
Dockerfile  docker-compose.yml  .env.example
README.md  ASSUMPTIONS.md  AI-USE.md
```

## 10. Extension gate: GTFS-Realtime

Only after §7 passes for all six questions, docs are drafted and the video is recorded,
and only if the time budget allows. Scope is fixed: one **server-side** tool
`vehicle_positions(route_id)` in `/api/chat` that fetches MBTA `VehiclePositions.pb`,
decodes it with `gtfs-realtime-bindings`, and returns vehicle, position, trip. The agent
joins it with static trips to answer "how many vehicles are on Route 1 now and what are
the actual gaps". Developed on a branch with a PR; if unmerged at submission the PR
documents the state. Q6's refusal is the baseline; with RT it becomes a real answer.

## 11. Documentation plan

- **README.md** — narrative, screenshots from the recorded demo, key findings, data &
  resources, compute (Parley tier, models), model comparison table, why-not-CopilotKit /
  why-not-LangGraph paragraph, quickstart, Docker, deploy. Hours line at the end.
- **ASSUMPTIONS.md** — feed pinned; headway/period/date definitions; modes loaded but
  prompt tuned for bus + Red Line; parent-station heuristic; guardrails are signals not
  security; eval matching is substring on numbers; RT scope.
- **AI-USE.md** — written by the author after development; commit history
  (`Co-Authored-By`) is part of the record.
- Backlog as GitHub issues, linked from README future work.

## 12. Risks

| risk | mitigation |
|---|---|
| Parley unreachable from Vercel | verify in hour one; fall back to Docker-only |
| Date resolution flaky (Q2 = full resolution) | fallback to three fixed dates, recorded in ASSUMPTIONS |
| Agent picks wrong reference stop on branched routes | definition in prompt + few-shot; eval Q1/Q4 catch it |
| Vega spec quality | one example spec in prompt; chart is not on the critical path |
| sqlrooms + Next.js SSR issues with DuckDB-WASM | start from the official `ai-nextjs` example |
