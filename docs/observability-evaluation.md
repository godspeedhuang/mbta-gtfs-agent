# Observability and evaluation

An agent that writes SQL for planners is only useful if its numbers are right, and "right" has to be measured, not eyeballed. This document covers what is instrumented, how answers are evaluated, what the evaluation found, and what comes next.

## Observability

**Now: LangSmith.** Every model call goes through the server gateway and is traced as one run with its input messages, tool calls, reasoning summary, output and token usage. Runs from one chat session are grouped into a thread, so a whole conversation (question → queries → retries → answer) can be replayed step by step. The header of the app shows input, output and reasoning tokens for the session.

Traces are how problems like these were diagnosed during development: the agent giving up after a single SQL error instead of fixing the query, and the agent constructing a `shape_id` that matched no route geometry.

**Next: Langfuse.** For the open-source release, agencies need a tracing backend they can host themselves. Langfuse covers the same ground (traces, threads, token and cost accounting, evaluation datasets) and is self-hostable, so it replaces LangSmith at Tier 1 without changing what is recorded.

**Not yet instrumented:** tool-level timing (how long each query took, how many rows it returned), per-user usage, latency budgets and alerts.

## Evaluation

### Golden dataset

`eval/questions.json` holds the demo questions. Each has the prompt, the tools a correct run needs, optional tools that are acceptable, a reference SQL query written and checked by hand, and the key values a correct answer must contain (e.g. Route 1 weekday AM peak median = 8 minutes).

| Question | Required tools | Key values |
|---|---|---|
| Q1 Route 1 headway by hour | query, chart | 8, 10 |
| Q2 Bus routes ≤10 min in AM peak | query, map_layer, zoom_to_layer | 1, 66, 111 |
| Q3 Routes serving Harvard | query, map_layer, zoom_to_layer | 66, Red, 71 |
| Q4 Route 1 vs 66, weekday vs Saturday | query (chart optional) | 8, 9, 13, Saturday |
| Q6 Is Route 1 on time right now? | none (query optional) | "schedule" |

### Two levels

**1. Data check (runs in CI, no model).** Each reference SQL runs against the Parquet feed in Node DuckDB and must produce the key values. This catches a changed feed, a broken conversion script, or a wrong definition before anything reaches the model. It runs on every push.

**2. Agent check (run on demand).** The same agent, prompt and tool definitions as the app, with tools executed in Node against the same data. For each run it records:

| Metric | Meaning |
|---|---|
| **Answer accuracy** | the key values appear in the final answer text |
| **Data accuracy** | the key values appear in a successful query result, i.e. the table the planner sees |
| **Tool precision** | share of tools used that were required or acceptable |
| **Tool recall** | share of required tools that were used |
| **Time** | wall-clock seconds per question |
| **Tokens** | input + output (and reasoning) per question |
| **Cost** | billed USD per question, from Parley's per-request cost header |

Answer and data accuracy are kept separate on purpose. The prompt tells the agent not to paste raw rows into the answer, so a model can compute the right table and still write a vague summary. Those are different failures with different fixes.

Each configuration runs every question three times, because the same model can take a different SQL path on each run.

### What the evaluation found

**Model and reasoning-effort comparison** (5 questions × 3 runs per configuration, 2026-09-13; `pnpm eval --summary`)

| Model | Effort | API | Answer acc. | Data acc. | Tool P / R | Sec / question | Tokens / question | USD / question |
|---|---|---|---|---|---|---|---|---|
| gpt-5.6-luna | low | Responses | 93% | 100% | 1.00 / 1.00 | 19.5 | 26k | $0.0040 |
| gpt-5.6-luna | medium | Responses | 93% | 100% | 1.00 / 1.00 | 24.2 | 27k | $0.0047 |
| gpt-5.6-luna | high | Responses | 93% | 93% | 1.00 / 1.00 | 34.3 | 32k | $0.0064 |
| gemini-3.6-flash | medium | Chat Completions | 73% | 100% | 0.77 / 1.00 | 48.3 | 66k | $0.0690 |
| llama-4-maverick-17b | — | Chat Completions | 20% | 47% | 0.97 / 0.84 | 13.0 | 18k | $0.0053 |

The whole matrix (75 agent runs) cost $1.34.

- **More reasoning did not buy accuracy.** Low, medium and high effort reach the same accuracy on this set; high takes 76% longer and costs 60% more. The hard part of these questions is applying the definitions in the prompt, not deliberation.
- **Gemini computes the right tables but over-acts.** Data accuracy is 100%, but it draws maps and charts for questions that don't need them (it added a map layer while declining the real-time question), and sometimes leaves a key number out of the answer. It takes twice as long and costs about 15× more per question than gpt-5.6-luna.
- **The open-weight model is not enough for this loop.** Llama 4 Maverick calls tools, but gets the table right less than half the time, often skips the map, and writes answers that point at "the table" instead of stating results. Self-hosting is viable only with a stronger open-weight model; this is the number to re-measure as those improve.
- **The remaining GPT misses are phrasing, not data**: e.g. a Route 1 answer that describes the AM peak without stating the 10-minute 8 AM value.

**Definition problems the evaluation surfaced**

- **Period boundaries.** The reference SQL treated the AM peak as 07:00–09:00 *inclusive*; the agent treated it as half-open. For Route 66 that is 9.5 vs 9 minutes. Periods are adjacent (the midday starts at 09:00), so half-open is correct: the reference SQL was wrong, not the agent. The prompt now states the rule explicitly.
- **"Every 10 minutes or better" is ambiguous.** One model counted a route if *either* direction met the threshold (21 routes); the reference counts the *worse* direction (20 routes). Both are defensible; a service standard should say which, and the prompt should too.

## Next steps

- **LLM-as-judge.** Substring matching checks that numbers are present, not that the answer is good. A judge model with a rubric would score correctness against the reference result, conciseness, whether caveats (reference stop, excluded trips, scheduled vs actual) are stated, and whether the resolved service date is given. Judge scores need spot-checking against human ratings before they are trusted.
- **Trajectory evaluation beyond tool sets.** Compare the order of tool calls and the SQL itself against the reference (same service date, typicality filter, reference stop), not just which tools were used.
- **Larger golden set from real planner questions,** including ones the agent should decline or ask to clarify.
- **Evaluation as a gate.** Run the agent check on prompt or model changes and block a release when accuracy drops, the same way the data check already gates every push.
