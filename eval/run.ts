import {DuckDBInstance} from '@duckdb/node-api';
import type {ToolSet} from 'ai';
import {mkdirSync, readdirSync, readFileSync, writeFileSync} from 'node:fs';
import {GTFS_TABLES} from '../src/lib/gtfs/feed';

// pnpm eval --data-only                       reference SQL vs expected numbers (no model calls; runs in CI)
// pnpm eval [--model id] [--effort e] [--api responses|chat] [--repeat n]
//                                             agent runs with Node-executed tools; writes eval/results/<model>-<effort>.json
// pnpm eval --only <question id>             one question, prints the answer, writes nothing
// pnpm eval --prompt "<question>"            one ad-hoc question, prints the clarifying question or answer, writes nothing
// pnpm eval --no-ask [...]                     vague questions only, without ask_user (control group)
// pnpm eval --summary                         comparison table across eval/results/*.json

type Question = {id: string; prompt: string; tools: string[]; optionalTools?: string[]; clarify?: string[]; referenceSql?: string; expect: Array<string | number>};
const questions = JSON.parse(readFileSync(new URL('./questions.json', import.meta.url), 'utf8')) as Question[];
const resultsDir = new URL('./results/', import.meta.url);

export async function openGtfs() {
  const db = await (await DuckDBInstance.create(':memory:')).connect();
  for (const t of GTFS_TABLES) await db.run(`CREATE VIEW ${t} AS SELECT * FROM read_parquet('public/gtfs/${t}.parquet')`);
  return db;
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Expected values missing from `text`, matched as standalone tokens (so 8 does not match 18 or 8.5).
 * "a|b" accepts either spelling.
 */
const missingValues = (text: string, expect: Array<string | number>) =>
  expect.filter(
    (e) => !String(e).split('|').some((alt) => new RegExp('(?<![A-Za-z0-9.])' + escapeRegExp(alt) + '(?![A-Za-z0-9]|\\.\\d)', 'i').test(text)),
  );

const arg = (flag: string) => (process.argv.includes(flag) ? process.argv[process.argv.indexOf(flag) + 1] : undefined);

type Run = {
  id: string;
  rep: number;
  correct: boolean;
  missing: string[];
  /** Expected values present in some successful query result (the table the user sees). */
  dataCorrect: boolean;
  /** ask_user was called. */
  asked: boolean;
  /** Share of a vague question's ambiguous dimensions the clarifying questions covered. */
  clarifyCoverage?: number;
  askInput?: unknown;
  tools: string[];
  toolPrecision: number;
  toolRecall: number;
  steps: number;
  secs: number;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  costUsd: number | null;
  answer?: string;
  error?: string;
};

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const round = (x: number, d = 2) => Math.round(x * 10 ** d) / 10 ** d;

if (process.argv.includes('--summary')) {
  const rows = readdirSync(resultsDir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => ({config: f.replace(/\.json$/, ''), ...(JSON.parse(readFileSync(new URL(f, resultsDir), 'utf8')) as {model: string; effort: string; api: string; runs: Run[]})}))
    .map(({config, model, effort, api, runs}) => {
      // Re-score answers against the current expectations, so fixing an expectation doesn't require re-running models.
      for (const r of runs) {
        const q = questions.find((x) => x.id === r.id);
        if (q && !q.clarify && r.answer != null && !r.error) {
          r.missing = missingValues(r.answer, q.expect).map(String);
          r.correct = r.missing.length === 0;
          if (!q.referenceSql) r.dataCorrect = r.correct;
        }
      }
      const costs = runs.map((r) => r.costUsd).filter((c): c is number => c != null);
      const isVague = (r: Run) => Boolean(questions.find((q) => q.id === r.id)?.clarify);
      const clear = runs.filter((r) => !isVague(r));
      const vague = runs.filter(isVague);
      const pct = (xs: number[]) => (xs.length ? `${Math.round(100 * mean(xs))}%` : '-');
      return {
        model: config.endsWith('-noask') ? `${model} (no ask_user)` : model,
        effort,
        api,
        runs: runs.length,
        answerAcc: pct(clear.map((r) => +r.correct)),
        dataAcc: pct(clear.map((r) => +r.dataCorrect)),
        toolP: round(mean(clear.map((r) => r.toolPrecision))),
        toolR: round(mean(clear.map((r) => r.toolRecall))),
        askVague: pct(vague.map((r) => +r.asked)),
        askClear: pct(clear.map((r) => +r.asked)),
        coverage: pct(vague.filter((r) => r.asked).map((r) => r.clarifyCoverage ?? 0)),
        secsPerQ: round(mean(runs.map((r) => r.secs)), 1),
        tokensPerQ: Math.round(mean(runs.map((r) => r.inputTokens + r.outputTokens))),
        reasoningPerQ: Math.round(mean(runs.map((r) => r.reasoningTokens))),
        usdPerQ: costs.length ? round(mean(costs), 4) : null,
        errors: runs.filter((r) => r.error).length,
      };
    });
  console.table(rows);
  process.exit(0);
}

const db = await openGtfs();
let dataFailed = 0;
console.log('== data check (reference SQL) ==');
for (const q of questions) {
  if (!q.referenceSql) continue;
  const rows = (await db.runAndReadAll(q.referenceSql)).getRowObjectsJson();
  const missing = missingValues(JSON.stringify(rows), q.expect);
  console.log(`${missing.length ? 'FAIL' : 'ok  '} ${q.id} rows=${rows.length}${missing.length ? ' missing=' + missing.join(',') : ''}`);
  if (process.argv.includes('--show')) console.table(rows);
  if (missing.length) dataFailed++;
}
if (process.argv.includes('--data-only')) process.exit(dataFailed ? 1 : 0);

const {ToolLoopAgent, stepCountIs, tool} = await import('ai');
const {createModel, modelConfig} = await import('../src/lib/agent/model');
const {buildInstructions} = await import('../src/lib/agent/instructions');
const {ChartParams, MapLayerParams, QueryParams, TOOL_DESCRIPTIONS, ZoomToLayerParams, requiredMapColumns, MAX_STEPS} = await import(
  '../src/lib/agent/tool-schemas'
);
const {withLimit, assertReadOnly} = await import('../src/lib/agent/sql-guard');

const cfg = modelConfig({model: arg('--model'), reasoningEffort: arg('--effort'), api: arg('--api')});
const {model, providerOptions} = createModel(cfg);
const repeat = Number(arg('--repeat') ?? 1);
const adhoc = arg('--prompt');
const only = adhoc ? 'adhoc' : arg('--only');
if (adhoc) questions.push({id: 'adhoc', prompt: adhoc, tools: [], expect: []});
const noAsk = process.argv.includes('--no-ask');
// Pin "today" so relative dates resolve to the service days the expected numbers were computed for
// (Sunday 2026-09-13 → weekday 20260916, Saturday 20260919).
const instructions = buildInstructions(new Date('2026-09-13T16:00:00Z'), {clarify: !noAsk});
const {createAskUserTool} = await import('../src/lib/agent/ask-user-tool');

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Node executors mirroring the browser tools' checks and outputs. */
function makeTools(): ToolSet {
  const layers: string[] = [];
  return {
    // Needs approval, so generate() stops at the question: the eval measures whether and what it asks.
    ...(noAsk ? {} : {ask_user: createAskUserTool()}),
    query: tool({
      description: TOOL_DESCRIPTIONS.query,
      inputSchema: QueryParams,
      execute: async ({sqlQuery}) => {
        try {
          const rows = (await db.runAndReadAll(withLimit(sqlQuery))).getRowObjectsJson();
          return {success: true, data: {type: 'query', firstRows: rows.slice(0, 100), rowCount: rows.length}, sqlQuery};
        } catch (e) {
          return {success: false, error: errorText(e), sqlQuery};
        }
      },
    }),
    chart: tool({
      description: TOOL_DESCRIPTIONS.chart,
      inputSchema: ChartParams,
      execute: async ({sqlQuery, vegaLiteSpec}) => {
        try {
          JSON.parse(vegaLiteSpec);
          const rows = (await db.runAndReadAll(withLimit(sqlQuery))).getRowObjectsJson();
          return {success: true, details: `Chart rendered from ${rows.length} rows.`, sqlQuery};
        } catch (e) {
          return {success: false, error: errorText(e), sqlQuery};
        }
      },
    }),
    map_layer: tool({
      description: TOOL_DESCRIPTIONS.map_layer,
      inputSchema: MapLayerParams,
      execute: async ({sqlQuery, kind, title}) => {
        try {
          const sql = assertReadOnly(sqlQuery);
          const cols = (await db.runAndReadAll(`SELECT * FROM (${sql}) AS q LIMIT 1`)).columnNames().map((c) => c.toLowerCase());
          const missing = requiredMapColumns(kind).filter((c) => !cols.includes(c));
          if (missing.length) return {success: false, error: `Missing columns for kind=${kind}: ${missing.join(', ')}. Required: ${requiredMapColumns(kind).join(', ')}.`};
          const countSql =
            kind === 'routes'
              ? `SELECT count(*)::int AS n FROM (${sql}) AS q JOIN shape_lines USING (shape_id)`
              : `SELECT count(*)::int AS n FROM (${sql}) AS q WHERE q.lat IS NOT NULL AND q.lon IS NOT NULL`;
          const [{n}] = (await db.runAndReadAll(countSql)).getRowObjectsJson() as Array<{n: number}>;
          if (n === 0) {
            return {
              success: false,
              error:
                kind === 'routes'
                  ? 'The SELECT returned no rows whose shape_id exists in shape_lines. Use real shape_id values from trips.shape_id (route_patterns.representative_trip_id → trips), not a constructed id.'
                  : 'The SELECT returned no rows with non-null lat/lon.',
            };
          }
          const layerId = `${kind}-${layers.length + 1}`;
          layers.push(layerId);
          return {success: true, layerId, rows: n, details: `Added ${kind} layer "${title}" (${n} rows) to the map.`};
        } catch (e) {
          return {success: false, error: errorText(e)};
        }
      },
    }),
    zoom_to_layer: tool({
      description: TOOL_DESCRIPTIONS.zoom_to_layer,
      inputSchema: ZoomToLayerParams,
      execute: async ({layerId}) => {
        const id = layerId ?? layers.at(-1);
        return id && layers.includes(id) ? {success: true, layerId: id} : {success: false, error: layers.length ? `No layer ${layerId}. Existing: ${layers.join(', ')}.` : 'No layers on the map yet.'};
      },
    }),
  };
}

/**
 * Tool-set precision/recall. Recall: share of required tools used. Precision: share of used tools that were
 * required or optional (e.g. a query before declining a real-time question is fine, a map for a table is not).
 */
function toolScores(required: string[], optional: string[], used: string[]) {
  const req = new Set(required);
  const allowed = new Set([...required, ...optional]);
  const got = new Set(used);
  return {
    precision: got.size ? [...got].filter((t) => allowed.has(t)).length / got.size : 1,
    recall: req.size ? [...req].filter((t) => got.has(t)).length / req.size : 1,
  };
}

const label = `${cfg.model}-${cfg.reasoningEffort}${noAsk ? '-noask' : ''}`;
console.log(`\n== agent check: ${cfg.model} · effort ${cfg.reasoningEffort} · api ${cfg.api} · ${repeat}x ==`);
const runs: Run[] = [];
for (let rep = 1; rep <= repeat; rep++) {
  for (const q of questions.filter((x) => (!only || x.id === only) && (!noAsk || x.clarify))) {
    const agent = new ToolLoopAgent({model, providerOptions, instructions, tools: makeTools(), stopWhen: stepCountIs(MAX_STEPS)});
    const t0 = Date.now();
    try {
      const r = await agent.generate({prompt: q.prompt, abortSignal: AbortSignal.timeout(240_000)});
      const used = r.steps.flatMap((s) => s.toolCalls.map((c) => c.toolName));
      const askCall = r.steps.flatMap((s) => s.toolCalls).find((c) => c.toolName === 'ask_user');
      const askText = askCall ? JSON.stringify(askCall.input).toLowerCase() : '';
      const clarifyCoverage = q.clarify ? mean(q.clarify.map((dim) => +dim.split('|').some((w) => askText.includes(w)))) : undefined;
      const missing = q.clarify ? [] : missingValues(r.text, q.expect);
      const tables = r.steps
        .flatMap((s) => s.toolResults)
        .map((t) => t.output as {success?: boolean; data?: {firstRows?: unknown[]}})
        .filter((o) => o?.success && o.data?.firstRows)
        .map((o) => JSON.stringify(o.data!.firstRows));
      // Real-time refusal has no table to check; its expectation is about the text.
      const dataCorrect = q.clarify ? Boolean(askCall) : q.referenceSql ? tables.some((t) => missingValues(t, q.expect).length === 0) : missing.length === 0;
      const {precision, recall} = toolScores(q.tools, q.optionalTools ?? [], used);
      // Parley reports the billed cost of each non-streaming call in a response header.
      const costs = r.steps.map((s) => Number(s.response.headers?.['x-parley-v1-cost']));
      runs.push({
        id: q.id,
        rep,
        correct: q.clarify ? Boolean(askCall) : missing.length === 0,
        missing: missing.map(String),
        dataCorrect,
        asked: Boolean(askCall),
        clarifyCoverage,
        askInput: askCall?.input,
        tools: used,
        toolPrecision: precision,
        toolRecall: recall,
        steps: r.steps.length,
        secs: round((Date.now() - t0) / 1000, 1),
        inputTokens: r.totalUsage.inputTokens ?? 0,
        outputTokens: r.totalUsage.outputTokens ?? 0,
        reasoningTokens: r.totalUsage.reasoningTokens ?? 0,
        costUsd: costs.every(Number.isFinite) ? round(costs.reduce((a, b) => a + b, 0), 6) : null,
        answer: r.text,
      });
    } catch (e) {
      runs.push({id: q.id, rep, correct: false, missing: q.expect.map(String), dataCorrect: false, asked: false, tools: [], toolPrecision: 0, toolRecall: 0, steps: 0, secs: round((Date.now() - t0) / 1000, 1), inputTokens: 0, outputTokens: 0, reasoningTokens: 0, costUsd: null, error: errorText(e).slice(0, 200)});
    }
    const last = runs.at(-1)!;
    console.log(`${last.correct ? 'ok  ' : 'FAIL'} #${rep} ${q.id}${last.asked ? ' ASKED' : ''} data=${last.dataCorrect ? 'ok' : 'FAIL'} tools=${last.tools.join(',') || '-'} ${last.secs}s${last.missing.length ? ' missing=' + last.missing.join(',') : ''}${last.error ? ' error=' + last.error : ''}`);
  }
}

mkdirSync(resultsDir, {recursive: true});
if (!only) writeFileSync(new URL(`${label}.json`, resultsDir), JSON.stringify({model: cfg.model, effort: cfg.reasoningEffort, api: cfg.api, repeat, runs}, null, 2) + '\n');
console.table(
  questions.filter((q) => runs.some((r) => r.id === q.id)).map((q) => {
    const rs = runs.filter((r) => r.id === q.id);
    return {id: q.id, answer: `${rs.filter((r) => r.correct).length}/${rs.length}`, data: `${rs.filter((r) => r.dataCorrect).length}/${rs.length}`, toolP: round(mean(rs.map((r) => r.toolPrecision))), toolR: round(mean(rs.map((r) => r.toolRecall))), secs: round(mean(rs.map((r) => r.secs)), 1), tokens: Math.round(mean(rs.map((r) => r.inputTokens + r.outputTokens)))};
  }),
);
if (only) console.log(runs.map((r) => (r.askInput ? `ASK_USER ${JSON.stringify(r.askInput, null, 2)}` : r.answer)).join('\n---\n'));
else console.log(`wrote eval/results/${label}.json`);
process.exit(dataFailed ? 1 : 0);
