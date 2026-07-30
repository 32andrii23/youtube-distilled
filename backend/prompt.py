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

Important:
- If transcript/timestamps are unavailable, say that clearly and work from the available context.
- Do not invent timestamps.
- Be concise but dense.
- Prioritize usefulness over completeness.
"""


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
