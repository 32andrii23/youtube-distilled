<p align="center">
  <img src=".github/banner.png" alt="YouTube Distilled — paste a video, extract its transcript, and keep the highest-value moments" width="100%" />
</p>

<p align="center">
  <strong>Turn a YouTube URL into a useful brief—with source-backed timecodes you can watch on demand.</strong>
</p>

<p align="center">
  <img alt="React 19" src="https://img.shields.io/badge/React_19-000000?style=flat-square&logo=react&logoColor=white" />
  <img alt="shadcn/ui" src="https://img.shields.io/badge/shadcn%2Fui-000000?style=flat-square&logo=shadcnui&logoColor=white" />
  <img alt="FastAPI" src="https://img.shields.io/badge/FastAPI-000000?style=flat-square&logo=fastapi&logoColor=white" />
  <img alt="MIT License" src="https://img.shields.io/badge/license-MIT-000000?style=flat-square" />
</p>

YouTube Distilled is a minimal, local-first web app for extracting the signal from long videos. It gathers the video title, creator, description, duration, chapters, and available captions, then asks your authenticated Codex CLI or Claude Code installation to produce a concise, structured analysis.

## Highlights

- **A watch-or-skip verdict up front** — every brief opens with a 0-100 relevance score, colour-coded to watch, skim, or skip, and one line saying what earned it. Scored against a viewer profile in the prompt, so it answers "is this worth *my* time" rather than "is this a good video".
- **Dense, predictable briefs** — summary, key takeaways, concepts, practical uses, critical view, and final compression.
- **A watch guide of ten minutes or less** — only the most valuable source-backed moments, with clickable timecodes and the total watch time up front. Ten minutes is a ceiling: a video whose value fits in two gets two.
- **Play the guide, not the video** — one button in the extension plays the picked periods back to back, jumping from the end of each to the start of the next, so a forty-minute video is watched in the four minutes that earned it.
- **Floating YouTube player** — opens at the selected moment, snaps to any corner, and toggles fullscreen.
- **Codex or Claude** — choose the provider, model, and reasoning level from the settings menu.
- **Visible performance** — see the total run time and expand a per-step timing breakdown.
- **Local app state** — the UI and API run on your machine, and analysis sessions are not persisted.

## Quick start

### Requirements

- macOS
- Node.js 22.13 or newer
- Python 3
- An authenticated [Codex CLI](https://github.com/openai/codex) or [Claude Code](https://docs.anthropic.com/en/docs/claude-code/overview) installation

### Install and run

```sh
git clone https://github.com/32andrii23/youtube-distilled.git
cd youtube-distilled
./scripts/start.sh
```

The startup script prepares missing JavaScript and Python dependencies, starts the API at `127.0.0.1:4322`, starts the app at `localhost:4321`, and opens it in your browser. Press `Ctrl+C` to stop both services.

To create a global Zsh command, add this to `~/.zshrc` and replace the path with your clone location:

```zsh
youtube-distilled() {
  cd /path/to/youtube-distilled && ./scripts/start.sh
}
```

Reload your shell, then launch the app from anywhere:

```sh
source ~/.zshrc
youtube-distilled
```

## How it works

1. The Python service validates and normalizes the YouTube URL.
2. It fetches public metadata and selects the best available caption track, preferring creator-provided English captions.
3. The transcript is timestamped and combined with the video context and analysis prompt.
4. The selected local CLI performs the analysis and may use its web tools for supporting context.
5. The React interface renders the Markdown brief and turns supported timecodes into player controls.

If YouTube does not expose captions, the app says so and works from the remaining metadata and web context. It never invents timestamps by design, but—as with any AI-generated analysis—you should verify important claims against the source.

### Several videos at once

Each run is its own CLI process, so ten can work in parallel: open a tab per
video in the web app, or hit Distill on several YouTube tabs and let the side
panel follow whichever one you are looking at. Past the tenth, a request is
refused rather than queued, so nothing sits in a silent wait. Set
`YOUTUBE_DISTILLED_MAX_RUNS` before starting the app to move the ceiling.

The leftmost header button opens another tab on the empty state, and each tab
renames itself after the video it is distilling — YouTube's own title, so the tab
strip stays readable with several runs going.

## Output

Every brief follows the same useful structure:

1. Video summary
2. Key takeaways
3. “I only have 10 minutes” watch guide
4. Important concepts and terms
5. Hidden value
6. Practical use
7. Critical view
8. Final compression
9. Diagrams — the shape of what the video says, not a picture of its running
   order: the structure holding up an argument, the loop inside a mechanism, the
   options on the axes a review actually judges them on. The analysis picks the
   form from what the video is, out of nine mermaid types, and draws nothing when
   nothing has a shape worth drawing. Timecodes ride along on the nodes that have
   one, where they become seek controls.

A brief is headed by the video's own title and channel. Mermaid a model got
slightly wrong is repaired before it is drawn rather than shown as a failure, and
mermaid that would have parsed cleanly while drawing the wrong picture — a state
name quietly cut in half, an axis title with its spaces stripped — is corrected
first.

## Chrome extension

The same brief, in a side panel next to the video. Load `extension/` unpacked at
`chrome://extensions` — there is no build step — then open a YouTube video and
click the toolbar icon.

It talks to the same local API, so start the app first; when the service is not
running the panel says so and offers the command to copy. Timecodes drive the
tab's own player rather than opening a second one, so playback stays native, and
**Play moments** runs the whole watch guide through that player without you
touching the scrubber.

See [`extension/README.md`](extension/README.md) for details.

## Stack

| Layer | Technology |
|---|---|
| Interface | React, TypeScript, Vite, Tailwind CSS, shadcn/ui |
| Extension | Chrome MV3 side panel, plain ES modules, no build step |
| API | Python, FastAPI, Uvicorn |
| Video context | YouTube watch metadata and `youtube-transcript-api` |
| Analysis | Codex CLI or Claude Code |

## Privacy and limitations

- The server binds to `127.0.0.1`; it is not exposed to your network by default.
- The app does not store summaries or AI sessions.
- Requests still reach YouTube and the provider services used by your chosen CLI.
- Caption availability and quality depend on the source video and YouTube access.
- Available models depend on your installed CLI version and account access.

## Development

```sh
npm test
npm run lint
```

The test command builds the frontend, runs the TypeScript tests, and runs the Python unit tests.

## License

Released under the [MIT License](LICENSE).
