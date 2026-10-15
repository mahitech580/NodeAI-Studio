# NodeAI Studio

A responsive developer workspace for AI-assisted engineering questions, code generation, debugging, and SQL. Version 2.4.0 adds secure Markdown rendering for live answers, copyable syntax-highlighted code blocks, raw/rendered output switching, response regeneration, provider-backed model discovery, and tested browser-supplied credentials. When no provider is connected, generation returns an explicit setup error instead of fabricated sample output.

**Stack:** Node.js 22+, Express 5, OpenAI-compatible SDK clients, vanilla HTML/CSS/JavaScript, Node's native test runner.

## Application features

- **Four workflows:** Chat, Code Generator, AI Debugger, and SQL Assistant each use a dedicated system prompt and real provider-backed completion.
- **Independent workflow frontends:** each section has its own header, accent theme, starter prompts, empty state, and structured controls. Code captures language/framework/deliverable/test preference; Debug captures runtime, issue category, expected and observed behavior; SQL captures dialect, schema, and query priority.
- **Live streaming:** the browser receives provider-generated token deltas over server-sent events; the stop button cancels in-flight requests. The server does not stream canned fallback text.
- **Response styles:** Balanced, Concise, and Deep dive styles tune prompt guidance and output-token budgets.
- **Multi-turn context:** chat sends a bounded set of recent user/assistant messages; system-role messages from clients are rejected.
- **Source-file context:** attach approved text/source files up to 64 KB. The contents are inserted in your prompt; binary files are not uploaded.
- **Reusable prompts:** save up to 100 templates in browser-local storage and reload/remove them by workflow.
- **Session history:** the latest 50 sessions are stored in this browser only; search, restore, or clear them. The shared backend does not persist prompts or responses.
- **Rich output:** render headings, lists, quotations, tables, safe links, and inline formatting; switch between rendered output and raw Markdown; copy individual code blocks; and use lightweight syntax highlighting without extra runtime dependencies.
- **Iteration:** regenerate a response for the active prompt, restore a session with formatted output, copy answers, or save a Markdown report containing the prompt and response.
- **Quick actions:** searchable command palette (Ctrl/Cmd + K), generate (Ctrl/Cmd + Enter), and history search (/).
- **Responsive design:** reduced-motion support, dark/light themes, mobile workflow navigation, and visible keyboard focus.
- **Provider connections:** connect OpenAI, Google Gemini, Groq, or OpenRouter through OpenAI-compatible endpoints; test a real completion before using a model. Fetch model IDs available to your key and choose one from suggestions, or enter a supported model ID manually.
- **BYOK credentials:** a key can stay in page memory or, by explicit opt-in, `sessionStorage` until the tab closes. The browser sends it to the NodeAI API over HTTPS in a request header; the backend proxies it and does not persist it in app storage or return it. Only use keys you control and review provider billing/usage.
- **No fabricated success:** if neither a server provider nor a browser key is configured, generation returns HTTP 503 with a clear connect-provider message.
- **Safer defaults:** server-side environment credentials, Helmet security headers, request and prompt limits, API throttling, validated context, browser-local history, and consistent JSON errors.

## Run locally

Requirements: Node.js 22+ and npm.

    git clone https://github.com/mahitech580/NodeAI-Studio.git
    cd NodeAI-Studio
    npm ci
    cp .env.example .env
    npm start

Open http://localhost:3000.

Add `AI_API_KEY` to the server-side `.env` for live generation. Set `AI_PROVIDER` to `openai`, `gemini`, `groq`, or `openrouter`; `AI_MODEL` defaults to the provider's documented default in `server.js`. Keep secrets outside `public/` and never commit `.env`. Alternatively, use **Connect AI** in the app to test a provider key for requests from that tab.

Without a server `AI_API_KEY` or a key supplied by the browser, live generation is unavailable and returns a setup error. No prewritten sample answer is presented as model output.

## Configuration

| Variable | Description |
| --- | --- |
| AI_API_KEY | Optional server-side API key for the selected provider. If absent, connect a browser key in the UI. |
| AI_PROVIDER | `openai` (default), `gemini`, `groq`, or `openrouter`. | 
| AI_MODEL | Optional model name; defaults depend on `AI_PROVIDER`. |
| PORT | HTTP port; defaults to 3000. |
| NODE_ENV | Set production on a production host. |
| CORS_ORIGIN | Comma-separated exact allowed frontend origins for cross-origin use. |

### Live Render backend and GitHub Pages

The published [NodeAI Studio frontend](https://mahitech580.github.io/NodeAI-Studio/) calls the [NodeAI Render API](https://nodeai-studio-api-mahitech580.onrender.com). The API exposes health, readiness, capabilities, provider-connection testing, model discovery, and live generation endpoints. The API's `CORS_ORIGIN` must include the exact GitHub Pages origin (and any other browser origin that should be permitted); the public frontend configuration contains no secret. The `X-Request-ID` header makes requests easier to correlate with server logs.

Conversation history is stored in browser local storage and is never written to the shared server. It can be viewed by someone with access to that browser profile, and clearing browser storage removes it. In live mode, the prompt is still sent to this server and the configured AI provider to generate a response. The API has no account login, so CORS is not authentication and the service should not be treated as a private multi-user API. Render's ephemeral filesystem is no longer used for conversation storage.

The Render service can use a key stored in its private Environment settings (`AI_PROVIDER`, `AI_API_KEY`, and optionally `AI_MODEL`). For a browser BYOK connection, the key is sent over HTTPS to the Render API in request headers only for the connection test and generation requests. It is not written to `localStorage`, the GitHub repository, app history, or server response bodies; by default it stays in the page's memory. The optional remember checkbox stores it in `sessionStorage` until the tab closes. Never use a shared/public browser for a sensitive API key. Provider requests can incur usage charges.

## API reference

| Method | Endpoint | Description |
| --- | --- | --- |
| GET | /api/health | Service health, demo/live state, configured model name, version, and uptime. |
| GET | /api/config | Supported modes, response styles, prompt/context limits, and streaming capability. | 
| GET | /api/ready | Service readiness; does not depend on server-side history storage. |
| POST | /api/providers/test | Sends a small provider request to verify the connection. | 
| POST | /api/providers/models | Lists model IDs visible to the selected provider key; returns IDs only. | 
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
    │   ├── markdown.js
    │   ├── script.js
    │   └── style.css
    ├── test/server.test.js
    ├── index.html
    ├── server.js
    ├── package.json
    └── package-lock.json

## License

MIT. See LICENSE.
