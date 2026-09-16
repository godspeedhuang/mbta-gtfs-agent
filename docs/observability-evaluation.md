# Observability and evaluation

An agent that writes SQL for planners is only useful if its numbers are right, and "right" has to be measured, not eyeballed. This document covers what is instrumented, how answers are evaluated, what the evaluation found, and what comes next.

## Observability

**Now: LangSmith.** Every model call goes through the server gateway and is traced as one run with its input messages, tool calls, reasoning summary, output and token usage. Runs from one chat session are grouped into a thread, so a whole conversation (question → queries → retries → answer) can be replayed step by step. The header of the app shows input, output and reasoning tokens for the session.

Traces are how problems like these were diagnosed during development: the agent giving up after a single SQL error instead of fixing the query, and the agent constructing a `shape_id` that matched no route geometry.

**Next: Langfuse.** For the open-source release, agencies need a tracing backend they can host themselves. Langfuse covers the same ground (traces, threads, token and cost accounting, evaluation datasets) and is self-hostable, so it replaces LangSmith at Tier 1 without changing what is recorded.

**Not yet instrumented:** tool-level timing (how long each query took, how many rows it returned), per-user usage, latency budgets and alerts.

## Evaluation

### Golden dataset

`eval/questions.json` holds two kinds of question.

**Clear questions** have a prompt, the tools a correct run needs, optional tools that are acceptable, a reference SQL query written and checked by hand, and the key values a correct answer must contain (e.g. Route 1 weekday AM peak median = 8 minutes). The agent should answer them without asking anything.

| Question | Required tools | Key values |
|---|---|---|
| Q1 Route 1 headway by hour | query, chart | 8, 10 |
| Q2 Bus routes ≤10 min in AM peak | query, map_layer, zoom_to_layer | 1, 66, 111 |
| Q3 Routes serving Harvard | query, map_layer, zoom_to_layer | 66, Red, 71 |
| Q4 Route 1 vs 66, weekday vs Saturday | query (chart optional) | 8, 9, 13, Saturday |
| Q6 Is Route 1 on time right now? | none (query optional) | "schedule" |
| Q7 Routes that gained or lost weekday trips, Summer → Fall 2026 | query, map_layer, zoom_to_layer | 65 (+45), 66, 70, 746/SLW |

Q7 needs a second feed. The Summer 2026 archive is converted locally with the same script (`pnpm prepare-gtfs <src> <out>`) and mounted as the `summer_2026` schema, exactly as an upload in the app would be. It is not committed, so CI skips Q7 and reports that it did.

**Vague questions** leave out something that changes the answer. The agent should ask before computing, and its questions should cover the dimensions that are actually missing.

| Question | What is missing |
|---|---|
| V1 Which bus routes are frequent? | day; what "frequent" means |
| V2 How often do buses run downtown? | where "downtown" is; day |
| V3 Which stops are the busiest? | what "busiest" means; day |

### Two levels

**1. Data check (runs in CI, no model).** Each reference SQL runs against the Parquet feed in Node DuckDB and must produce the key values. This catches a changed feed, a broken conversion script, or a wrong definition before anything reaches the model. It runs on every push.

**2. Agent check (run on demand).** The same agent, prompt and tool definitions as the app, with tools executed in Node against the same data. For each run it records:

| Metric | Meaning |
|---|---|
| **Answer accuracy** | clear questions: the key values appear in the final answer text |
| **Data accuracy** | clear questions: the key values appear in a successful query result, i.e. the table the planner sees |
| **Tool precision / recall** | clear questions: share of tools used that were required or acceptable / share of required tools used |
| **Asks when vague** | share of vague-question runs where the agent asked before computing |
| **Asks when clear** | share of clear-question runs where it asked anyway (over-asking) |
| **Coverage** | share of a vague question's missing dimensions its clarifying questions addressed |
| **Time, tokens, cost** | per question; cost is the billed USD from Parley's per-request cost header |

Answer and data accuracy are kept separate on purpose. The prompt tells the agent not to paste raw rows into the answer, so a model can compute the right table and still write a vague summary. Those are different failures with different fixes.

Each configuration runs every question three times, because the same model can take a different path on each run. A control group runs the vague questions with the clarifying tool removed.

### What the evaluation found

The results and what they mean are in the [README](../README.md#evaluation), so they sit next to the demo they explain. This document keeps the method.

## Next steps

- **LLM-as-judge.** Substring matching checks that numbers are present, not that the answer is good. A judge model with a rubric would score correctness against the reference result, conciseness, whether caveats (reference stop, excluded trips, scheduled vs actual) are stated, and whether the resolved service date is given. Judge scores need spot-checking against human ratings before they are trusted.
- **Trajectory evaluation beyond tool sets.** Compare the order of tool calls and the SQL itself against the reference (same service date, typicality filter, reference stop), not just which tools were used.
- **Larger golden set from real planner questions,** including more that the agent should decline or clarify, and scoring whether the options it offers are the right ones, not only whether it asked.
- **Evaluation as a gate.** Run the agent check on prompt or model changes and block a release when accuracy drops, the same way the data check already gates every push.
