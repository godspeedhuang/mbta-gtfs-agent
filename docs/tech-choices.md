# Tech choices

This one explains the stack for anyone who wants to run or extend the prototype.

PTIQ is meant to be open source, run by transit agencies without in-house AI or data teams. This prototype is a take-home, but I chose its stack as if it were that platform's first building block, under three principles:

1. **No paid dependency on the core path.**
2. **Self-hosted, not SaaS.** The agency runs everything on infrastructure it controls; there is no hosted multi-tenant service.
3. **The agency picks the model and where the data lives** through configuration, without code changes.

The architecture grows along two independent axes:

- **Who uses it** (individual, small team, mid-size or large team) sets where it runs and where state lives. See [Deployment by team size](#deployment-by-team-size).
- **What the agent has to do** sets the agent runtime. Questions answerable with SQL, a chart and a map run in the browser; tasks that need code, files or long multi-step work need a server-side agent. See [Agent runtime](#3-agent-runtime-agent-loop-in-the-browser).

Each section gives the decision, why it fits now, the trade-offs, and when to change it.

## 1. Data layer: DuckDB in the browser over Parquet

**Decision.** The GTFS feed is converted once to Parquet and served as static files. DuckDB compiled to WebAssembly reads them over HTTP in the user's browser.

**Why now.**
- There is no database server to operate, only a static file server.
- The browser uses HTTP range requests to fetch only the columns and row groups a query needs, the same pattern modern data platforms use. A 14 MB feed with 3.9M stop times stays interactive.
- Queries run on the user's machine, so more users add compute at no cost.
- The model sees the question, schema description, SQL and up to 100 rows of each result, never the full tables. For public GTFS that is a convenience. For the fare, ridership or passenger-count data agencies will want to connect next, it is a requirement.

**Trade-offs.**
- Browser memory is the limit: fine for a few static feeds, not for months of real-time history.
- The bundled feed is fixed at build time; updating it means rebuilding.

**More than one feed.** A second feed dropped into the data panel loads into its own DuckDB schema named after its season in `feed_info` (`summer_2026.trips` next to the bundled `trips`), and the agent's instructions list every loaded feed with its calendar window. With the same tables and rules in one schema per season, the agent can answer "which routes gained trips from Summer to Fall?" Uploads take the Parquet files the conversion script produces and last only for that tab (see [Uploaded feeds and state](../ASSUMPTIONS.md#uploaded-feeds-and-state)).

**When to change.** The read path stays the same at every scale; only the source of the files changes.
- *Individual with their own feed:* DuckDB converts the GTFS zip to Parquet in the browser (shapes need a small aggregation step) and keeps it in browser storage, with no upload.
- *Team sharing feeds:* uploads are converted and written to a volume the app serves, still as static files read with range requests.
- *Real-time history (GTFS-RT):* data arrives continuously and reaches gigabytes, so a server-side ingestion job writes Parquet and queries move to server-side DuckDB. The SQL dialect, prompts and eval set carry over.
- *Application state* (users, saved questions, conversations) is transactional and goes in Postgres, alongside the analytical files.

## 2. App framework: sqlrooms

**Decision.** The UI is built on sqlrooms, an open-source React toolkit for DuckDB data apps.

**Why now.**
- It already provides in-browser DuckDB, a chat panel, a SQL editor, charts and maps.
- The database, UI and agent share one application state. The agent's queries and map layers act on the data the user is viewing, and the user can open, edit and re-run that SQL without the model, which makes every answer checkable.

**Trade-offs.**
- It is a young project with a small community, and I had to work around its internals several times: its server-side chat mode does not run browser tools (hence the agent loop in the browser), its map component owns the camera, and a state-sync loop needed a workaround.
- Visualization library versions must be pinned by hand.

**When to change.** Once tasks need a server-side agent (next section), the sqlrooms chat UI gets replaced. Its data, chart and map pieces can stay.

## 3. Agent runtime: agent loop in the browser

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

## 4. Visualization: Vega-Lite charts, deck.gl + MapLibre maps

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

## 5. Packaging: one container

**Decision.** The app builds to a standalone Next.js server in a Docker image that runs on a laptop or a server with `docker compose`.

**Why now.** A small agency can run the whole system with one command and an API key. CI runs tests, the data evaluation and a production build on every push.

**Trade-offs.** Configuration lives in environment variables. There is no secrets manager or infrastructure-as-code yet.

## Deployment by team size

| | **Individual** | **Small team** | **Mid-size or large team** |
|---|---|---|---|
| **Who** | one planner trying it out | 5–30 staff at a small agency | control center, analysts, customer service |
| **Runs on** | a laptop, one container (this repository today) | one server on the agency network, Docker Compose | several instances on Kubernetes, in the agency's own data center or its own cloud account |
| **Data** | pinned feed; extra feeds dropped into the data panel, per tab | shared uploaded feeds on a volume | plus GTFS-RT ingestion and server-side DuckDB |
| **Model** | any OpenAI-compatible endpoint, including a local model | same, with an agency-wide usage budget | same |
| **State** | none | Postgres: users, saved questions, conversations | same |
| **Observability** | optional | self-hosted Langfuse | same |

The agent runtime is left out of this table because it depends on the task: an individual who wants a generated report needs the server-side agent, while a large team that only asks schedule questions does not.

Each larger column adds infrastructure on top of the smaller one. The Parquet read path, tool definitions, prompts and eval set carry through all three.
