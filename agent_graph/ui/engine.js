/* The graph, running in the browser against the Claude API.
 *
 * This is the runtime for the published single-file build, where there is no
 * Python backend. It mirrors agent_graph/nodes.py and graph.py: the same five
 * stages, the same ceilings, the same revision gate. The system prompts and
 * JSON schemas are not duplicated here — they are injected at bundle time from
 * prompts.py, so they cannot drift from the server implementation.
 *
 * Calls go straight from the page to api.anthropic.com with the visitor's own
 * key. Anthropic gates that on an explicit header (see BROWSER_HEADER); without
 * it the API refuses the origin outright.
 *
 * Two differences from the Python runtime, both forced by the browser:
 *   - No filesystem, so read_file / list_dir / write_file do not exist here.
 *     Web search, web fetch and the calculator do.
 *   - Requests are non-streaming, so max_tokens is capped (see TOKEN_CAP).
 */
window.AgentGraphEngine = (() => {
  "use strict";

  const ENDPOINT = "https://api.anthropic.com/v1/messages";
  const API_VERSION = "2023-06-01";
  const BROWSER_HEADER = "anthropic-dangerous-direct-browser-access";

  // Above roughly this many output tokens a non-streaming request risks an
  // HTTP timeout. The browser build does not stream, so it clamps instead.
  const TOKEN_CAP = 16000;

  const NO_THINKING_PARAM = new Set(["claude-fable-5", "claude-mythos-5"]);
  const HIGH_EFFORTS = new Set(["xhigh", "max"]);
  const MODERN_SEARCH_MODELS = new Set([
    "claude-opus-5", "claude-opus-4-8", "claude-opus-4-7", "claude-opus-4-6",
    "claude-sonnet-5", "claude-sonnet-4-6", "claude-fable-5",
  ]);

  const P = () => window.__AGENT_GRAPH_STATIC__.prompts;

  class BudgetExceeded extends Error {}
  class Refusal extends Error {
    constructor(category, explanation) {
      super(`the model declined this request (${category || "unspecified"})` +
            (explanation ? `: ${explanation}` : ""));
      this.category = category;
    }
  }
  class ApiError extends Error {}

  /* ── request plumbing ─────────────────────────────────────────────────── */

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  async function request(apiKey, body, attempt = 0) {
    let response;
    try {
      response = await fetch(ENDPOINT, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": API_VERSION,
          [BROWSER_HEADER]: "true",
        },
        body: JSON.stringify(body),
      });
    } catch (err) {
      throw new ApiError(
        "Could not reach api.anthropic.com. Check your connection — the page " +
        "itself is static, so this request goes straight from your browser to " +
        `Anthropic. (${err.message})`);
    }

    if (response.ok) return response.json();

    const detail = await response.json().catch(() => null);
    const message = detail?.error?.message || response.statusText;

    // 429 and 5xx are worth retrying; 4xx are not.
    if ((response.status === 429 || response.status >= 500) && attempt < 3) {
      const header = Number(response.headers.get("retry-after"));
      const delay = Number.isFinite(header) && header > 0
        ? header * 1000
        : Math.min(30000, 1000 * 2 ** attempt) + Math.random() * 500;
      await sleep(delay);
      return request(apiKey, body, attempt + 1);
    }

    if (response.status === 401) {
      throw new ApiError("Anthropic rejected the API key (401). Check that it " +
                         "is current and pasted in full.");
    }
    if (response.status === 403) {
      throw new ApiError("That key lacks access to this model or feature (403). " +
                         `${message}`);
    }
    if (response.status === 429) {
      throw new ApiError(`Rate limited, and retries did not clear it. ${message}`);
    }
    throw new ApiError(`Anthropic returned ${response.status}: ${message}`);
  }

  function thinkingParam(role) {
    if (NO_THINKING_PARAM.has(role.model)) return null;   // always on; sending is a 400
    if (role.thinking !== false) return { type: "adaptive" };
    // `disabled` above `high` effort is rejected, so fall back to adaptive.
    if (HIGH_EFFORTS.has(role.effort)) return { type: "adaptive" };
    return { type: "disabled" };
  }

  function baseBody(role, config, extra = {}) {
    const body = {
      model: role.model,
      max_tokens: Math.min(role.max_tokens || TOKEN_CAP, TOKEN_CAP),
      output_config: { effort: role.effort, ...(extra.output_config || {}) },
      ...extra.rest,
    };
    const thinking = thinkingParam(role);
    if (thinking) body.thinking = thinking;
    return body;
  }

  function systemBlocks(text, config) {
    if (!config.prompt_caching) return text;
    return [{ type: "text", text, cache_control: { type: "ephemeral" } }];
  }

  function textOf(message) {
    return (message.content || [])
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("\n")
      .trim();
  }

  function guardRefusal(message) {
    if (message.stop_reason === "refusal") {
      throw new Refusal(message.stop_details?.category,
                        message.stop_details?.explanation);
    }
  }

  /* Structured outputs guarantee valid JSON; stay defensive anyway. */
  function parseJson(text) {
    const trimmed = (text || "").trim();
    try { return JSON.parse(trimmed); } catch { /* fall through */ }
    const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(trimmed);
    if (fenced) {
      try { return JSON.parse(fenced[1]); } catch { /* fall through */ }
    }
    const braced = /\{[\s\S]*\}/.exec(trimmed);
    if (braced) return JSON.parse(braced[0]);
    throw new Error(`expected JSON, got: ${trimmed.slice(0, 200)}`);
  }

  function collectSources(message) {
    const found = [];
    for (const block of message.content || []) {
      if (block.type === "web_search_tool_result") {
        // On success `content` is a list of results; on error it is one object
        // carrying an error_code.
        if (Array.isArray(block.content)) {
          for (const item of block.content) {
            found.push({ title: item.title || "", url: item.url || "" });
          }
        }
      } else if (block.type === "text" && Array.isArray(block.citations)) {
        for (const citation of block.citations) {
          if (citation.url) {
            found.push({ title: citation.title || "", url: citation.url });
          }
        }
      }
    }
    const seen = new Set();
    return found.filter((source) => {
      const key = source.url || source.title;
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function usageOf(message) {
    const u = message.usage || {};
    return {
      calls: 1,
      input_tokens: u.input_tokens || 0,
      output_tokens: u.output_tokens || 0,
      cache_read_tokens: u.cache_read_input_tokens || 0,
      cache_write_tokens: u.cache_creation_input_tokens || 0,
      web_searches: u.server_tool_use?.web_search_requests || 0,
    };
  }

  /* ── tools ────────────────────────────────────────────────────────────── */

  const BIN_OPS = { "+": 1, "-": 1, "*": 1, "/": 1, "%": 1, "**": 1 };

  /* Arithmetic only. Rejects anything that is not numbers and operators, then
     evaluates with the shunting-yard algorithm — never with eval(). */
  function calculate(expression) {
    if (typeof expression !== "string" || expression.length > 500) {
      throw new Error("expression too long");
    }
    const tokens = expression.match(/(\d+\.?\d*|\*\*|[-+*/%()])/g) || [];
    if (tokens.join("").replace(/\s/g, "") !== expression.replace(/\s/g, "")) {
      throw new Error("only numeric arithmetic is supported");
    }

    // Unary minus is its own operator ("u-"), binding tighter than * but
    // looser than **, so -2 ** 2 is -(2 ** 2) and 1 - -2 is 3.
    const precedence = { "+": 1, "-": 1, "*": 2, "/": 2, "%": 2, "u-": 2.5, "**": 3 };
    const output = [];
    const operators = [];
    let previous = null;

    for (const token of tokens) {
      if (/^\d/.test(token)) {
        output.push(Number(token));
      } else if (token === "(") {
        operators.push(token);
      } else if (token === ")") {
        while (operators.length && operators[operators.length - 1] !== "(") {
          output.push(operators.pop());
        }
        if (!operators.length) throw new Error("unbalanced parentheses");
        operators.pop();
      } else if (BIN_OPS[token]) {
        // A '+' or '-' in leading position, after '(', or after another
        // operator is a sign rather than a binary operator.
        const unary = (token === "-" || token === "+") &&
          (previous === null || previous === "(" || BIN_OPS[previous]);
        if (unary) {
          // Prefix and right-associative: nothing pending should pop first.
          if (token === "-") operators.push("u-");
        } else {
          while (operators.length) {
            const top = operators[operators.length - 1];
            if (top === "(") break;
            const rightAssociative = token === "**";
            if (precedence[top] > precedence[token] ||
                (precedence[top] === precedence[token] && !rightAssociative)) {
              output.push(operators.pop());
            } else break;
          }
          operators.push(token);
        }
      } else {
        throw new Error(`unexpected token: ${token}`);
      }
      previous = token;
    }
    while (operators.length) {
      const op = operators.pop();
      if (op === "(") throw new Error("unbalanced parentheses");
      output.push(op);
    }

    const stack = [];
    for (const item of output) {
      if (typeof item === "number") { stack.push(item); continue; }
      if (item === "u-") {
        const operand = stack.pop();
        if (operand === undefined) throw new Error("malformed expression");
        stack.push(-operand);
        continue;
      }
      const right = stack.pop();
      const left = stack.pop();
      if (left === undefined || right === undefined) {
        throw new Error("malformed expression");
      }
      if (item === "**" && Math.abs(right) > 64) {
        throw new Error("exponent out of range");
      }
      stack.push(
        item === "+" ? left + right :
        item === "-" ? left - right :
        item === "*" ? left * right :
        item === "/" ? left / right :
        item === "%" ? left % right :
        left ** right,
      );
    }
    if (stack.length !== 1 || !Number.isFinite(stack[0])) {
      throw new Error("malformed expression");
    }
    return String(stack[0]);
  }

  const CALCULATOR_SPEC = {
    name: "calculator",
    description:
      "Evaluate one arithmetic expression and return the result. Supports " +
      "+ - * / % ** and parentheses over numbers. Use it whenever a figure in " +
      "your answer comes from arithmetic, rather than computing it in your " +
      "head. It does not run general code.",
    input_schema: {
      type: "object",
      properties: {
        expression: { type: "string", description: "e.g. (1250 * 0.07) / 12" },
      },
      required: ["expression"],
    },
  };

  /* Which tools a role gets. The browser has no filesystem, so the file tools
     from the Python build are absent by construction rather than disabled. */
  function toolsFor(config, roleName, model) {
    const enabled = new Set(config.roles?.[roleName]?.tools || []);
    const specs = [];
    const modern = MODERN_SEARCH_MODELS.has(model);
    const maxUses = config.tools?.max_web_searches || 8;

    if (enabled.has("web_search") && config.tools?.web_search) {
      specs.push({
        type: modern ? "web_search_20260209" : "web_search_20250305",
        name: "web_search",
        max_uses: maxUses,
      });
    }
    if (enabled.has("web_fetch") && config.tools?.web_fetch && modern) {
      specs.push({ type: "web_fetch_20260209", name: "web_fetch", max_uses: maxUses });
    }
    if (enabled.has("calculator") && config.tools?.calculator) {
      specs.push(CALCULATOR_SPEC);
    }

    const execute = (name, input) => {
      if (name === "calculator") return calculate(input.expression);
      throw new Error(`tool '${name}' is not available in the browser build`);
    };
    return { specs, execute };
  }

  /* ── the two primitives ───────────────────────────────────────────────── */

  function makeClient(config, apiKey, budget) {
    async function callJson({ role, system, prompt, schema }) {
      budget.check();
      const body = baseBody(role, config, {
        output_config: { format: { type: "json_schema", schema } },
        rest: {
          system: systemBlocks(system, config),
          messages: [{ role: "user", content: prompt }],
        },
      });
      const message = await request(apiKey, body);
      budget.add(usageOf(message));
      guardRefusal(message);
      return parseJson(textOf(message));
    }

    async function callAgent({ role, system, prompt, tools, execute, maxIterations,
                               onEvent }) {
      const messages = [{ role: "user", content: prompt }];
      const result = { text: "", sources: [], toolCalls: [], stop_reason: "end_turn" };

      for (let i = 0; i < maxIterations; i++) {
        budget.check();
        const body = baseBody(role, config, {
          rest: {
            system: systemBlocks(system, config),
            messages,
            ...(tools.length ? { tools } : {}),
          },
        });
        const message = await request(apiKey, body);
        budget.add(usageOf(message));
        guardRefusal(message);

        result.sources.push(...collectSources(message));
        result.stop_reason = message.stop_reason;

        // A server-side tool loop hit its internal cap; resend to resume.
        if (message.stop_reason === "pause_turn") {
          messages.splice(1, messages.length,
                          { role: "assistant", content: message.content });
          continue;
        }
        if (message.stop_reason !== "tool_use") {
          result.text = textOf(message);
          result.sources = dedupe(result.sources);
          return result;
        }

        messages.push({ role: "assistant", content: message.content });
        const results = [];
        for (const block of message.content) {
          if (block.type !== "tool_use") continue;
          onEvent?.({ type: "tool", name: block.name, input: block.input });
          let output;
          let isError = false;
          try {
            output = execute(block.name, block.input || {});
          } catch (err) {
            output = `${err.name}: ${err.message}`;
            isError = true;
          }
          result.toolCalls.push({
            name: block.name, input: block.input,
            output: String(output).slice(0, 2000), error: isError,
          });
          results.push({
            type: "tool_result",
            tool_use_id: block.id,
            content: String(output),
            is_error: isError,
          });
        }
        // All results go back in a single user message.
        messages.push({ role: "user", content: results });
      }

      result.text = result.text || "(agent stopped at its tool-iteration limit)";
      result.stop_reason = "max_iterations";
      result.sources = dedupe(result.sources);
      return result;
    }

    return { callJson, callAgent };
  }

  function dedupe(sources) {
    const seen = new Set();
    return sources.filter((source) => {
      const key = source.url || source.title;
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  /* ── prompt assembly (mirrors prompts.py) ─────────────────────────────── */

  const bullets = (items) =>
    (items || []).length ? items.map((i) => `- ${i}`).join("\n") : "(none)";

  function deliverableBrief(deliverable) {
    const described = P().deliverable_formats;
    const parts = [`Format: ${described[deliverable.format] || described.report}`];
    if (deliverable.audience) parts.push(`Audience: ${deliverable.audience}`);
    if (deliverable.format === "template" && deliverable.template) {
      parts.push("Template to fill:\n---\n" + deliverable.template + "\n---");
    }
    if (deliverable.format === "json" && deliverable.json_schema) {
      parts.push("The JSON must satisfy this schema:\n" +
                 JSON.stringify(deliverable.json_schema, null, 2));
    }
    if (deliverable.instructions) {
      parts.push("Format instructions: " + deliverable.instructions);
    }
    return parts.join("\n\n");
  }

  function findingsDigest(findings, full) {
    if (!findings.length) return "(none)";
    return findings.map((finding) => {
      const lines = [`### ${finding.question || finding.id}`];
      lines.push(`Confidence: ${finding.confidence || "unknown"}`);
      lines.push(finding.summary || "");
      if (full) {
        if (finding.key_points?.length) lines.push(bullets(finding.key_points));
        if (finding.sources?.length) {
          lines.push("Sources: " + finding.sources.slice(0, 10)
            .map((s) => `${s.title || s.url} <${s.url || ""}>`).join("; "));
        }
      }
      if (finding.gaps?.length) lines.push("Unresolved: " + finding.gaps.join("; "));
      return lines.filter(Boolean).join("\n");
    }).join("\n\n");
  }

  function artifactsDigest(artifacts) {
    if (!artifacts.length) return "(none)";
    return artifacts.map((artifact) => {
      const lines = [`### ${artifact.instruction || artifact.id}`];
      lines.push(artifact.output || "");
      if (artifact.notes) lines.push(`Worker notes: ${artifact.notes}`);
      if (artifact.assumptions?.length) {
        lines.push("Assumptions: " + artifact.assumptions.join("; "));
      }
      return lines.filter(Boolean).join("\n");
    }).join("\n\n");
  }

  function leadPrompt(config, state) {
    const limits = config.limits;
    const sections = [`# Task\n${config.task}`];
    if (config.context) sections.push(`# Supplied context\n${config.context}`);
    sections.push("# Deliverable\n" + deliverableBrief(config.deliverable));
    sections.push(
      "# Ceilings for this round\n" +
      `- research agents: at most ${limits.max_research_agents}\n` +
      `- worker agents: at most ${limits.max_worker_agents}\n` +
      `- action agents: at most ${limits.max_action_agents}\n` +
      `- action mode: ${config.action_mode}` +
      (config.action_mode === "off"
        ? "  (action agents are disabled; set needs_action to false)" : ""));
    sections.push(
      "# Environment\n" +
      "This run happens in a browser. The agents have web search and a " +
      "calculator; there is no filesystem, so do not plan work that reads or " +
      "writes files. Action agents can only describe what should be done.");

    if (!state.round) {
      sections.push("This is the first round. Plan the work from scratch.");
    } else {
      sections.push(
        `# Round ${state.round + 1} — gap filling\n` +
        "A first pass already ran. Commission only the work that closes the " +
        "gaps below; do not re-commission anything already answered.\n\n" +
        "## What the compiler found missing\n" +
        bullets(state.critique.unmet_criteria) +
        "\n\n## Open questions\n" + bullets(state.critique.followup_questions) +
        "\n\n## Already established\n" + findingsDigest(state.findings, false));
    }
    return sections.join("\n\n");
  }

  function researchPrompt(spec, config, prior) {
    const sections = [
      `# Your question\n${spec.question}`,
      `# Why it matters\n${spec.why || "(not stated)"}`,
      `# Depth\n${spec.depth || "normal"}`,
    ];
    if (config.context) sections.push(`# Context supplied with the task\n${config.context}`);
    if (prior.length) {
      sections.push("# Already established by earlier agents\n" +
                    "Do not re-derive these; build on them.\n\n" +
                    findingsDigest(prior, false));
    }
    sections.push(
      "Report your findings as prose. Cite a URL for each substantive claim, " +
      "and end with anything you could not resolve.");
    return sections.join("\n\n");
  }

  function workerPrompt(spec, config, findings) {
    const sections = [
      `# Your instruction\n${spec.instruction}`,
      `# Required output format\n${spec.output_format || "prose"}`,
    ];
    if (config.context) sections.push(`# Context supplied with the task\n${config.context}`);
    if (spec.needs_findings !== false) {
      sections.push("# Research findings\n" + (findings.length
        ? findingsDigest(findings, true)
        : "None were gathered. Work from the instruction and context, and " +
          "record what you assumed."));
    }
    return sections.join("\n\n");
  }

  function compilePrompt(config, state) {
    const plan = state.plan;
    const sections = [
      `# Objective\n${plan.objective || config.task}`,
      "# Success criteria\n" + bullets(plan.success_criteria),
      "# Deliverable specification\n" + deliverableBrief(config.deliverable),
    ];
    if (config.context) sections.push(`# Context supplied with the task\n${config.context}`);
    sections.push("# Research findings\n" + (state.findings.length
      ? findingsDigest(state.findings, true) : "None — no research agents ran."));
    sections.push("# Worker artifacts\n" + (state.artifacts.length
      ? artifactsDigest(state.artifacts) : "None — no worker agents ran."));

    const roundsLeft = config.limits.max_rounds - state.round - 1;
    sections.push(roundsLeft <= 0
      ? "This is the final round — no further research is possible. Set " +
        "needs_more_research to false and record anything still missing as caveats."
      : `${roundsLeft} further research round(s) are available if specific ` +
        "answerable questions would change the deliverable.");
    return sections.join("\n\n");
  }

  function actionPrompt(spec, config, report) {
    return [
      `# Your action\n${spec.description}`,
      `# Kind\n${spec.kind || "other"}`,
      `# Mode\n${config.action_mode}`,
      "# Environment\nThis run has no filesystem. Describe the action precisely; " +
      "report status \"proposed\".",
      "# The finished deliverable\n" + report,
    ].join("\n\n");
  }

  /* ── the graph ────────────────────────────────────────────────────────── */

  const COVERAGE_SCORE = { poor: 0.25, partial: 0.55, good: 0.82, complete: 1.0 };
  const clamp = (items, limit) => (items || []).slice(0, Math.max(0, limit));

  async function run(config, emit, { apiKey } = {}) {
    if (!apiKey) throw new ApiError("No API key was provided.");

    const started = Date.now();
    const usage = {
      calls: 0, input_tokens: 0, output_tokens: 0,
      cache_read_tokens: 0, cache_write_tokens: 0, web_searches: 0,
    };
    const budget = {
      add(delta) { for (const key of Object.keys(usage)) usage[key] += delta[key] || 0; },
      check() {
        if (usage.calls >= config.limits.max_llm_calls) {
          throw new BudgetExceeded(
            `run hit its ceiling of ${config.limits.max_llm_calls} model calls`);
        }
      },
    };
    const client = makeClient(config, apiKey, budget);

    const state = {
      round: 0, plan: {}, critique: {},
      findings: [], artifacts: [], actions: [], report: "",
    };
    let status = "complete";
    let error = null;

    emit({ type: "run", status: "started", at: started / 1000, config });

    try {
      for (;;) {
        await leadStage();
        await fanOut("research", state.plan.research_tasks, researchAgent);
        await fanOut("worker", state.plan.worker_tasks, workerAgent);
        const again = await compileStage();
        if (!again) break;
      }
      await actionStage();
    } catch (err) {
      status = err instanceof BudgetExceeded ? "budget_exceeded"
             : err instanceof Refusal ? "refused"
             : "error";
      error = err.message;
      emit({ type: "log", level: "error", message: err.message });
    }

    const result = {
      status, error,
      report: state.report,
      structured: state.structured ?? null,
      plan: state.plan,
      critique: state.critique,
      findings: state.findings,
      artifacts: state.artifacts,
      actions: state.actions,
      rounds: state.round,
      usage,
      elapsed_seconds: Number(((Date.now() - started) / 1000).toFixed(2)),
    };
    emit({ type: "run", status, result });
    return result;

    /* -- stages -------------------------------------------------------- */

    async function leadStage() {
      const id = `lead-r${state.round}`;
      const label = `Planning (round ${state.round + 1})`;
      emit({ type: "agent", stage: "lead", id, status: "running", label });

      const role = config.roles.lead;
      const plan = await client.callJson({
        role,
        system: P().LEAD_SYSTEM,
        prompt: leadPrompt(config, state),
        schema: P().PLAN_SCHEMA,
      });

      plan.research_tasks = clamp(plan.research_tasks, config.limits.max_research_agents);
      plan.worker_tasks = clamp(plan.worker_tasks, config.limits.max_worker_agents);
      if (config.action_mode === "off") {
        plan.needs_action = false;
        plan.action_tasks = [];
      } else {
        plan.action_tasks = clamp(plan.action_tasks, config.limits.max_action_agents);
      }
      state.plan = plan;

      emit({
        type: "agent", stage: "lead", id, status: "done", label,
        summary: `${plan.research_tasks.length} research, ` +
                 `${plan.worker_tasks.length} worker, ${plan.action_tasks.length} action`,
        plan,
      });
    }

    async function fanOut(stage, specs, work) {
      if (!specs || !specs.length) {
        emit({ type: "stage", stage, status: "skipped", count: 0 });
        return;
      }
      const labelOf = (spec) =>
        spec.question || spec.instruction || spec.description || spec.id;
      emit({
        type: "stage", stage, status: "fanout", count: specs.length,
        agents: specs.map((spec) => ({ id: spec.id, label: labelOf(spec) })),
      });
      // Genuinely parallel: the agents in a stage are independent by design.
      await Promise.all(specs.map((spec) => work(spec, labelOf(spec))));
    }

    async function researchAgent(spec, label) {
      const stage = "research";
      emit({ type: "agent", stage, id: spec.id, status: "running", label });
      const role = config.roles.research;
      const { specs, execute } = toolsFor(config, "research", role.model);
      try {
        const result = await client.callAgent({
          role, system: P().RESEARCH_SYSTEM,
          prompt: researchPrompt(spec, config, state.findings),
          tools: specs, execute,
          maxIterations: config.limits.max_tool_iterations,
          onEvent: (event) => emit({ ...event, stage, id: spec.id }),
        });
        // Web search attaches citations, which cannot be combined with
        // output_config.format, so the shaping is a second call.
        const structured = await client.callJson({
          role,
          system: "Restate the research report below as structured data. Use " +
                  "only what the report contains; do not add findings of your own.",
          prompt: result.text,
          schema: P().FINDING_SCHEMA,
        });
        state.findings.push({
          id: spec.id, question: spec.question, report: result.text,
          sources: result.sources, tool_calls: result.toolCalls.length, ...structured,
        });
        emit({
          type: "agent", stage, id: spec.id, status: "done", label,
          summary: (structured.summary || "").slice(0, 400),
          sources: result.sources.length,
        });
      } catch (err) {
        if (err instanceof BudgetExceeded) throw err;
        state.findings.push({
          id: spec.id, question: spec.question, failed: true,
          summary: `This question was not answered: ${err.message}`,
          key_points: [], confidence: "low", gaps: [spec.question],
          sources: [], report: "",
        });
        emit({ type: "agent", stage, id: spec.id, status: "error", label,
               summary: err.message });
      }
    }

    async function workerAgent(spec, label) {
      const stage = "worker";
      emit({ type: "agent", stage, id: spec.id, status: "running", label });
      const role = config.roles.worker;
      const { specs, execute } = toolsFor(config, "worker", role.model);
      try {
        const result = await client.callAgent({
          role, system: P().WORKER_SYSTEM,
          prompt: workerPrompt(spec, config, state.findings),
          tools: specs, execute,
          maxIterations: config.limits.max_tool_iterations,
          onEvent: (event) => emit({ ...event, stage, id: spec.id }),
        });
        const structured = await client.callJson({
          role,
          system: "Restate the worker output below as structured data, " +
                  "preserving the produced artifact verbatim in `output`.",
          prompt: result.text,
          schema: P().ARTIFACT_SCHEMA,
        });
        state.artifacts.push({ id: spec.id, instruction: spec.instruction, ...structured });
        emit({ type: "agent", stage, id: spec.id, status: "done", label,
               summary: (structured.output || "").slice(0, 400) });
      } catch (err) {
        if (err instanceof BudgetExceeded) throw err;
        state.artifacts.push({
          id: spec.id, instruction: spec.instruction, output: "",
          notes: `This worker failed: ${err.message}`, assumptions: [], failed: true,
        });
        emit({ type: "agent", stage, id: spec.id, status: "error", label,
               summary: err.message });
      }
    }

    /* Returns true when the compiler wants another round. */
    async function compileStage() {
      const id = `compiler-r${state.round}`;
      emit({ type: "agent", stage: "compiler", id, status: "running",
             label: "Compiling findings" });

      const role = config.roles.compiler;
      const critique = await client.callJson({
        role, system: P().COMPILER_SYSTEM,
        prompt: compilePrompt(config, state),
        schema: P().COMPILE_SCHEMA,
      });
      state.critique = critique;
      state.report = critique.deliverable || "";
      state.round += 1;

      const deliverable = config.deliverable;
      if (deliverable.format === "json" && deliverable.json_schema) {
        try {
          state.structured = await client.callJson({
            role,
            system: "Return the content below as a JSON object matching the " +
                    "required schema. Use only what is present; do not invent values.",
            prompt: state.report,
            schema: deliverable.json_schema,
          });
          state.report = JSON.stringify(state.structured, null, 2);
        } catch (err) {
          (critique.caveats ||= []).push(
            `Could not conform the output to the supplied JSON Schema: ${err.message}`);
        }
      }

      emit({
        type: "agent", stage: "compiler", id, status: "done",
        label: "Compiling findings", summary: `coverage: ${critique.coverage}`,
        coverage: critique.coverage,
      });

      const coverage = COVERAGE_SCORE[critique.coverage] ?? 0.5;
      const again = Boolean(critique.needs_more_research) &&
                    Boolean(critique.followup_questions?.length) &&
                    coverage < config.limits.quality_bar &&
                    state.round < config.limits.max_rounds;
      if (again) {
        emit({
          type: "stage", stage: "revise", status: "fanout", count: 1,
          reason: `coverage ${critique.coverage} is below the ` +
                  `${config.limits.quality_bar.toFixed(2)} bar; ` +
                  `round ${state.round + 1} of ${config.limits.max_rounds}`,
        });
      }
      return again;
    }

    async function actionStage() {
      const specs = state.plan.action_tasks;
      if (config.action_mode === "off" || !state.plan.needs_action ||
          !specs || !specs.length) {
        emit({ type: "stage", stage: "action", status: "skipped", count: 0 });
        return;
      }
      await fanOut("action", specs, async (spec, label) => {
        const stage = "action";
        emit({ type: "agent", stage, id: spec.id, status: "running", label });
        const role = config.roles.action;
        const { specs: toolSpecs, execute } = toolsFor(config, "action", role.model);
        try {
          const result = await client.callAgent({
            role, system: P().ACTION_SYSTEM,
            prompt: actionPrompt(spec, config, state.report),
            tools: toolSpecs, execute,
            maxIterations: config.limits.max_tool_iterations,
            onEvent: (event) => emit({ ...event, stage, id: spec.id }),
          });
          const structured = await client.callJson({
            role, system: "Restate the action report below as structured data.",
            prompt: result.text, schema: P().ACTION_SCHEMA,
          });
          state.actions.push({
            id: spec.id, description: spec.description, kind: spec.kind,
            mode: config.action_mode, tool_calls: result.toolCalls, ...structured,
          });
          emit({ type: "agent", stage, id: spec.id, status: "done", label,
                 summary: (structured.detail || "").slice(0, 400),
                 action_status: structured.status });
        } catch (err) {
          if (err instanceof BudgetExceeded) throw err;
          state.actions.push({
            id: spec.id, description: spec.description, status: "failed",
            detail: err.message, artifacts: [],
          });
          emit({ type: "agent", stage, id: spec.id, status: "error", label,
                 summary: err.message });
        }
      });
    }
  }

  /* One cheap call, so a visitor finds out immediately whether their key works
     rather than after a full fan-out. */
  async function testKey(apiKey, model) {
    const message = await request(apiKey, {
      model: model || "claude-opus-5",
      max_tokens: 16,
      messages: [{ role: "user", content: "Reply with the single word: ready" }],
    });
    return textOf(message) || "(empty reply)";
  }

  return { run, testKey, calculate, ApiError, Refusal, BudgetExceeded };
})();
