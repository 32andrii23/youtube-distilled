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

## Status

This is a frontend shell. **The brief is sample data** and is not an analysis of
whatever video you have open — the panel labels it `Sample data` for that reason.
It exists so the interface could be built and reviewed before the local API was
wired in.

Two behaviours are already real:

- **Video detection.** The title, channel, and length come from the page.
- **Timecode seeking.** Clicking a timecode moves the tab's own player, so
  playback stays native rather than opening a second video.

## Files

| File | Role |
| --- | --- |
| `manifest.json` | MV3 manifest. One permission, one host. |
| `background.js` | Opens the side panel when the toolbar icon is clicked. |
| `content.js` | Reports the open video and seeks playback. |
| `panel.html` | Panel markup, one section per state. |
| `panel.css` | The app's design tokens at panel scale. |
| `panel.js` | State machine and rendering. |
| `markdown.js` | Markdown subset to HTML, plus timecode linkifying. |
| `mock-brief.js` | The sample payload. |
| `format.js` | Duration and title formatting. |

`markdown.js`, `format.js`, and `mock-brief.js` are pure and covered by
`tests/extension-markdown.test.ts` in the repository root. Run them with
`npm test`.

## Wiring the API

`mock-brief.js` exports a payload shaped exactly like `SummaryResponse` in
`backend/main.py`, so replacing `createMockBrief` with a request to
`/api/summarize` is the whole change. Add `http://127.0.0.1:4322/*` to
`host_permissions` first — an extension page may fetch any host it has
permission for, so the API needs no CORS change of its own.
