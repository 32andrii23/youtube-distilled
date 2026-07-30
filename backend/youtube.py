import html
import json
import re
from dataclasses import dataclass
from urllib.request import Request, urlopen

from youtube_transcript_api import YouTubeTranscriptApi


USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36"
)
MAX_DESCRIPTION_CHARS = 12_000
MAX_TRANSCRIPT_CHARS = 160_000


@dataclass
class VideoContext:
    title: str | None = None
    author: str | None = None
    duration_seconds: int | None = None
    description: str | None = None
    transcript: str | None = None
    transcript_language: str | None = None
    transcript_generated: bool = False
    transcript_error: str | None = None

    @property
    def has_transcript(self) -> bool:
        return bool(self.transcript)


def _fetch_text(url: str) -> str:
    request = Request(url, headers={"User-Agent": USER_AGENT, "Accept-Language": "en-US,en"})
    with urlopen(request, timeout=20) as response:
        return response.read().decode("utf-8", errors="replace")


def _decode_json_string(value: str) -> str:
    try:
        return json.loads(f'"{value}"')
    except json.JSONDecodeError:
        return html.unescape(value.replace(r"\n", "\n"))


def parse_watch_metadata(page: str) -> tuple[str | None, int | None]:
    description_match = re.search(r'"shortDescription":"((?:\\.|[^"\\])*)"', page)
    duration_match = re.search(r'"lengthSeconds":"(\d+)"', page)
    description = _decode_json_string(description_match.group(1)) if description_match else None
    duration = int(duration_match.group(1)) if duration_match else None
    return description, duration


def _fetch_metadata(video_id: str) -> tuple[str | None, str | None, str | None, int | None]:
    video_url = f"https://www.youtube.com/watch?v={video_id}"
    title = None
    author = None
    try:
        oembed = json.loads(
            _fetch_text(f"https://www.youtube.com/oembed?url={video_url}&format=json")
        )
        title = str(oembed.get("title") or "").strip() or None
        author = str(oembed.get("author_name") or "").strip() or None
    except (OSError, ValueError, json.JSONDecodeError):
        pass

    description = None
    duration = None
    try:
        description, duration = parse_watch_metadata(_fetch_text(f"{video_url}&hl=en"))
    except OSError:
        pass

    if description and len(description) > MAX_DESCRIPTION_CHARS:
        description = description[:MAX_DESCRIPTION_CHARS] + "\n[Description truncated by the app.]"
    return title, author, description, duration


def format_timestamp(seconds: float) -> str:
    total_seconds = max(0, int(seconds))
    hours, remainder = divmod(total_seconds, 3600)
    minutes, seconds = divmod(remainder, 60)
    if hours:
        return f"{hours:02d}:{minutes:02d}:{seconds:02d}"
    return f"{minutes:02d}:{seconds:02d}"


def _fetch_transcript(video_id: str) -> tuple[str, str, bool]:
    transcripts = list(YouTubeTranscriptApi().list(video_id))
    if not transcripts:
        raise RuntimeError("YouTube did not expose a caption track.")

    def rank(item: object) -> tuple[int, int]:
        language_code = str(getattr(item, "language_code", "")).lower()
        is_english = language_code == "en" or language_code.startswith("en-")
        is_generated = bool(getattr(item, "is_generated", False))
        return (0 if is_english else 1, 1 if is_generated else 0)

    selected = min(transcripts, key=rank)
    snippets = selected.fetch()
    lines = [
        f"[{format_timestamp(snippet.start)}] {str(snippet.text).replace(chr(10), ' ').strip()}"
        for snippet in snippets
        if str(snippet.text).strip()
    ]
    transcript = "\n".join(lines)
    if len(transcript) > MAX_TRANSCRIPT_CHARS:
        transcript = transcript[:MAX_TRANSCRIPT_CHARS] + "\n[Transcript truncated by the app.]"
    return (
        transcript,
        str(getattr(selected, "language", getattr(selected, "language_code", "unknown"))),
        bool(getattr(selected, "is_generated", False)),
    )


def fetch_video_context(video_id: str) -> VideoContext:
    title, author, description, duration = _fetch_metadata(video_id)
    context = VideoContext(
        title=title,
        author=author,
        description=description,
        duration_seconds=duration,
    )
    try:
        transcript, language, generated = _fetch_transcript(video_id)
        context.transcript = transcript
        context.transcript_language = language
        context.transcript_generated = generated
    except Exception as error:  # YouTube returns several library-specific failure classes.
        context.transcript_error = str(error).strip() or type(error).__name__
    return context
