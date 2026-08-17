/* In-browser run simulator.
 *
 * Emits the same event stream the Python runner does, so the topology view and
 * the output tabs work identically without a server. It plans, fans out,
 * revises and compiles against the real configuration — the ceilings, the
 * action mode and the quality bar all take effect — but it calls no model and
 * makes no network request. Every string it produces says so.
 */
window.AgentGraphSimulator = (() => {
  "use strict";

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const clamp = (items, limit) => items.slice(0, Math.max(0, limit));

  /* A short, readable handle for the task, used inside the fake briefs. */
  function subject(task) {
    const clean = (task || "the task").replace(/\s+/g, " ").trim();
    return clean.length > 90 ? clean.slice(0, 87) + "…" : clean;
  }

  const RESEARCH_ANGLES = [
    (s) => `How is "${s}" defined and framed by the primary sources?`,
    (s) => `What does the most recent evidence say about ${s}?`,
    (s) => `What are the main criticisms, limitations, or failure cases?`,
    (s) => `What comparable cases, benchmarks, or prior art exist?`,
    (s) => `Which practical constraints govern ${s} in practice?`,
    (s) => `Where do credible sources disagree, and on what?`,
    (s) => `What quantitative data is available, and how reliable is it?`,
    (s) => `What has changed most recently, and what is still unsettled?`,
    (s) => `Who are the authoritative voices, and what do they claim?`,
    (s) => `What terminology or methodology traps mislead newcomers?`,
    (s) => `What second-order effects follow from ${s}?`,
    (s) => `What would falsify the leading account of ${s}?`,
  ];

  function workerBriefs(config) {
    const format = config.deliverable?.format || "report";
    if (format === "template") {
      return [
        "Fill every placeholder in the supplied template from the findings.",
        "Verify the filled template against the findings and flag unsupported fields.",
        "Draft the supporting notes that accompany the filled template.",
        "Reconcile placeholders that no finding covers and list them explicitly.",
      ];
    }
    if (format === "code") {
      return [
        "Write the implementation described by the findings.",
        "Write the tests that pin the behaviour the findings specify.",
        "Write the run instructions and note the assumptions made.",
        "Review the implementation against the stated success criteria.",
      ];
    }
    return [
      "Draft the opening: the answer, then the evidence behind it.",
      "Assemble the structured body — comparisons, figures, and their sources.",
      "Write the caveats and open questions the findings leave standing.",
      "Cross-check every claim against the findings and flag unsupported ones.",
    ];
  }

  function buildPlan(config, round) {
    const s = subject(config.task);
    const limits = config.limits || {};
    const gap = round > 0;
    const tag = `r${round + 1}`;

    const angles = gap
      ? RESEARCH_ANGLES.slice(2, 4)   // a gap round commissions less
      : RESEARCH_ANGLES.slice(0, 3);
    const research = clamp(angles, limits.max_research_agents ?? 4).map((make, i) => ({
      id: `${tag}-research-${i + 1}`,
      question: make(s),
      why: gap ? "Closes a gap the compiler flagged." : "Covers one axis of the task.",
      depth: "normal",
    }));

    const briefs = gap ? workerBriefs(config).slice(3) : workerBriefs(config).slice(0, 2);
    const workers = clamp(briefs, limits.max_worker_agents ?? 4).map((brief, i) => ({
      id: `${tag}-worker-${i + 1}`,
      instruction: brief,
      output_format: config.deliverable?.format || "report",
      needs_findings: true,
    }));

    const wantsAction = (config.action_mode || "propose") !== "off";
    const actions = wantsAction
      ? clamp([{
          id: `${tag}-action-1`,
          description:
            `Save the finished deliverable to ` +
            `${(config.tools?.workspace || ".")}/deliverable.md`,
          kind: "write_file",
        }], limits.max_action_agents ?? 4)
      : [];

    return {
      objective: s,
      task_type: "research",
      complexity: Math.min(5, 2 + research.length > 4 ? 4 : 3),
      success_criteria: [
        "The deliverable answers the task directly, in the requested format.",
        "Every substantive claim is attributed to a source.",
        "Anything that could not be established is stated rather than implied.",
      ],
      research_tasks: research,
      worker_tasks: workers,
      needs_action: actions.length > 0,
      action_tasks: actions,
      reasoning:
        "Simulated plan. The real lead agent writes this from the task; the " +
        "shape here is fixed, but the ceilings and the action mode you set do apply.",
    };
  }

  const SIM_NOTE = "Simulated — no model was called and nothing was fetched.";

  function makeFinding(spec, config) {
    const searched = config.tools?.web_search;
    return {
      id: spec.id,
      question: spec.question,
      summary:
        `${SIM_NOTE} In a real run this is where the agent's answer to ` +
        `"${spec.question}" would sit, written from what it actually read.`,
      key_points: [
        "Each key point would carry a source the agent opened.",
        "Points the agent could not verify would be marked as such.",
      ],
      confidence: "medium",
      gaps: ["Nothing was researched, so everything remains open."],
      sources: searched
        ? [{ title: "sources appear here after a real run", url: "" }]
        : [],
      report: SIM_NOTE,
    };
  }

  function makeArtifact(spec) {
    return {
      id: spec.id,
      instruction: spec.instruction,
      output:
        `${SIM_NOTE} A real worker would return the artifact for ` +
        `"${spec.instruction}" here, built from the findings above.`,
      notes: "Simulated worker output.",
      assumptions: ["No findings existed to work from — this is a placeholder."],
    };
  }

  function deliverableText(config, rounds) {
    const format = config.deliverable?.format || "report";
    if (format === "json") {
      return JSON.stringify(
        { simulated: true, note: SIM_NOTE, task: config.task, rounds },
        null, 2,
      );
    }
    return [
      "# Simulated deliverable",
      "",
      `**${SIM_NOTE}** This run shows how the graph fans out for your settings,`,
      "with placeholder content in place of what the agents would actually find.",
      "Add an Anthropic key under Setup to run it for real, or use the CLI below.",
      "",
      "## What just happened",
      "",
      `The lead agent planned the run, ${rounds > 1 ? "two rounds of " : ""}research`,
      "and worker agents fanned out in parallel, and the compiler assembled this",
      "text and graded it against the success criteria — all with placeholder",
      "content in place of real findings.",
      "",
      "## Running it for real",
      "",
      "Export the config from Setup, then:",
      "",
      "```",
      "pip install -r agent_graph/requirements.txt",
      "export ANTHROPIC_API_KEY=...",
      "python -m agent_graph.cli --config agent-graph.config.json --stream",
      "```",
      "",
      "Or `python -m agent_graph.cli --serve` for this same interface with the",
      "graph actually wired up behind it.",
    ].join("\n");
  }

  /* Mirrors runner.run(): resolves with the result once the graph finishes. */
  async function run(config, emit, options = {}) {
    const pace = options.pace ?? 1;
    const wait = (ms) => sleep(ms * pace);
    const started = Date.now();

    const limits = config.limits || {};
    const maxRounds = limits.max_rounds ?? 2;
    const bar = limits.quality_bar ?? 0.8;

    const findings = [];
    const artifacts = [];
    const actions = [];
    const usage = {
      calls: 0, input_tokens: 0, output_tokens: 0,
      cache_read_tokens: 0, cache_write_tokens: 0, web_searches: 0,
    };
    const charge = (searches = 0) => {
      usage.calls += 1;
      usage.input_tokens += 900 + Math.floor(Math.random() * 600);
      usage.output_tokens += 250 + Math.floor(Math.random() * 300);
      usage.web_searches += searches;
    };

    emit({ type: "run", status: "started", at: started / 1000, config });

    let plan = {};
    let critique = {};
    let round = 0;

    while (true) {
      // ── lead ───────────────────────────────────────────────────────────
      const leadId = `lead-r${round}`;
      const leadLabel = `Planning (round ${round + 1})`;
      emit({ type: "agent", stage: "lead", id: leadId, status: "running",
             label: leadLabel });
      await wait(650);
      plan = buildPlan(config, round);
      charge();
      emit({
        type: "agent", stage: "lead", id: leadId, status: "done", label: leadLabel,
        summary: `${plan.research_tasks.length} research, ` +
                 `${plan.worker_tasks.length} worker, ${plan.action_tasks.length} action`,
        plan,
      });

      // ── research fan-out ───────────────────────────────────────────────
      await runStage("research", plan.research_tasks, async (spec) => {
        if (config.tools?.web_search) {
          emit({ type: "tool", stage: "research", id: spec.id, name: "web_search" });
          await wait(260);
        }
        charge(config.tools?.web_search ? 2 : 0);
        charge();  // the follow-up call that structures the report
        findings.push(makeFinding(spec, config));
      }, (spec) => spec.question);

      // ── worker fan-out ─────────────────────────────────────────────────
      await runStage("worker", plan.worker_tasks, async (spec) => {
        charge();
        charge();
        artifacts.push(makeArtifact(spec));
      }, (spec) => spec.instruction);

      // ── compiler ───────────────────────────────────────────────────────
      const compilerId = `compiler-r${round}`;
      emit({ type: "agent", stage: "compiler", id: compilerId, status: "running",
             label: "Compiling findings" });
      await wait(800);
      charge();
      round += 1;

      const roundsLeft = round < maxRounds;
      // Mirrors the real gate: a first pass under the bar asks for one more round.
      const wantsMore = roundsLeft && bar > 0.6;
      critique = {
        deliverable: deliverableText(config, round),
        coverage: wantsMore ? "partial" : "complete",
        unmet_criteria: wantsMore
          ? ["Sources have not been gathered for every claim."] : [],
        needs_more_research: wantsMore,
        followup_questions: wantsMore
          ? ["Which claims still lack a source?"] : [],
        caveats: [SIM_NOTE],
      };
      emit({
        type: "agent", stage: "compiler", id: compilerId, status: "done",
        label: "Compiling findings", summary: `coverage: ${critique.coverage}`,
        coverage: critique.coverage,
      });

      if (wantsMore) {
        emit({
          type: "stage", stage: "revise", status: "fanout", count: 1,
          reason: `coverage ${critique.coverage} is below the ${bar.toFixed(2)} bar; ` +
                  `round ${round + 1} of ${maxRounds}`,
        });
        await wait(500);
        continue;
      }
      break;
    }

    // ── action fan-out ───────────────────────────────────────────────────
    const mode = config.action_mode || "propose";
    if (mode !== "off" && plan.needs_action && plan.action_tasks.length) {
      await runStage("action", plan.action_tasks, async (spec) => {
        charge();
        charge();
        actions.push({
          id: spec.id,
          description: spec.description,
          kind: spec.kind,
          mode,
          status: mode === "execute" ? "executed" : "proposed",
          detail: mode === "execute"
            ? `${SIM_NOTE} A real run in execute mode would write the file here.`
            : `${SIM_NOTE} Propose mode describes the action without doing it.`,
          artifacts: [],
        });
      }, (spec) => spec.description);
    } else {
      emit({ type: "stage", stage: "action", status: "skipped", count: 0 });
    }

    const result = {
      status: "complete",
      error: null,
      simulated: true,
      report: critique.deliverable,
      structured: null,
      plan,
      critique,
      findings,
      artifacts,
      actions,
      rounds: round,
      usage,
      elapsed_seconds: Number(((Date.now() - started) / 1000).toFixed(2)),
    };
    emit({ type: "run", status: "complete", result });
    return result;

    /* Fan a stage out, running its agents "in parallel" with staggered starts
       so the topology animates the way a real run does. */
    async function runStage(stage, specs, work, labelOf) {
      if (!specs.length) {
        emit({ type: "stage", stage, status: "skipped", count: 0 });
        await wait(150);
        return;
      }
      emit({
        type: "stage", stage, status: "fanout", count: specs.length,
        agents: specs.map((spec) => ({ id: spec.id, label: labelOf(spec) })),
      });
      await wait(250);

      await Promise.all(specs.map(async (spec, index) => {
        await wait(index * 180);
        const label = labelOf(spec);
        emit({ type: "agent", stage, id: spec.id, status: "running", label });
        await wait(700 + Math.random() * 500);
        await work(spec);
        const record =
          stage === "research" ? findings[findings.length - 1]
          : stage === "worker" ? artifacts[artifacts.length - 1]
          : actions[actions.length - 1];
        emit({
          type: "agent", stage, id: spec.id, status: "done", label,
          summary: (record?.summary || record?.output || record?.detail || "")
            .slice(0, 400),
        });
      }));
    }
  }

  return { run };
})();
