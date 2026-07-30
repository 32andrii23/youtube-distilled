<p align="center">
  <img src="docs/assets/logo.png" alt="YouTube Distilled logo" width="128" />
</p>

<h1 align="center">YouTube Distilled</h1>

A local React + shadcn interface with a Python API that turns a YouTube video into a structured brief using your choice of Codex CLI or Claude CLI.

## What it does

- Extracts available YouTube metadata, chapters, and captions.
- Produces a dense summary, takeaways, concepts, practical uses, and a critical view.
- Turns verified timecodes into links for a draggable, expandable floating player.
- Runs locally and does not persist AI sessions.

## Requirements

- macOS
- Node.js 22.13 or newer
- Python 3
- [Codex CLI](https://github.com/openai/codex) or [Claude Code](https://docs.anthropic.com/en/docs/claude-code/overview), already authenticated

## Install

```sh
npm install
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
```

## Run

```sh
youtube-distilled
```

The command starts the Python API at `127.0.0.1:4322`, starts the web app at `localhost:4321`, and opens it in your browser. Press `Ctrl+C` in the terminal to stop both services.

Settings in the top-right let you choose the local provider, model, and reasoning level. The Python service extracts YouTube metadata, chapters, and creator or auto-generated captions before asking the selected model to analyze them; live web tools provide supporting context. AI sessions are not persisted. Verified timestamps in the result are clickable and open the video at that moment in a floating, expandable player.

## Development

```sh
npm test
npm run lint
```

## License

[MIT](LICENSE)
