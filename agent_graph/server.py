"""HTTP server for the configuration frontend.

    GET  /                serves the UI
    GET  /api/schema      config metadata the UI builds its form from
    POST /api/validate    normalise + validate a config (shows resolved presets)
    POST /api/run         run the graph, streaming events back as SSE
"""

from __future__ import annotations

import json
from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import ValidationError

from .config import (
    LOCAL_TOOLS,
    MODEL_CHOICES,
    PRESETS,
    ROLES,
    SERVER_TOOLS,
    GraphConfig,
)
from .llm import has_credentials
from .runner import stream

UI_DIR = Path(__file__).parent / "ui"

app = FastAPI(title="Agent Graph", version="0.1.0")


@app.get("/api/schema")
def schema() -> dict:
    """Everything the frontend needs to render its controls."""
    return {
        "models": MODEL_CHOICES,
        "roles": list(ROLES),
        "presets": {name: preset for name, preset in PRESETS.items()},
        "tools": {"local": LOCAL_TOOLS, "server": SERVER_TOOLS},
        "efforts": ["low", "medium", "high", "xhigh", "max"],
        "formats": [
            "report", "brief", "bullets", "json", "template", "code", "custom",
        ],
        "action_modes": ["off", "propose", "execute"],
        "defaults": GraphConfig().model_dump(mode="json"),
        "credentials": has_credentials(),
    }


@app.post("/api/validate")
async def validate(payload: dict) -> JSONResponse:
    try:
        config = GraphConfig.model_validate(payload)
    except ValidationError as exc:
        return JSONResponse(
            {"ok": False, "errors": exc.errors(include_url=False)}, status_code=422
        )
    return JSONResponse({"ok": True, "config": config.model_dump(mode="json")})


@app.post("/api/run")
async def run_graph(payload: dict) -> StreamingResponse:
    try:
        config = GraphConfig.model_validate(payload)
    except ValidationError as exc:
        return JSONResponse(
            {"ok": False, "errors": exc.errors(include_url=False)}, status_code=422
        )

    def events():
        try:
            for event in stream(config):
                yield f"data: {json.dumps(event, default=str)}\n\n"
        except Exception as exc:  # keep the stream well-formed on failure
            payload = {"type": "run", "status": "error",
                       "error": f"{type(exc).__name__}: {exc}"}
            yield f"data: {json.dumps(payload)}\n\n"
        yield "data: {\"type\": \"eof\"}\n\n"

    return StreamingResponse(
        events(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@app.get("/")
def index() -> FileResponse:
    return FileResponse(UI_DIR / "index.html")


app.mount("/static", StaticFiles(directory=UI_DIR), name="static")


def serve(host: str = "127.0.0.1", port: int = 8000) -> None:
    import uvicorn

    print(f"Agent Graph UI -> http://{host}:{port}")
    if not has_credentials():
        print("No Anthropic credentials detected — the UI defaults to mock mode.")
    uvicorn.run(app, host=host, port=port, log_level="warning")


if __name__ == "__main__":
    serve()
