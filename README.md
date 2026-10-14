# NodeAI Studio

A full-stack AI workspace for day-to-day software development. Use one responsive interface for engineering Q&A, code generation, debugging, and SQL assistance.

**Stack:** Node.js 22+, Express 5, vanilla HTML/CSS/JavaScript, OpenAI SDK, and Node's built-in test runner.

## What it does

- **Four focused workflows:** chat, code, debug, and SQL each use a tailored system prompt.
- **Live AI or clearly labelled demo mode:** live responses use your configured OpenAI API key; without a key, the server returns deterministic examples and does not pretend a model ran.
- **Responsive workspace:** dark/light themes, animated ambient details, mobile workflow navigation, keyboard shortcuts, prompt starters, character count, and accessible focus states.
- **History:** the latest 50 prompts and responses are stored on the server; search and restore sessions, filter results, or clear history.
- **Copy and export:** copy an answer or download a Markdown file containing the prompt and response.
- **Safer defaults:** request size and prompt length limits, per-IP AI request throttling, server-only credentials, security headers, bounded history, atomic file writes, and consistent JSON errors.
- **Regression checks:** API tests cover health/config responses, validation, demo generation, saved history, search, deletion, and unknown routes.

## Run locally

Requirements: Node.js 22 or newer and npm.

Clone the repository, install locked dependencies, copy .env.example to .env, and start the service:

    git clone https://github.com/mahitech580/NodeAI-Studio.git
    cd NodeAI-Studio
    npm ci
    cp .env.example .env
    npm start

Open http://localhost:3000.

For live model responses, set AI_API_KEY in your local .env. You may optionally change AI_MODEL; the default is gpt-4o-mini. Never put a key in public/ or commit .env.

Without AI_API_KEY, the app starts in **Demo mode**. The interface and API can be exercised, but the examples are not AI-generated answers.

## Environment variables

| Variable | Required | Description |
| --- | --- | --- |
| AI_API_KEY | No | OpenAI API key used only by the server. Unset means demo mode. |
| AI_MODEL | No | Model name; defaults to gpt-4o-mini. |
| PORT | No | HTTP port; defaults to 3000. |
| HISTORY_FILE | No | Optional path for the JSON conversation store. |
| CORS_ORIGIN | No | Comma-separated allowlist for cross-origin frontends. Same-origin use needs no CORS setting. |

## API

All successful responses are JSON and include success: true.

| Method | Route | Purpose |
| --- | --- | --- |
| GET | /api/health | Server health, demo/live mode, configured model name, uptime, and version. |
| GET | /api/config | Public mode list, prompt character limit, and history limit. |
| POST | /api/ai | Generate a response. JSON body: {"mode":"chat","prompt":"..."}. Modes: chat, code, debug, sql. |
| GET | /api/history | List saved sessions. Supports limit, q, and mode query parameters. |
| DELETE | /api/history | Clear stored conversation history. |

The AI endpoint accepts prompts up to 12,000 characters and is rate-limited to 20 requests per minute per client IP by default. These limits are intentionally conservative for a personal demo; use a shared store and a production-grade rate limiter if running multiple server instances.

## Quality checks

    npm run check
    npm test

GitHub Actions runs installation, syntax checks, and the API regression suite on pushes and pull requests to main.

## Deployment notes

Deploy the Node.js application as a Node service (for example, on a platform that supports persistent environment variables and a writable filesystem). Configure AI_API_KEY in the host's secret/environment settings. If the frontend and API live on different origins, set CORS_ORIGIN to the exact frontend origin.

GitHub Pages can host static HTML/CSS/JavaScript only; it cannot run this Express API. If you publish the public/ directory on Pages, the UI can load but generation, health, and history calls need a separately deployed API and a frontend API-base configuration before they will work end-to-end.

Conversation history is file-backed for this compact project. Ephemeral hosting filesystems may reset during restarts; use a persistent disk or database if history must survive redeployments. This demo has no user accounts, so do not deploy it as a shared, multi-user private workspace without adding authentication and user-scoped storage.

## Project structure

    NodeAI-Studio/
    ├── .github/workflows/ci.yml
    ├── public/
    │   ├── index.html
    │   ├── script.js
    │   └── style.css
    ├── storage/history.json
    ├── test/server.test.js
    ├── .env.example
    ├── package.json
    ├── package-lock.json
    └── server.js

## License

MIT. See LICENSE if a license file is added to the repository.
