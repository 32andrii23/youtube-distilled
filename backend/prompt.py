from backend.youtube import VideoContext, format_timestamp


SUMMARY_PROMPT = """Analyze this YouTube video using the supplied video context, transcript, captions, title, description, chapters, and visible metadata.

Goal: help me get the maximum value from the video while barely watching it or not watching it at all.

Structure your answer like this:

## 0. Verdict
Open with the call: should I watch this video at all, and how strongly.

Write exactly two lines, nothing else, in this order:

Score: NN/100
Why: One or two sentences naming what in this specific video earns or loses the score.

Score the video's worth to me, not its quality in general. A polished, well-argued video about something I already do daily scores low. A badly shot one that solves a problem I am stuck on right now scores high. The viewer profile further down is the thing you are scoring against; read it before you pick a number.

What the bands have to mean, so the number lands me on an action rather than a feeling:

| Score | Means | The action it commits me to |
|---:|---|---|
| 70-100 | Worth watching properly | It teaches something I do not already have and would actually use |
| 40-69 | Worth only the moments in section 3 | Real value, but it is a few minutes buried in a long video |
| 0-39 | The brief is enough | Sections 1 and 2 leave nothing on the table |

Rules for this section:
- `Why` must point at something concrete in this video. "Walks through the exact eval harness I have been missing" is a reason; "relevant to AI engineering" is not.
- When the score is middling, say what loses the points as well as what earns them. That is the sentence that makes a 55 different from a 65.
- Weigh how much of the video is the useful part. A ten-minute video that is entirely on point outscores a two-hour one with the same idea in it somewhere.
- Familiarity cuts the score hard. Material I already know is worth nothing to me however well it is made.
- No timecodes in this section. Section 3 owns those.
- Do not hedge to the middle. Scores between 45 and 55 should be rare and should mean genuinely mixed, not undecided.
- Never adjust the score to be encouraging or to soften a low one. A 12 is a useful answer.

## 1. Video Summary
Give me a clear summary of the full video in 2–5 paragraphs. Focus on what the video is actually arguing, teaching, explaining, or showing.

## 2. Key Takeaways
List the most important takeaways. Prioritize ideas that are useful, surprising, actionable, or central to understanding the video.

## 3. “I Only Have 10 Minutes” Watch Guide
Pick the most important timestamps to watch if I have at most 10 minutes total.

Ten minutes is a ceiling, not a target. Spend only what the video actually earns: if two minutes of clips carry the whole value, pick two minutes and stop. Never pad the selection to reach ten minutes, and never stretch a period beyond the moment that made it worth watching. A short video, or one with a single dense passage, should come out well under the budget.

Open the section with one line stating the total watch time of the rows you picked, like `Total: about 4 minutes.` Write it in words, never as a clock value, so it is not mistaken for a timestamp.

Keep this section short. Use this format:

| Title | Time | Why this part matters |
|---|---:|---|
| Short section title | 00:00–00:00 | One sentence explaining why it was picked |

Only include the highest-value moments. Do not overfill this section.

List the rows in ascending order and keep the time periods disjoint: each row must start at or after the previous row ends. Never overlap or nest two periods.

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
Draw the shape of what the video says — the structure I would otherwise have to hold in my head while watching. This section is not a picture of the video's running order. Section 3 already covers running order, and a diagram that repeats it is wasted space.

Draw at most four diagrams. Two good ones beat four. Zero is a correct and common answer: vlogs, narrative, and most entertainment have no structure worth drawing. Do not fill this section. If nothing qualifies, say in one line that the video had no structure worth drawing and stop.

Find the video's shape, then draw that:

| If the video is | Draw | With |
|---|---|---|
| an argument, essay, or opinion piece | what holds the central claim up: which evidence carries it, and which unstated assumption it rests on | `flowchart` |
| an explainer of how something works | the mechanism, including the loop that makes it run or self-reinforce | `flowchart`, or `stateDiagram-v2` when the thing moves between modes |
| a how-to with real forks in it | the decision as something I can actually run, conditions and all | `flowchart` |
| a comparison, review, or ranking | the options placed on the two axes the video really judges them on | `quadrantChart` |
| a conceptual or definitional talk | how the terms nest, and where they overlap | `mindmap` |
| a story, case study, or documentary | who did what to whom | `erDiagram`, plus a `timeline` when the chronology of events carries the story |
| an interview or debate | the two positions and the exact points where they collide | `flowchart` |
| a walkthrough of an exchange between parties | the exchange itself, turn by turn | `sequenceDiagram` |
| number-heavy, with figures the video actually states | where a quantity splits, or how it moved | `sankey-beta`, `xychart-beta` |

Blend rows when the video does, and prefer two diagrams of different types over two of the same. Use only the nine types named above.

The bar for drawing at all: a diagram earns its place when it shows a relationship prose has to spell out slowly — a loop, a branch, a convergence, a cross-link, a position on two axes, a split of a quantity. A `flowchart` that runs straight through, with no branch, no loop, and no two arrows arriving at the same node, is a list. Write it as prose and drop the diagram.

Never draw:
- the video's own sections in order, in any diagram type. That is section 3 as a picture.
- a node whose label is a section title and a timestamp.
- anything you would caption "the video, in order" or "how the video is structured".
- a `timeline` of the video's runtime. `timeline` is for a chronology inside the subject — a company's history, the events of a case — where the periods are dates or eras the video talks about, never playhead positions.

Caption each diagram with one bold line naming the question the picture answers, like **Why the video thinks fees, not skill, decide the outcome**. Never caption it with the diagram type or a number.

Timecodes are anchors to the evidence, not the content of a node. Where a node states something specific the video says at an identifiable moment, put the timecode at the end of the label — `A["Fees compound against you 04:12"]` — and the app turns it into a control that seeks the video. Nodes that are syntheses, categories, conditions, or questions carry no timecode, and a good diagram usually has them on some nodes and not others. Never open a label with a timecode, never put one on every node to be thorough, and never use a time the supplied material does not support.

Syntax, each rule verified against Mermaid 11:
- Put each diagram in its own ```mermaid fenced code block, directly under its caption.
- Wrap every `flowchart` label in double quotes: `A["Fees compound 04:12"]`. Quoted labels can hold parentheses, colons, and timecodes safely; unquoted ones cannot.
- In a `stateDiagram-v2`, a state whose name has spaces must be declared first and then referred to by its id: `state "Novice investor" as Novice_investor`. Writing `A --> Novice investor` parses but silently draws the wrong state.
- In an `erDiagram`, quote any relationship label longer than one word: `FOUNDER ||--o{ COMPANY : "starts and funds"`.
- In an `xychart-beta`, quote the title and the y-axis label, and plot only figures the video actually states.
- In a `timeline`, the period goes to the left of the colon and the event to the right of it: `1996 : Company founded`. A timecode can only ever appear on the right, appended to the event text. Mermaid reads the left side as the period and cannot parse a timecode there, quoted or not: write `Opening claim : 01:12`, never `01:12 : Opening claim`.
- A `sankey-beta` is rows of `source,target,value` with real numbers from the video.
- Never use Mermaid's `click` directive. The app wires up seeking itself.
- Keep each diagram under about twelve nodes. Anything larger belongs in prose.

Important:
- If transcript/timestamps are unavailable, say that clearly and work from the available context.
- Do not invent timestamps.
- Be concise but dense.
- Prioritize usefulness over completeness.
"""


# What the score in section 0 is measured against. Deliberately about the shape
# of my work and attention rather than my identity: to price a video the model
# needs to know what I already have and what I would act on, not who I am. This
# is the one part of the prompt that goes stale on its own — when the work
# changes and this does not, every score is answering last year's question.
VIEWER_PROFILE = """Where I am
- Full-stack engineer, TypeScript end to end, working at a strong mid-to-senior level. Self-taught, and I move quickly.
- My day job is reliability and evaluation for a production LLM voice agent in healthcare: eval design, simulated-call regression testing, tracing and observability, alerting that fails closed.
- I am preparing for a stronger international backend or full-stack role, so senior interview material is live work rather than curiosity.
- I read constantly and I run my own notes-and-agent setup.

What I already have cold. Material pitched at this level is worth nothing to me however well it is made:
- React, Next.js, Node, NestJS, TypeScript, PostgreSQL, Redis, Prisma, GraphQL, both the fundamentals and the everyday use.
- CRUD APIs, auth flows, pagination, todo and clone builds, Firebase and Supabase starters.
- Docker, docker-compose, GitHub Actions CI, deploying Node to a VM, Nginx and certificates, AWS at practitioner level, basic SQL.
- What an LLM is, what a prompt is, what RAG is, and building one more RAG chatbot.

What I am actually trying to learn. The high scores live here:
- LLM evaluation: judge design and how it fails, criteria taxonomies, aggregation traps, scoring drift.
- Agent testing: simulation, production-trace replay, regression suites for non-deterministic systems.
- Observability for AI systems: OpenTelemetry GenAI conventions, tracing, dead-man switches, alert precision, blast radius.
- Agent infrastructure rather than agent demos: MCP internals and authorization, tool contracts, harness and skill design.
- Voice AI and telephony: call failure attribution, latency, barge-in, PHI-safe telemetry.
- TypeScript, Node, and Postgres at depth: variance and the strict compiler flags, backpressure, bounded concurrency, graceful shutdown, heap profiling, index and transaction diagnosis.
- Senior interviewing from both sides: system design, production war stories, behavioural structure, mock interviews.
- Architecture and the trade-offs a senior engineer is expected to have an opinion about.

Outside work, where a genuinely good video still scores well:
- Film craft, from a beginner who wants the mechanism named: shot size, blocking, editing rhythm, structure, subtext. Director and crew interviews and real production decisions count. Serious, weighty film and anime, never franchise coverage.
- Books and ideas: Nietzsche, Fromm, Dostoevsky, Homer, the Stoics, Naval, big-idea nonfiction.
- Football, played and watched. Tactics and match analysis, not athlete-brand documentaries.
- Writing craft, sleep and eye strain with real citations, beginner gym programming, VW 2.0 TSI maintenance, small-breed dog dental care, co-op games, and music-genre primers.

What I do not want, at any production quality:
- Tutorial-tier web development. The list of what I already have is above.
- Agent demos, "what is RAG", introductory prompt engineering, tool listicles.
- AI hype and AI doom: model-release reactions, "AI replaces developers", anything that argues by vibe.
- One more productivity or AI system to adopt. I replace tools, I do not accumulate them.
- Franchise and IP content, fan theories, leaks, current shonen, hustle and passive-income material.
- Anything whose pitch is that I put it on in the background.

How I judge afterwards whether watching was worth it:
- Did it leave me a mental model, or a sharp atmosphere? Mood alone is a failure.
- Does it name the mechanism? "X works because of choice Y" is worth watching; "X is great" is not.
- Runtime is part of the price. A long video has to earn its length, and a short one that is entirely on point beats a long one with the same idea buried somewhere inside it.
- One long substantial video beats five short ones."""


FOLLOWUP_PROMPT = """Answer a follow-up question about a YouTube video that was already analyzed.

Rules:
- Answer from the material supplied below: the brief, the conversation so far, and the transcript when one is included.
- Reference specific timecodes whenever they help me jump straight to the moment in the video.
- Be concise but thorough: answer the question directly and stop.
- Do not repeat the structured brief or reuse its section headings. No preamble, no restatement of the question, no description of your process.
- Use live web search only to clarify or verify a claim made in the video, never as a replacement for it.
- If the supplied material does not answer the question, say so plainly and add the closest relevant context it does offer.
- Never infer or fabricate timecodes: only cite a time supported by the supplied material. Write timecode values as plain text; the app will make them clickable.
"""
MAX_FOLLOWUP_SUMMARY_CHARS = 14_000
MAX_FOLLOWUP_MESSAGE_CHARS = 3_000
MAX_FOLLOWUP_TRANSCRIPT_CHARS = 120_000
# Six exchanges. The brief and the transcript carry the context that matters, so
# older turns are the cheapest thing to drop when a thread runs long.
MAX_FOLLOWUP_HISTORY_MESSAGES = 12


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

This is who the brief is for. Section 0 scores the video against it.

--- BEGIN VIEWER PROFILE ---
{VIEWER_PROFILE}
--- END VIEWER PROFILE ---

The app extracted the following source material directly from YouTube. Treat it as the primary evidence. Auto-generated captions can contain transcription errors, so resolve obvious errors from context and do not overstate uncertain wording.

--- BEGIN EXTRACTED VIDEO CONTEXT ---
{_context_block(context)}
--- END EXTRACTED VIDEO CONTEXT ---

Use live web search only to corroborate or clarify the supplied material when useful. Do not ask follow-up questions. Return only the completed Markdown brief, beginning with `## 0. Verdict`. Do not describe your process. Never infer or fabricate timestamps: only include a timestamp when it is supported by the supplied transcript, captions, chapters, or page context. Write timestamp values as plain text; the app will make them clickable.
"""


def _condense(value: str, limit: int) -> str:
    text = (value or "").strip()
    if len(text) <= limit:
        return text
    return f"{text[:limit].rstrip()}\n[... trimmed for length ...]"


def _history_block(history: list[dict[str, str]]) -> str:
    kept = history[-MAX_FOLLOWUP_HISTORY_MESSAGES:]
    lines: list[str] = []
    if len(history) > len(kept):
        lines.append("Earlier questions were dropped to keep this prompt in bounds.")

    for message in kept:
        role = "Question" if message.get("role") == "user" else "Your answer"
        content = _condense(str(message.get("content", "")), MAX_FOLLOWUP_MESSAGE_CHARS)
        if content:
            lines.append(f"{role}: {content}")
    return "\n\n".join(lines) if lines else "No follow-up questions have been asked yet."


# The transcript is cached from the analysis run, so a follow-up on a brief from
# an earlier server session will not have one. Saying so is what keeps the model
# from citing timecodes it cannot actually see.
def _transcript_block(context: VideoContext | None) -> str:
    if context is None or not context.transcript:
        return (
            "The transcript is not available in this session. Answer from the brief and the"
            " conversation, and only cite timecodes that appear in the brief."
        )

    caption_kind = "auto-generated" if context.transcript_generated else "creator-provided"
    return f"""This is the transcript the analysis worked from. Auto-generated captions can contain transcription errors, so resolve obvious errors from context.

--- BEGIN VIDEO TRANSCRIPT ({context.transcript_language or 'unknown language'}, {caption_kind}) ---
{_condense(context.transcript, MAX_FOLLOWUP_TRANSCRIPT_CHARS)}
--- END VIDEO TRANSCRIPT ---"""


def build_followup_prompt(
    video_url: str,
    summary: str,
    history: list[dict[str, str]],
    question: str,
    context: VideoContext | None = None,
) -> str:
    return f"""{FOLLOWUP_PROMPT}

Video URL: {video_url}

This is the brief that was already produced for the video. Treat it as established context and do not repeat it back to me.

--- BEGIN VIDEO BRIEF ---
{_condense(summary, MAX_FOLLOWUP_SUMMARY_CHARS) or "Unavailable."}
--- END VIDEO BRIEF ---

{_transcript_block(context)}

--- BEGIN CONVERSATION SO FAR ---
{_history_block(history)}
--- END CONVERSATION SO FAR ---

New question: {question.strip()}

Return only the answer to the new question, as Markdown.
"""
