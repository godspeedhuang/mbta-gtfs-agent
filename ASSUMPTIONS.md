# Assumptions and simplifications

I built this prototype in about 12 hours and scoped it down on purpose. Each item says what I assumed or left out, what that costs, and what lifting it would take. Transit definitions come first because they change the numbers. [Technology choices](#technology-choices), at the end, covers the stack.

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

**Tested on bus and rapid transit.** Commuter rail and ferry are loaded and queryable, but the prompt and eval questions cover buses and subway only, so answers about them are unverified.

## Uploaded feeds and state

**Upload takes prepared parquet, not a GTFS zip.** Convert a second feed with `pnpm prepare-gtfs` first. The app checks that all 11 table files are present and that `feed_info` has a version, which becomes the schema name. It does not check file type, size or columns, so a parquet file with wrong columns loads and fails only at query time. Uploading the same season again replaces it.

**Nothing survives a reload.** Uploaded feeds live in DuckDB-WASM memory and chat history in page state, which kept the architecture to a browser plus one API route. To persist them, store uploads in the browser's Origin Private File System (OPFS), which DuckDB-WASM reads directly (localStorage is too small), and keep conversations in Postgres as described under [Technology choices](#3-agent-runtime-agent-loop-in-the-browser).

## Agent

**Tools run in the browser.** Queries, charts and map layers execute in the user's browser, so the feed never leaves the machine and deployment is one API route that forwards model calls. In exchange, the agent has no file system and cannot run code, so it cannot write report files or do multi-step analysis beyond SQL. Lifting this means moving the agent to a backend: a LangGraph deep agent with a Postgres checkpointer, connected to the UI through CopilotKit over AG-UI (see [Agent runtime](#3-agent-runtime-agent-loop-in-the-browser)).

**The model reads a sample, the user sees the table.** The model gets the first 100 rows of a query result and the user sees up to 1,000, so the agent's summary rests on those 100 rows. The agent stops after 20 steps and retries a failed query at most twice.

**All context is in one system prompt.** Schema notes, definitions, tool rules and the answer format are always loaded. That is fine for one task; with more capabilities I would split them into skills loaded on demand.

**Maps show routes and stops only.** `map_layer` accepts routes as line shapes and stops as points. deck.gl can draw far more, but these two cover the questions in scope and are easy for the model to call correctly.

**Charts are for time.** The agent charts a result only when it has a time axis (hour, period, date). Vega-Lite could show far more; the limit keeps it from adding charts nobody asked for.

## Guardrails and access

**The SQL guard catches mistakes, not attacks.** `sql-guard.ts` allows one `SELECT`/`WITH` statement and adds `LIMIT 1000`, so the model cannot accidentally change or dump tables. It is not a security boundary: the data is a public, read-only copy in the user's own browser.

**Access is one shared password.** The public demo uses optional HTTP Basic Auth, with no user accounts and no rate limit on the model proxy.

## Evaluation

**Scoring checks key values, not answer quality.** Each clear question has key numbers from a hand-checked reference query. A run passes if they appear as whole tokens in the answer (answer accuracy) or in a query result (data accuracy). Tool precision and recall compare the set of tools used; call order is recorded but not scored. Nothing scores the reasoning, caveats, SQL, or concision.

A wrong number is the most serious failure and can be checked exactly, so I stopped there. Grading the rest needs an LLM judge calibrated against human ratings, plus trajectory checks on call order and on the agent's SQL result against the reference. The plan is in `docs/observability-evaluation.md`.

**The golden set is small.** Nine questions (six clear, three vague), three runs per configuration, with "today" fixed to 2026-09-13 so relative dates resolve the same way. CI runs only the reference-SQL data check; the agent check runs by hand. CI skips Q7 (season comparison) because it needs the Summer 2026 feed, which is prepared locally and not committed.

## Technology choices

PTIQ is meant to be open source, run by transit agencies without in-house AI or data teams. This prototype is a take-home, but I chose its stack as if it were that platform's first building block, under three principles:

1. **No paid dependency on the core path.**
2. **Self-hosted, not SaaS.** The agency runs everything on infrastructure it controls; there is no hosted multi-tenant service.
3. **The agency picks the model, where the data lives, and who can sign in** through configuration, without code changes.

The architecture grows along two independent axes:

- **Who uses it** (individual, small team, mid-size or large team) sets where it runs, where state lives, and how people sign in. See [Deployment by team size](#deployment-by-team-size).
- **What the agent has to do** sets the agent runtime. Questions answerable with SQL, a chart and a map run in the browser; tasks that need code, files or long multi-step work need a server-side agent. See [Agent runtime](#3-agent-runtime-agent-loop-in-the-browser).

Each section gives the decision, why it fits now, the trade-offs, and when to change it.

### 1. Data layer: DuckDB in the browser over Parquet

**Decision.** The GTFS feed is converted once to Parquet and served as static files. DuckDB compiled to WebAssembly reads them over HTTP in the user's browser.

**Why now.**
- There is no database server to operate, only a static file server.
- The browser uses HTTP range requests to fetch only the columns and row groups a query needs, the same pattern modern data platforms use. A 14 MB feed with 3.9M stop times stays interactive.
- Queries run on the user's machine, so more users add compute at no cost.
- The model sees the question, schema description, SQL and small aggregated results, never the raw tables. For public GTFS that is a convenience. For the fare, ridership or passenger-count data agencies will want to connect next, it is a requirement.

**Trade-offs.**
- Browser memory is the limit: fine for a few static feeds, not for months of real-time history.
- The bundled feed is fixed at build time; updating it means rebuilding.

**More than one feed.** A second feed dropped into the data panel loads into its own DuckDB schema named after its season in `feed_info` (`summer_2026.trips` next to the bundled `trips`), and the agent's instructions list every loaded feed with its calendar window. With the same tables and rules in one schema per season, the agent can answer "which routes gained trips from Summer to Fall?" Uploads take the Parquet files the conversion script produces and last only for that tab (see [Uploaded feeds and state](#uploaded-feeds-and-state)).

**When to change.** The read path stays the same at every scale; only the source of the files changes.
- *Individual with their own feed:* DuckDB converts the GTFS zip to Parquet in the browser (shapes need a small aggregation step) and keeps it in browser storage, with no upload.
- *Team sharing feeds:* uploads are converted and written to a volume the app serves, still as static files read with range requests.
- *Real-time history (GTFS-RT):* data arrives continuously and reaches gigabytes, so a server-side ingestion job writes Parquet and queries move to server-side DuckDB. The SQL dialect, prompts and eval set carry over.
- *Application state* (users, saved questions, conversations) is transactional and goes in Postgres, alongside the analytical files.

### 2. App framework: sqlrooms

**Decision.** The UI is built on sqlrooms, an open-source React toolkit for DuckDB data apps.

**Why now.**
- It already provides in-browser DuckDB, a chat panel, a SQL editor, charts and maps.
- The database, UI and agent share one application state. The agent's queries and map layers act on the data the user is viewing, and the user can open, edit and re-run that SQL without the model, which makes every answer checkable.

**Trade-offs.**
- It is a young project with a small community, and I had to work around its internals several times: its server-side chat mode does not run browser tools (hence the agent loop in the browser), its map component owns the camera, and a state-sync loop needed a workaround.
- Visualization library versions must be pinned by hand.

**When to change.** Once tasks need a server-side agent (next section), the sqlrooms chat UI gets replaced. Its data, chart and map pieces can stay.

### 3. Agent runtime: agent loop in the browser

**Decision.** The agent loop (model call → tool call → result → next step) runs in the browser on the Vercel AI SDK. Its tools are SQL queries, charts, map layers, and asking the user back when a request is too vague to compute. The server is a thin model gateway that holds the API key, pins the model and reasoning effort, traces each call, and talks to any OpenAI-compatible endpoint.

**Why now.**
- SQL, declarative charts and map layers all run next to the data in the browser.
- By default sqlrooms has each user paste their own LLM key into the browser, which agency staff cannot do. The gateway keeps the key on the server while tools still run in the browser.
- Provider independence is a core requirement. Switching provider, including to a self-hosted open-weight model, means changing the endpoint, model name and API mode; the evaluation runs GPT, Gemini and Llama through the same gateway.
- The app stays a single TypeScript deployable.

**Trade-offs.**
- The agent is limited to what SQL plus a chart or map can express. It cannot run its own analysis code or produce files.
- The loop lives in a browser tab, so closing the tab stops the task. There is no background work and no resumable run.

**When to change.** Move to a server-side agent when the task requires it, whatever the number of users. That means when the agent has to:

| Needs to | Example in transit work |
|---|---|
| write and run code beyond SQL | a bunching or regression analysis in Python, a spatial join with a demographics layer |
| produce files | a service-change briefing deck with maps and charts, a board-ready spreadsheet or PDF |
| keep a workspace across many steps | clean an uploaded ridership file, join it to the schedule, then chart the result |
| plan a long task and split it up | "summarise how every route did against the service standard this quarter" |

Then the front end and back end split:
- **Back end:** a Python LangGraph service running a deep-agent runtime that plans, keeps files in its own workspace, runs code in a sandbox, and delegates to sub-agents. The lab's own models and document retrieval will also live in Python.
- **Front end:** CopilotKit over the AG-UI protocol, which carries streaming text, tool calls, shared state and human approvals between UI and agent. Rich interactions (a map the agent draws on, a table the user edits) stay possible without coupling the two codebases.
- **State:** Postgres stores conversation threads and agent checkpoints so users can leave a task and resume it. Redis routes agent events to the right connection, resumes a stream after a dropped connection, and locks a thread against concurrent runs.

### 4. Visualization: Vega-Lite charts, deck.gl + MapLibre maps

**Decision.** Charts are Vega-Lite specs rendered in the browser. Maps are deck.gl layers on a MapLibre basemap.

**Why now.**
- **Interactive.** Planners need to hover a point, isolate a route from the legend, or pan to a corridor, which a static image such as a matplotlib figure does not allow. Every agent chart supports legend-click highlighting.
- **Declarative, so a model can write it.** A Vega-Lite chart is a small JSON document. The agent writes a spec and a SQL query, and the app renders it without running plotting code.
- **GPU map rendering.** deck.gl draws thousands of route shapes and stops smoothly. MapLibre is open source, needs no vendor token, and has a swappable basemap.
- Routes are drawn in their GTFS colours, with distinct colours when two routes share one.

**Trade-offs.**
- The model sometimes writes a weak spec (wrong axis type, awkward labels); prompt guidance and post-processing fix the common cases.
- Export is limited to what the browser can produce: charts as SVG or PNG and result tables as CSV. There are no report files.

**When to change.** Agencies need exportable reports. Vega-Lite specs render to SVG or PNG on a server, so the same spec can feed a PDF or slide deck. That is one of the file-producing tasks that moves work to the server-side agent.

### 5. Access control: none for an individual, OIDC for a team

**Decision.** The system has no sign-in. An individual runs it on their own machine, where there is nobody to keep out.

**Why now.** Sign-in matters only once several people share a deployment. Building accounts earlier would add a service to operate for no benefit.

**Trade-offs.** Without user identity there are no roles and no record of who asked what.

**When to change.** When a team shares a deployment, sign-in uses **OpenID Connect (OIDC)**:
- Agencies already run an identity provider (Microsoft Entra ID, Okta, government single sign-on), so staff sign in with existing accounts, and switching provider is configuration.
- Roles come from the provider's groups (planning, scheduling, operations control, customer service) and set what each role can query and see.
- Agencies without an identity provider get a self-hostable Keycloak reference setup.
- Supabase offers database and sign-in in one step but ties identity to the database, so it is not the default.

### 6. Packaging: one container

**Decision.** The app builds to a standalone Next.js server in a Docker image that runs on a laptop or a server with `docker compose`.

**Why now.** A small agency can run the whole system with one command and an API key. CI runs tests, the data evaluation and a production build on every push.

**Trade-offs.** Configuration lives in environment variables. There is no secrets manager or infrastructure-as-code yet.

### Deployment by team size

| | **Individual** | **Small team** | **Mid-size or large team** |
|---|---|---|---|
| **Who** | one planner trying it out | 5–30 staff at a small agency | control center, analysts, customer service |
| **Runs on** | a laptop, one container (this repository today) | one server on the agency network, Docker Compose | several instances on Kubernetes, in the agency's own data center or its own cloud account |
| **Data** | pinned feed; extra feeds dropped into the data panel, per tab | shared uploaded feeds on a volume | plus GTFS-RT ingestion and server-side DuckDB |
| **Model** | any OpenAI-compatible endpoint, including a local model | same, with an agency-wide usage budget | same |
| **State** | none | Postgres: users, saved questions, conversations | same |
| **Sign-in** | none | OIDC with the agency's identity provider, roles from groups | plus an audit log |
| **Observability** | optional | self-hosted Langfuse | same |

The agent runtime is left out of this table because it depends on the task: an individual who wants a generated report needs the server-side agent, while a large team that only asks schedule questions does not.

Each larger column adds infrastructure on top of the smaller one. The Parquet read path, tool definitions, prompts and eval set carry through all three.
