# YouTube Distilled — Chrome extension

A side panel that distills the video in the current tab. There is no build step:
the folder loads as-is.

## Install

1. Open `chrome://extensions`.
2. Turn on **Developer mode**.
3. Choose **Load unpacked** and select this `extension` folder.
4. Open a YouTube video and click the toolbar icon. The panel opens beside it.

After changing any file, press reload on the extension card. Reopen the panel to
pick up panel changes.

## How it works

The panel uses the local FastAPI service at `http://127.0.0.1:4322`. When it
opens, it loads the available providers, models, and reasoning levels from
`/api/health`. Distill sends the detected YouTube video URL and selected settings
to `/api/summarize`, then renders the returned brief and timing breakdown.

The local service must be running before you use the extension:

```sh
youtube-distilled
```

If that shell function is not set up, run `./scripts/start.sh` from the project
clone instead. The panel shows this command and a Retry action whenever the
service cannot be reached.

One panel serves the whole window, but it keeps a run per video: start one, move
to another YouTube tab, and Distill there too. The panel always shows the run
belonging to the tab you are on, counts the ones still working elsewhere, and
**New** retires only the run in front of you. The service caps the CLIs it will
run at once and refuses beyond that rather than queueing, so a panel that says
several are already distilling is quoting a real limit.

**Diagrams.** The brief's ```mermaid blocks are drawn in the panel, the same way
the web app draws them: the same greyscale palette, redrawn when you change
theme, and any label carrying a timecode seeks the video when clicked. A diagram
is drawn at its own size and its box scrolls sideways, because fitting one into a
400px column shrinks its labels past reading. Before it is drawn, the source goes
through `mermaid-repair.js`, which offers the panel several versions of it —
normalised, exactly as written, and repaired — and the first one mermaid accepts
is the one you see. A diagram no version can draw keeps its source on screen
under a one-line note.

Mermaid is loaded from `vendor/mermaid.min.js`, its own prebuilt bundle, since
MV3 forbids pulling a script off a CDN and this folder has no build step. It
loads only once a brief actually contains a diagram. Refresh it after bumping
mermaid in `package.json`:

```sh
./scripts/vendor-mermaid.sh
```

These behaviours remain native to the browser tab:

- **Video detection.** The title, channel, and length come from the page.
- **Timecode seeking.** Clicking a timecode moves the tab's own player, so
  playback stays native rather than opening a second video.
- **Progress-bar moments.** After a brief finishes, its “I Only Have 10 Minutes”
  watch guide appears just above YouTube's seek bar: a black upright at each
  boundary, joined by a rule across the top, or a single upright for a moment
  with no end. Nothing is drawn on the red bar itself, so the player's own
  chrome stays readable and seeking keeps its full precision. Hover or focus a
  marker to see why the moment matters; click it, or press Enter or Space, to
  seek and play. The markers fade in and out with the player's controls, so they
  are only on screen while the seek bar is. Markers return if YouTube rebuilds
  the player or if you navigate back to a video summarized in the same tab.
  **New** clears the current brief's markers.
- **Play moments.** The button above that line plays the whole watch guide back
  to back: it seeks to the first period, and when that period ends it jumps
  straight to the next, all the way through, then pauses. A forty-minute video
  becomes the four minutes of it the model picked, and the line under the button
  says how long that is before you commit to it. The period playing is drawn in
  red on the seek bar, so the tour is legible in fullscreen with the panel out of
  sight, and the panel names the period and counts the way through.

  Scrubbing during a tour never fights it: land inside a later period and the
  tour carries on from there, land in a stretch the model skipped and it pulls
  you forward to the next period, drag backwards and it rejoins the earlier one.
  Pausing pauses the tour with it. The tour lasts as long as the panel that
  started it — closing the panel returns the tab to ordinary playback, the same
  bargain grayscale focus makes, since a panel that is gone cannot offer a way to
  stop what it started.

## Files

| File | Role |
| --- | --- |
| `manifest.json` | MV3 manifest, including local API host permissions. |
| `background.js` | Opens the side panel when the toolbar icon is clicked. |
| `content.js` | Reports the open video, seeks playback, owns progress-bar markers, and drives the tour. |
| `panel.html` | Panel markup, one section per state. |
| `panel.css` | The app's design tokens at panel scale. |
| `panel.js` | State machine and rendering. |
| `provider-catalog.js` | Fallback catalog and settings normalization. |
| `markdown.js` | Markdown subset to HTML, plus timecode linkifying. |
| `diagrams.js` | Draws the brief's mermaid blocks and wires their timecodes. |
| `mermaid-repair.js` | Rewrites the mermaid a model got wrong. Shared with the web app. |
| `vendor/mermaid.min.js` | Mermaid's own bundle, vendored. Refresh with `scripts/vendor-mermaid.sh`. |
| `moments.js` | Pure watch-guide moment extraction and label cleanup. |
| `tour.js` | Pure planning and stepping for playing the moments back to back. |
| `format.js` | Duration and title formatting. |

`markdown.js`, `moments.js`, `tour.js`, `format.js`, and `provider-catalog.js`
are pure and covered by the extension tests in the repository root. Run them
with `npm test`. `tests/diagrams.test.ts` holds the panel's diagram theme and config tables
against the web app's so the two surfaces cannot drift, and holds both against
the diagram types `backend/prompt.py` offers, so a type the analysis can ask for
cannot arrive unsized. `mermaid-repair.js` needs no such test: the web app
imports that very file through vite, so there is only one copy of the rules, and
`tests/mermaid-repair.test.ts` and `tests/mermaid-normalize.test.ts` cover both
surfaces at once.

The extension declares `http://127.0.0.1:4322/*` and `http://localhost:4322/*`
in `host_permissions`. Its extension-page requests therefore do not require a
new backend CORS origin.
