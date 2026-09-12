# MBTA GTFS Agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Next.js app where an MBTA service planner asks questions in English and an agent answers with DuckDB SQL run in the browser, returning tables, charts and map layers with the SQL, resolved service date and caveats attached.

**Architecture:** Next.js App Router. All GTFS data lives in DuckDB-WASM in the browser (parquet from `public/gtfs/`). `@sqlrooms/ai` runs the chat; its tools (`query`, `chart`, `map_layer`) execute in the browser. The agent loop also runs in the browser (sqlrooms `getCustomModel`); the only server code is `/api/llm`, a model-layer proxy that receives AI SDK `LanguageModelV3` call options, adds the key, pins model + reasoning effort, calls Parley via the OpenAI Responses API, streams parts back as NDJSON, and traces each call to LangSmith. (Revised from a server-side agent: sqlrooms' `chatEndPoint` mode never executes browser tools.) An eval runner reuses the same instructions and tool schemas against Node DuckDB.

**Tech Stack:** Next.js 16 · React 19 · `@sqlrooms/{room-shell,duckdb,ai,ai-core,ai-settings,sql-editor,vega,deck,ui}` 0.29.0 · `ai` ^6.0.177 · `@ai-sdk/openai` ^3 (Responses API) · deck.gl 9 via `@sqlrooms/deck` (MapLibre basemap, CARTO dark style) · Tailwind 4 · `@duckdb/node-api` for scripts/eval · pnpm · Node 24.

**Spec:** `docs/design.md`

## Global Constraints

- `@sqlrooms/*` pinned to `0.29.0`; `ai` must satisfy sqlrooms peer `^6.0.177` (NOT ai 7).
- Feed pinned: MBTA GTFS *Fall 2026, version D* (2026-09-04 → 2026-12-12); parquet committed under `public/gtfs/`.
- GTFS columns stay `VARCHAR` in tables; cast in SQL. Times may exceed `24:00:00`.
- Headway definition (spec §4): typicality=1 trips only; reference stop = first stop shared by all kept trips; median of consecutive-departure gaps; answer names reference stop + excluded trips.
- Service date: agent resolves any date; every answer states the resolved `YYYYMMDD`.
- Tools execute in the browser; server declares schemas only. Tool names are exactly `query`, `chart`, `map_layer`.
- `map_layer` column contract: `stops` → `lat, lon, label, value`; `routes` → `shape_id, label, value`.
- SQL guard: SELECT/WITH only, one statement, `LIMIT 1000` appended when absent; max 8 agent steps.
- UI: English, fixed dark theme, chat left / map right, SQL editor modal. Header shows feed window, model id, cumulative tokens.
- Model calls use the OpenAI **Responses API** via `@ai-sdk/openai` `.responses(model)` for every model on Parley. Env: `OPENAI_BASE_URL`, `OPENAI_API_KEY`, `OPENAI_MODEL`, `OPENAI_REASONING_EFFORT` (`minimal|low|medium|high`, default `medium`), passed as `providerOptions.openai.reasoningEffort`. Parley's Chat Completions endpoint silently accepts any `reasoning_effort` and reports no reasoning tokens; the Responses endpoint honours it (measured 25 vs 52 reasoning tokens, low vs high).
- No Python, no CopilotKit, no database server, no persistence layer.
- Commits: small, `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` trailer on commits made by Claude.
- Basemap: CARTO dark-matter (free, no token). `@sqlrooms/deck` renders with MapLibre, so no Mapbox token is needed — the spec's "Mapbox" wording is superseded here.

---

## File structure

| Path | Responsibility |
|---|---|
| `package.json`, `tsconfig.json`, `next.config.ts`, `postcss.config.mjs` | project config (from sqlrooms `ai-nextjs` example) |
| `scripts/prepare-gtfs.ts` | `data/gtfs/*.txt` → `public/gtfs/*.parquet` (+ `shape_lines`) with Node DuckDB; self-checks |
| `public/gtfs/*.parquet` | committed data (≈10 MB) |
| `src/lib/gtfs/feed.ts` | feed constants, table list, browser data-source config |
| `src/lib/agent/tool-schemas.ts` | zod schemas + descriptions for the 3 tools (shared by server, browser, eval) |
| `src/lib/agent/sql-guard.ts` (+ `.test.ts`) | `assertReadOnly`, `withLimit` |
| `src/lib/agent/instructions.ts` | the system prompt (persona, GTFS facts, definitions, tool rules, answer format, reference SQL) |
| `src/lib/agent/server-tools.ts` | the 3 tools without `execute`, for the server and eval |
| `src/app/api/chat/route.ts` | `POST` agent stream with usage metadata; `GET` model info |
| `src/app/store.ts` | room store: room-shell (parquet data sources, layout), sql-editor, ai-settings, ai (tools + renderers), app slice |
| `src/lib/app-slice.ts` | map layers, SQL-editor-open flag, token usage |
| `src/lib/map/map-layer-tool.ts` | browser `map_layer` tool: validates columns via DuckDB, adds a layer |
| `src/components/{app-shell-client,room,Header,ChatPanel,MapPanel,QueryResultWithEditor,MapLayerToolResult}.tsx` | UI |
| `src/app/{layout,page}.tsx`, `src/globals.css` | Next shell |
| `eval/questions.json`, `eval/run.ts` | six demo questions with reference SQL + expected numbers; `--data-only` and agent modes |
| `Dockerfile`, `docker-compose.yml`, `.github/workflows/ci.yml` | deploy + CI |
| `README.md`, `ASSUMPTIONS.md` | drafted in the last task; `AI-USE.md` is written by the author |

---

### Task 1: Scaffold the Next.js app

**Files:**
- Create: `package.json`, `tsconfig.json`, `next.config.ts`, `postcss.config.mjs`, `src/app/layout.tsx`, `src/app/page.tsx`, `src/globals.css`, `src/components/app-shell-client.tsx`, `src/components/room.tsx`
- Modify: `.gitignore` (add `next-env.d.ts` and `*.tsbuildinfo`; `.next/` and `node_modules/` are already listed)

**Interfaces:**
- Produces: `src/components/room.tsx` default export `Room` (placeholder until Task 3); `@/` alias → `src/`.

- [ ] **Step 1: Write package.json**

```json
{
  "name": "mbta-gtfs-agent",
  "private": true,
  "type": "module",
  "engines": {"node": ">=22"},
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "test": "node --import tsx --test src/**/*.test.ts",
    "prepare-gtfs": "node --import tsx scripts/prepare-gtfs.ts",
    "eval": "node --env-file-if-exists=.env --import tsx eval/run.ts"
  },
  "dependencies": {
    "@ai-sdk/openai": "^3.0.112",
    "@sqlrooms/ai": "0.29.0",
    "@sqlrooms/ai-core": "0.29.0",
    "@sqlrooms/ai-settings": "0.29.0",
    "@sqlrooms/deck": "0.29.0",
    "@sqlrooms/duckdb": "0.29.0",
    "@sqlrooms/room-shell": "0.29.0",
    "@sqlrooms/sql-editor": "0.29.0",
    "@sqlrooms/ui": "0.29.0",
    "@sqlrooms/vega": "0.29.0",
    "ai": "^6.0.177",
    "lucide-react": "^0.555.0",
    "next": "^16.1.6",
    "react": "^19.2.0",
    "react-dom": "^19.2.0",
    "zod": "^4.1.8"
  },
  "devDependencies": {
    "@duckdb/node-api": "^1.5.5-r.4",
    "@tailwindcss/postcss": "^4.1.13",
    "@types/node": "^22.0.0",
    "@types/react": "^19.1.13",
    "@types/react-dom": "^19.1.9",
    "postcss": "^8.5.6",
    "tailwindcss": "^4.1.13",
    "tsx": "^4.20.0",
    "tw-animate-css": "^1.3.8",
    "typescript": "5.9.2"
  },
  "pnpm": {"overrides": {"@duckdb/duckdb-wasm": "1.32.0"}}
}
```

(The `@duckdb/duckdb-wasm` override mirrors sqlrooms' own `ai` example.)

- [ ] **Step 2: Write tsconfig.json, next.config.ts, postcss.config.mjs**

`tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": true,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "react-jsx",
    "incremental": true,
    "plugins": [{"name": "next"}],
    "paths": {"@/*": ["./src/*"]}
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

`next.config.ts`:
```ts
import type {NextConfig} from 'next';

const nextConfig: NextConfig = {
  output: 'standalone', // Docker copies .next/standalone (Task 11)
};

export default nextConfig;
```

`postcss.config.mjs`:
```js
const config = {plugins: {'@tailwindcss/postcss': {}}};
export default config;
```

- [ ] **Step 3: Write globals.css**

Copy the sqlrooms `ai-nextjs` example's `globals.css` verbatim (Tailwind 4 + `@sqlrooms/ui/tailwind-preset.css` + the `:root` / `.dark` oklch token blocks + `@theme inline` + `@layer base`). Replace the three `@source` lines with:

```css
@source './**/*.{ts,tsx}';
@source '../node_modules/@sqlrooms/*/dist/';
```

and append:

```css
html, body { height: 100%; }
```

- [ ] **Step 4: Write layout, page, app-shell-client, placeholder room**

`src/app/layout.tsx`:
```tsx
import type {Metadata} from 'next';
import '../globals.css';

export const metadata: Metadata = {
  title: 'MBTA GTFS Agent',
  description: 'Ask the MBTA schedule questions in plain English. Every answer shows its SQL.',
};

export default function RootLayout({children}: {children: React.ReactNode}) {
  return (
    <html lang="en" className="dark">
      <body className="antialiased">{children}</body>
    </html>
  );
}
```

`src/app/page.tsx`:
```tsx
import AppShellClient from '@/components/app-shell-client';

export default function Home() {
  return <AppShellClient />;
}
```

`src/components/app-shell-client.tsx`:
```tsx
'use client';

import dynamic from 'next/dynamic';

// DuckDB-WASM and deck.gl are browser-only: never render the room on the server.
const Room = dynamic(() => import('@/components/room'), {ssr: false});

export default function AppShellClient() {
  return <Room />;
}
```

`src/components/room.tsx` (placeholder, replaced in Task 3):
```tsx
'use client';

export default function Room() {
  return <div className="p-4">room placeholder</div>;
}
```

- [ ] **Step 5: Install and run**

Run: `pnpm install && pnpm dev`
Expected: `http://localhost:3000` shows "room placeholder" on a dark background, no console errors.

- [ ] **Step 6: Commit**

```bash
git add package.json pnpm-lock.yaml tsconfig.json next.config.ts postcss.config.mjs src .gitignore
git commit -m "Scaffold Next.js app from the sqlrooms ai-nextjs example"
```

---

### Task 2: GTFS → parquet pipeline

**Files:**
- Create: `scripts/prepare-gtfs.ts`, `src/lib/gtfs/feed.ts`
- Produces: `public/gtfs/{agency,routes,trips,stop_times,stops,calendar,calendar_dates,route_patterns,directions,shape_lines}.parquet`

**Interfaces:**
- Produces: `FEED` constants; `GTFS_TABLES` readonly tuple; `gtfsDataSources(origin: string)` → sqlrooms `dataSources` array.

- [ ] **Step 1: Write feed.ts**

```ts
export const FEED = {
  agency: 'MBTA',
  version: 'Fall 2026, version D',
  start: '2026-09-04',
  end: '2026-12-12',
  source: 'https://cdn.mbta.com/MBTA_GTFS.zip',
  downloaded: '2026-09-12',
} as const;

/** Tables loaded into the browser. `shapes` is folded into `shape_lines` (one LineString per shape_id). */
export const GTFS_TABLES = [
  'agency',
  'routes',
  'trips',
  'stop_times',
  'stops',
  'calendar',
  'calendar_dates',
  'route_patterns',
  'directions',
  'feed_info',
  'shape_lines',
] as const;

export type GtfsTable = (typeof GTFS_TABLES)[number];

/** sqlrooms data-source config. DuckDB-WASM needs absolute URLs, so pass `window.location.origin`. */
export function gtfsDataSources(origin: string) {
  return GTFS_TABLES.map((tableName) => ({
    type: 'url' as const,
    tableName,
    url: `${origin}/gtfs/${tableName}.parquet`,
    loadOptions: {method: 'read_parquet' as const},
  }));
}
```

- [ ] **Step 2: Write scripts/prepare-gtfs.ts**

```ts
import {DuckDBInstance} from '@duckdb/node-api';
import {mkdirSync} from 'node:fs';

const SRC = 'data/gtfs';
const OUT = 'public/gtfs';
// Raw GTFS files exported 1:1. `shapes` is read but only exported as `shape_lines`.
const RAW = ['agency', 'routes', 'trips', 'stop_times', 'stops', 'calendar', 'calendar_dates', 'route_patterns', 'directions', 'feed_info'];

const instance = await DuckDBInstance.create(':memory:');
const db = await instance.connect();
await db.run('INSTALL spatial; LOAD spatial;');
mkdirSync(OUT, {recursive: true});

for (const t of [...RAW, 'shapes']) {
  // all_varchar: GTFS times exceed 24:00 and ids are strings. quote: trips.txt has quoted commas.
  await db.run(`CREATE TABLE ${t} AS SELECT * FROM read_csv('${SRC}/${t}.txt', all_varchar=true, quote='"')`);
}
for (const t of RAW) {
  await db.run(`COPY ${t} TO '${OUT}/${t}.parquet' (FORMAT parquet, COMPRESSION zstd)`);
}
await db.run(`
  CREATE TABLE shape_lines AS
  SELECT shape_id,
         ST_AsWKB(ST_MakeLine(list(ST_Point(shape_pt_lon::double, shape_pt_lat::double) ORDER BY shape_pt_sequence::int))) AS geom
  FROM shapes GROUP BY shape_id`);
await db.run(`COPY shape_lines TO '${OUT}/shape_lines.parquet' (FORMAT parquet, COMPRESSION zstd)`);

// Self-check: fail loudly if the feed is not what the app assumes.
const check = await db.runAndReadAll(`
  SELECT (SELECT count(*) FROM stop_times) AS stop_times,
         (SELECT count(*) FROM shape_lines) AS shape_lines,
         (SELECT count(DISTINCT ST_GeometryType(ST_GeomFromWKB(geom))) FROM shape_lines) AS geom_types,
         (SELECT feed_version FROM feed_info) AS feed_version`);
const [row] = check.getRowObjectsJson() as Array<Record<string, unknown>>;
console.log(row);
if (Number(row.stop_times) < 1_000_000) throw new Error(`stop_times too small: ${row.stop_times}`);
if (Number(row.geom_types) !== 1) throw new Error('shape_lines must be LINESTRING only');
```

- [ ] **Step 3: Run it**

Run: `pnpm prepare-gtfs && ls -lh public/gtfs`
Expected: prints `{ stop_times: 3882388, shape_lines: 1565, geom_types: 1, feed_version: 'Fall 2026, 2026-09-11T20:42:05+00:00, version D' }`; 11 parquet files, `stop_times.parquet` ≈ 6.5 MB, `shape_lines.parquet` ≈ 2.3 MB, total ≈ 10 MB.

- [ ] **Step 4: Commit (parquet included on purpose — see ASSUMPTIONS)**

```bash
git add scripts/prepare-gtfs.ts src/lib/gtfs/feed.ts public/gtfs
git commit -m "Add GTFS→parquet pipeline and commit the pinned Fall 2026 feed"
```

---

### Task 3: Room store with DuckDB data sources, layout, SQL editor

**Files:**
- Create: `src/app/store.ts`, `src/lib/app-slice.ts`, `src/components/ChatPanel.tsx` (placeholder), `src/components/MapPanel.tsx` (placeholder)
- Modify: `src/components/room.tsx`

**Interfaces:**
- Produces: `roomStore`, `useRoomStore`, `RoomState`; `AppSliceState` with `app.layers/addLayer/clearLayers/sqlEditorOpen/setSqlEditorOpen/usage/setUsage`; panel ids `'chat' | 'map'`.

- [ ] **Step 1: Write app-slice.ts**

```ts
import type {StateCreator} from 'zustand';

export type MapLayer = {id: string; kind: 'stops' | 'routes'; title: string; sql: string};
export type TokenUsage = {inputTokens: number; outputTokens: number};

export type AppSliceState = {
  app: {
    layers: MapLayer[];
    addLayer: (layer: MapLayer) => void;
    clearLayers: () => void;
    sqlEditorOpen: boolean;
    setSqlEditorOpen: (open: boolean) => void;
    usage: TokenUsage;
    setUsage: (usage: TokenUsage) => void;
  };
};

export const createAppSlice =
  (): StateCreator<AppSliceState, [], [], AppSliceState> => (set) => ({
    app: {
      layers: [],
      addLayer: (layer) => set((s) => ({app: {...s.app, layers: [...s.app.layers, layer]}})),
      clearLayers: () => set((s) => ({app: {...s.app, layers: []}})),
      sqlEditorOpen: false,
      setSqlEditorOpen: (open) => set((s) => ({app: {...s.app, sqlEditorOpen: open}})),
      usage: {inputTokens: 0, outputTokens: 0},
      setUsage: (usage) => set((s) => ({app: {...s.app, usage}})),
    },
  });
```
(`zustand` is a transitive dependency of `@sqlrooms/room-store`; if `import type from 'zustand'` fails to resolve, add `"zustand": "^5"` to dependencies.)

- [ ] **Step 2: Write store.ts (AI slice is added in Task 7; keep this compiling now)**

```ts
import {createWasmDuckDbConnector} from '@sqlrooms/duckdb';
import {createRoomShellSlice, createRoomStore, type LayoutConfig, type RoomShellSliceState} from '@sqlrooms/room-shell';
import {createSqlEditorSlice, type SqlEditorSliceState} from '@sqlrooms/sql-editor';
import {MapIcon, MessageSquareIcon} from 'lucide-react';
import {ChatPanel} from '@/components/ChatPanel';
import {MapPanel} from '@/components/MapPanel';
import {createAppSlice, type AppSliceState} from '@/lib/app-slice';
import {gtfsDataSources} from '@/lib/gtfs/feed';

export type RoomState = RoomShellSliceState & SqlEditorSliceState & AppSliceState;

const layout: LayoutConfig = {
  id: 'root',
  type: 'split',
  direction: 'row',
  children: [
    {type: 'panel', id: 'chat', panel: 'chat', defaultSize: '42%', minSize: '360px'},
    {type: 'panel', id: 'map', panel: 'map'},
  ],
};

export const {roomStore, useRoomStore} = createRoomStore<RoomState>((set, get, store) => ({
  ...createRoomShellSlice({
    connector: createWasmDuckDbConnector({
      // spatial: ST_Point / ST_AsWKB for the stops map layer (Task 8)
      initializationQuery: 'LOAD spatial;',
    }),
    config: {
      title: 'MBTA GTFS Agent',
      dataSources: gtfsDataSources(window.location.origin),
    },
    layout: {
      config: layout,
      panels: {
        chat: {title: 'Chat', icon: MessageSquareIcon, component: ChatPanel},
        map: {title: 'Map', icon: MapIcon, component: MapPanel},
      },
    },
  })(set, get, store),
  ...createSqlEditorSlice()(set, get, store),
  ...createAppSlice()(set, get, store),
}));
```

- [ ] **Step 3: Placeholder panels that prove the data loaded**

`src/components/ChatPanel.tsx`:
```tsx
'use client';

import {useRoomStore} from '@/app/store';

export function ChatPanel() {
  const tables = useRoomStore((s) => s.db.tables);
  return <div className="p-4 text-sm">tables loaded: {tables.length}</div>;
}
```

`src/components/MapPanel.tsx`:
```tsx
'use client';

export function MapPanel() {
  return <div className="h-full w-full bg-black/40" />;
}
```

- [ ] **Step 4: Replace room.tsx**

```tsx
'use client';

import {roomStore, useRoomStore} from '@/app/store';
import {RoomShell} from '@sqlrooms/room-shell';
import {SqlEditorModal} from '@sqlrooms/sql-editor';

export default function Room() {
  const open = useRoomStore((s) => s.app.sqlEditorOpen);
  const setOpen = useRoomStore((s) => s.app.setSqlEditorOpen);
  return (
    <RoomShell className="h-screen" roomStore={roomStore}>
      <RoomShell.LayoutComposer />
      <RoomShell.LoadingProgress />
      <SqlEditorModal isOpen={open} onClose={() => setOpen(false)} />
    </RoomShell>
  );
}
```
(`useRoomStore` outside `RoomShell` works because `createRoomStore` returns a hook bound to the singleton store, as in the examples' `MainView`.)

- [ ] **Step 5: Verify in the browser**

Run: `pnpm dev`, open `http://localhost:3000`.
Expected: loading progress runs, then left panel shows `tables loaded: 11`; DevTools Network shows 11 `/gtfs/*.parquet` fetches, no errors. If `LOAD spatial` fails in WASM, check the console for the extension URL error before changing anything.

- [ ] **Step 6: Commit**

```bash
git add src
git commit -m "Room store: load GTFS parquet into DuckDB-WASM, two-panel layout, SQL editor"
```

---

### Task 4: Tool schemas, SQL guard, server tool declarations

**Files:**
- Create: `src/lib/agent/tool-schemas.ts`, `src/lib/agent/sql-guard.ts`, `src/lib/agent/sql-guard.test.ts`, `src/lib/agent/server-tools.ts`

**Interfaces:**
- Produces: `QueryParams`, `ChartParams`, `MapLayerParams` (zod), `TOOL_DESCRIPTIONS`, `requiredMapColumns(kind)`; `assertReadOnly(sql): string`, `withLimit(sql, n=1000): string`; `serverTools(): ToolSet`.

- [ ] **Step 1: Write the failing test**

`src/lib/agent/sql-guard.test.ts`:
```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import {assertReadOnly, withLimit} from './sql-guard';

test('accepts SELECT and WITH, strips trailing semicolon', () => {
  assert.equal(assertReadOnly('SELECT 1;'), 'SELECT 1');
  assert.equal(assertReadOnly('  with a as (select 1) select * from a'), 'with a as (select 1) select * from a');
});

test('rejects non-SELECT and multiple statements', () => {
  assert.throws(() => assertReadOnly('DROP TABLE trips'), /Only SELECT/);
  assert.throws(() => assertReadOnly('SELECT 1; SELECT 2'), /One statement/);
});

test('withLimit appends LIMIT only when absent', () => {
  assert.equal(withLimit('SELECT * FROM routes'), 'SELECT * FROM (SELECT * FROM routes) AS __q LIMIT 1000');
  assert.equal(withLimit('SELECT * FROM routes LIMIT 5'), 'SELECT * FROM routes LIMIT 5');
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm test`
Expected: FAIL — cannot find module `./sql-guard`.

- [ ] **Step 3: Write sql-guard.ts**

```ts
/** Strip comments, require a single SELECT/WITH statement, drop the trailing semicolon. */
export function assertReadOnly(sql: string): string {
  const s = sql.replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '').trim().replace(/;\s*$/, '');
  if (!/^(select|with)\b/i.test(s)) throw new Error('Only SELECT / WITH queries are allowed');
  if (s.includes(';')) throw new Error('One statement at a time');
  return s;
}

/** Wrap in a LIMIT unless the query already ends with one. Keeps result tables bounded. */
export function withLimit(sql: string, n = 1000): string {
  const s = assertReadOnly(sql);
  return /\blimit\s+\d+\s*$/i.test(s) ? s : `SELECT * FROM (${s}) AS __q LIMIT ${n}`;
}
```
(ponytail: a prefix check, not a parser. The browser `query` tool additionally goes through sqlrooms' DuckDB-parsed `readOnly` check; DuckDB-WASM is a sandbox anyway.)

- [ ] **Step 4: Run tests**

Run: `pnpm test`
Expected: 3 passing.

- [ ] **Step 5: Write tool-schemas.ts**

```ts
import {z} from 'zod';

// ponytail: these mirror @sqlrooms/ai `QueryToolParameters` and @sqlrooms/vega
// `VegaChartToolParameters` so the server route and eval runner never import
// React-heavy packages. Keep field names identical — the browser executes these.

export const QueryParams = z.object({
  type: z.literal('query'),
  sqlQuery: z.string().describe('One DuckDB SELECT statement.'),
  reasoning: z.string().describe('One sentence: what this query computes and why.'),
});

export const ChartParams = z.object({
  sqlQuery: z.string().describe('SELECT producing the chart data. Omit data from the spec.'),
  vegaLiteSpec: z.string().describe('Vega-Lite spec as a JSON string, no "data" property.'),
  reasoning: z.string(),
});

export const MapLayerParams = z.object({
  sqlQuery: z.string().describe('SELECT with the columns required by `kind` (see description).'),
  kind: z.enum(['stops', 'routes']),
  title: z.string().describe('Legend title, e.g. "AM peak median headway (min)".'),
  reasoning: z.string(),
});

export function requiredMapColumns(kind: 'stops' | 'routes'): string[] {
  return kind === 'stops' ? ['lat', 'lon', 'label', 'value'] : ['shape_id', 'label', 'value'];
}

export const TOOL_DESCRIPTIONS = {
  query: `Run one DuckDB SELECT against the GTFS tables and show the result table to the user with the SQL attached.
Set "type" to "query". Only one statement per call. The first 100 rows are returned to you; the user sees up to 1000.
If a query fails, fix it rather than re-running the same text. Never modify data.`,
  chart: `Draw a Vega-Lite chart from a SELECT. Use for results with a time or ordinal axis (hour of day, period, date).
Omit "data" from the spec and put the SELECT in sqlQuery; set "width": "container"; give axes clear titles.`,
  map_layer: `Add a layer to the map from a SELECT. Use when the answer has a spatial dimension (which routes, which stops).
kind="stops": the SELECT must return lat, lon, label, value.
kind="routes": the SELECT must return shape_id, label, value (get shape_id via route_patterns.representative_trip_id → trips.shape_id, typicality 1 only).
"value" is numeric and drives the colour scale (higher = worse, e.g. headway in minutes). Missing columns return an error — fix the SELECT and call again.`,
} as const;
```

- [ ] **Step 6: Write server-tools.ts**

```ts
import {tool, type ToolSet} from 'ai';
import {ChartParams, MapLayerParams, QueryParams, TOOL_DESCRIPTIONS} from './tool-schemas';

/** Tool declarations without `execute`: the browser runs them and posts results back. */
export function serverTools(): ToolSet {
  return {
    query: tool({description: TOOL_DESCRIPTIONS.query, inputSchema: QueryParams}),
    chart: tool({description: TOOL_DESCRIPTIONS.chart, inputSchema: ChartParams}),
    map_layer: tool({description: TOOL_DESCRIPTIONS.map_layer, inputSchema: MapLayerParams}),
  };
}
```

- [ ] **Step 7: Commit**

```bash
git add src/lib/agent
git commit -m "Agent tool schemas, SQL guard with tests, server-side tool declarations"
```

---

### Task 5: Eval questions with reference SQL, data-only eval runner

**Files:**
- Create: `eval/questions.json`, `eval/run.ts`

**Interfaces:**
- Produces: `questions.json` entries `{id, prompt, referenceSql?, expect: (string|number)[], tools: string[]}`; `pnpm eval --data-only` exits 0 when every reference SQL result contains every `expect` value.

- [ ] **Step 1: Write questions.json with reference SQL (expected values filled in Step 3)**

```json
[
  {
    "id": "q1-headway-route1",
    "prompt": "What is the scheduled headway on Route 1 by hour on a weekday?",
    "tools": ["query", "chart"],
    "referenceSql": "WITH active AS (SELECT service_id FROM calendar WHERE wednesday='1' AND '20260916' BETWEEN start_date AND end_date UNION SELECT service_id FROM calendar_dates WHERE date='20260916' AND exception_type='1' EXCEPT SELECT service_id FROM calendar_dates WHERE date='20260916' AND exception_type='2'), typical AS (SELECT t.trip_id FROM trips t JOIN active USING (service_id) JOIN route_patterns rp ON rp.route_pattern_id = t.route_pattern_id AND rp.route_pattern_typicality='1' WHERE t.route_id='1' AND t.direction_id='0'), ref_stop AS (SELECT st.stop_id FROM stop_times st JOIN typical USING (trip_id) GROUP BY st.stop_id HAVING count(*) = (SELECT count(*) FROM typical) ORDER BY min(st.stop_sequence::int) LIMIT 1), dep AS (SELECT split_part(st.departure_time, ':', 1)::int*60 + split_part(st.departure_time, ':', 2)::int AS mins FROM stop_times st JOIN typical USING (trip_id) WHERE st.stop_id = (SELECT stop_id FROM ref_stop)), gaps AS (SELECT mins, mins - lag(mins) OVER (ORDER BY mins) AS headway FROM dep) SELECT mins // 60 AS hour, count(*) AS trips, median(headway) AS median_headway_min FROM gaps WHERE headway IS NOT NULL GROUP BY 1 ORDER BY 1",
    "expect": []
  },
  {
    "id": "q2-frequent-am-peak",
    "prompt": "Which bus routes run every 10 minutes or better during the AM peak (7–9 AM) on a weekday?",
    "tools": ["query", "map_layer"],
    "referenceSql": "WITH active AS (SELECT service_id FROM calendar WHERE wednesday='1' AND '20260916' BETWEEN start_date AND end_date UNION SELECT service_id FROM calendar_dates WHERE date='20260916' AND exception_type='1' EXCEPT SELECT service_id FROM calendar_dates WHERE date='20260916' AND exception_type='2'), typical AS (SELECT t.trip_id, t.route_id, t.direction_id FROM trips t JOIN active USING (service_id) JOIN route_patterns rp ON rp.route_pattern_id = t.route_pattern_id AND rp.route_pattern_typicality='1' JOIN routes r USING (route_id) WHERE r.route_type='3'), n AS (SELECT route_id, direction_id, count(*) AS n FROM typical GROUP BY 1,2), ref_stop AS (SELECT st.stop_id, ty.route_id, ty.direction_id FROM stop_times st JOIN typical ty USING (trip_id) JOIN n USING (route_id, direction_id) GROUP BY st.stop_id, ty.route_id, ty.direction_id, n.n HAVING count(*) = n.n QUALIFY row_number() OVER (PARTITION BY ty.route_id, ty.direction_id ORDER BY min(st.stop_sequence::int)) = 1), dep AS (SELECT ty.route_id, ty.direction_id, split_part(st.departure_time, ':', 1)::int*60 + split_part(st.departure_time, ':', 2)::int AS mins FROM stop_times st JOIN typical ty USING (trip_id) JOIN ref_stop rs ON rs.stop_id = st.stop_id AND rs.route_id = ty.route_id AND rs.direction_id = ty.direction_id), gaps AS (SELECT route_id, direction_id, mins, mins - lag(mins) OVER (PARTITION BY route_id, direction_id ORDER BY mins) AS headway FROM dep), peak AS (SELECT route_id, direction_id, median(headway) AS med FROM gaps WHERE headway IS NOT NULL AND mins BETWEEN 7*60 AND 9*60 GROUP BY 1,2) SELECT route_id, max(med) AS worst_direction_median_min FROM peak GROUP BY 1 HAVING max(med) <= 10 ORDER BY 2, 1",
    "expect": []
  },
  {
    "id": "q3-harvard-routes",
    "prompt": "Which routes serve Harvard, and what are the first and last departures on a weekday?",
    "tools": ["query", "map_layer"],
    "referenceSql": "WITH active AS (SELECT service_id FROM calendar WHERE wednesday='1' AND '20260916' BETWEEN start_date AND end_date UNION SELECT service_id FROM calendar_dates WHERE date='20260916' AND exception_type='1' EXCEPT SELECT service_id FROM calendar_dates WHERE date='20260916' AND exception_type='2'), harvard AS (SELECT stop_id FROM stops WHERE parent_station='place-harsq' OR stop_id='place-harsq' OR stop_name ILIKE 'Harvard%') SELECT r.route_short_name, r.route_long_name, min(st.departure_time) AS first_departure, max(st.departure_time) AS last_departure, count(DISTINCT st.trip_id) AS trips FROM stop_times st JOIN harvard USING (stop_id) JOIN trips t USING (trip_id) JOIN active USING (service_id) JOIN routes r USING (route_id) GROUP BY 1,2 ORDER BY trips DESC",
    "expect": []
  },
  {
    "id": "q4-compare-1-66",
    "prompt": "Compare Route 1 and Route 66: weekday AM peak vs. Saturday AM peak median headway.",
    "tools": ["query"],
    "referenceSql": "WITH days AS (SELECT 'Weekday' AS day, '20260916' AS d, 'wednesday' AS col UNION ALL SELECT 'Saturday', '20260919', 'saturday'), active AS (SELECT d.day, c.service_id FROM days d JOIN calendar c ON (CASE d.col WHEN 'wednesday' THEN c.wednesday ELSE c.saturday END)='1' AND d.d BETWEEN c.start_date AND c.end_date UNION SELECT d.day, cd.service_id FROM days d JOIN calendar_dates cd ON cd.date=d.d AND cd.exception_type='1' EXCEPT SELECT d.day, cd.service_id FROM days d JOIN calendar_dates cd ON cd.date=d.d AND cd.exception_type='2'), typical AS (SELECT a.day, t.trip_id, t.route_id, t.direction_id FROM trips t JOIN active a USING (service_id) JOIN route_patterns rp ON rp.route_pattern_id=t.route_pattern_id AND rp.route_pattern_typicality='1' WHERE t.route_id IN ('1','66') AND t.direction_id='0'), n AS (SELECT day, route_id, count(*) AS n FROM typical GROUP BY 1,2), ref_stop AS (SELECT st.stop_id, ty.day, ty.route_id FROM stop_times st JOIN typical ty USING (trip_id) JOIN n USING (day, route_id) GROUP BY st.stop_id, ty.day, ty.route_id, n.n HAVING count(*)=n.n QUALIFY row_number() OVER (PARTITION BY ty.day, ty.route_id ORDER BY min(st.stop_sequence::int))=1), dep AS (SELECT ty.day, ty.route_id, split_part(st.departure_time, ':', 1)::int*60 + split_part(st.departure_time, ':', 2)::int AS mins FROM stop_times st JOIN typical ty USING (trip_id) JOIN ref_stop rs ON rs.stop_id=st.stop_id AND rs.day=ty.day AND rs.route_id=ty.route_id), gaps AS (SELECT day, route_id, mins, mins - lag(mins) OVER (PARTITION BY day, route_id ORDER BY mins) AS headway FROM dep) SELECT route_id, day, median(headway) AS am_peak_median_min, count(*) AS trips FROM gaps WHERE headway IS NOT NULL AND mins BETWEEN 7*60 AND 9*60 GROUP BY 1,2 ORDER BY 1,2",
    "expect": []
  },
  {
    "id": "q6-realtime-refusal",
    "prompt": "Is Route 1 running on time right now?",
    "tools": [],
    "expect": ["schedule"]
  }
]
```
(Q5 is a UI action, not a prompt, so it has no entry. Q6 expects the answer to mention that only the *schedule* is available.)

- [ ] **Step 2: Write eval/run.ts (data-only mode; agent mode added in Task 10)**

```ts
import {DuckDBInstance} from '@duckdb/node-api';
import {readFileSync} from 'node:fs';
import {GTFS_TABLES} from '../src/lib/gtfs/feed';

type Question = {id: string; prompt: string; tools: string[]; referenceSql?: string; expect: Array<string | number>};
const questions = JSON.parse(readFileSync(new URL('./questions.json', import.meta.url), 'utf8')) as Question[];

export async function openGtfs() {
  const db = await (await DuckDBInstance.create(':memory:')).connect();
  for (const t of GTFS_TABLES) await db.run(`CREATE VIEW ${t} AS SELECT * FROM read_parquet('public/gtfs/${t}.parquet')`);
  return db;
}

const containsAll = (text: string, expect: Array<string | number>) =>
  expect.filter((e) => !text.toLowerCase().includes(String(e).toLowerCase()));

const db = await openGtfs();
let failed = 0;
console.log('== data check (reference SQL) ==');
for (const q of questions) {
  if (!q.referenceSql) continue;
  const rows = (await db.runAndReadAll(q.referenceSql)).getRowObjectsJson();
  const missing = containsAll(JSON.stringify(rows), q.expect);
  console.log(`${missing.length ? 'FAIL' : 'ok  '} ${q.id} rows=${rows.length}${missing.length ? ' missing=' + missing.join(',') : ''}`);
  if (process.argv.includes('--show')) console.table(rows);
  if (missing.length) failed++;
}
if (process.argv.includes('--data-only')) process.exit(failed ? 1 : 0);
// agent mode: Task 10
process.exit(failed ? 1 : 0);
```

- [ ] **Step 3: Run with `--show`, then record expected numbers**

Run: `pnpm eval --data-only --show`
Expected: all four reference queries run without error and print tables. Sanity: Q1 hour 7 → median 8; Q4 Route 1 Weekday ≈ 8; Q2 lists Route 1, 66, 111 among others; Q3 lists Route 1, 66, 71, 73, 77, 86, 96, Red among others.

Then fill `expect` for each question with 2–3 values read from the output, e.g. for Q1 `["8"]` is too weak — use the hour-7 and hour-8 medians formatted as they print (e.g. `[8, 10]`); for Q2 route ids that appear (e.g. `["1", "66", "111"]`); for Q3 `["1", "66", "Red"]`; for Q4 the four medians. Re-run `pnpm eval --data-only` → all `ok`.

- [ ] **Step 4: Commit**

```bash
git add eval
git commit -m "Eval: six demo questions with reference SQL and a data-only runner"
```

---

### Task 6: System prompt

**Files:**
- Create: `src/lib/agent/instructions.ts`

**Interfaces:**
- Produces: `INSTRUCTIONS: string` (static; the GTFS schema is fixed so no store access is needed).

- [ ] **Step 1: Write instructions.ts**

```ts
import {FEED} from '@/lib/gtfs/feed';
import q from '../../../eval/questions.json' with {type: 'json'};

const REFERENCE_HEADWAY_SQL = (q as Array<{id: string; referenceSql?: string}>).find((x) => x.id === 'q1-headway-route1')!.referenceSql!;

export const INSTRUCTIONS = `
You are the MBTA GTFS Agent, an assistant for MBTA service planners. You answer questions about
SCHEDULED service using the agency's static GTFS feed (${FEED.version}, valid ${FEED.start} to ${FEED.end}),
loaded as DuckDB tables. You cannot see real-time or historical actual operations. If a question needs
vehicle positions, delays, on-time performance or ridership, say so plainly, explain that only the
schedule is available, and offer the closest scheduled-service answer instead.

## Tables (all columns are VARCHAR; cast in SQL)
- routes(route_id, route_short_name, route_long_name, route_type, route_color, route_desc). route_type: 0 light rail (Green, Mattapan), 1 subway (Red, Orange, Blue), 2 commuter rail, 3 bus, 4 ferry.
- trips(trip_id, route_id, service_id, direction_id, trip_headsign, shape_id, route_pattern_id)
- stop_times(trip_id, stop_id, stop_sequence, arrival_time, departure_time, timepoint) — 3.9M rows
- stops(stop_id, stop_name, location_type, parent_station, stop_lat, stop_lon, platform_name). location_type: 0 stop/platform, 1 parent station, 2 entrance, 3 node.
- calendar(service_id, monday..sunday as '0'/'1', start_date, end_date as YYYYMMDD)
- calendar_dates(service_id, date, exception_type) — 1 = added, 2 = removed
- route_patterns(route_pattern_id, route_id, direction_id, route_pattern_name, route_pattern_typicality, representative_trip_id)
- directions(route_id, direction_id, direction, direction_destination) — e.g. Route 1 direction 0 = Outbound to Harvard Square
- shape_lines(shape_id, geom) — one LineString per shape, for maps
- agency, feed_info

## GTFS facts you must apply
- Service on a date D (YYYYMMDD string) = calendar rows whose weekday flag is '1' and D BETWEEN start_date AND end_date, UNION calendar_dates with exception_type '1' on D, EXCEPT calendar_dates with exception_type '2' on D. MBTA uses many short-lived service_ids; never skip this step.
- Times are strings and can exceed 24:00:00 (a 25:10:00 departure is 1:10 AM of the same service day). Convert with split_part(t, ':', 1)::int*60 + split_part(t, ':', 2)::int. Never cast to TIME.
- route_pattern_typicality: '1' typical (branched routes like Red Line have one per branch), '2' deviation, '3' highly atypical (short-turns, a few trips a day), '4' diversion (detours, shuttles), '5' canonical reference pattern that is NOT scheduled. For headway and frequency questions use only trips whose pattern has typicality '1'.
- A station name can map to a parent station (location_type '1', e.g. place-harsq "Harvard"), its child platforms, and nearby street bus stops that have NO parent. "Routes serving X" must union: stops with parent_station = the parent id, the parent id itself, and stops whose stop_name starts with the station name. Say in the answer that you merged them.

## Definitions
- Headway for a route + direction + service date: keep typicality-1 trips; reference stop = the first stop that every kept trip serves (the origin for unbranched routes; the shared trunk stop, e.g. Alewife, for branched ones); sort departures at that stop; headway = gap between consecutive departures; report the MEDIAN gap per period plus the trip count. Never report 60 / trips. Always state the reference stop and how many trips were excluded.
- Default periods: AM peak 07:00–09:00, midday 09:00–15:00, PM peak 15:00–18:30, evening 18:30–24:00, late night 24:00+ (GTFS notation). Use the user's periods if given.
- Service date: resolve what the user says ("weekday", "Saturday", "Labor Day", "next Friday", an explicit date) to one YYYYMMDD inside the feed window. "Weekday" with no date = the next Wednesday in the window. Today's date is not known to you; if the user gives none, use 20260916 (Wed), 20260919 (Sat) or 20260920 (Sun) and say so.

## Tools
- query: run one SELECT. Always run query first. You receive the first 100 rows; the user sees the table with the SQL.
- chart: when the result has a time/ordinal axis (hour, period, date). Reuse the query's SQL. Omit "data"; set "width": "container".
- map_layer: REQUIRED whenever the answer is a set of routes or stops ("which routes…", "which stops…", "routes serving X"): after the query succeeds, call map_layer before writing the answer. kind "stops" needs lat, lon, label, value; kind "routes" needs shape_id, label, value. Get shape_id from route_patterns (typicality '1') → representative_trip_id → trips.shape_id. value is numeric (e.g. headway minutes; higher = worse).
- Run tools one at a time. If a query fails with a SQL error (e.g. an ambiguous or missing column), read the message, fix the SQL and retry, at most 2 retries. If it still fails, stop, report the error, and suggest a fix.
- Never modify data. Keep result tables under 1000 rows (add LIMIT for long lists).

## Answer format (every answer)
1. Service date used (YYYYMMDD and weekday) and feed version.
2. The result in one or two paragraphs; the table/chart/map speaks for itself — do not paste raw rows.
3. Caveats: reference stop, excluded trips (typicality), merged stops, and that this is scheduled, not actual, service.
4. One line: "How I computed this: …".

## Reference SQL for headway by hour (Route 1, direction 0, 2026-09-16)
Adapt this pattern; do not invent a different method.
${REFERENCE_HEADWAY_SQL}
`.trim();
```
(Importing `eval/questions.json` keeps the reference SQL in one place. If the JSON import attribute fails under Next's bundler, copy the SQL string into this file with a comment pointing at `eval/questions.json`.)

- [ ] **Step 2: Type-check**

Run: `pnpm exec tsc --noEmit`
Expected: no errors (JSON import needs `resolveJsonModule`, already on).

- [ ] **Step 3: Commit**

```bash
git add src/lib/agent/instructions.ts
git commit -m "System prompt: persona, GTFS facts, headway/date definitions, tool rules, answer format"
```

---

### Task 7: `/api/chat` route against Parley

**Files:**
- Create: `src/app/api/chat/route.ts`
- Modify: `.env.example` (rename keys to match)

**Interfaces:**
- Produces: `POST /api/chat` (AI SDK UI message stream; assistant message `metadata.usage = {inputTokens, outputTokens, reasoningTokens}` cumulative for that message); `GET /api/chat` → `{model, baseUrl, reasoningEffort}`.
- Produces: `src/lib/agent/model.ts` → `modelConfig(overrides?)` and `createModel(cfg)` returning `{model, providerOptions}`, shared by the route and the eval runner.

- [ ] **Step 1: Align .env.example**

```
# MIT Parley — OpenAI-compatible (https://parley-docs.mit.edu/). Any OpenAI-compatible endpoint works.
OPENAI_BASE_URL=https://parley.api.mit.edu/v1
OPENAI_API_KEY=
# Model id as listed by GET $OPENAI_BASE_URL/models
OPENAI_MODEL=
# Responses API reasoning effort: minimal | low | medium | high
OPENAI_REASONING_EFFORT=medium
```
Remove the Mapbox line (no token needed). Copy the same keys into your local `.env` and fill them.

- [ ] **Step 2: Write model.ts (shared by route and eval)**

```ts
import {createOpenAI} from '@ai-sdk/openai';

export type ReasoningEffort = 'minimal' | 'low' | 'medium' | 'high';
const EFFORTS: ReasoningEffort[] = ['minimal', 'low', 'medium', 'high'];

export function modelConfig(overrides: {model?: string; reasoningEffort?: string} = {}) {
  const reasoningEffort = (overrides.reasoningEffort ?? process.env.OPENAI_REASONING_EFFORT ?? 'medium') as ReasoningEffort;
  if (!EFFORTS.includes(reasoningEffort)) throw new Error(`OPENAI_REASONING_EFFORT must be one of ${EFFORTS.join(', ')}`);
  return {
    baseURL: process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1',
    apiKey: process.env.OPENAI_API_KEY ?? '',
    model: overrides.model ?? process.env.OPENAI_MODEL ?? '',
    reasoningEffort,
  };
}

/** Responses API model plus the providerOptions that carry reasoning effort. */
export function createModel(cfg: ReturnType<typeof modelConfig>) {
  const provider = createOpenAI({baseURL: cfg.baseURL, apiKey: cfg.apiKey});
  return {model: provider.responses(cfg.model), providerOptions: {openai: {reasoningEffort: cfg.reasoningEffort}}};
}
```
(Check `node_modules/@ai-sdk/openai/dist/index.d.ts` for the exact `providerOptions.openai` keys if types complain.)

- [ ] **Step 3: Write route.ts**

```ts
import {createAgentUIStreamResponse, stepCountIs, ToolLoopAgent} from 'ai';
import {INSTRUCTIONS} from '@/lib/agent/instructions';
import {createModel, modelConfig} from '@/lib/agent/model';
import {serverTools} from '@/lib/agent/server-tools';

// Vercel Hobby caps function duration; a multi-step answer can take a minute.
export const maxDuration = 120;

export function GET() {
  const {baseURL, model, reasoningEffort} = modelConfig();
  return Response.json({model, baseUrl: baseURL, reasoningEffort});
}

export async function POST(req: Request) {
  const {messages} = await req.json();
  const cfg = modelConfig();
  if (!cfg.apiKey || !cfg.model) return new Response('OPENAI_API_KEY / OPENAI_MODEL not set', {status: 500});
  const {model, providerOptions} = createModel(cfg);

  const agent = new ToolLoopAgent({
    model,
    providerOptions,
    instructions: INSTRUCTIONS, // server-controlled: the client cannot override the prompt
    tools: serverTools(),
    stopWhen: stepCountIs(8),
  });

  // Cumulative usage for this assistant message, attached as metadata on every step.
  const total = {inputTokens: 0, outputTokens: 0, reasoningTokens: 0};
  return createAgentUIStreamResponse({
    agent,
    uiMessages: messages,
    abortSignal: req.signal,
    messageMetadata: ({part}) => {
      if (part.type !== 'finish-step') return undefined;
      total.inputTokens += part.usage.inputTokens ?? 0;
      total.outputTokens += part.usage.outputTokens ?? 0;
      total.reasoningTokens += part.usage.reasoningTokens ?? 0;
      return {usage: {...total}};
    },
  });
}
```
(No `temperature`: reasoning models on the Responses API reject it. If `ToolLoopAgent` does not take `providerOptions` in its constructor in the installed `ai`, pass it per call per `node_modules/ai/dist/index.d.ts`.)

- [ ] **Step 4: Verify against Parley from the terminal**

Run (with `.env` filled):
```bash
curl -s "$OPENAI_BASE_URL/models" -H "Authorization: Bearer $OPENAI_API_KEY" | head -c 600
```
Expected: JSON model list; pick one into `OPENAI_MODEL`.

Then with `pnpm dev` running:
```bash
curl -s http://localhost:3000/api/chat && echo && curl -sN http://localhost:3000/api/chat -H 'content-type: application/json' \
  -d '{"messages":[{"id":"1","role":"user","parts":[{"type":"text","text":"Which tables do you have? One line."}]}]}' | head -c 1500
```
Expected: GET prints `{"model":"…","baseUrl":"https://parley.api.mit.edu/v1","reasoningEffort":"…"}`; POST streams SSE lines including `"type":"text-delta"` and message metadata with `usage` including `reasoningTokens`. Run the POST at `OPENAI_REASONING_EFFORT=low` and `=high` (restart the dev server between) on a question that needs thought; `reasoningTokens` must differ.

Also test reachability from outside MIT's network once (phone hotspot): same `curl $OPENAI_BASE_URL/models`. Record the result for Task 11 (Vercel yes/no).

- [ ] **Step 5: Commit**

```bash
git add src/app/api/chat/route.ts src/lib/agent/model.ts package.json pnpm-lock.yaml .env.example
git commit -m "POST /api/chat: ToolLoopAgent on the Responses API with reasoning effort and usage metadata"
```

---

### Task 8: Wire the AI slice, chat panel, query + chart tools

**Files:**
- Modify: `src/app/store.ts`, `src/components/ChatPanel.tsx`
- Create: `src/components/QueryResultWithEditor.tsx`

**Interfaces:**
- Consumes: `withLimit`, `TOOL_DESCRIPTIONS`, `AppSliceState`.
- Produces: `RoomState` now includes `AiSliceState & AiSettingsSliceState`; tool names `query`, `chart` registered client-side with `remoteClientToolNames`.

- [ ] **Step 1: QueryResultWithEditor.tsx**

```tsx
'use client';

import {QueryToolResult, type QueryToolOutput, type QueryToolParameters} from '@sqlrooms/ai';
import type {ToolRendererProps} from '@sqlrooms/ai-core';
import {Button} from '@sqlrooms/ui';
import {TerminalIcon} from 'lucide-react';
import {useRoomStore} from '@/app/store';

/** sqlrooms' query renderer plus "Open in SQL editor" — the audit path (spec §7, Q5). */
export function QueryResultWithEditor(props: ToolRendererProps<QueryToolOutput, QueryToolParameters>) {
  const createQueryTab = useRoomStore((s) => s.sqlEditor.createQueryTab);
  const setOpen = useRoomStore((s) => s.app.setSqlEditorOpen);
  const sql = props.output?.sqlQuery;
  return (
    <div className="flex flex-col gap-1">
      <QueryToolResult {...props} />
      {sql && (
        <Button
          size="xs"
          variant="ghost"
          className="self-end"
          onClick={() => {
            createQueryTab(sql);
            setOpen(true);
          }}
        >
          <TerminalIcon className="mr-1 h-3 w-3" /> Open in SQL editor
        </Button>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Add the AI slices to store.ts**

Add imports:
```ts
import {createAiSlice, createDefaultAiTools, type AiSliceState} from '@sqlrooms/ai';
import {createAiSettingsSlice, type AiSettingsSliceState} from '@sqlrooms/ai-settings';
import {createSqlValidator, createVegaChartTool, VegaChartToolResult} from '@sqlrooms/vega';
import {QueryResultWithEditor} from '@/components/QueryResultWithEditor';
import {withLimit} from '@/lib/agent/sql-guard';
import {TOOL_DESCRIPTIONS} from '@/lib/agent/tool-schemas';
```
Extend the state type:
```ts
export type RoomState = RoomShellSliceState & SqlEditorSliceState & AppSliceState & AiSliceState & AiSettingsSliceState;
```
Inside the composer, after `createAppSlice()`:
```ts
  // The server picks the real model from env; this placeholder keeps the AI slice's
  // model-selection plumbing satisfied. Nothing here is sent to a provider.
  ...createAiSettingsSlice({
    config: {providers: {gateway: {baseUrl: '', apiKey: '', models: [{id: 'server', modelName: 'server-configured'}]}}},
  })(set, get, store),
  ...createAiSlice({
    chatEndPoint: '/api/chat',
    defaultProvider: 'gateway',
    defaultModel: 'server',
    remoteClientToolNames: ['query', 'chart', 'map_layer'],
    getInstructions: () => 'server-controlled', // ignored by /api/chat; see instructions.ts
    tools: (() => {
      const {query} = createDefaultAiTools(store, {
        query: {readOnly: true, numberOfRowsToShareWithLLM: 100},
        commands: false,
        tables: false,
      });
      return {
        // ponytail: wrap rather than re-implement — sqlrooms parses/validates the SELECT; we add the row cap.
        query: {
          ...query,
          execute: (params, options) => query.execute!({...params, sqlQuery: withLimit(params.sqlQuery)}, options),
        },
        chart: createVegaChartTool({
          description: TOOL_DESCRIPTIONS.chart,
          validateSql: createSqlValidator(() => store.getState().db.getConnector()),
        }),
        // map_layer added in Task 9
      };
    })(),
    toolRenderers: {
      query: QueryResultWithEditor,
      chart: VegaChartToolResult,
    },
    onChatFinish: ({messages}) => {
      // Each assistant message carries its own cumulative usage (route.ts); sum across the session.
      const usage = messages.reduce(
        (acc, m) => {
          const u = (m.metadata as {usage?: {inputTokens?: number; outputTokens?: number}} | undefined)?.usage;
          return {inputTokens: acc.inputTokens + (u?.inputTokens ?? 0), outputTokens: acc.outputTokens + (u?.outputTokens ?? 0)};
        },
        {inputTokens: 0, outputTokens: 0},
      );
      get().app.setUsage(usage);
    },
  })(set, get, store),
```
Until Task 9 lands, temporarily set `remoteClientToolNames: ['query', 'chart']` so the client does not claim a tool it lacks.

- [ ] **Step 3: ChatPanel.tsx**

```tsx
'use client';

import {Chat} from '@sqlrooms/ai';
import {SkeletonPane} from '@sqlrooms/ui';
import {useRoomStore} from '@/app/store';

const SUGGESTIONS = [
  'What is the scheduled headway on Route 1 by hour on a weekday?',
  'Which bus routes run every 10 minutes or better during the AM peak (7–9 AM) on a weekday?',
  'Which routes serve Harvard, and what are the first and last departures on a weekday?',
  'Compare Route 1 and Route 66: weekday AM peak vs. Saturday AM peak median headway.',
  'Is Route 1 running on time right now?',
];

export function ChatPanel() {
  const sessionId = useRoomStore((s) => s.ai.config.currentSessionId || null);
  const ready = useRoomStore((s) => s.room.initialized);
  return (
    <div className="flex h-full w-full flex-col gap-2 overflow-hidden p-3">
      <Chat>
        <Chat.Sessions className="w-full" />
        <div className="grow overflow-auto">
          {ready ? (
            <Chat.Messages key={sessionId} hoistedRenderers={['chart']} />
          ) : (
            <div className="flex h-full flex-col items-center justify-center">
              <SkeletonPane className="p-4" />
              <p className="text-muted-foreground mt-2 text-sm">Loading GTFS into DuckDB…</p>
            </div>
          )}
        </div>
        <Chat.PromptSuggestions>
          {SUGGESTIONS.map((text) => (
            <Chat.PromptSuggestions.Item key={text} text={text} />
          ))}
        </Chat.PromptSuggestions>
        <Chat.Composer placeholder="Ask about scheduled MBTA service…" />
      </Chat>
    </div>
  );
}
```

- [ ] **Step 4: Verify Q1 end to end in the browser**

Run: `pnpm dev`, open the app, click the first suggestion.
Expected: the agent calls `query` (SQL + table rendered, "Open in SQL editor" button present), then `chart` (line chart hoisted above the text), then answers with service date, caveats (reference stop "Nubian"/stop 64, excluded trips) and "How I computed this". Hour 7 median = 8. Click "Open in SQL editor" → modal opens with the SQL in a tab.

If the answer's numbers or method drift from the reference, fix the prompt (Task 6), not the UI.

- [ ] **Step 5: Commit**

```bash
git add src
git commit -m "Chat: AI slice on /api/chat with query (row-capped) and chart tools, prompt suggestions"
```

---

### Task 9: `map_layer` tool and the map panel

**Files:**
- Create: `src/lib/map/map-layer-tool.ts`, `src/components/MapLayerToolResult.tsx`
- Modify: `src/components/MapPanel.tsx`, `src/app/store.ts`

**Interfaces:**
- Consumes: `MapLayerParams`, `requiredMapColumns`, `assertReadOnly`, `app.addLayer`.
- Produces: tool output `{success: boolean; layerId?: string; rows?: number; details?: string; error?: string}`.

- [ ] **Step 1: map-layer-tool.ts**

```ts
import {arrowTableToJson, type DuckDbSliceState} from '@sqlrooms/duckdb';
import type {StoreApi} from '@sqlrooms/room-shell';
import {tool} from 'ai';
import {assertReadOnly} from '@/lib/agent/sql-guard';
import {MapLayerParams, requiredMapColumns, TOOL_DESCRIPTIONS} from '@/lib/agent/tool-schemas';
import type {AppSliceState} from '@/lib/app-slice';

export type MapLayerToolOutput = {success: boolean; layerId?: string; rows?: number; details?: string; error?: string};

export function createMapLayerTool(store: StoreApi<DuckDbSliceState & AppSliceState>) {
  return tool({
    description: TOOL_DESCRIPTIONS.map_layer,
    inputSchema: MapLayerParams,
    execute: async ({sqlQuery, kind, title}): Promise<MapLayerToolOutput> => {
      try {
        const sql = assertReadOnly(sqlQuery);
        const connector = await store.getState().db.getConnector();
        const probe = await connector.query(`SELECT * FROM (${sql}) AS q LIMIT 1`);
        const cols = probe.schema.fields.map((f) => f.name.toLowerCase());
        const missing = requiredMapColumns(kind).filter((c) => !cols.includes(c));
        if (missing.length) {
          return {success: false, error: `Missing columns for kind=${kind}: ${missing.join(', ')}. Required: ${requiredMapColumns(kind).join(', ')}.`};
        }
        const [{n}] = arrowTableToJson(await connector.query(`SELECT count(*)::int AS n FROM (${sql}) AS q`)) as Array<{n: number}>;
        const id = `${kind}-${Date.now()}`;
        store.getState().app.addLayer({id, kind, title, sql});
        return {success: true, layerId: id, rows: n, details: `Added ${kind} layer "${title}" (${n} rows) to the map.`};
      } catch (e) {
        return {success: false, error: e instanceof Error ? e.message : String(e)};
      }
    },
  });
}
```

- [ ] **Step 2: MapLayerToolResult.tsx**

```tsx
'use client';

import type {ToolRendererProps} from '@sqlrooms/ai-core';
import {MapIcon} from 'lucide-react';
import type {MapLayerToolOutput} from '@/lib/map/map-layer-tool';
import type {z} from 'zod';
import type {MapLayerParams} from '@/lib/agent/tool-schemas';

export function MapLayerToolResult({input, output}: ToolRendererProps<MapLayerToolOutput, z.infer<typeof MapLayerParams>>) {
  if (!output) return null;
  return (
    <div className={`rounded-md border p-2 text-xs ${output.success ? 'border-emerald-500/40' : 'border-red-500/40'}`}>
      <div className="flex items-center gap-1 font-medium">
        <MapIcon className="h-3 w-3" /> {output.success ? output.details : `Map layer failed: ${output.error}`}
      </div>
      {input?.sqlQuery && <pre className="text-muted-foreground mt-1 max-h-32 overflow-auto whitespace-pre-wrap">{input.sqlQuery}</pre>}
    </div>
  );
}
```

- [ ] **Step 3: Register in store.ts**

Add `map_layer: createMapLayerTool(store)` to the tools object, `map_layer: MapLayerToolResult` to `toolRenderers`, and set `remoteClientToolNames: ['query', 'chart', 'map_layer']`.

- [ ] **Step 4: MapPanel.tsx**

```tsx
'use client';

import {DeckJsonMap} from '@sqlrooms/deck';
import {Button} from '@sqlrooms/ui';
import {useMemo} from 'react';
import {useRoomStore} from '@/app/store';

const MAP_STYLE = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json';
const BOSTON = {longitude: -71.09, latitude: 42.35, zoom: 11, pitch: 0, bearing: 0};

export function MapPanel() {
  const layers = useRoomStore((s) => s.app.layers);
  const clear = useRoomStore((s) => s.app.clearLayers);

  const datasets = useMemo(
    () =>
      Object.fromEntries(
        layers.map((l) => [
          l.id,
          {
            sqlQuery:
              l.kind === 'stops'
                ? `SELECT q.*, ST_AsWKB(ST_Point(q.lon::double, q.lat::double)) AS geom FROM (${l.sql}) AS q`
                : `SELECT q.*, s.geom FROM (${l.sql}) AS q JOIN shape_lines s USING (shape_id)`,
            geometryColumn: 'geom',
            geometryEncodingHint: 'wkb' as const,
          },
        ]),
      ),
    [layers],
  );

  const spec = useMemo(
    () => ({
      initialViewState: BOSTON,
      controller: true,
      layers: layers.map((l) => {
        const color = {'@@function': 'colorScale', field: 'value', type: 'sequential', scheme: 'YlOrRd', domain: 'auto', legend: {title: l.title}};
        return l.kind === 'stops'
          ? {'@@type': 'GeoArrowScatterplotLayer', id: l.id, _sqlroomsBinding: {dataset: l.id, geometryColumn: 'geom'}, pickable: true, radiusUnits: 'pixels', getRadius: 5, radiusMinPixels: 3, getFillColor: color}
          : {'@@type': 'GeoArrowPathLayer', id: l.id, _sqlroomsBinding: {dataset: l.id, geometryColumn: 'geom'}, pickable: true, widthUnits: 'pixels', getWidth: 3, widthMinPixels: 2, getColor: color};
      }),
    }),
    [layers],
  );

  return (
    <div className="relative h-full w-full">
      <DeckJsonMap
        className="absolute inset-0"
        spec={spec}
        datasets={datasets}
        mapStyle={MAP_STYLE}
        deckProps={{
          getTooltip: ({object}: {object?: {label?: string; value?: number}}) =>
            object?.label ? {text: `${object.label}: ${object.value}`} : null,
        }}
      />
      {layers.length > 0 && (
        <Button size="xs" variant="outline" className="absolute top-2 right-2" onClick={clear}>
          Clear layers
        </Button>
      )}
      {layers.length === 0 && (
        <div className="text-muted-foreground pointer-events-none absolute inset-x-0 top-3 text-center text-xs">
          Ask a "which routes / which stops" question and the agent will draw here.
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Verify Q2 and Q3 in the browser**

Run: `pnpm dev`; click suggestion 2.
Expected: `query` result table of route ids with medians; `map_layer` success card; red-to-yellow route lines appear over Boston with a legend; hovering a line shows `"1: 8"`-style tooltip. Suggestion 3 → stop points near Harvard plus the routes table with first/last departures; the answer mentions merging parent/child/street stops.

If `GeoArrowPathLayer` complains about geometry, run in the SQL editor: `SELECT shape_id, octet_length(geom) FROM shape_lines LIMIT 3` — non-null lengths mean the parquet is fine and the issue is the binding.

- [ ] **Step 6: Commit**

```bash
git add src
git commit -m "map_layer tool: column contract, DuckDB validation, deck.gl stops/routes layers"
```

---

### Task 10: Header (feed window, model, tokens) and SQL-editor audit path

**Files:**
- Create: `src/components/Header.tsx`
- Modify: `src/components/room.tsx`

**Interfaces:**
- Consumes: `GET /api/chat`, `app.usage`, `FEED`.

- [ ] **Step 1: Header.tsx**

```tsx
'use client';

import {useEffect, useState} from 'react';
import {useRoomStore} from '@/app/store';
import {FEED} from '@/lib/gtfs/feed';

export function Header() {
  const usage = useRoomStore((s) => s.app.usage);
  const [model, setModel] = useState<string>('…');
  const [effort, setEffort] = useState<string>('…');
  useEffect(() => {
    fetch('/api/chat').then((r) => r.json()).then((j) => { setModel(j.model || 'not configured'); setEffort(j.reasoningEffort ?? '?'); }).catch(() => setModel('unreachable'));
  }, []);
  return (
    <header className="bg-card text-card-foreground flex items-center gap-4 border-b px-4 py-2 text-xs">
      <span className="text-sm font-semibold">MBTA GTFS Agent</span>
      <span className="text-muted-foreground">
        {FEED.agency} static GTFS · {FEED.version} · {FEED.start} → {FEED.end} · scheduled service only
      </span>
      <span className="ml-auto font-mono">model: {model} · effort: {effort}</span>
      <span className="font-mono">
        tokens: {usage.inputTokens.toLocaleString()} in / {usage.outputTokens.toLocaleString()} out
      </span>
    </header>
  );
}
```

- [ ] **Step 2: Mount it in room.tsx**

```tsx
'use client';

import {roomStore, useRoomStore} from '@/app/store';
import {RoomShell} from '@sqlrooms/room-shell';
import {SqlEditorModal} from '@sqlrooms/sql-editor';
import {Header} from '@/components/Header';

export default function Room() {
  const open = useRoomStore((s) => s.app.sqlEditorOpen);
  const setOpen = useRoomStore((s) => s.app.setSqlEditorOpen);
  return (
    <div className="flex h-screen flex-col">
      <Header />
      <RoomShell className="min-h-0 flex-1" roomStore={roomStore}>
        <RoomShell.LayoutComposer />
        <RoomShell.LoadingProgress />
        <SqlEditorModal isOpen={open} onClose={() => setOpen(false)} />
      </RoomShell>
    </div>
  );
}
```

- [ ] **Step 3: Verify Q4 → Q5 (the audit moment)**

Run: `pnpm dev`; ask suggestion 4. After the answer, click "Open in SQL editor" on the query result, change `'20260919'` to `'20260920'` and `saturday` to `sunday`, run.
Expected: the editor re-runs and shows Sunday medians; header token counter increased after each answer; model id visible.

- [ ] **Step 4: Verify Q6**

Ask "Is Route 1 running on time right now?"
Expected: no tool calls; answer says only the schedule is available and offers the scheduled headway instead.

- [ ] **Step 5: Commit**

```bash
git add src
git commit -m "Header with feed window, model id and token usage; SQL editor audit path"
```

---

### Task 11: Agent-mode eval (`pnpm eval`) and model comparison

**Files:**
- Modify: `eval/run.ts`

**Interfaces:**
- Consumes: `INSTRUCTIONS`, `serverTools()` shapes, `withLimit`, `requiredMapColumns`.
- Produces: `pnpm eval [--model <id>]` prints a per-question ok/FAIL table for the agent and exits non-zero on any failure.

- [ ] **Step 1: Add agent mode**

Replace the tail of `eval/run.ts` (from the `--data-only` exit) with:

```ts
if (process.argv.includes('--data-only')) process.exit(failed ? 1 : 0);

const {ToolLoopAgent, stepCountIs, tool} = await import('ai');
const {createModel, modelConfig} = await import('../src/lib/agent/model');
const {INSTRUCTIONS} = await import('../src/lib/agent/instructions');
const {ChartParams, MapLayerParams, QueryParams, TOOL_DESCRIPTIONS, requiredMapColumns} = await import('../src/lib/agent/tool-schemas');
const {withLimit, assertReadOnly} = await import('../src/lib/agent/sql-guard');

const arg = (flag: string) => (process.argv.includes(flag) ? process.argv[process.argv.indexOf(flag) + 1] : undefined);
const cfg = modelConfig({model: arg('--model'), reasoningEffort: arg('--effort')});
const {model, providerOptions} = createModel(cfg);

// Node executors mirroring the browser tools: query returns rows; chart/map validate and accept.
const tools = {
  query: tool({
    description: TOOL_DESCRIPTIONS.query,
    inputSchema: QueryParams,
    execute: async ({sqlQuery}) => {
      try {
        const rows = (await db.runAndReadAll(withLimit(sqlQuery))).getRowObjectsJson();
        return {success: true, data: {type: 'query', summary: null, firstRows: rows.slice(0, 100)}, title: 'Query Result', sqlQuery};
      } catch (e) {
        return {success: false, error: e instanceof Error ? e.message : String(e), title: 'Query Result', sqlQuery};
      }
    },
  }),
  chart: tool({description: TOOL_DESCRIPTIONS.chart, inputSchema: ChartParams, execute: async ({sqlQuery}) => ({success: true, details: '(eval) chart accepted', sqlQuery, vegaLiteSpec: null})}),
  map_layer: tool({
    description: TOOL_DESCRIPTIONS.map_layer,
    inputSchema: MapLayerParams,
    execute: async ({sqlQuery, kind}) => {
      try {
        const cols = (await db.runAndReadAll(`SELECT * FROM (${assertReadOnly(sqlQuery)}) AS q LIMIT 1`)).columnNames().map((c) => c.toLowerCase());
        const missing = requiredMapColumns(kind).filter((c) => !cols.includes(c));
        return missing.length ? {success: false, error: `Missing columns: ${missing.join(', ')}`} : {success: true, details: '(eval) layer accepted'};
      } catch (e) {
        return {success: false, error: e instanceof Error ? e.message : String(e)};
      }
    },
  }),
};

console.log(`== agent check (model: ${cfg.model}, effort: ${cfg.reasoningEffort}) ==`);
const agent = new ToolLoopAgent({model, providerOptions, instructions: INSTRUCTIONS, tools, stopWhen: stepCountIs(8)});
const report: Array<Record<string, unknown>> = [];
for (const q of questions) {
  const t0 = Date.now();
  const r = await agent.generate({prompt: q.prompt});
  const used = r.steps.flatMap((s) => s.toolCalls.map((c) => c.toolName));
  const missing = containsAll(r.text, q.expect);
  const toolsOk = q.tools.every((t) => used.includes(t)) && (q.tools.length > 0 || used.length === 0);
  const ok = missing.length === 0 && toolsOk;
  if (!ok) failed++;
  report.push({id: q.id, ok, tools: used.join(','), missing: missing.join(','), secs: Math.round((Date.now() - t0) / 1000), tokens: r.totalUsage.totalTokens, reasoning: r.totalUsage.reasoningTokens});
}
console.table(report);
process.exit(failed ? 1 : 0);
```
(`columnNames()` is the DuckDB Node reader's column accessor; if the installed version names it differently, use `reader.columnNames` or `reader.deduplicatedColumnNames()` per its README.)

- [ ] **Step 2: Run for the main model**

Run: `pnpm eval`
Expected: data check all `ok`; agent table with 5 rows; target ≥ 4/5 ok. For failures, read the missing values and tool lists, then adjust `instructions.ts` (never the expectations) and re-run.

- [ ] **Step 3: Run the model / effort matrix and save tables**

Run: `pnpm eval --model <id> --effort <low|high> | tee eval/results-<id>-<effort>.txt` for the main model at low and high, plus one smaller model.
Expected: result files to paste into README's comparison table.

- [ ] **Step 4: Commit**

```bash
git add eval
git commit -m "Eval: agent mode with Node-executed tools, per-model result tables"
```

---

### Task 12: Docker, Vercel, CI

**Files:**
- Create: `Dockerfile`, `docker-compose.yml`, `.dockerignore`, `.github/workflows/ci.yml`

- [ ] **Step 1: Dockerfile + compose + dockerignore**

`Dockerfile`:
```Dockerfile
FROM node:24-alpine AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
EXPOSE 3000
CMD ["node", "server.js"]
```

`docker-compose.yml`:
```yaml
services:
  app:
    build: .
    env_file: .env
    ports:
      - "3000:3000"
```

`.dockerignore`:
```
node_modules
.next
data
.git
.env
```

- [ ] **Step 2: Verify**

Run: `docker compose up --build`
Expected: app on `http://localhost:3000`, Q1 works. Image build does not need `data/` (parquet is in `public/`).

- [ ] **Step 3: CI**

`.github/workflows/ci.yml`:
```yaml
name: ci
on: [push, pull_request]
jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with: {version: 10}
      - uses: actions/setup-node@v4
        with: {node-version: 24, cache: pnpm}
      - run: pnpm install --frozen-lockfile
      - run: pnpm test
      - run: pnpm eval --data-only
      - run: pnpm build
```

- [ ] **Step 4: Vercel (only if Task 7 Step 3 showed Parley reachable from outside MIT)**

Run: `vercel link && vercel env add OPENAI_BASE_URL && vercel env add OPENAI_API_KEY && vercel env add OPENAI_MODEL && vercel --prod`
Expected: production URL answers Q1. If Parley is not reachable, skip and note it in README.

- [ ] **Step 5: Commit and push**

```bash
git add Dockerfile docker-compose.yml .dockerignore .github
git commit -m "Docker standalone image, compose, CI (tests + data eval + build)"
git push -u origin main
```
Expected: CI green on GitHub.

---

### Task 13: README.md and ASSUMPTIONS.md drafts

**Files:**
- Create: `README.md`, `ASSUMPTIONS.md`
- (`AI-USE.md` is written by the author, not by this plan.)

- [ ] **Step 1: Collect artifacts**

From the recorded demo (author records the video after Tasks 1–12 pass): six screenshots into `docs/img/q1.png … q6.png` plus `docs/img/demo.gif`. Eval tables from `eval/results-*.txt`.

- [ ] **Step 2: README.md outline (fill each section; no section may be empty)**

```
# MBTA GTFS Agent
> Submitted for the **Agentic AI** RA track. [video link] · [live demo link or "run locally"]
![demo](docs/img/demo.gif)

## Why this
(planner's recurring question; half-day → one sentence; PTIQ's "show the query, data window, sources, caveats")

## What it does
(three tools; every answer's four-part format; screenshot q1)

## Walkthrough
Q1 … Q6 with screenshots and 1–2 findings each (e.g. Route 1 AM peak median 8 min; which routes meet ≤10; Harvard merged-stops caveat; Sunday re-run)

## Key findings
(3–5 bullets with numbers from eval --show)

## Design for trust
(SQL shown + editable, resolved date stated, caveats, guardrails list, provider independence via OPENAI_BASE_URL, token counter)

## Architecture
(diagram from docs/design.md §2; why no Python / CopilotKit / LangGraph and where the seam is)

## Model comparison
(table from eval/results-*.txt)

## Data and resources
(MBTA GTFS Fall 2026 ver. D, download date; sqlrooms, AI SDK, deck.gl, CARTO basemap; MBTA GTFS docs for typicality)

## Compute
(MIT Parley, free student tier, models used; laptop specs for DuckDB-WASM; no paid subscriptions)

## Run it
(local, Docker, Vercel; env vars; pnpm eval)

## Limitations and future work
(links to GitHub issues: GTFS-RT, upload feed, query timeout, Red Line branch reference stop)

Hours spent: N
```

- [ ] **Step 3: ASSUMPTIONS.md (one bullet each, with the reason)**

Feed pinned and parquet committed · headway definition (typicality 1, shared first stop, median) · default periods · date resolution + fallback · all modes loaded, prompt tuned for bus + Red Line · Harvard-style station merging heuristic · guardrails are design signals, not security (browser sandbox) · LIMIT 1000 wrapper · eval matching is substring on expected numbers · SQL editor is a modal, not a drawer · basemap CARTO not Mapbox · RT scope and gate · no persistence, no auth, no upload.

- [ ] **Step 4: Author review, then commit**

```bash
git add README.md ASSUMPTIONS.md docs/img
git commit -m "README and ASSUMPTIONS drafts"
```

---

## Out of scope for this plan

GTFS-Realtime (`vehicle_positions` server tool) is gated per spec §10 and gets its own branch + PR after this plan is complete and the video is recorded.
