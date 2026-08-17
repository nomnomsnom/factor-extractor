# Agent Graph

A general-purpose multi-agent graph, with a browser UI for configuring and
watching runs.

```
                 ┌── research agent ──┐        ┌── worker agent ──┐
  lead agent ────┼── research agent ──┼────────┼── worker agent ──┼──▶ compiler ──▶ action agent
   (planner)     └── research agent ──┘        └── worker agent ──┘       │            (optional)
        ▲                                                                 │
        └──────────────── revise: coverage below the bar ─────────────────┘
```

The lead agent decides the shape of each run, so one graph covers a one-line
lookup and a multi-round deep-research task. **Every fan-out stage can be
empty** — a question the lead can answer from context commissions zero research
agents, and a pure-retrieval task commissions zero workers.

LangGraph owns the topology; the model layer talks to the Claude API directly.

## The published page

**<https://nomnomsnom.github.io/factor-extractor/agent-graph/>**

The same interface as one self-contained HTML file — no imports, no stylesheet
links, no backend. Two ways to run it there:

- **Simulate** needs nothing. The graph fans out, revises and compiles against
  your real settings with placeholder content, so the topology is explorable
  offline. It makes no network request at all.
- **Claude** runs the graph for real against **your own** Anthropic key, pasted
  into the page. Requests go straight from your browser to
  `api.anthropic.com` — there is no server in between to send them to.
  Research agents get web search, so a real run does reach the internet.

Because the page is static, a few things only exist in the Python build: the
file tools (a browser has no filesystem), `action_mode: execute`, and output
budgets above 16K tokens (the browser build does not stream).

**About the key.** It is yours, not the site's, and nothing here can bill you
for someone else's run. It lives in memory for the tab unless you tick *Keep
it in this browser*, which moves it to `localStorage` where anything with
access to the browser profile can read it. The page ships a
Content-Security-Policy whose `connect-src` is `https://api.anthropic.com` and
nothing else, so even script injected into the page could not post the key
elsewhere. Still: use a key you can rotate, and prefer one scoped to a
workspace with a spend limit.

Building it locally:

```bash
python -m agent_graph.bundle     # writes dist/agent-graph.html
```

Open that file straight off the filesystem, mail it, or drop it on any static
host. CI rebuilds it from `ui/`, `config.py` and `prompts.py` on every push to
`main`, so the published page cannot drift from the source.

### How it gets published

This repo's Pages source is **"Deploy from a branch" → `gh-pages`**, not
"GitHub Actions". `gh-pages` holds a hand-published `index.html` (rngdle), so
the workflow writes `agent-graph/index.html` into that branch and touches
nothing else.

That is deliberate. `gh-pages`' rngdle is **ahead of** `rngdle/` on `main` —
the live game has 230 badges, `main` builds 169, and the newer version sits on
the unmerged `claude/rngdle-research-build-4inh1j` branch. Switching Pages to
"GitHub Actions" and building both sites from source would therefore *downgrade
the live rngdle*. To go that route, merge the rngdle branch to `main` first,
then flip the setting.

## Quick start

```bash
pip install -r agent_graph/requirements.txt

# Configuration UI at http://127.0.0.1:8000
python -m agent_graph.cli --serve

# Or straight from the terminal
export ANTHROPIC_API_KEY=...          # or: ant auth login
python -m agent_graph.cli --stream --preset deep \
  "Compare three momentum factor definitions and write a one-page brief"

# No key? The mock provider exercises the whole graph offline.
python -m agent_graph.cli --mock --stream "anything"
```

## The five stages

| Stage | What it does | Tools |
|---|---|---|
| **lead** | Reads the task and emits a plan: the research questions, the worker briefs, the success criteria, and whether action is needed. Clamped to the configured ceilings. | none |
| **research** | One question per agent, in parallel. Searches, reads, and reports with sources. | web search / fetch, read, list, calculator |
| **worker** | One brief per agent, in parallel, with the findings in hand. Drafts, fills templates, computes, restructures. | same, minus write |
| **compiler** | Assembles the single deliverable, then grades its own output against the success criteria. | none |
| **action** | Acts on the finished deliverable — one action per agent. | + write, in execute mode only |

After the compiler grades the work, the graph either finishes, runs the action
stage, or sends specific unanswered questions back to the lead for another
round. A revision needs all four of: the compiler asked for one, it supplied
concrete follow-up questions, coverage is under the quality bar, and rounds
remain.

## Configuration

Presets seed the ceilings and the reasoning effort; anything you set explicitly
survives the seeding.

| Preset | Research | Workers | Rounds | Model calls | Effort |
|---|---|---|---|---|---|
| quick | 2 | 1 | 1 | 20 | low |
| standard | 4 | 4 | 2 | 60 | medium |
| deep | 8 | 8 | 3 | 140 | high |
| exhaustive | 12 | 12 | 5 | 320 | xhigh |

Beyond the preset you can set, per run: the deliverable format (report, brief,
bullets, JSON against your own schema, template fill, code, or free-form), the
model / effort / token budget **per role**, which tools each stage may use, the
filesystem sandbox root, and the quality bar that triggers a revision round.

Every role defaults to `claude-opus-5`. The research and worker legs are the
reading-heavy ones, so those are where a cheaper model saves the most if you
want to trade capability for cost.

`Export` writes the config as JSON; the CLI takes the same file via `--config`.

## Deliverable formats

`report`, `brief`, `bullets`, and `code` shape the compiler's prose.
`template` preserves your template's structure and fills only its placeholders.
`json` constrains the output to a JSON Schema you supply — the compiler's text
is passed through one further schema-constrained call, so the result validates
rather than merely looking like JSON. `custom` takes free-form instructions.

## Safety rails

- **Filesystem sandbox.** Every path from `read_file` / `write_file` /
  `list_dir` is resolved and rejected if it leaves the workspace root.
- **Write is gated twice** — by the tool config *and* by `action_mode:
  execute`. Research and worker agents never get it.
- **`action_mode: propose`** (the default) has action agents describe exactly
  what they would do without executing anything.
- **Budget ceiling.** `max_llm_calls` stops a run that fans out further than
  you intended; the partial result still comes back.
- **The calculator is arithmetic only** — an AST walk over numeric operators,
  not `eval`.
- A single agent failing is recorded as a failed finding and the run continues.
  A refusal or a budget stop ends the run and is reported as the run's status.

## HTTP API

| | |
|---|---|
| `GET /api/schema` | models, presets, tool list, defaults, credential status |
| `POST /api/validate` | normalise a config and show the resolved preset values |
| `POST /api/run` | run the graph, streaming events back as SSE |

## Layout

```
config.py    the run configuration and its presets
bundle.py    packs ui/ + the schema and prompts into one static HTML file
llm.py       every call to Claude: JSON calls, the tool-use loop, budgets
tools.py     server-tool specs, the local tools, the filesystem sandbox
prompts.py   system prompts and the JSON schemas each stage returns
nodes.py     the five stages
graph.py     topology, dynamic fan-out, the revision route
runner.py    run() and stream()
server.py    FastAPI app
mock.py      deterministic stand-in provider
ui/          the frontend
  app.js       config form, live topology, output panes; transport-agnostic
  engine.js    the graph again, in JS, for the published page's real runs
  simulate.js  the offline stand-in that needs no key
```

`engine.js` re-implements the orchestration that `nodes.py` and `graph.py` do,
because the published page has no Python behind it. The prompts and schemas are
*not* duplicated — `bundle.py` injects them from `prompts.py`, so only the
orchestration exists twice, and both sides are tested.

## Tests

```bash
python -m pytest tests/test_agent_graph.py     # the Python graph
node --test agent_graph/ui/engine.test.mjs     # the browser engine's arithmetic
```

Both run offline — no API key, no network. Between them they cover the
zero-agent stages, the fan-out ceilings, the revision loop, the budget stop,
the sandbox escapes, the shape of the requests sent to the API, and the
expression evaluator the browser build uses in place of Python's.
