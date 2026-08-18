"""Configuration model for the agent graph.

Everything the frontend can tune lives here. `GraphConfig.model_validate(dict)`
is the single entry point used by the CLI, the HTTP server, and the tests.
"""

from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, Field, model_validator

Role = Literal["lead", "research", "worker", "compiler", "action"]
ROLES: tuple[Role, ...] = ("lead", "research", "worker", "compiler", "action")

# Effort maps onto output_config.effort. Higher effort means deeper thinking and
# more tool calls per agent; it is the primary cost/quality dial.
Effort = Literal["low", "medium", "high", "xhigh", "max"]

# Every role defaults to Opus 5. The UI exposes the cheaper models per role for
# callers who want to spend less on the reading-heavy research/worker legs.
MODEL_CHOICES = [
    "claude-opus-5",
    "claude-sonnet-5",
    "claude-haiku-4-5",
    "claude-fable-5",
]

DEFAULT_MODEL = "claude-opus-5"

LOCAL_TOOLS = ["read_file", "list_dir", "write_file", "calculator"]
SERVER_TOOLS = ["web_search", "web_fetch"]


class RoleConfig(BaseModel):
    """Per-role model settings. Roles are the five stages of the graph."""

    model: str = DEFAULT_MODEL
    effort: Optional[Effort] = None  # None -> inherit the preset's effort
    max_tokens: int = Field(default=16000, ge=256, le=128000)
    thinking: bool = True
    tools: list[str] = Field(default_factory=list)


class Limits(BaseModel):
    """Hard ceilings. The lead agent's plan is clamped to these."""

    max_research_agents: int = Field(default=4, ge=0, le=24)
    max_worker_agents: int = Field(default=4, ge=0, le=24)
    max_action_agents: int = Field(default=4, ge=0, le=12)
    max_rounds: int = Field(default=2, ge=1, le=8)
    max_llm_calls: int = Field(default=80, ge=1, le=1000)
    max_tool_iterations: int = Field(default=12, ge=1, le=60)
    quality_bar: float = Field(default=0.8, ge=0.0, le=1.0)
    # Dollar ceiling per model call, honoured by the Agent SDK provider only —
    # the API provider has no price to check against. 0 disables it.
    max_cost_usd: float = Field(default=0.0, ge=0.0, le=100.0)


class Deliverable(BaseModel):
    """What the compiler agent is asked to produce."""

    format: Literal[
        "report", "brief", "bullets", "json", "template", "code", "custom"
    ] = "report"
    audience: str = ""
    # Used when format == "template": the literal text with placeholders to fill.
    template: str = ""
    # Used when format == "json": a JSON Schema the final answer must satisfy.
    json_schema: Optional[dict] = None
    # Used when format == "custom".
    instructions: str = ""


class ToolConfig(BaseModel):
    web_search: bool = True
    web_fetch: bool = True
    read_file: bool = True
    list_dir: bool = True
    write_file: bool = False
    calculator: bool = True
    # Filesystem sandbox. All read/write tools are confined to this root.
    workspace: str = "."
    max_web_searches: int = Field(default=8, ge=1, le=40)


PRESETS: dict[str, dict] = {
    "quick": {
        "effort": "low",
        "limits": {
            "max_research_agents": 2,
            "max_worker_agents": 1,
            "max_action_agents": 2,
            "max_rounds": 1,
            "max_llm_calls": 20,
            "max_tool_iterations": 6,
            "quality_bar": 0.6,
        },
    },
    "standard": {
        "effort": "medium",
        "limits": {
            "max_research_agents": 4,
            "max_worker_agents": 4,
            "max_action_agents": 4,
            "max_rounds": 2,
            "max_llm_calls": 60,
            "max_tool_iterations": 10,
            "quality_bar": 0.8,
        },
    },
    "deep": {
        "effort": "high",
        "limits": {
            "max_research_agents": 8,
            "max_worker_agents": 8,
            "max_action_agents": 6,
            "max_rounds": 3,
            "max_llm_calls": 140,
            "max_tool_iterations": 16,
            "quality_bar": 0.88,
        },
    },
    "exhaustive": {
        "effort": "xhigh",
        "limits": {
            "max_research_agents": 12,
            "max_worker_agents": 12,
            "max_action_agents": 8,
            "max_rounds": 5,
            "max_llm_calls": 320,
            "max_tool_iterations": 24,
            "quality_bar": 0.94,
        },
    },
}


class GraphConfig(BaseModel):
    """The full run configuration.

    `preset` seeds `effort` and `limits`; anything explicitly set by the caller
    survives the seeding (see `_apply_preset`).
    """

    task: str = ""
    context: str = ""

    preset: Literal["quick", "standard", "deep", "exhaustive"] = "standard"
    effort: Effort = "medium"

    deliverable: Deliverable = Field(default_factory=Deliverable)
    limits: Limits = Field(default_factory=Limits)
    tools: ToolConfig = Field(default_factory=ToolConfig)
    roles: dict[str, RoleConfig] = Field(default_factory=dict)

    # off       -> action agents never run
    # propose   -> action agents describe what they would do, nothing executes
    # execute   -> action agents may call their tools for real
    action_mode: Literal["off", "propose", "execute"] = "propose"

    # "mock" runs the whole graph with a deterministic fake model. Useful for
    # exercising the UI and the topology without an API key.
    #   anthropic  the Messages API, billed to an API key
    #   agent_sdk  the Claude Agent SDK, billed to a Claude subscription
    #   mock       deterministic stand-in, no network
    provider: Literal["anthropic", "agent_sdk", "mock"] = "anthropic"

    # Cache the (large, stable) system prompts across the run.
    prompt_caching: bool = True

    @model_validator(mode="after")
    def _apply_preset(self) -> "GraphConfig":
        fields_set = self.model_fields_set
        preset = PRESETS[self.preset]

        if "effort" not in fields_set:
            self.effort = preset["effort"]

        # Merge field by field: setting one limit must not silently drop the
        # preset's values for the others.
        preset_limits = Limits(**preset["limits"])
        if "limits" in fields_set:
            explicit = {
                name: getattr(self.limits, name)
                for name in self.limits.model_fields_set
            }
            self.limits = preset_limits.model_copy(update=explicit)
        else:
            self.limits = preset_limits

        for role in ROLES:
            self.roles.setdefault(role, RoleConfig())

        # Roles that never touch the outside world get an empty tool set;
        # the rest inherit whatever the caller enabled globally.
        enabled = [name for name in LOCAL_TOOLS + SERVER_TOOLS
                   if getattr(self.tools, name, False)]
        readonly = [t for t in enabled if t != "write_file"]

        defaults = {
            "lead": [],
            "research": readonly,
            "worker": readonly,
            "compiler": [],
            "action": enabled,
        }
        for role, tools in defaults.items():
            cfg = self.roles[role]
            if not cfg.tools:
                cfg.tools = tools
            if cfg.effort is None:
                cfg.effort = self.effort

        return self

    def role(self, name: Role) -> RoleConfig:
        return self.roles[name]
