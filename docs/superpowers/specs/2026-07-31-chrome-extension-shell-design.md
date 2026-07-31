# Chrome extension shell — design

Date: 2026-07-31
Status: approved

## Goal

A Chrome extension that brings YouTube Distilled to the page where videos are
watched. This first pass is a frontend-only shell: the interface is complete and
interactive, but the brief it displays is canned. No backend work, and no
changes to the existing app or API.

## Decisions

| Decision | Choice |
| --- | --- |
| Data source | Mock only. No network calls. |
| Surface | Side panel only. The toolbar icon opens it. |
| Repo structure | `extension/` with no build step; loadable unpacked. |
| Timecodes | Seek the real YouTube player in the tab. |

Two behaviours are real even in the shell: the detected video and timecode
seeking. Only the brief is fabricated. This keeps the shell honest as a
prototype — the parts that must feel native already do.

## Layout

```
extension/
  manifest.json      MV3. permissions: ["sidePanel"]. host: youtube.com/*
  background.js      Service worker. Opens the panel on icon click.
  content.js         youtube.com/watch. Reports video info, seeks playback.
  panel.html         Side panel document.
  panel.css          App design tokens at panel scale.
  panel.js           State machine and rendering.
  markdown.js        Pure. Markdown subset to HTML, timecode linkify.
  mock-brief.js      Pure data. The canned payload.
  icons/             16, 32, 48, 128, derived from public/logo.png.
  README.md          Load-unpacked instructions.
```

`content.js` is declared in the manifest rather than injected, which avoids the
`scripting` permission. `chrome.tabs.query` returns `tab.id` without the `tabs`
permission, so that is unnecessary too — a failed probe message is itself the
signal that the tab holds no video. The extension therefore ships with one
permission and one host.

## Modules

**`markdown.js`** takes a markdown string and returns HTML. It escapes input
first, then handles the subset the brief actually uses: `###` and `####`
headings, paragraphs, ordered and unordered lists, bold, inline code, links,
blockquotes, and GFM tables. It also linkifies timecodes, porting the pattern
from `src/timecodes.ts` so both surfaces agree on what a timestamp is. Timecodes
become buttons carrying `data-seconds`.

**`mock-brief.js`** exports a payload shaped exactly like the API's
`SummaryResponse`: `summary`, `video_url`, `elapsed_seconds`, `provider`,
`model`, `reasoning`, and `timings[]`. Wiring the real endpoint later replaces
one function and touches nothing else. Its brief follows the app's six-section
structure and exercises every markdown path — table, bullets, bold, blockquote,
inline code, and several timecodes.

**`content.js`** answers two messages, `probe` and `seek`, and pushes a
`video-changed` message on `yt-navigate-finish` so that SPA navigation between
videos updates the panel.

**`panel.js`** owns the state machine and rendering. It depends on `markdown.js`
and `mock-brief.js`, and talks to the page only through the two content-script
messages.

## States

The app's `idle | running | success | error`, plus one the panel needs:

- **no-video** — the active tab is not a YouTube video. Muted, centered.
- **idle** — thumbnail from `i.ytimg.com/vi/<id>/mqdefault.jpg`, title, channel,
  the current provider and model, and a `Distill` button.
- **running** — the app's loading shell: sweeping rail, provider glyph, the same
  five staged labels, live elapsed timer. Roughly seven seconds, simulated.
- **success** — a `Ready in Ns` disclosure over the timing breakdown, then
  Copy, Video, and New actions, then the numbered sections.
- **error** — the app's alert treatment, shown if a probe or seek fails.

The panel re-probes on `tabs.onActivated` and `tabs.onUpdated`.

Mock timings are scaled to the real elapsed time of the simulated run, so the
headline figure and the breakdown agree rather than contradicting each other.

## Style

Without a build step, `panel.css` carries the app's language by hand: the same
`oklch` tokens from `src/index.css`, the Helvetica Neue and SFMono stacks, a
white ground with `black/10` hairlines, black selection, monospace uppercase
micro-labels tracked at `0.12em`, `01`-style section numerals, and the
`.summary-markdown` and `.loading-shell` rules ported directly. The type scale
drops one step for a roughly 400px column, and the layout stays fluid from
320px up because the panel is user-resizable.

Settings become a disclosure behind a gear rather than a popover, which does not
fit the width: a segmented Codex and Claude toggle plus two native selects
styled as the app's inputs, persisted to `chrome.storage.local`. The model
catalog is copied from `backend/main.py`.

The cost of hand-written CSS is drift as the app evolves. Accepted for now.

## Honesty

The panel reads a real video and then shows an analysis it did not perform, so
the success header carries a `Sample data` pill. It is one element to delete
when the API is wired.

## Testing

`tsconfig.json` covers only `src`, `components`, and `lib`, and `tests/` is not
type-checked, so plain-ESM extension modules work with the existing runner.
`tests/extension-markdown.test.ts` covers the markdown subset, HTML escaping,
timecode conversion, the URL-port case ported from `tests/timecodes.test.ts`,
and tab-title cleanup. ESLint targets only `.ts` and `.tsx`, so it needs no
change.

`npm test` and `npm run lint` must stay green.

## Out of scope

Calling `/api/summarize`. Persisting briefs. Firefox or Safari. Any change to
the app, the API, or `scripts/start.sh`.
