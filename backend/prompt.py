from backend.youtube import VideoContext, format_timestamp


SUMMARY_PROMPT = """Analyze this YouTube video using the supplied video context, transcript, captions, title, description, chapters, and visible metadata.

Goal: help me get the maximum value from the video while barely watching it or not watching it at all.

Structure your answer like this:

## 1. Video Summary
Give me a clear summary of the full video in 2–5 paragraphs. Focus on what the video is actually arguing, teaching, explaining, or showing.

## 2. Key Takeaways
List the most important takeaways. Prioritize ideas that are useful, surprising, actionable, or central to understanding the video.

## 3. “I Only Have 10 Minutes” Watch Guide
Pick the most important timestamps to watch if I only have 10 minutes total.

Keep this section short. Use this format:

| Title | Time | Why this part matters |
|---|---:|---|
| Short section title | 00:00–00:00 | One sentence explaining why it was picked |

Only include the highest-value moments. Do not overfill this section.

## 4. Important Concepts / Terms
Explain any important concepts, references, frameworks, people, tools, or terms mentioned in the video.

## 5. Hidden Value / What Most People Might Miss
Tell me what deeper point, implication, or useful detail might be easy to miss.

## 6. Practical Use
Explain how I can apply the video’s ideas in real life, work, learning, creativity, business, or decision-making.

## 7. Critical View
Briefly evaluate the video:
- What is strong about it?
- What is weak, vague, biased, exaggerated, or unsupported?
- What should I not blindly accept?

## 8. Final Compression
Give me:
- one-sentence summary
- 3 most important takeaways
- whether this video is worth watching fully, partially, or not at all

## 9. Diagrams
Draw up to five Mermaid diagrams, but only where a picture carries something the prose cannot say as compactly. Zero diagrams is a correct and common answer: narrative, interview, and commentary videos usually have no structure worth drawing. Do not fill this section. If nothing qualifies, say in one line that the video had no structure worth drawing and stop.

Use only these six diagram types.

Timecoded — every node must carry a timecode:
- `timeline` — how the video's argument unfolds
- `flowchart` — a process or decision path the video teaches
- `sequenceDiagram` — an exchange or interaction the video walks through

Explanatory — never put a timecode in these labels:
- `mindmap` — how the video's concepts relate
- `quadrantChart` — a two-axis comparison the video makes
- `sankey-beta` — flows or proportions, and only when the video states real numbers

Rules for this section:
- Put each diagram in its own ```mermaid fenced code block, with a short bold caption line above it.
- In a `timeline`, the timecode goes to the right of the colon and never to the left of it. Mermaid reads the left side as the period and cannot parse a timecode there, quoted or not. Write `Opening claim : 01:12`, not `01:12 : Opening claim`.
- In a `flowchart` or `sequenceDiagram`, put the timecode at the start of the node or message text, and wrap flowchart labels in double quotes: `A["01:12 Gather sources"]`.
- Timecodes follow the same rule as the rest of this brief: only times supported by the supplied material, never invented. If you cannot source a real time for every node, use an explanatory type instead, or draw nothing.
- Never use Mermaid's `click` directive. The app wires up seeking itself.
- Keep each diagram under about twelve nodes. Anything larger belongs in prose.
- Write plain label text. Parentheses, semicolons, and stray colons inside labels break Mermaid parsing.

Important:
- If transcript/timestamps are unavailable, say that clearly and work from the available context.
- Do not invent timestamps.
- Be concise but dense.
- Prioritize usefulness over completeness.
"""


FOLLOWUP_PROMPT = """Answer a follow-up question about a YouTube video that was already analyzed.

Rules:
- Answer from the video itself: its transcript, captions, chapters, and the brief below.
- Reference specific timecodes whenever they help me jump straight to the moment in the video.
- Be concise but thorough: answer the question directly and stop.
- Do not repeat the structured brief or reuse its section headings. No preamble, no restatement of the question, no description of your process.
- Use live web search only to clarify or verify a claim made in the video, never as a replacement for it.
- If the video does not answer the question, say so plainly and add the closest relevant context it does offer.
- Never infer or fabricate timecodes: only cite a time supported by the supplied material. Write timecode values as plain text; the app will make them clickable.
"""
MAX_FOLLOWUP_SUMMARY_CHARS = 14_000
MAX_FOLLOWUP_MESSAGE_CHARS = 3_000


def _context_block(context: VideoContext | None) -> str:
    if context is None:
        return "No context was extracted locally. Inspect the URL using live web search."

    metadata = [
        f"Title: {context.title or 'Unavailable'}",
        f"Channel: {context.author or 'Unavailable'}",
        (
            f"Duration: {format_timestamp(context.duration_seconds)}"
            if context.duration_seconds is not None
            else "Duration: Unavailable"
        ),
        "Description and chapters:",
        context.description or "Unavailable",
    ]
    if context.transcript:
        caption_kind = "auto-generated" if context.transcript_generated else "creator-provided"
        metadata.extend(
            [
                "",
                f"Transcript ({context.transcript_language or 'unknown language'}, {caption_kind}):",
                context.transcript,
            ]
        )
    else:
        metadata.extend(
            [
                "",
                "Transcript: Unavailable.",
                f"Extraction note: {context.transcript_error or 'No caption track was exposed.'}",
            ]
        )
    return "\n".join(metadata)


def build_prompt(video_url: str, context: VideoContext | None = None) -> str:
    return f"""{SUMMARY_PROMPT}

Video URL: {video_url}

The app extracted the following source material directly from YouTube. Treat it as the primary evidence. Auto-generated captions can contain transcription errors, so resolve obvious errors from context and do not overstate uncertain wording.

--- BEGIN EXTRACTED VIDEO CONTEXT ---
{_context_block(context)}
--- END EXTRACTED VIDEO CONTEXT ---

Use live web search only to corroborate or clarify the supplied material when useful. Do not ask follow-up questions. Return only the completed Markdown brief, beginning with `## 1. Video Summary`. Do not describe your process. Never infer or fabricate timestamps: only include a timestamp when it is supported by the supplied transcript, captions, chapters, or page context. Write timestamp values as plain text; the app will make them clickable.
"""


def _condense(value: str, limit: int) -> str:
    text = (value or "").strip()
    if len(text) <= limit:
        return text
    return f"{text[:limit].rstrip()}\n[... trimmed for length ...]"


def _history_block(history: list[dict[str, str]]) -> str:
    lines: list[str] = []
    for message in history:
        role = "Question" if message.get("role") == "user" else "Your answer"
        content = _condense(str(message.get("content", "")), MAX_FOLLOWUP_MESSAGE_CHARS)
        if content:
            lines.append(f"{role}: {content}")
    return "\n\n".join(lines) if lines else "No follow-up questions have been asked yet."


def build_followup_prompt(
    video_url: str,
    summary: str,
    history: list[dict[str, str]],
    question: str,
) -> str:
    return f"""{FOLLOWUP_PROMPT}

Video URL: {video_url}

This is the brief that was already produced for the video. Treat it as established context and do not repeat it back to me.

--- BEGIN VIDEO BRIEF ---
{_condense(summary, MAX_FOLLOWUP_SUMMARY_CHARS) or "Unavailable."}
--- END VIDEO BRIEF ---

--- BEGIN CONVERSATION SO FAR ---
{_history_block(history)}
--- END CONVERSATION SO FAR ---

New question: {question.strip()}

Return only the answer to the new question, as Markdown.
"""
