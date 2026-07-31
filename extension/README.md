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

These behaviours remain native to the browser tab:

- **Video detection.** The title, channel, and length come from the page.
- **Timecode seeking.** Clicking a timecode moves the tab's own player, so
  playback stays native rather than opening a second video.

## Files

| File | Role |
| --- | --- |
| `manifest.json` | MV3 manifest, including local API host permissions. |
| `background.js` | Opens the side panel when the toolbar icon is clicked. |
| `content.js` | Reports the open video and seeks playback. |
| `panel.html` | Panel markup, one section per state. |
| `panel.css` | The app's design tokens at panel scale. |
| `panel.js` | State machine and rendering. |
| `provider-catalog.js` | Fallback catalog and settings normalization. |
| `markdown.js` | Markdown subset to HTML, plus timecode linkifying. |
| `format.js` | Duration and title formatting. |

`markdown.js`, `format.js`, and `provider-catalog.js` are pure and covered by
`tests/extension-markdown.test.ts` in the repository root. Run them with
`npm test`.

The extension declares `http://127.0.0.1:4322/*` and `http://localhost:4322/*`
in `host_permissions`. Its extension-page requests therefore do not require a
new backend CORS origin.
