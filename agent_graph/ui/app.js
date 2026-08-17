/* Agent Graph — configuration UI + live run view. */
(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const el = (tag, cls, text) => {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text != null) node.textContent = text;
    return node;
  };

  const STAGES = ["lead", "research", "worker", "compiler", "action"];
  const STORAGE_KEY = "agent-graph.config.v1";

  let META = null;          // schema payload: models, presets, tools, defaults
  let ABORT = null;         // AbortController for a live run
  const NODES = new Map();  // agent id -> { stage, status, el }

  /* ── transports ───────────────────────────────────────────────────────────
     The served app talks to the Python backend. The published single-file
     build has no backend, so it runs the simulator in the page instead. Both
     expose the same two methods, and everything below is written against them
     rather than against fetch. */

  const ServerTransport = {
    isStatic: false,

    async schema() {
      return (await fetch("/api/schema")).json();
    },

    async run(config, onEvent) {
      ABORT = new AbortController();
      try {
        const response = await fetch("/api/run", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(config),
          signal: ABORT.signal,
        });

        if (!response.ok) {
          const body = await response.json().catch(() => ({}));
          throw new Error("Config rejected: " +
            JSON.stringify(body.errors || body));
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const chunks = buffer.split("\n\n");
          buffer = chunks.pop();
          for (const chunk of chunks) {
            const line = chunk.split("\n").find((l) => l.startsWith("data: "));
            if (!line) continue;
            try { onEvent(JSON.parse(line.slice(6))); }
            catch (err) { log("bad event: " + err.message, "err"); }
          }
        }
      } finally {
        ABORT = null;
      }
    },
  };

  /* The published build has no backend. `provider: anthropic` runs the graph in
     the page against the visitor's own key; `provider: mock` runs the simulator,
     which touches the network not at all. */
  const StaticTransport = {
    isStatic: true,
    cancelled: false,

    async schema() {
      return window.__AGENT_GRAPH_STATIC__.schema;
    },

    async run(config, onEvent) {
      StaticTransport.cancelled = false;
      ABORT = { abort: () => { StaticTransport.cancelled = true; } };
      const guard = (event) => {
        if (!StaticTransport.cancelled) onEvent(event);
      };
      try {
        if (config.provider === "mock") {
          await window.AgentGraphSimulator.run(config, guard);
          return;
        }
        const apiKey = readKey();
        if (!apiKey) {
          throw new Error(
            "This page has no server, so a real run needs your own Anthropic " +
            "API key — add one at the top of the panel, or switch the provider " +
            "to Mock to watch a simulated run instead.");
        }
        await window.AgentGraphEngine.run(config, guard, { apiKey });
      } finally {
        ABORT = null;
      }
    },
  };

  const TRANSPORT = window.__AGENT_GRAPH_STATIC__ ? StaticTransport : ServerTransport;
  const RUN_LABEL = "Run graph";

  /* ── key handling (static build only) ─────────────────────────────────── */

  const KEY_NAME = "agent-graph.api-key";
  let MEMORY_KEY = "";  // default home for the key: this tab, this session

  function readKey() {
    return (MEMORY_KEY || localStorage.getItem(KEY_NAME) || "").trim();
  }

  function storeKey(value, remember) {
    MEMORY_KEY = value;
    if (remember && value) localStorage.setItem(KEY_NAME, value);
    else localStorage.removeItem(KEY_NAME);
  }

  function forgetKey() {
    MEMORY_KEY = "";
    localStorage.removeItem(KEY_NAME);
    $("api-key").value = "";
    $("remember-key").checked = false;
    setKeyStatus("Key forgotten.", "");
  }

  function setKeyStatus(message, kind) {
    const node = $("key-status");
    node.textContent = message;
    node.style.color = kind === "ok" ? "var(--ok)"
      : kind === "err" ? "var(--err)" : "";
  }

  /* ── config <-> form ──────────────────────────────────────────────────── */

  const segValue = (id) => $(id).querySelector("button.on")?.dataset.value;
  const setSeg = (id, value) => {
    $(id).querySelectorAll("button").forEach((b) => {
      const on = b.dataset.value === value;
      b.classList.toggle("on", on);
      b.setAttribute("aria-checked", String(on));
      // Roving tabindex: one stop for the group, arrows move within it.
      b.tabIndex = on ? 0 : -1;
    });
  };

  function readConfig() {
    const format = $("deliverable-format").value;
    let schema = null;
    const raw = $("deliverable-schema").value.trim();
    if (format === "json" && raw) {
      try { schema = JSON.parse(raw); }
      catch (err) { throw new Error("The JSON Schema is not valid JSON: " + err.message); }
    }

    const roles = {};
    for (const role of META.roles) {
      roles[role] = {
        model: $(`role-${role}-model`).value,
        effort: $(`role-${role}-effort`).value,
        max_tokens: Number($(`role-${role}-tokens`).value),
        thinking: $(`role-${role}-thinking`).checked,
      };
    }

    const tools = {
      workspace: $("workspace").value || ".",
      max_web_searches: Number($("max_web_searches").value),
    };
    for (const name of [...META.tools.server, ...META.tools.local]) {
      tools[name] = $(`tool-${name}`).checked;
    }

    return {
      task: $("task").value,
      context: $("context").value,
      preset: segValue("preset"),
      effort: $("effort").value,
      action_mode: segValue("action_mode"),
      provider: segValue("provider"),
      prompt_caching: $("prompt_caching").checked,
      deliverable: {
        format,
        audience: $("deliverable-audience").value,
        template: $("deliverable-template").value,
        json_schema: schema,
        instructions: $("deliverable-instructions").value,
      },
      limits: {
        max_research_agents: Number($("max_research_agents").value),
        max_worker_agents: Number($("max_worker_agents").value),
        max_action_agents: Number($("max_action_agents").value),
        max_rounds: Number($("max_rounds").value),
        max_llm_calls: Number($("max_llm_calls").value),
        max_tool_iterations: Number($("max_tool_iterations").value),
        quality_bar: Number($("quality_bar").value),
      },
      tools,
      roles,
    };
  }

  function writeConfig(cfg) {
    $("task").value = cfg.task || "";
    $("context").value = cfg.context || "";
    setSeg("preset", cfg.preset);
    setSeg("action_mode", cfg.action_mode);
    setSeg("provider", cfg.provider);
    $("effort").value = cfg.effort;
    $("prompt_caching").checked = cfg.prompt_caching !== false;

    const d = cfg.deliverable || {};
    $("deliverable-format").value = d.format || "report";
    $("deliverable-audience").value = d.audience || "";
    $("deliverable-template").value = d.template || "";
    $("deliverable-instructions").value = d.instructions || "";
    $("deliverable-schema").value = d.json_schema
      ? JSON.stringify(d.json_schema, null, 2) : "";

    for (const [key, value] of Object.entries(cfg.limits || {})) {
      if ($(key)) $(key).value = value;
    }
    $("quality_bar_out").textContent = Number(cfg.limits?.quality_bar ?? 0.8).toFixed(2);

    const tools = cfg.tools || {};
    for (const name of [...META.tools.server, ...META.tools.local]) {
      if ($(`tool-${name}`)) $(`tool-${name}`).checked = !!tools[name];
    }
    $("workspace").value = tools.workspace ?? ".";
    $("max_web_searches").value = tools.max_web_searches ?? 8;

    for (const role of META.roles) {
      const r = (cfg.roles || {})[role] || {};
      $(`role-${role}-model`).value = r.model || META.defaults.roles[role].model;
      $(`role-${role}-effort`).value = r.effort || cfg.effort;
      $(`role-${role}-tokens`).value = r.max_tokens || 16000;
      $(`role-${role}-thinking`).checked = r.thinking !== false;
    }

    syncDeliverableFields();
    syncHints();
  }

  /* ── form construction ────────────────────────────────────────────────── */

  function buildForm() {
    fillSelect($("effort"), META.efforts);
    fillSelect($("deliverable-format"), META.formats);

    const toolsHost = $("tools");
    const describe = {
      web_search: "Web search — Claude searches and cites live sources",
      web_fetch: "Web fetch — retrieve a page named in the conversation",
      read_file: "Read files inside the workspace",
      list_dir: "List workspace directories",
      write_file: "Write files (action agents in execute mode only)",
      calculator: "Arithmetic evaluator",
    };
    for (const name of [...META.tools.server, ...META.tools.local]) {
      const label = el("label", "check");
      const input = el("input");
      input.type = "checkbox";
      input.id = `tool-${name}`;
      label.append(input, el("span", null, describe[name] || name));
      toolsHost.append(label);
    }

    const rolesHost = $("roles");
    const roleNote = {
      lead: "Plans the run. Benefits most from a strong model.",
      research: "Fans out. Reading-heavy — a cheaper model here saves the most.",
      worker: "Transforms findings into artifacts.",
      compiler: "Assembles the deliverable and judges coverage.",
      action: "Executes or proposes the follow-up actions.",
    };
    for (const role of META.roles) {
      const card = el("div", "role");
      card.append(el("h4", null, role));
      const row = el("div", "row");

      const model = el("select");
      model.id = `role-${role}-model`;
      fillSelect(model, META.models);

      const effort = el("select");
      effort.id = `role-${role}-effort`;
      fillSelect(effort, META.efforts);

      const tokens = el("input");
      tokens.type = "number";
      tokens.id = `role-${role}-tokens`;
      tokens.min = 256; tokens.max = 128000; tokens.step = 1024;
      tokens.title = "max output tokens";

      row.append(model, effort, tokens);
      card.append(row);

      const think = el("label", "check");
      think.style.marginTop = "8px";
      const box = el("input");
      box.type = "checkbox";
      box.id = `role-${role}-thinking`;
      think.append(box, el("span", null, "adaptive thinking"));
      card.append(think);
      card.append(el("p", "hint", roleNote[role] || ""));
      rolesHost.append(card);
    }
  }

  function fillSelect(select, values) {
    select.innerHTML = "";
    for (const value of values) {
      const option = el("option", null, value);
      option.value = value;
      select.append(option);
    }
  }

  function syncDeliverableFields() {
    const format = $("deliverable-format").value;
    $("wrap-template").hidden = format !== "template";
    $("wrap-schema").hidden = format !== "json";
    $("wrap-instructions").hidden = format !== "custom";
  }

  function syncHints() {
    const preset = META.presets[segValue("preset")];
    if (preset) {
      const l = preset.limits;
      $("preset-hint").textContent =
        `${l.max_research_agents} research · ${l.max_worker_agents} workers · ` +
        `${l.max_rounds} round(s) · up to ${l.max_llm_calls} model calls · ` +
        `${preset.effort} effort`;
    }
    const mode = segValue("action_mode");
    $("action-hint").textContent = {
      off: "No action agents run. The deliverable is the end of the graph.",
      propose: "Action agents describe what they would do. Nothing is executed.",
      execute: "Action agents may write files inside the workspace root.",
    }[mode] || "";
  }

  function applyPreset(name) {
    const preset = META.presets[name];
    if (!preset) return;
    for (const [key, value] of Object.entries(preset.limits)) {
      if ($(key)) $(key).value = value;
    }
    $("quality_bar_out").textContent = Number(preset.limits.quality_bar).toFixed(2);
    $("effort").value = preset.effort;
    for (const role of META.roles) $(`role-${role}-effort`).value = preset.effort;
    syncHints();
  }

  /* ── graph rendering ──────────────────────────────────────────────────── */

  function resetGraph() {
    NODES.clear();
    for (const stage of STAGES) {
      const lane = $(`lane-${stage}`);
      lane.innerHTML = "";
      lane.closest(".lane").dataset.active = "0";
    }
    drawWires();
  }

  function laneEmpty(stage, text) {
    const lane = $(`lane-${stage}`);
    if (!lane || lane.children.length) return;
    lane.append(el("div", "lane-empty", text));
    drawWires();
  }

  function upsertNode(event) {
    const { stage, id, status } = event;
    const lane = $(`lane-${stage}`);
    if (!lane) return;
    lane.querySelectorAll(".lane-empty").forEach((n) => n.remove());
    lane.closest(".lane").dataset.active = "1";

    let entry = NODES.get(id);
    if (!entry) {
      const node = el("div", "node");
      const top = el("div", "node-top");
      top.append(el("span", "dot"), el("span", "node-id", id));
      node.append(top, el("div", "node-label"), el("div", "node-sub"));
      lane.append(node);
      entry = { stage, el: node };
      NODES.set(id, entry);
    }
    entry.status = status;
    entry.el.className = `node ${status}`;
    entry.el.querySelector(".dot").className = `dot ${status}`;
    if (event.label) entry.el.querySelector(".node-label").textContent = event.label;
    const sub = entry.el.querySelector(".node-sub");
    if (event.summary) sub.textContent = event.summary;
    else if (status === "running") sub.textContent = "working…";
    drawWires();
  }

  function seedPending(stage, agents) {
    const lane = $(`lane-${stage}`);
    if (!lane) return;
    lane.querySelectorAll(".lane-empty").forEach((n) => n.remove());
    for (const agent of agents || []) {
      if (NODES.has(agent.id)) continue;
      upsertNode({ stage, id: agent.id, status: "pending", label: agent.label });
    }
  }

  /* Connectors between adjacent populated lanes.
     Every source converges on one hub between the lanes and every target
     diverges from it, so an N-to-M stage draws N+M curves rather than N×M. */
  function drawWires() {
    const svg = $("wires");
    const graph = $("graph");
    if (!svg || !graph) return;
    svg.innerHTML = "";
    const origin = graph.getBoundingClientRect();
    const SVGNS = "http://www.w3.org/2000/svg";

    // On a phone the lanes stack, so connectors have to run top-to-bottom.
    // Detect it from the geometry rather than re-reading the media query.
    const laneBoxes = STAGES.map((s) => $(`lane-${s}`).getBoundingClientRect());
    const vertical = laneBoxes.length > 1 &&
      laneBoxes[1].top >= laneBoxes[0].bottom - 1;

    const port = (node, side) => {
      const box = node.getBoundingClientRect();
      if (vertical) {
        return {
          x: box.left + box.width / 2 - origin.left,
          y: (side === "out" ? box.bottom : box.top) - origin.top,
        };
      }
      return {
        x: (side === "out" ? box.right : box.left) - origin.left,
        y: box.top + box.height / 2 - origin.top,
      };
    };
    const mean = (values) => values.reduce((a, b) => a + b, 0) / values.length;

    const curve = (from, to, live) => {
      const path = document.createElementNS(SVGNS, "path");
      if (vertical) {
        const bend = Math.max(12, Math.abs(to.y - from.y) * 0.5);
        path.setAttribute("d",
          `M ${from.x} ${from.y} C ${from.x} ${from.y + bend}, ` +
          `${to.x} ${to.y - bend}, ${to.x} ${to.y}`);
      } else {
        const bend = Math.max(18, Math.abs(to.x - from.x) * 0.5);
        path.setAttribute("d",
          `M ${from.x} ${from.y} C ${from.x + bend} ${from.y}, ` +
          `${to.x - bend} ${to.y}, ${to.x} ${to.y}`);
      }
      if (live) path.classList.add("live");
      svg.append(path);
    };

    const laneNodes = STAGES.map((stage) =>
      [...$(`lane-${stage}`).querySelectorAll(".node, .lane-empty")]);

    for (let i = 0; i < laneNodes.length - 1; i++) {
      const sources = laneNodes[i];
      const targets = laneNodes[i + 1];
      if (!sources.length || !targets.length) continue;

      const outs = sources.map((n) => port(n, "out"));
      const ins = targets.map((n) => port(n, "in"));
      const hub = vertical
        ? {
            x: (mean(outs.map((p) => p.x)) + mean(ins.map((p) => p.x))) / 2,
            y: (Math.max(...outs.map((p) => p.y)) + Math.min(...ins.map((p) => p.y))) / 2,
          }
        : {
            x: (Math.max(...outs.map((p) => p.x)) + Math.min(...ins.map((p) => p.x))) / 2,
            y: (mean(outs.map((p) => p.y)) + mean(ins.map((p) => p.y))) / 2,
          };

      // A single source and a single target needs no hub — draw it straight.
      if (outs.length === 1 && ins.length === 1) {
        curve(outs[0], ins[0], targets[0].classList.contains("running"));
        continue;
      }
      const anyLive = targets.some((n) => n.classList.contains("running"));
      outs.forEach((p) => curve(p, hub, false));
      ins.forEach((p, idx) =>
        curve(hub, p, targets[idx].classList.contains("running") && anyLive));
    }
  }

  /* ── output rendering ─────────────────────────────────────────────────── */

  /* Minimal, escape-first Markdown. Enough for headings, lists, code, links. */
  function markdown(src) {
    const esc = (s) => s.replace(/[&<>]/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]);

    const blocks = [];
    let text = esc(src).replace(/```(\w*)\n([\s\S]*?)```/g, (_m, _lang, code) => {
      blocks.push(code);
      return ` BLOCK${blocks.length - 1} `;
    });

    const inline = (s) => s
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/(^|[\s(])\*([^*\n]+)\*/g, "$1<em>$2</em>")
      .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g,
        '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
      .replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g,
        '$1<a href="$2" target="_blank" rel="noopener noreferrer">$2</a>');

    const out = [];
    let list = null;
    let para = [];   // consecutive prose lines form one paragraph

    const flushPara = () => {
      if (para.length) {
        out.push(`<p>${inline(para.join(" "))}</p>`);
        para = [];
      }
    };
    const closeList = () => {
      if (list) { out.push(`</${list}>`); list = null; }
    };

    for (const line of text.split("\n")) {
      const heading = /^(#{1,4})\s+(.*)$/.exec(line);
      const bullet = /^\s*[-*+]\s+(.*)$/.exec(line);
      const numbered = /^\s*\d+[.)]\s+(.*)$/.exec(line);

      if (heading) {
        flushPara(); closeList();
        const level = Math.min(heading[1].length, 4);
        out.push(`<h${level}>${inline(heading[2])}</h${level}>`);
      } else if (bullet || numbered) {
        flushPara();
        const want = bullet ? "ul" : "ol";
        if (list && list !== want) closeList();
        if (!list) { out.push(`<${want}>`); list = want; }
        out.push(`<li>${inline((bullet || numbered)[1])}</li>`);
      } else if (!line.trim()) {
        flushPara(); closeList();
      } else if (list) {
        // A continuation line inside a list item.
        out.push(out.pop().replace(/<\/li>$/, " " + inline(line.trim()) + "</li>"));
      } else {
        para.push(line.trim());
      }
    }
    flushPara();
    closeList();

    return out.join("\n").replace(/ BLOCK(\d+) /g,
      (_m, i) => `<pre><code>${blocks[Number(i)]}</code></pre>`);
  }

  function renderResult(result) {
    $("deliverable-empty").hidden = true;
    const host = $("deliverable-out");
    host.innerHTML = markdown(result.report || "(no deliverable produced)");

    const critique = result.critique || {};
    if (critique.caveats?.length || critique.unmet_criteria?.length) {
      const card = el("div", "card");
      card.append(el("h4", null, "Caveats and gaps"));
      const list = el("ul");
      for (const item of [...(critique.unmet_criteria || []),
                          ...(critique.caveats || [])]) {
        list.append(el("li", null, item));
      }
      card.append(list);
      card.append(el("p", null,
        `Coverage: ${critique.coverage || "unknown"} · ${result.rounds} round(s)`));
      host.append(card);
    }

    renderFindings(result);
    renderPlan(result);
  }

  function renderFindings(result) {
    const host = $("tab-findings");
    host.innerHTML = "";
    const findings = result.findings || [];
    const artifacts = result.artifacts || [];
    const actions = result.actions || [];

    if (!findings.length && !artifacts.length && !actions.length) {
      host.append(el("div", "empty", "No research findings or worker artifacts yet."));
      return;
    }

    for (const finding of findings) {
      const card = el("div", "card");
      card.append(el("h4", null, finding.question || finding.id));
      card.append(el("p", null, finding.summary || ""));
      if (finding.key_points?.length) {
        const list = el("ul");
        finding.key_points.forEach((p) => list.append(el("li", null, p)));
        card.append(list);
      }
      const meta = el("div", "meta");
      meta.append(el("span", `tag ${finding.confidence || ""}`,
        `confidence: ${finding.confidence || "?"}`));
      if (finding.gaps?.length) meta.append(el("span", "tag", `${finding.gaps.length} gap(s)`));
      card.append(meta);
      if (finding.sources?.length) {
        const list = el("ul", "sources");
        for (const source of finding.sources.slice(0, 8)) {
          const li = el("li");
          if (source.url) {
            const a = el("a", null, source.title || source.url);
            a.href = source.url;
            a.target = "_blank";
            a.rel = "noopener noreferrer";
            li.append(a);
          } else {
            li.textContent = source.title || "";
          }
          list.append(li);
        }
        card.append(list);
      }
      host.append(card);
    }

    for (const artifact of artifacts) {
      const card = el("div", "card");
      card.append(el("h4", null, artifact.instruction || artifact.id));
      card.append(el("p", null, (artifact.output || "").slice(0, 1200)));
      if (artifact.assumptions?.length) {
        const meta = el("div", "meta");
        artifact.assumptions.forEach((a) => meta.append(el("span", "tag", a.slice(0, 60))));
        card.append(meta);
      }
      host.append(card);
    }

    for (const action of actions) {
      const card = el("div", "card");
      card.append(el("h4", null, action.description || action.id));
      card.append(el("p", null, action.detail || ""));
      const meta = el("div", "meta");
      meta.append(el("span", "tag", `status: ${action.status}`));
      meta.append(el("span", "tag", `mode: ${action.mode || "?"}`));
      (action.artifacts || []).forEach((a) => meta.append(el("span", "tag", a)));
      card.append(meta);
      host.append(card);
    }
  }

  function renderPlan(result) {
    const host = $("tab-plan");
    host.innerHTML = "";
    const plan = result.plan || {};
    if (!plan.objective) {
      host.append(el("div", "empty", "The lead agent's plan appears here once it runs."));
      return;
    }
    const card = el("div", "card");
    card.append(el("h4", null, plan.objective));
    card.append(el("p", null, plan.reasoning || ""));
    const meta = el("div", "meta");
    meta.append(el("span", "tag", `type: ${plan.task_type}`));
    meta.append(el("span", "tag", `complexity: ${plan.complexity}/5`));
    card.append(meta);
    host.append(card);

    const criteria = el("div", "card");
    criteria.append(el("h4", null, "Success criteria"));
    const list = el("ul");
    (plan.success_criteria || []).forEach((c) => list.append(el("li", null, c)));
    criteria.append(list);
    host.append(criteria);

    const pre = el("pre");
    pre.style.cssText = "font:11.5px var(--mono);overflow-x:auto;white-space:pre-wrap";
    pre.textContent = JSON.stringify(plan, null, 2);
    const raw = el("div", "card");
    raw.append(el("h4", null, "Raw plan"), pre);
    host.append(raw);
  }

  function log(message, kind) {
    const host = $("tab-log");
    const line = el("div", `logline ${kind || ""}`);
    line.append(el("span", "t", new Date().toLocaleTimeString()));
    line.append(el("span", null, message));
    host.append(line);
    host.scrollTop = host.scrollHeight;
  }

  function setStatus(text, kind) {
    $("run-meta").innerHTML = "";
    $("run-meta").append(el("span", `dot ${kind}`), document.createTextNode(" " + text));
    // The bottom bar is visible from every view, so carry the state there too.
    const mark = $("nav-run-mark");
    if (mark) mark.className = `nav-mark ${kind}`;
  }

  function renderUsage(usage, extra) {
    const strip = $("usage");
    strip.innerHTML = "";
    const rows = [
      ["calls", usage.calls],
      ["in", usage.input_tokens?.toLocaleString()],
      ["out", usage.output_tokens?.toLocaleString()],
      ["cache read", usage.cache_read_tokens?.toLocaleString()],
      ["searches", usage.web_searches],
    ];
    if (extra) rows.push(...extra);
    for (const [name, value] of rows) {
      const item = el("span");
      item.append(el("b", null, name + " "), document.createTextNode(String(value ?? 0)));
      strip.append(item);
    }
  }

  /* ── run ──────────────────────────────────────────────────────────────── */

  async function runGraph() {
    let config;
    try { config = readConfig(); }
    catch (err) { log(err.message, "err"); switchTab("log"); return; }

    if (!config.task.trim()) {
      log("Add a task before running.", "err");
      $("task").focus();
      return;
    }

    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
    resetGraph();
    $("tab-log").innerHTML = "";
    $("deliverable-out").innerHTML = "";
    $("deliverable-empty").hidden = false;
    $("deliverable-empty").textContent = "Running…";
    setStatus("running", "running");
    // The run is the point of pressing the button; on a phone the graph is a
    // different view, so go there rather than leaving the user on the form.
    if (NARROW.matches) switchView("graph");
    // Stays enabled: a second click stops the run (see the click handler).
    $("btn-run").textContent = "Stop";
    $("btn-run").title = TRANSPORT.isStatic
      ? "Stop the simulation."
      : "Stop watching. The server finishes the round it is in.";

    try {
      await TRANSPORT.run(config, handleEvent);
    } catch (err) {
      if (err.name === "AbortError") {
        log("Stopped watching. The server finishes the round it is in.", "err");
        setStatus("detached", "error");
      } else {
        log(err.message, "err");
        switchTab("log");
        setStatus("error", "error");
      }
    } finally {
      ABORT = null;
      $("btn-run").textContent = RUN_LABEL;
      $("btn-run").title = "";
      if ($("deliverable-empty").textContent === "Running…") {
        $("deliverable-empty").textContent = "The run produced no deliverable.";
      }
    }
  }

  function handleEvent(event) {
    switch (event.type) {
      case "run":
        if (event.status === "started") {
          log("run started", "ok");
        } else {
          const result = event.result || {};
          const ok = event.status === "complete";
          setStatus(event.status, ok ? "done" : "error");
          log("run " + event.status + (event.error ? ": " + event.error : ""),
            ok ? "ok" : "err");
          if (result.usage) {
            renderUsage(result.usage, [["seconds", result.elapsed_seconds]]);
          }
          if (result.report || result.findings?.length) renderResult(result);
        }
        break;

      case "stage":
        // `revise` is a routing decision, not a lane — it only gets logged.
        if (event.stage === "revise") {
          log(`another round: ${event.reason || "coverage below the bar"}`);
          break;
        }
        if (event.status === "fanout") {
          log(`${event.stage}: ${event.count} agent(s) ${event.reason || ""}`.trim());
          seedPending(event.stage, event.agents);
        } else {
          log(`${event.stage}: skipped`);
          laneEmpty(event.stage, "no agents needed");
        }
        break;

      case "agent":
        upsertNode(event);
        if (event.status !== "running") {
          log(`[${event.stage}] ${event.id} ${event.status}`,
            event.status === "error" ? "err" : "");
        }
        break;

      case "tool":
        log(`  ↳ ${event.stage || ""} ${event.id || ""} used ${event.name}`);
        break;

      case "log":
        log(event.message, event.level === "error" ? "err" : "");
        break;
    }
  }

  function switchTab(name) {
    document.querySelectorAll("#tabs button").forEach((b) => {
      const on = b.dataset.tab === name;
      b.classList.toggle("on", on);
      b.setAttribute("aria-selected", String(on));
      b.tabIndex = on ? 0 : -1;
    });
    for (const tab of ["deliverable", "findings", "plan", "log"]) {
      $(`tab-${tab}`).hidden = tab !== name;
    }
  }

  /* ── mobile view switching ────────────────────────────────────────────── */

  const NARROW = window.matchMedia("(max-width: 860px)");

  function switchView(name) {
    $("layout").dataset.view = name;
    document.querySelectorAll("#mobile-nav button").forEach((b) =>
      b.setAttribute("aria-selected", String(b.dataset.panel === name)));
    // Each view is its own scroll area; start it at the top.
    const panel = $(`panel-${name}`);
    if (panel) panel.scrollTop = 0;
    if (name === "graph") requestAnimationFrame(drawWires);
  }

  /* The panels size against the viewport minus the fixed chrome, which varies
     with the header wrapping and the phone's safe-area inset. */
  function measureChrome() {
    if (!NARROW.matches) return;
    const header = document.querySelector(".topbar").offsetHeight;
    const nav = $("mobile-nav").offsetHeight;
    document.documentElement.style.setProperty("--chrome", `${header + nav}px`);
  }

  /* Arrow-key navigation, which a radiogroup and a tablist are both expected
     to support once they claim those roles. */
  function bindRovingKeys(container, onPick, attr) {
    container.addEventListener("keydown", (event) => {
      const keys = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"];
      if (!keys.includes(event.key)) return;
      const buttons = [...container.querySelectorAll("button")]
        .filter((b) => !b.hidden);
      const current = buttons.indexOf(document.activeElement);
      if (current < 0) return;
      event.preventDefault();
      const step = (event.key === "ArrowRight" || event.key === "ArrowDown") ? 1
                 : (event.key === "ArrowLeft" || event.key === "ArrowUp") ? -1 : 0;
      const next = event.key === "Home" ? 0
                 : event.key === "End" ? buttons.length - 1
                 : (current + step + buttons.length) % buttons.length;
      buttons[next].focus();
      onPick(buttons[next].dataset[attr]);
    });
  }

  /* ── wiring ───────────────────────────────────────────────────────────── */

  function bind() {
    for (const id of ["preset", "action_mode", "provider"]) {
      $(id).addEventListener("click", (event) => {
        const button = event.target.closest("button");
        if (!button) return;
        setSeg(id, button.dataset.value);
        if (id === "preset") applyPreset(button.dataset.value);
        syncHints();
      });
    }

    $("deliverable-format").addEventListener("change", syncDeliverableFields);
    $("quality_bar").addEventListener("input", (e) => {
      $("quality_bar_out").textContent = Number(e.target.value).toFixed(2);
    });

    $("btn-run").addEventListener("click", () => {
      if (ABORT) ABORT.abort();
      else runGraph();
    });

    document.querySelectorAll("#tabs button").forEach((b) =>
      b.addEventListener("click", () => switchTab(b.dataset.tab)));

    $("btn-theme").addEventListener("click", () => {
      const root = document.documentElement;
      const next = root.dataset.theme === "dark" ? "light" : "dark";
      root.dataset.theme = next;
      localStorage.setItem("agent-graph.theme", next);
      requestAnimationFrame(drawWires);
    });

    const exportConfig = () => {
      let config;
      try { config = readConfig(); }
      catch (err) { log(err.message, "err"); switchTab("log"); return; }
      const blob = new Blob([JSON.stringify(config, null, 2)],
        { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = el("a");
      a.href = url;
      a.download = "agent-graph.config.json";
      a.click();
      URL.revokeObjectURL(url);
    };
    const importConfig = () => $("file-import").click();

    // Two sets of buttons: the header's, and the Setup-panel pair that takes
    // over at phone widths where the header ones are hidden.
    for (const id of ["btn-export", "btn-export-2"]) {
      $(id)?.addEventListener("click", exportConfig);
    }
    for (const id of ["btn-import", "btn-import-2"]) {
      $(id)?.addEventListener("click", importConfig);
    }
    $("file-import").addEventListener("change", async (event) => {
      const file = event.target.files?.[0];
      if (!file) return;
      try {
        writeConfig(JSON.parse(await file.text()));
        log("config imported", "ok");
      } catch (err) {
        log("import failed: " + err.message, "err");
        switchTab("log");
      }
      event.target.value = "";
    });

    window.addEventListener("resize", () => { measureChrome(); drawWires(); });
    NARROW.addEventListener("change", () => { measureChrome(); drawWires(); });

    $("mobile-nav").addEventListener("click", (event) => {
      const button = event.target.closest("button");
      if (button) switchView(button.dataset.panel);
    });
    bindRovingKeys($("mobile-nav"), switchView, "panel");
    bindRovingKeys($("tabs"), switchTab, "tab");
    for (const id of ["preset", "action_mode", "provider"]) {
      bindRovingKeys($(id), (value) => {
        setSeg(id, value);
        if (id === "preset") applyPreset(value);
        syncHints();
      }, "value");
    }

    if (!TRANSPORT.isStatic) return;

    const syncKeyPill = () => {
      $("cred-pill").textContent = readKey()
        ? "Live — your key, straight to Anthropic"
        : "Add a key to run for real";
    };

    $("api-key").addEventListener("input", (event) => {
      storeKey(event.target.value.trim(), $("remember-key").checked);
      setKeyStatus("");
      syncKeyPill();
      if (readKey()) setSeg("provider", "anthropic");
    });

    $("remember-key").addEventListener("change", (event) => {
      storeKey(readKey(), event.target.checked);
      setKeyStatus(event.target.checked
        ? "Stored in this browser until you clear it."
        : "Held for this tab only.", "");
    });

    $("btn-clear-key").addEventListener("click", () => {
      forgetKey();
      setSeg("provider", "mock");
      syncKeyPill();
    });

    $("btn-test-key").addEventListener("click", async () => {
      const apiKey = readKey();
      if (!apiKey) { setKeyStatus("Paste a key first.", "err"); return; }
      const button = $("btn-test-key");
      button.disabled = true;
      setKeyStatus("Checking…", "");
      try {
        const reply = await window.AgentGraphEngine.testKey(
          apiKey, $("role-lead-model").value);
        setKeyStatus(`Working — the model replied "${reply.slice(0, 40)}".`, "ok");
        setSeg("provider", "anthropic");
        syncKeyPill();
      } catch (err) {
        setKeyStatus(err.message, "err");
      } finally {
        button.disabled = false;
      }
    });
  }

  async function init() {
    const saved = localStorage.getItem("agent-graph.theme");
    if (saved) document.documentElement.dataset.theme = saved;

    META = await TRANSPORT.schema();
    buildForm();
    bind();

    let config = META.defaults;
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      try { config = { ...config, ...JSON.parse(stored) }; } catch { /* ignore */ }
    }

    const pill = $("cred-pill");
    pill.hidden = false;

    if (TRANSPORT.isStatic) {
      $("keyring").hidden = false;
      // "Mock" is the Python provider's name; in the browser it is the
      // in-page simulator, and execute mode has no filesystem to act on.
      $("provider").querySelector('[data-value="mock"]').textContent = "Simulate";
      $("action_mode").querySelector('[data-value="execute"]').hidden = true;
      $("wrap-workspace").hidden = true;
      const remembered = localStorage.getItem(KEY_NAME);
      if (remembered) {
        MEMORY_KEY = remembered;
        $("api-key").value = remembered;
        $("remember-key").checked = true;
      }
      // Without a key there is nothing to run against, so default to the
      // simulator rather than failing on the first click.
      config.provider = readKey() ? "anthropic" : "mock";
      pill.textContent = readKey()
        ? "Live — your key, straight to Anthropic"
        : "Add a key to run for real";
    } else if (!META.credentials) {
      config.provider = "mock";
      pill.textContent = "No credentials — mock mode";
    } else {
      pill.textContent = "Claude credentials detected";
    }

    writeConfig(config);

    for (const stage of STAGES) laneEmpty(stage, "—");
    setStatus("idle", "idle");
    renderUsage({});
    measureChrome();
  }

  init().catch((err) => {
    document.body.innerHTML =
      `<pre style="padding:24px;font:13px monospace">Failed to start: ${err.message}</pre>`;
  });
})();
