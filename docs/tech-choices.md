# Tech choices

PTIQ is meant to be released as open source and stood up by transit agencies without in-house AI or data teams. That shapes every choice in this prototype more than any single feature does. Three principles:

1. **No paid dependency on the core path.** Every component can be self-hosted.
2. **Deploy incrementally.** The smallest useful deployment is one container. Each added piece of infrastructure has a concrete trigger (see [Deployment tiers](#deployment-tiers)).
3. **The agency decides the provider and the data boundary.** Which model, where the data lives, and who can sign in are configuration, not code changes.

Each section below follows the same shape: the decision, why it fits now, what it gives up, and when to change it.

---

## 1. Data layer: DuckDB in the browser over Parquet

**Decision.** The GTFS feed is converted once to Parquet and served as static files. DuckDB, compiled to WebAssembly, runs in the user's browser and reads those files over HTTP.

**Why now.**
- Nothing to operate. There is no database server; the "backend" for data is a static file server.
- Columnar, compressed files plus HTTP range requests are the same pattern cloud data platforms use. The browser reads only the columns and row groups a query needs, so a 14 MB feed with 3.9M stop times answers interactively.
- Queries run on the user's machine. Adding users adds compute for free.
- The data stays inside the agency's boundary: the model sees the question, the schema description, the SQL and small aggregated results, never the raw tables. For public GTFS this is a convenience; for fare, ridership or APC data the agency will want to connect next, it is the requirement.

**Trade-offs.**
- Bounded by browser memory. Fine for one agency's static feed, not for months of real-time history.
- The feed is pinned at build time (committed to the repo, baked into the image). Updating it is a rebuild.

**When to change.** The read path stays the same as the system grows; only where the files come from changes.
- *Agency uploads its own feed:* convert GTFS to Parquet in the browser (DuckDB can do it) and keep it in browser storage for a single user, or write it to a volume the app serves for a whole team. Cloud deployments point the same code at S3, Azure Blob Storage or similar. No object store is required to run it.
- *Real-time history (GTFS-RT):* data arrives continuously and grows to gigabytes, so it needs a server-side ingestion job writing Parquet, and queries over it move to a server-side DuckDB. The SQL dialect, prompts and evaluation set carry over unchanged.
- *Application state* (users, saved questions, conversations) is transactional and belongs in Postgres, alongside the analytical files rather than replacing them.

## 2. App framework: sqlrooms

**Decision.** The UI is built on sqlrooms, an open-source React toolkit for data apps around DuckDB.

**Why now.**
- It already combines the pieces this app needs: in-browser DuckDB, a chat panel, a SQL editor, charts and maps.
- The database, the UI and the agent share one application state. When the agent runs a query or adds a map layer, it acts on the same data the user is looking at, and the user can open that SQL, edit it and re-run it without a round trip through the model. That is what makes answers auditable rather than just visible.

**Trade-offs.**
- Young project (0.x), small community. I hit internals more than once: its server-side chat mode does not run browser tools, which is why the agent loop runs in the browser (next section); its map component owns the camera; and a state-sync loop needed a workaround.
- Visualization library versions have to be pinned by hand.

**When to change.** If the agent moves to a server-side runtime (Tier 2), sqlrooms' chat layer stops being useful. Its data, chart and map modules can stay; the chat UI is replaced.

## 3. Agent runtime: Vercel AI SDK, agent loop in the browser

**Decision.** The agent loop (model call → tool call → result → next step) runs in the browser with the Vercel AI SDK. The server is a thin model gateway: it holds the API key, pins the model and reasoning effort, and traces each call. It speaks either the Responses API or Chat Completions to any OpenAI-compatible endpoint.

**Why now.**
- sqlrooms' default design has users paste their own LLM key into the browser. For agency staff that is a non-starter, so a server gateway keeps the key server-side while tools still execute next to the data.
- Provider independence is a core project requirement. Swapping the provider, including a self-hosted open-weight model, is a change of base URL, model id and API mode. The evaluation runs GPT, Gemini and Llama through the same gateway ([details](observability-evaluation.md)).
- The whole app stays one TypeScript deployable.

**Trade-offs.**
- The loop lives in a browser tab. Close the tab and a long task stops; there is no durable state, no resumable run, no background work.
- Tools are limited to what the browser can do.

**When to change.** When tasks get longer and more users share the system (Tier 2), split front end and back end:
- **Back end:** a Python LangGraph service running a deep-agent style runtime. The agent gets its own sandboxed filesystem and code execution, can plan multi-step analyses and delegate to sub-agents, and can call the lab's in-house models and retrieval over policy documents directly. Python is also where those models live.
- **Front end:** CopilotKit over the AG-UI protocol. The protocol carries streaming text, tool calls, shared state and human-in-the-loop approvals between UI and agent, so front-end interactions (a map the agent draws on, a table the user edits) stay flexible without coupling the two codebases.
- **State:** Postgres stores conversation threads and agent checkpoints, so users can switch between conversations and come back to them. Redis handles the real-time side: pushing agent events to the right connection, resuming a stream after a dropped connection or page refresh, locking a thread against concurrent runs, and fan-out across multiple server instances.

## 4. Visualization: Vega-Lite charts, deck.gl + MapLibre maps

**Decision.** Charts are Vega-Lite specifications rendered in the browser. Maps use deck.gl layers on a MapLibre basemap.

**Why now.**
- **Interactive, not static.** A planner needs to hover a point, isolate one route in a legend, pan to a corridor. A static image (e.g. matplotlib output) can be looked at but not interrogated. Legend-click highlighting is added to every chart the agent draws.
- **Declarative, so a model can write it.** A Vega-Lite chart is a small JSON document. The agent produces a spec plus a SQL query; the app renders it. There is no plotting code to execute.
- **GPU map rendering.** deck.gl draws thousands of route shapes and stops smoothly. MapLibre is open source and needs no vendor token; the basemap tiles are swappable.
- Transit conventions come through: routes are drawn in their GTFS brand colours, falling back to distinct colours when routes share one.

**Trade-offs.**
- The model sometimes writes a weak spec (wrong axis type, awkward labels). Prompt guidance and post-processing fix the common cases.
- No export yet.

**When to change.** Agencies need exportable reports (the job description lists them). Vega-Lite specs render to SVG/PNG on a server, so the same spec feeds a PDF or slide export. Time-series views over real-time data may need a streaming chart layer.

## 5. Access control: Basic Auth now, OIDC next

**Decision.** The public demo is protected by HTTP Basic Auth, enabled only when credentials are configured.

**Why now.** One shared password is enough to keep a demo and its model budget private. It adds no service, and local and Docker deployments run without it.

**Trade-offs.** One shared credential, no per-user identity, no roles, no audit of who asked what.

**When to change.** At Tier 1, sign-in moves to **OpenID Connect (OIDC)**:
- Agencies already have an identity provider (Microsoft Entra ID, Okta, a government SSO). OIDC lets staff sign in with their existing accounts; switching providers is configuration.
- Roles come from the identity provider's groups (planning, scheduling, operations control, customer service) and map to what each role can query and see.
- Agencies without an identity provider get a self-hostable reference setup with Keycloak.
- Supabase is a reasonable shortcut for a team that wants Postgres and auth in one step, but it ties identity to the database, so it is not the default.

## 6. Deployment: one container, then add pieces

**Decision.** The app builds to a standalone Next.js server in a Docker image. The same image runs locally with `docker compose`, and the demo runs on Vercel.

**Why now.** A small agency can run the whole thing with one command and an API key. CI runs tests, the data evaluation and a production build on every push.

**Trade-offs.** Configuration lives in environment variables; there is no secrets manager or infrastructure-as-code yet.

---

## Deployment tiers

| | Tier 0: try it | Tier 1: a team uses it | Tier 2: an agency runs on it |
|---|---|---|---|
| **Who** | one planning team | many staff, several roles | control center, analysts, customer service |
| **Data** | pinned static feed as Parquet | uploaded feeds on a mounted volume or object storage | + GTFS-RT ingestion, server-side DuckDB |
| **Agent** | browser loop, server model gateway | same | Python LangGraph deep agent with sandbox; CopilotKit / AG-UI front end |
| **State** | none | Postgres: users, saved questions, threads | + Redis: live events, stream resume, locks |
| **Access** | Basic Auth | OIDC with the agency's identity provider, roles from groups | same, plus audit log |
| **Observability** | LangSmith | Langfuse, self-hosted | same |
| **Runs on** | one container | containers + Postgres | containers + Postgres + Redis + sandbox runtime |

Moving up a tier adds infrastructure; it does not replace what the lower tier built. The Parquet read path, the tool definitions, the prompts and the evaluation set carry through all three.
