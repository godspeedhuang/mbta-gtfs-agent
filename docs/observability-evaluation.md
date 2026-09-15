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

**Comparison** (8 questions × 3 runs per configuration, 2026-09-14; `pnpm eval --summary`)

| Model | Effort | Answer acc. | Data acc. | Tool P / R | Asks when vague | Asks when clear | Coverage | Sec / q | Tokens / q | USD / q |
|---|---|---|---|---|---|---|---|---|---|---|
| gpt-5.6-luna | low | 87% | 93% | 1.00 / 0.91 | 100% | 0% | 100% | 14.3 | 14k | $0.0022 |
| gpt-5.6-luna | medium | 93% | 100% | 1.00 / 1.00 | 100% | 0% | 100% | 24.9 | 23k | $0.0034 |
| gpt-5.6-luna | high | 93% | 100% | 0.91 / 1.00 | 100% | 0% | 100% | 25.8 | 22k | $0.0042 |
| gemini-3.6-flash | medium | 80% | 100% | 0.66 / 1.00 | 100% | 0% | 100% | 25.7 | 35k | $0.0385 |
| llama-4-maverick-17b | — | 13% | 27% | 0.77 / 0.58 | 100% | 20% | 72% | 4.9 | 9k | $0.0027 |

GPT runs through the Responses API; Gemini and Llama through Chat Completions. The 129 agent runs, including the control group, cost $1.27.

- **Medium effort is the sweet spot.** High effort adds cost without adding accuracy; low effort is faster and cheaper but misses more (one table wrong, one required tool skipped).
- **Gemini computes the right tables but over-acts.** Data accuracy is 100%, but it draws charts and maps nobody asked for (tool precision 0.66) and sometimes leaves a key number out of the answer, at about 11× the cost per question of gpt-5.6-luna.
- **The open-weight model is not enough for this loop.** Llama 4 Maverick gets the table right about a quarter of the time, asks unnecessary questions on clear requests, and misses part of what is ambiguous on vague ones. Self-hosting is viable only with a stronger open-weight model; this is the number to re-measure as those improve.

### Clarifying before computing

This is the result I care most about. With the clarifying tool, every GPT and Gemini configuration asked on every vague question, covered every missing dimension, and never asked on a clear one. The questions are multiple choice with a recommended option, e.g. for "Which bus routes are frequent?": *Day* (weekday / Saturday / Sunday), *Threshold* (≤10 / ≤15 / ≤20 minutes, both directions), *Hours* (all periods / peaks / daytime).

Without it, the same model guesses, and guesses differently each time. The control group (gpt-5.6-luna, medium, three runs per vague question):

| Question | Run 1 | Run 2 | Run 3 |
|---|---|---|---|
| Which bus routes are frequent? | Wednesday, ≤15 min in any period and direction → **2 routes** | Wednesday, ≤15 min in daytime → **33 routes** | Sunday, ≤15 min at midday → **23 routes** |
| How often do buses run downtown? | Downtown Crossing, Sunday | asked in plain text instead of answering | Downtown Crossing, Sunday |
| Which stops are the busiest? | departures per platform: Forest Hills 1,207 | same | departures per station: Forest Hills 1,747 |

Every one of those answers is defensible, and each states its assumptions in the caveats. None of that helps a planner who meant something else, and the guessing runs also took about 30 seconds per question against 4–5 seconds to ask. A stronger model does not remove this variance, because it comes from the question, not from the model's ability to write SQL. Once time, place and metric are pinned down, the SQL is the easy part.

Two lessons from tuning the rule:
- **Defaults prevent over-asking.** "Weekday" already resolves to the next Wednesday, and a given threshold is judged on the worse direction, so neither triggers a question. An earlier version of the prompt asked "which direction?" on clear questions in 20% of runs until direction got a default.
- **Asking has a UX cost, so the form of the question depends on the ambiguity.** One obvious reading ("Harvard"): no question, the assumption goes in the caveats. One likely reading ("the Coop"): a yes/no confirmation, "Yes, Harvard Coop" or "No, something else". Several readings ("downtown"): multiple choice with a recommended option. Each is one click; free text is always available.

### Comparing two feeds

Q7 (gpt-5.6-luna, medium, three runs) got the table right every time: it picked a Wednesday inside each feed's window, applied the calendar rule per feed, and joined on `route_id`. Two of the three answers named route 746 by its public name, SLW, which the expectation now accepts. About 28 seconds and 24k tokens per run; the map colours each route by its change in trips. The point of the question is less the numbers than that nothing had to change for the agent to answer it: the schema per feed and one paragraph of instructions were enough.

**Definition problems the evaluation surfaced**

- **Period boundaries.** The reference SQL treated the AM peak as 07:00–09:00 *inclusive*; the agent treated it as half-open. For Route 66 that is 9.5 vs 9 minutes. Periods are adjacent (midday starts at 09:00), so half-open is correct: the reference SQL was wrong, not the agent. The prompt now states the rule explicitly.
- **"Every 10 minutes or better" was ambiguous about direction.** One run counted a route if either direction met the threshold (21 routes), the reference used the worse direction (20). The prompt now makes the worse direction the default.

## Next steps

- **LLM-as-judge.** Substring matching checks that numbers are present, not that the answer is good. A judge model with a rubric would score correctness against the reference result, conciseness, whether caveats (reference stop, excluded trips, scheduled vs actual) are stated, and whether the resolved service date is given. Judge scores need spot-checking against human ratings before they are trusted.
- **Trajectory evaluation beyond tool sets.** Compare the order of tool calls and the SQL itself against the reference (same service date, typicality filter, reference stop), not just which tools were used.
- **Larger golden set from real planner questions,** including more that the agent should decline or clarify, and scoring whether the options it offers are the right ones, not only whether it asked.
- **Evaluation as a gate.** Run the agent check on prompt or model changes and block a release when accuracy drops, the same way the data check already gates every push.
