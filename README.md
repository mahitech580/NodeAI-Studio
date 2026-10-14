# NodeAI Studio

A responsive developer workspace for AI-assisted engineering questions, code generation, debugging, and SQL. Version 2.2.0 adds themed workspaces with structured settings for chat, code generation, debugging, and SQL, plus streamed responses, browser-local sessions, and resilient request states.

**Stack:** Node.js 22+, Express 5, OpenAI SDK, vanilla HTML/CSS/JavaScript, Node's native test runner.

## Application features

- **Four workflows:** Chat, Code Generator, AI Debugger, and SQL Assistant each use a dedicated system prompt.
- **Independent workflow frontends:** each section has its own header, accent theme, starter prompts, empty state, and structured controls. Code captures language/framework/deliverable/test preference; Debug captures runtime, issue category, expected and observed behavior; SQL captures dialect, schema, and query priority.
- **Streaming responses:** the browser renders server-sent events as the answer is generated; stop requests in progress or keep completed results.
- **Response styles:** Balanced, Concise, and Deep dive styles tune prompt guidance and output-token budgets.
- **Multi-turn context:** chat sends a bounded set of recent user/assistant messages; system-role messages from clients are rejected.
- **Source-file context:** attach approved text/source files up to 64 KB. The contents are inserted in your prompt; binary files are not uploaded.
- **Reusable prompts:** save up to 100 templates in browser-local storage and reload/remove them by workflow.
- **Session history:** the latest 50 sessions are stored in this browser only; search, restore, or clear them. The shared backend does not persist prompts or responses.
- **Export/copy:** copy the answer or save a Markdown report containing the prompt and response.
- **Quick actions:** searchable command palette (Ctrl/Cmd + K), generate (Ctrl/Cmd + Enter), and history search (/).
- **Responsive design:** reduced-motion support, dark/light themes, mobile workflow navigation, and visible keyboard focus.
- **Safer defaults:** server-only credentials, Helmet security headers, request and prompt limits, API throttling, validated context, browser-local history, and consistent JSON errors.

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

### Live Render backend and GitHub Pages

The published [NodeAI Studio frontend](https://mahitech580.github.io/NodeAI-Studio/) calls the [NodeAI Render API](https://nodeai-studio-api-mahitech580.onrender.com). The API exposes health, readiness, capabilities, and generation endpoints. The API's `CORS_ORIGIN` must include the exact GitHub Pages origin (and any other browser origin that should be permitted); the public frontend configuration contains no secret. The `X-Request-ID` header makes requests easier to correlate with server logs.

Conversation history is stored in browser local storage and is never written to the shared server. It can be viewed by someone with access to that browser profile, and clearing browser storage removes it. In live mode, the prompt is still sent to this server and the configured AI provider to generate a response. The API has no account login, so CORS is not authentication and the service should not be treated as a private multi-user API. Render's ephemeral filesystem is no longer used for conversation storage.

The deployed backend currently operates in **Demo mode** until `AI_API_KEY` is set in the Render service's private Environment settings. Set `AI_MODEL` there only to a model supported by that key. Never place provider secrets in `public/config.js` or in GitHub.

## API reference

| Method | Endpoint | Description |
| --- | --- | --- |
| GET | /api/health | Service health, demo/live state, configured model name, version, and uptime. |
| GET | /api/config | Supported modes, response styles, prompt/context limits, and streaming capability. |\n| GET | /api/ready | Service readiness; does not depend on server-side history storage. |
| POST | /api/ai | Non-streaming generation for API clients. |
| POST | /api/ai/stream | Server-sent event stream: meta, delta, done, or error. |
| GET | /api/history | Compatibility endpoint returning an empty list; sessions stay in the browser. |
| DELETE | /api/history | Compatibility endpoint; the server stores no conversation history. |

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
    ├── index.html
    ├── server.js
    ├── package.json
    └── package-lock.json

## License

MIT. See LICENSE.
