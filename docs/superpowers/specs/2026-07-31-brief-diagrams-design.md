# Brief diagrams — design

Date: 2026-07-31
Status: proposed

## Goal

Let the analysis draw. A brief today is eight sections of prose, tables, and
timecodes; some videos argue a structure, teach a process, or compare options,
and those are clearer seen than read. Section 9 gives the model a place to draw
up to five Mermaid diagrams — and the explicit freedom to draw none.

The differentiator is not that diagrams exist. Every YouTube summarizer with a
visual mode renders one mind map per video. It is that half the diagram
vocabulary here is anchored to timecodes, so a diagram doubles as a visual table
of contents: click a node, the player seeks. That reuses machinery this app
already has and nothing in that category does.

## Decisions

| Decision | Choice |
| --- | --- |
| Transport | Fenced ` ```mermaid ` blocks inside the existing brief Markdown. |
| Placement | A new `## 9. Diagrams` section. Zero to five diagrams. |
| Vocabulary | Six types, split into timecoded and explanatory groups. |
| Clickable nodes | SVG post-processing, not Mermaid's `click` directive. |
| Security level | `strict`. Never loosened. |
| Invalid output | Render the source as a code block. No retry, no round-trip. |
| Extension panel | Out of scope. Renders the fence as a plain code block. |

Mermaid is the transport because Codex and Claude Code already emit it fluently
with no format instruction — the same reason Excalidraw's AI generates Mermaid
and renders it rather than drawing directly. Model-authored SVG offers finer
control at much worse reliability, and a bespoke JSON schema would teach the
model a dialect it has never seen.

Because the diagram travels inside the brief Markdown, `backend/main.py` needs
no changes at all, and `splitSummary` in `src/App.tsx` already turns any `##`
heading into a section. The backend surface of this feature is one prompt
section.

## The type contract

| Group | Types | Timecodes |
| --- | --- | --- |
| Timecoded | `timeline`, `flowchart`, `sequenceDiagram` | Required on every event, node, or message |
| Explanatory | `mindmap`, `quadrantChart`, `sankey-beta` | Forbidden in labels |

The split is enforced in the prompt and checked in the renderer. Timecoded types
describe something that happens in an order the video itself has, so a time is
always available and always useful. Explanatory types describe a shape that
exists outside time — a hierarchy, a two-axis comparison, a distribution — where
a timecode would be noise, and inventing one would violate the brief's existing
prohibition on fabricated timestamps.

`sankey-beta` is the weakest member. It needs real quantities, and transcripts
rarely supply them cleanly. The prompt says so directly: use it only when the
video states actual numbers, never to render a vague sense of proportion.

### The timeline colon rule

Found while verifying the renderer, and the reason the first working diagram
failed: in a `timeline`, a timecode cannot go to the left of the colon. Mermaid
reads that side as the period, and `01:12 : Opening claim` fails to parse —
quoting it does not help. `Opening claim : 01:12` parses fine, as does a
timecode anywhere in the event text. Checked against Mermaid 11:

| Form | Parses |
| --- | --- |
| `01:12 : Opening claim` | no |
| `"01:12" : Opening claim` | no |
| `Opening claim : 01:12` | yes |
| `Opening claim : 01:12 the thesis lands` | yes |
| `A["01:12 Gather sources"]` (flowchart) | yes |
| `A->>B: 01:12 Opening claim` (sequence) | yes |

The prompt states this as a rule with both forms spelled out, and
`tests/test_prompt.py` asserts the rule is still there. Without it, `timeline` —
the type most worth having — fails on nearly every diagram it produces.

## Zero is a correct answer

The failure mode of any always-present visual section is filler. A model asked
for a diagram will produce one even when the content is a person talking through
an argument that has no structure worth drawing.

Three defenses, in order of importance:

1. The prompt states that zero diagrams is a correct and common answer, and
   names the case: narrative, interview, and commentary videos usually have
   nothing to draw.
2. The prompt gives a test each diagram must pass — it must show something the
   prose cannot say as compactly — and asks the model to apply it per diagram
   rather than to the section as a whole.
3. The cap is five, stated as a ceiling and not a target.

When the section is empty the model writes a single line saying the video had no
structure worth drawing, so the section reads as a deliberate judgment rather
than a rendering failure.

## Rendering

A new `MermaidDiagram` component, reached through react-markdown's `code`
component override when the fence language is `mermaid`.

1. **Load.** `await import("mermaid")` on first diagram. Mermaid is roughly
   480KB; a dynamic import keeps it out of the startup bundle for the many runs
   that produce no diagram at all.
2. **Validate.** `mermaid.parse(src, { suppressErrors: true })` returns `false`
   instead of throwing on bad syntax. LLM-generated Mermaid is invalid often
   enough that a whole category of validator tooling exists for it, so this is
   the expected path, not the exceptional one.
3. **Render.** `mermaid.render()` into the DOM.
4. **Linkify.** Walk the SVG's `<text>` nodes, match `TIMECODE_PATTERN` from
   `src/timecodes.ts`, and attach handlers calling the existing `playTimecode`.
5. **Theme.** `themeVariables` over the `base` theme — the only modifiable one —
   wired to the app palette so diagrams do not read as pasted in.

### Why not Mermaid's `click`

Mermaid gates `click` behind `securityLevel: 'antiscript'` or `'loose'`.
Loosening the security level on input authored by a model, to buy an interaction
we can get another way, is a bad trade. `timeline` and `mindmap` do not
reliably support `click` regardless, so the directive would cover only part of
the vocabulary while the SVG walk covers all of it with one mechanism. The
prompt forbids `click` outright; `strict` mode would ignore it anyway, but
saying so keeps the model from spending output on it.

### When parsing fails

Render the diagram source as an ordinary code block with a quiet note that it
could not be drawn. No retry loop and no backend round-trip: a re-run costs a
full CLI invocation, and the brief around the diagram is still good. The user
sees that something was attempted and what it was, which is more honest than a
silently missing section.

## Changes to existing code

**`src/timecodes.ts` — `linkifyTimecodes` must skip fenced code blocks.** It
currently regex-rewrites the whole raw Markdown string before react-markdown
parses it. A `timeline` diagram is full of timecodes, and every one of them
would become `[00:15](#t=15)` inside the fence, breaking the parse. This is a
prerequisite, not a refinement: without it no timecoded diagram can render.

**`src/App.tsx` — collapse the duplicated timecode-link renderer.** The `a`
component override appears verbatim twice, at `AnswerMarkdown` and in the
section loop. The `code` override has to be added to both, so unify them into
one `BriefMarkdown` component first and add the override once. This keeps the
two surfaces from drifting, which they already nearly have.

## The extension panel

*Drawing* diagrams in the panel is out of scope. Three unknowns stack up there:
MV3 forbids `unsafe-eval`, the documented workaround is a sandboxed iframe, and
whether Mermaid v11 actually needs eval is unverified. None of that blocks the
web app, and guessing at it would. Bringing Mermaid to the panel is its own
spec, and it starts by verifying the eval question.

*Surviving* diagrams in the panel is in scope, because the panel currently does
neither of the two things it would need to. Both are hazards introduced by this
feature, not pre-existing bugs:

**`extension/markdown.js` has no fenced-code-block handling.** It renders inline
code spans and nothing else, so a ` ```mermaid ` block falls through to
`renderParagraph` and comes out as a run of broken text with literal backticks —
and `renderInline` linkifies every timecode inside it along the way. It needs a
fence branch that emits `<pre><code>` with the body escaped and held aside from
inline processing.

**`extractMoments` scans the whole brief as a fallback.** When the watch-guide
section yields nothing, `extension/moments.js:150` drops to scanning every line
of the brief for timecodes. A `timeline` diagram is dense with them, so that
fallback would flood the YouTube seek bar with bogus moment brackets pointing at
diagram labels. It must strip fenced blocks before the fallback scan.

The panel therefore shows the diagram source in a code block. That degrades
honestly — the source is visible rather than the section looking empty — and the
seek bar stays truthful.

## Testing

| Test | Where |
| --- | --- |
| `linkifyTimecodes` leaves fenced blocks untouched | `tests/timecodes.test.ts` |
| `linkifyTimecodes` still links timecodes around a fence | `tests/timecodes.test.ts` |
| Inline code spans are also skipped | `tests/timecodes.test.ts` |
| The prompt names all six types and the five-diagram cap | `tests/test_prompt.py` (new) |
| A fence renders as `<pre><code>` with timecodes left as text | `tests/extension-markdown.test.ts` |
| Diagram timecodes never become watch moments | `tests/extension-moments.test.ts` |

The fence-awareness tests carry the weight, because that function silently
corrupts every diagram if it regresses and nothing else would catch it. Mermaid
rendering itself is not unit-tested — it is a third-party library behind a
dynamic import, and the useful check is the app running.
