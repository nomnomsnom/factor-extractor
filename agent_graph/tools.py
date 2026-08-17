"""Tool registry.

Two kinds of tool reach the model:

  * server tools  — web search / web fetch, executed on Anthropic's side. We
    only declare them; there is nothing to run locally.
  * local tools   — filesystem and arithmetic, executed here, sandboxed to the
    configured workspace root.
"""

from __future__ import annotations

import ast
import operator
import os
from pathlib import Path
from typing import Any, Callable

from .config import GraphConfig

# The `_20260209` variants add dynamic filtering and need Opus 5 / Sonnet 5 or
# the 4.6+ family; older models fall back to the basic variants.
_MODERN_SEARCH_MODELS = {
    "claude-opus-5",
    "claude-opus-4-8",
    "claude-opus-4-7",
    "claude-opus-4-6",
    "claude-sonnet-5",
    "claude-sonnet-4-6",
    "claude-fable-5",
}

MAX_READ_BYTES = 200_000


def server_tool_specs(names: list[str], model: str, max_uses: int) -> list[dict]:
    modern = model in _MODERN_SEARCH_MODELS
    specs: list[dict] = []
    if "web_search" in names:
        specs.append(
            {
                "type": "web_search_20260209" if modern else "web_search_20250305",
                "name": "web_search",
                "max_uses": max_uses,
            }
        )
    if "web_fetch" in names and modern:
        specs.append(
            {
                "type": "web_fetch_20260209",
                "name": "web_fetch",
                "max_uses": max_uses,
            }
        )
    return specs


LOCAL_TOOL_SPECS: dict[str, dict] = {
    "read_file": {
        "name": "read_file",
        "description": (
            "Read a UTF-8 text file from the workspace. Returns the file's "
            "contents with line numbers. Use it before editing a file, and to "
            "ground any claim you make about the repository's contents. Paths "
            "are relative to the workspace root; paths outside it are rejected."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "path": {
                    "type": "string",
                    "description": "Workspace-relative path, e.g. src/main.py",
                }
            },
            "required": ["path"],
        },
    },
    "list_dir": {
        "name": "list_dir",
        "description": (
            "List the entries of a directory in the workspace. Call this when "
            "you need to discover what exists before reading files. Returns one "
            "entry per line, directories suffixed with '/'."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "path": {
                    "type": "string",
                    "description": "Workspace-relative directory, '.' for the root",
                }
            },
            "required": ["path"],
        },
    },
    "write_file": {
        "name": "write_file",
        "description": (
            "Create or overwrite a UTF-8 text file in the workspace. Only "
            "available to action agents when the run is in execute mode. Parent "
            "directories are created as needed. Existing files are overwritten "
            "without a backup, so read before you write."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "path": {"type": "string", "description": "Workspace-relative path"},
                "content": {"type": "string", "description": "Full file contents"},
            },
            "required": ["path", "content"],
        },
    },
    "calculator": {
        "name": "calculator",
        "description": (
            "Evaluate one arithmetic expression and return the result. Supports "
            "+ - * / // % ** and parentheses over numbers. Use it whenever a "
            "figure in your answer comes from arithmetic, rather than computing "
            "it in your head. It does not run general Python."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "expression": {
                    "type": "string",
                    "description": "e.g. (1250 * 0.07) / 12",
                }
            },
            "required": ["expression"],
        },
    },
}


class Workspace:
    """Filesystem sandbox. Every path is resolved and checked against the root."""

    def __init__(self, root: str):
        self.root = Path(root).expanduser().resolve()

    def resolve(self, path: str) -> Path:
        candidate = (self.root / path).expanduser()
        resolved = candidate.resolve()
        if resolved != self.root and self.root not in resolved.parents:
            raise ValueError(f"path escapes the workspace root: {path}")
        return resolved

    def read_file(self, path: str) -> str:
        target = self.resolve(path)
        if not target.is_file():
            raise FileNotFoundError(f"no such file: {path}")
        data = target.read_text(encoding="utf-8", errors="replace")[:MAX_READ_BYTES]
        return "\n".join(
            f"{i:>6}\t{line}" for i, line in enumerate(data.splitlines(), 1)
        )

    def list_dir(self, path: str = ".") -> str:
        target = self.resolve(path)
        if not target.is_dir():
            raise NotADirectoryError(f"not a directory: {path}")
        entries = sorted(target.iterdir(), key=lambda p: (p.is_file(), p.name))
        if not entries:
            return "(empty directory)"
        return "\n".join(f"{e.name}/" if e.is_dir() else e.name for e in entries)

    def write_file(self, path: str, content: str) -> str:
        target = self.resolve(path)
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content, encoding="utf-8")
        return f"wrote {len(content)} bytes to {os.path.relpath(target, self.root)}"


_BIN_OPS = {
    ast.Add: operator.add,
    ast.Sub: operator.sub,
    ast.Mult: operator.mul,
    ast.Div: operator.truediv,
    ast.FloorDiv: operator.floordiv,
    ast.Mod: operator.mod,
    ast.Pow: operator.pow,
}
_UNARY_OPS = {ast.UAdd: operator.pos, ast.USub: operator.neg}


def calculate(expression: str) -> str:
    """Arithmetic only — no names, calls, attributes, or comprehensions."""

    def evaluate(node: ast.AST) -> float:
        if isinstance(node, ast.Expression):
            return evaluate(node.body)
        if isinstance(node, ast.Constant) and isinstance(node.value, (int, float)):
            return node.value
        if isinstance(node, ast.BinOp) and type(node.op) in _BIN_OPS:
            if isinstance(node.op, ast.Pow):
                exponent = evaluate(node.right)
                if abs(exponent) > 64:
                    raise ValueError("exponent out of range")
                return _BIN_OPS[ast.Pow](evaluate(node.left), exponent)
            return _BIN_OPS[type(node.op)](evaluate(node.left), evaluate(node.right))
        if isinstance(node, ast.UnaryOp) and type(node.op) in _UNARY_OPS:
            return _UNARY_OPS[type(node.op)](evaluate(node.operand))
        raise ValueError("only numeric arithmetic is supported")

    if len(expression) > 500:
        raise ValueError("expression too long")
    tree = ast.parse(expression, mode="eval")
    return str(evaluate(tree))


def build_toolset(
    config: GraphConfig, role_name: str, model: str
) -> tuple[list[dict], Callable[[str, dict], str]]:
    """Return (tool specs to send, executor for the local ones)."""
    role = config.role(role_name)  # type: ignore[arg-type]
    enabled = set(role.tools)

    # Writing is gated twice: by the tool config and by the action mode.
    if "write_file" in enabled and not (
        role_name == "action" and config.action_mode == "execute"
    ):
        enabled.discard("write_file")

    specs = server_tool_specs(
        sorted(enabled), model, config.tools.max_web_searches
    )
    specs += [LOCAL_TOOL_SPECS[name] for name in sorted(enabled)
              if name in LOCAL_TOOL_SPECS]

    workspace = Workspace(config.tools.workspace)

    handlers: dict[str, Callable[..., str]] = {
        "read_file": workspace.read_file,
        "list_dir": workspace.list_dir,
        "write_file": workspace.write_file,
        "calculator": lambda expression: calculate(expression),
    }

    def executor(name: str, payload: dict[str, Any]) -> str:
        if name not in enabled or name not in handlers:
            raise ValueError(f"tool '{name}' is not available to this agent")
        return handlers[name](**payload)

    return specs, executor
