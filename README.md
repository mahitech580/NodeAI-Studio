# NodeAI Studio

A responsive developer workspace for AI-assisted engineering questions, code generation, debugging, and SQL. Version 2.1.0 adds streamed responses, validated multi-turn chat context, response-style controls, a command palette, and safer static-host configuration.

**Stack:** Node.js 22+, Express 5, OpenAI SDK, vanilla HTML/CSS/JavaScript, Node's native test runner.

## Application features

- **Four workflows:** Chat, Code Generator, AI Debugger, and SQL Assistant each use a dedicated system prompt.
- **Streaming responses:** the browser renders server-sent events as the answer is generated; stop requests in progress or keep completed results.
- **Response styles:** Balanced, Concise, and Deep dive styles tune prompt guidance and output-token budgets.
- **Multi-turn context:** chat sends a bounded set of recent user/assistant messages; system-role messages from clients are rejected.
- **Source-file context:** attach approved text/source files up to 64 KB. The contents are inserted in your prompt; binary files are not uploaded.
- **Reusable prompts:** save up to 100 templates in browser-local storage and reload/remove them by workflow.
- **Session history:** latest 50 requests are stored on the server; search, restore, or clear them.
- **Export/copy:** copy the answer or save a Markdown report containing the prompt and response.
- **Quick actions:** searchable command palette (Ctrl/Cmd + K), generate (Ctrl/Cmd + Enter), and history search (/).
- **Responsive design:** reduced-motion support, dark/light themes, mobile workflow navigation, and visible keyboard focus.
- **Safer defaults:** server-only credentials, Helmet security headers, request and prompt limits, API throttling, validated context, atomic history writes, and consistent JSON errors.

## Run locally

Requirements: Node.js 22+ and npm.

    git clone https://github.com/mahitech580/NodeAI-Studio.git
    cd NodeAI-Studio
    npm ci
    cp .env.example .env
    npm start

Open http://localhost:3000.

Add AI_API_KEY to the server-side .env for live generation. AI_MODEL defaults to gpt-4o-mini. Keep secrets outside public/ and never commit .env.

Without AI_API_KEY, the backend stays in Demo mode. Demo text is labelled and is not a live model response.

## Configuration

| Variable | Description |
| --- | --- |
| AI_API_KEY | Optional server-side OpenAI API key. Unset means Demo mode. |
| AI_MODEL | Optional model name; defaults to gpt-4o-mini. |
| PORT | HTTP port; defaults to 3000. |
| NODE_ENV | Set production on a production host. |
| CORS_ORIGIN | Comma-separated exact allowed frontend origins for cross-origin use. |
| HISTORY_FILE | Optional path to a writable JSON history file. |

### Live Render backend and GitHub Pages

The published [NodeAI Studio frontend](https://mahitech580.github.io/NodeAI-Studio/) is configured to call the [NodeAI Render API](https://nodeai-studio-api-mahitech580.onrender.com). The API exposes:

- `GET /api/health` for liveness and whether live AI is configured.
- `GET /api/ready` for the history-storage readiness check; Render's Blueprint uses this health-check path.
- `GET /api/config` for runtime capabilities.
- `POST /api/ai` and `POST /api/ai/stream` for generation.
- `GET /api/history` and `DELETE /api/history` for the current browser session's history.

The Render service should use `NODE_ENV=production`, `TRUST_PROXY=true`, and `CORS_ORIGIN=https://mahitech580.github.io`. Trusting one proxy hop lets IP-based rate limiting see the client address forwarded by Render. A `X-Request-ID` header is attached to each request so errors can be correlated with server logs.

History is partitioned by a random browser-session UUID sent in `X-NodeAI-Session`; clearing history removes only the current browser session's entries. This is a convenience boundary, **not authentication or a secure tenant boundary**—anyone who learns another browser's session UUID could impersonate that session. Do not treat the service as a private multi-user product without authenticated users and server-validated ownership.

History remains file-backed, so Render's ephemeral filesystem may lose it on redeploy or restart. For durable sessions, use persistent storage or a database-backed history adapter.

The deployed backend currently operates in **Demo mode** until `AI_API_KEY` is set in the Render service's private Environment settings. Set `AI_MODEL` there only to a model supported by that key. Never place provider secrets in `public/config.js` or in GitHub.

## API reference

| Method | Endpoint | Description |
| --- | --- | --- |
| GET | /api/health | Service health, demo/live state, configured model name, version, and uptime. |
| GET | /api/config | Supported modes, response styles, prompt/context limits, and streaming capability. |\n| GET | /api/ready | History-storage readiness, including a 503 when the configured store is unavailable. |
| POST | /api/ai | Non-streaming generation for API clients. |
| POST | /api/ai/stream | Server-sent event stream: meta, delta, done, or error. |
| GET | /api/history | List saved entries; supports limit, mode, and q. |
| DELETE | /api/history | Clear the server's conversation history. |

AI request JSON fields: mode, tone, prompt, and context. Supported modes are chat, code, debug, and sql; response styles are balanced, concise, and deep. Context is accepted only for chat, limited to eight user/assistant messages and 16,000 combined characters. Prompts are limited to 12,000 characters. The default AI request budget is 20 requests per minute per client IP. Multiple Node instances require a shared rate-limit store.

## Quality checks

    npm run check
    npm test

GitHub Actions installs the lockfile, checks JavaScript syntax, and runs the API/streaming regression suite on pushes and pull requests to main.

## Repository layout

    NodeAI-Studio/
    ├── .github/workflows/ci.yml
    ├── public/
    │   ├── config.js
    │   ├── index.html
    │   ├── script.js
    │   └── style.css
    ├── test/server.test.js
    ├── storage/history.json
    ├── index.html
    ├── server.js
    ├── package.json
    └── package-lock.json

## License

MIT. See LICENSE.
