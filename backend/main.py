import asyncio
import json
import os
import re
import shutil
import signal
import tempfile
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Literal
from urllib.parse import parse_qs, urlparse

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from backend.prompt import build_prompt
from backend.youtube import VideoContext, fetch_video_context


PROJECT_ROOT = Path(__file__).resolve().parent.parent
YOUTUBE_ID_PATTERN = re.compile(r"^[A-Za-z0-9_-]{11}$")
ALLOWED_HOSTS = {
    "youtube.com",
    "www.youtube.com",
    "m.youtube.com",
    "music.youtube.com",
    "youtu.be",
    "www.youtu.be",
    "youtube-nocookie.com",
    "www.youtube-nocookie.com",
}
FRONTEND_ORIGINS = {
    "http://127.0.0.1:4321",
    "http://localhost:4321",
}
AI_TIMEOUT_SECONDS = 15 * 60
MODEL_CATALOG = {
    "codex": [
        {
            "id": "gpt-5.6-sol",
            "label": "GPT-5.6 Sol",
            "description": "Best quality",
            "reasoning": ["low", "medium", "high", "xhigh", "max"],
            "default_reasoning": "low",
        },
        {
            "id": "gpt-5.5",
            "label": "GPT-5.5",
            "description": "Strong all-rounder",
            "reasoning": ["low", "medium", "high", "xhigh"],
            "default_reasoning": "medium",
        },
        {
            "id": "gpt-5.4",
            "label": "GPT-5.4",
            "description": "Balanced",
            "reasoning": ["low", "medium", "high", "xhigh"],
            "default_reasoning": "medium",
        },
        {
            "id": "gpt-5.4-mini",
            "label": "GPT-5.4 Mini",
            "description": "Fastest Codex option",
            "reasoning": ["low", "medium", "high", "xhigh"],
            "default_reasoning": "low",
        },
    ],
    "claude": [
        {
            "id": "claude-sonnet-5",
            "label": "Claude Sonnet 5",
            "description": "Best balance",
            "reasoning": ["low", "medium", "high", "xhigh", "max"],
            "default_reasoning": "medium",
        },
        {
            "id": "claude-opus-5",
            "label": "Claude Opus 5",
            "description": "Deepest analysis",
            "reasoning": ["low", "medium", "high", "xhigh", "max"],
            "default_reasoning": "high",
        },
        {
            "id": "claude-haiku-4-5",
            "label": "Claude Haiku 4.5",
            "description": "Fastest Claude option",
            "reasoning": ["default"],
            "default_reasoning": "default",
        },
    ],
}
analysis_lock = asyncio.Lock()


class SummaryRequest(BaseModel):
    url: str
    provider: Literal["codex", "claude"] = "codex"
    model: str = "gpt-5.6-sol"
    reasoning: str = "low"


class TimingItem(BaseModel):
    label: str
    seconds: float


class SummaryResponse(BaseModel):
    summary: str
    video_url: str
    elapsed_seconds: int
    provider: str
    model: str
    reasoning: str
    timings: list[TimingItem]


@dataclass
class AiRunResult:
    summary: str
    analysis_seconds: float
    processing_seconds: float


app = FastAPI(title="YouTube Distilled", version="1.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=list(FRONTEND_ORIGINS),
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type"],
)


def normalize_youtube_url(raw_url: str) -> str:
    value = raw_url.strip()
    try:
        parsed = urlparse(value)
    except ValueError as error:
        raise ValueError("Paste a valid YouTube video URL.") from error

    hostname = (parsed.hostname or "").lower()
    if parsed.scheme not in {"http", "https"} or hostname not in ALLOWED_HOSTS:
        raise ValueError("Paste a valid YouTube video URL.")

    video_id: str | None = None
    if hostname in {"youtu.be", "www.youtu.be"}:
        video_id = parsed.path.strip("/").split("/")[0]
    else:
        query_video_ids = parse_qs(parsed.query).get("v")
        if query_video_ids:
            video_id = query_video_ids[0]
        else:
            path_parts = [part for part in parsed.path.split("/") if part]
            if len(path_parts) >= 2 and path_parts[0] in {"embed", "shorts", "live"}:
                video_id = path_parts[1]

    if not video_id or not YOUTUBE_ID_PATTERN.fullmatch(video_id):
        raise ValueError("This looks like YouTube, but it does not contain a valid video ID.")

    return f"https://www.youtube.com/watch?v={video_id}"


def validate_model(provider: str, model: str, reasoning: str) -> None:
    model_spec = next((item for item in MODEL_CATALOG[provider] if item["id"] == model), None)
    if not model_spec:
        raise ValueError(f"{model} is not available for {provider.title()}.")
    if reasoning not in model_spec["reasoning"]:
        raise ValueError(f"{reasoning} reasoning is not available for {model_spec['label']}.")


async def stop_process(process: asyncio.subprocess.Process) -> None:
    if process.returncode is not None:
        return

    try:
        os.killpg(process.pid, signal.SIGTERM)
    except ProcessLookupError:
        return

    try:
        await asyncio.wait_for(process.wait(), timeout=5)
    except asyncio.TimeoutError:
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        await process.wait()


async def communicate(
    process: asyncio.subprocess.Process,
    prompt: str,
    provider_label: str,
) -> tuple[bytes, bytes]:
    try:
        return await asyncio.wait_for(
            process.communicate(prompt.encode("utf-8")),
            timeout=AI_TIMEOUT_SECONDS,
        )
    except asyncio.TimeoutError as error:
        await stop_process(process)
        raise RuntimeError(
            f"{provider_label} took longer than 15 minutes. Try the request again."
        ) from error
    except asyncio.CancelledError:
        await stop_process(process)
        raise


def diagnostic_message(stdout: bytes, stderr: bytes) -> str:
    diagnostic = (stderr or stdout).decode("utf-8", errors="replace").strip()
    return diagnostic[-1200:] if diagnostic else "No diagnostic was returned."


async def run_codex(
    video_url: str,
    context: VideoContext,
    model: str,
    reasoning: str,
) -> AiRunResult:
    codex_path = shutil.which("codex")
    if not codex_path:
        raise RuntimeError("Codex CLI was not found in PATH.")

    with tempfile.TemporaryDirectory(prefix="youtube-distilled-") as temporary_directory:
        output_path = Path(temporary_directory) / "summary.md"
        command = [
            codex_path,
            "--search",
            "--model",
            model,
            "--config",
            f'model_reasoning_effort="{reasoning}"',
            "--sandbox",
            "read-only",
            "--ask-for-approval",
            "never",
            "exec",
            "--ignore-user-config",
            "--skip-git-repo-check",
            "--ephemeral",
            "--color",
            "never",
            "--output-last-message",
            str(output_path),
            "-",
        ]
        environment = os.environ.copy()
        environment["NO_COLOR"] = "1"
        process = await asyncio.create_subprocess_exec(
            *command,
            cwd=PROJECT_ROOT,
            env=environment,
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            start_new_session=True,
        )

        analysis_started = time.monotonic()
        stdout, stderr = await communicate(process, build_prompt(video_url, context), "Codex")
        analysis_seconds = time.monotonic() - analysis_started

        if process.returncode != 0:
            raise RuntimeError(f"Codex could not finish the summary. {diagnostic_message(stdout, stderr)}")

        processing_started = time.monotonic()
        if not output_path.exists():
            raise RuntimeError("Codex finished without returning a summary.")
        summary = output_path.read_text(encoding="utf-8").strip()
        if not summary:
            raise RuntimeError("Codex returned an empty summary.")

        return AiRunResult(
            summary=summary,
            analysis_seconds=analysis_seconds,
            processing_seconds=time.monotonic() - processing_started,
        )


async def run_claude(
    video_url: str,
    context: VideoContext,
    model: str,
    reasoning: str,
) -> AiRunResult:
    claude_path = shutil.which("claude")
    if not claude_path:
        raise RuntimeError("Claude CLI was not found in PATH.")

    command = [
        claude_path,
        "-p",
        "--output-format",
        "json",
        "--model",
        model,
        "--permission-mode",
        "dontAsk",
        "--tools",
        "WebSearch,WebFetch",
        "--allowedTools",
        "WebSearch,WebFetch",
        "--strict-mcp-config",
        "--mcp-config",
        '{"mcpServers":{}}',
        "--disable-slash-commands",
        "--no-session-persistence",
    ]
    if reasoning != "default":
        command.extend(["--effort", reasoning])

    environment = os.environ.copy()
    environment["NO_COLOR"] = "1"
    environment["DISABLE_AUTOUPDATER"] = "1"
    environment["CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC"] = "1"
    process = await asyncio.create_subprocess_exec(
        *command,
        cwd=PROJECT_ROOT,
        env=environment,
        stdin=asyncio.subprocess.PIPE,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
        start_new_session=True,
    )

    analysis_started = time.monotonic()
    stdout, stderr = await communicate(process, build_prompt(video_url, context), "Claude")
    analysis_seconds = time.monotonic() - analysis_started

    if process.returncode != 0:
        raise RuntimeError(f"Claude could not finish the summary. {diagnostic_message(stdout, stderr)}")

    processing_started = time.monotonic()
    try:
        payload = json.loads(stdout.decode("utf-8"))
    except (json.JSONDecodeError, UnicodeDecodeError) as error:
        raise RuntimeError("Claude finished without returning a readable response.") from error

    summary = str(payload.get("result", "")).strip()
    if not summary:
        raise RuntimeError("Claude returned an empty summary.")

    return AiRunResult(
        summary=summary,
        analysis_seconds=analysis_seconds,
        processing_seconds=time.monotonic() - processing_started,
    )


async def run_provider(
    provider: str,
    video_url: str,
    context: VideoContext,
    model: str,
    reasoning: str,
) -> AiRunResult:
    if provider == "claude":
        return await run_claude(video_url, context, model, reasoning)
    return await run_codex(video_url, context, model, reasoning)


@app.get("/api/health")
async def health() -> dict[str, object]:
    return {
        "status": "ok",
        "providers": {
            "codex": {
                "available": shutil.which("codex") is not None,
                "models": MODEL_CATALOG["codex"],
            },
            "claude": {
                "available": shutil.which("claude") is not None,
                "models": MODEL_CATALOG["claude"],
            },
        },
    }


@app.post("/api/summarize", response_model=SummaryResponse)
async def summarize(request: SummaryRequest) -> SummaryResponse:
    request_started = time.monotonic()
    try:
        video_url = normalize_youtube_url(request.url)
        validate_model(request.provider, request.model, request.reasoning)
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error

    if analysis_lock.locked():
        raise HTTPException(status_code=429, detail="A video is already being distilled. Let it finish first.")

    prepared_at = time.monotonic()
    try:
        async with analysis_lock:
            video_id = parse_qs(urlparse(video_url).query)["v"][0]
            context_started = time.monotonic()
            context = await asyncio.to_thread(fetch_video_context, video_id)
            context_seconds = time.monotonic() - context_started
            result = await run_provider(
                request.provider,
                video_url,
                context,
                request.model,
                request.reasoning,
            )
    except RuntimeError as error:
        raise HTTPException(status_code=502, detail=str(error)) from error

    finished_at = time.monotonic()
    provider_label = "Claude" if request.provider == "claude" else "Codex"
    return SummaryResponse(
        summary=result.summary,
        video_url=video_url,
        elapsed_seconds=max(1, round(finished_at - request_started)),
        provider=request.provider,
        model=request.model,
        reasoning=request.reasoning,
        timings=[
            TimingItem(label="Preparing request", seconds=round(prepared_at - request_started, 3)),
            TimingItem(label="Fetching YouTube context", seconds=round(context_seconds, 3)),
            TimingItem(
                label=f"{provider_label} research + analysis",
                seconds=round(result.analysis_seconds, 3),
            ),
            TimingItem(label="Processing response", seconds=round(result.processing_seconds, 3)),
        ],
    )
