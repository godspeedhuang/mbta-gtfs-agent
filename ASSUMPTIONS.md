# Assumptions and simplifications

I built this prototype in about 12 hours and scoped it down on purpose. Each item says what I assumed or left out, what that costs, and what lifting it would take. Transit definitions come first because they change the numbers. The stack itself is optional reading in [docs/tech-choices.md](docs/tech-choices.md).

## Transit definitions

GTFS leaves these open, so I picked one rule for each and put it in the system prompt (`src/lib/agent/instructions.ts`). The agent repeats the relevant rules in each answer's caveats.

**Scheduled service only.** Everything comes from the static feed. The agent declines questions about delays, vehicle positions, on-time performance or ridership and offers the closest scheduled answer (eval Q6). A server-side GTFS-Realtime tool would let it answer them; I did not build one.

**Headway is the median gap at one reference stop.** For a route, direction and service date, the agent sorts departures at the first stop every kept trip serves, then reports the median gap and trip count per period. That stop is the origin on an unbranched route and the shared trunk stop on a branched one (Alewife on the Red Line), so no branch is missed. I never use 60 / trips, because it hides uneven spacing.

**Only typical trips count.** Headway and frequency use trips whose route pattern has `route_pattern_typicality = 1`. Short-turns, detours and shuttles are dropped, and the agent says how many. Short-turns do carry riders, so on routes that have them the reported headway is slightly worse than what inner-section riders get.

**Periods are mine, not MBTA's.** AM peak 07:00–09:00, midday 09:00–15:00, PM peak 15:00–18:30, evening 18:30–24:00, late night after 24:00. Intervals are half-open (09:00 is midday), and a gap belongs to the period of its later departure. Hours the user gives take precedence.

**Times past midnight stay on the service day.** 25:10:00 is 1:10 AM of the same service day. Times are handled as minutes, never cast to clock times.

**A service date is resolved to one real date.** "Weekday" with no date means the first Wednesday on or after today in Boston, which keeps Monday holidays and Friday variations out; "Saturday" and "Sunday" mean the next one. Active service follows `calendar` plus `calendar_dates` exceptions, since MBTA uses many short-lived service IDs.

**A station includes what is near it.** "Routes serving Harvard" covers the parent station, its platforms, and street stops within 300 m of it. 300 m is my estimate of a walkable transfer, measured with a flat-earth approximation that is accurate enough at Boston's scale. I rejected matching by stop name because it pulls in unrelated stops far away.

**A threshold applies to both directions.** A route is "every 10 minutes or better" only if both directions are.

## Scope

**One agency, one pinned feed.** The bundled feed is MBTA *Fall 2026, version D* (2026-09-04 to 2026-12-12), committed as parquet so results are reproducible. It does not track MBTA updates, and dates outside that window move to the nearest matching day inside it.

**Static GTFS only, tested on bus and subway.** The only data source is the GTFS schedule; there is no real-time feed, ridership or other data. Commuter rail and ferry are loaded and queryable, but the prompt and eval questions cover buses and subway only, so answers about them are unverified.

## Uploaded feeds and state

**Upload takes prepared parquet, not a GTFS zip.** Convert a second feed with `pnpm prepare-gtfs` first. The app checks that all 11 table files are present and that `feed_info` has a version, which becomes the schema name. It does not check file type, size or columns, so a parquet file with wrong columns loads and fails only at query time. Uploading the same season again replaces it.

**Nothing survives a reload.** Uploaded feeds live in DuckDB-WASM memory and chat history in page state, which kept the architecture to a browser plus one API route. To persist them, store uploads in the browser's Origin Private File System (OPFS), which DuckDB-WASM reads directly (localStorage is too small), and keep conversations in Postgres as described in [docs/tech-choices.md](docs/tech-choices.md#3-agent-runtime-agent-loop-in-the-browser).

## Agent

- **Tools run in the browser.** Queries, charts and map layers execute in the user's browser, so the feed never leaves the machine and deployment is one API route that forwards model calls. In exchange, the agent has no file system and cannot run code, so it cannot write report files or do multi-step analysis beyond SQL. Lifting this means moving the agent to a backend: a LangGraph deep agent with a Postgres checkpointer, connected to the UI through CopilotKit over AG-UI (see [Agent runtime](docs/tech-choices.md#3-agent-runtime-agent-loop-in-the-browser)).
- **The model reads a sample, the user sees the table.** The model gets the first 100 rows of a query result and the user sees up to 1,000, so the agent's summary rests on those 100 rows. The agent stops after 20 steps and retries a failed query at most twice.
- **All context is in one system prompt.** Schema notes, definitions, tool rules and the answer format are always loaded. That is fine for one task; with more capabilities I would split them into skills loaded on demand.
- **Maps show routes and stops only.** `map_layer` accepts routes as line shapes and stops as points. deck.gl can draw far more, but these two cover the questions in scope and are easy for the model to call correctly.
- **Charts are for time.** The agent charts a result only when it has a time axis (hour, period, date). Vega-Lite could show far more; the limit keeps it from adding charts nobody asked for.

## Guardrails and access

**The SQL guard catches mistakes, not attacks.** `sql-guard.ts` allows one `SELECT`/`WITH` statement and adds `LIMIT 1000`, so the model cannot accidentally change or dump tables. It is not a security boundary: the data is a public, read-only copy in the user's own browser.

**Access is one shared password.** The public demo uses optional HTTP Basic Auth, with no user accounts and no rate limit on the model proxy.

## Evaluation

**Scoring checks key values, not answer quality.** Each clear question has key numbers from a hand-checked reference query. A run passes if they appear as whole tokens in the answer (answer accuracy) or in a query result (data accuracy). Tool precision and recall compare the set of tools used; call order is recorded but not scored. Nothing scores the reasoning, caveats, SQL, or concision.

A wrong number is the most serious failure and can be checked exactly, so I stopped there. Grading the rest needs an LLM judge calibrated against human ratings, plus trajectory checks on call order and on the agent's SQL result against the reference. The plan is in `docs/observability-evaluation.md`.

**The golden set is small.** Nine questions (six clear, three vague), three runs per configuration, with "today" fixed to 2026-09-13 so relative dates resolve the same way. CI runs only the reference-SQL data check; the agent check runs by hand. CI skips Q7 (season comparison) because it needs the Summer 2026 feed, which is prepared locally and not committed.
