# AI Use

Rather than letting AI run on autopilot, I used the methods below to keep it a copilot:
the right model for each decision, a specific skill for each kind of problem, and an
evaluation that decides which changes stay.

## Which model, and when

**Spec — Fable 5.1.** The design spec and implementation plan were written with the most
capable model available. Getting scope wrong at hour one costs more than any later bug,
and a weaker model will agree with a bad plan. The tool design, the fixed answer
layout and the pinned feed were all settled here.

**Development — Opus 5.** Most of the app: the DuckDB-WASM store, tool schemas and SQL
guard, the agent loop, the map, the charts, Docker and CI.

**Small fixes and tweaks — Sonnet 5.** Renames, copy changes, one-line corrections.

**Back to Fable 5.1 when integration got messy.** Some later problems Opus 5 circled
without closing, such as the second-feed schema, the data panel and a CSS bug from an
indirect sqlrooms package. When a model fails twice on the same problem, I switch models
instead of retrying.

## Skills, and what each one was for

**[`grilling`](https://github.com/mattpocock/skills/tree/main/skills/productivity/grilling) — defining the spec.** The skill interrogated me before any code existed:
what "frequent" means in minutes, which day, which reference stop on a branched route.
Those are the same questions a planner's question leaves open, which is where the
`ask_user` tool came from.

**[`superpowers`](https://github.com/obra/superpowers) — the first full skeleton.** The plan split into eight tasks, each with a
brief, an implementation pass and a review of its diff. This got a running app on day one.

**[`context7`](https://github.com/upstash/context7) — official docs.** sqlrooms, DuckDB-WASM, deck.gl and Next.js 16 have all
changed since the models' training data. Pulling current docs first avoids code written
against APIs that no longer exist.

**[`ponytail`](https://github.com/DietrichGebert/ponytail) — keeping it simple.** AI adds features faster than I can judge them, and
the usual failure of an AI-built codebase is bloat. Ponytail cut features and
abstractions instead of adding them.

**[`impeccable`](https://github.com/pbakaus/impeccable) — removing the AI look from the UI.** Gradient cards, emoji headings,
uniform padding. I used it to strip that out so the layout serves the data.

## Evaluation is what makes AI converge

AI writes GTFS SQL fast and confidently, and a confidently wrong headway is worse than
no answer. So before tuning anything I built an eval: `eval/questions.json` holds the
demo questions with reference SQL, and `eval/run.ts` runs the real agent against them
and checks the numbers.

The system prompt in `src/lib/agent/instructions.ts` changed many times, almost all driven
by eval failures: Green Line branches named wrong, hours bucketed where periods were meant, the
wrong reference stop. Change the prompt, re-run, keep the better version. The same
harness produced the model comparison in [docs/observability-evaluation.md](docs/observability-evaluation.md#what-the-evaluation-found): six configurations across GPT-5.6 Luna
(three effort levels), Gemini 3.6 Flash, Llama 4 Maverick, and one run with `ask_user`
off to measure what clarification is worth.

Without an eval, improving a prompt is rewording and hoping. With it, each change is
measurably better or it gets reverted.