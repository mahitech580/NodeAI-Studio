# API examples

The examples below use the local server at `http://localhost:3000`. For a deployed service, replace the base URL with the deployment origin. Never place a real provider key in source control or screenshots.

## Check service health

```bash
curl -sS http://localhost:3000/api/health
```

## Read capabilities

```bash
curl -sS http://localhost:3000/api/config
```

## Test a browser-supplied provider key

Use a key you own. This request sends the credential in a header rather than the JSON body:

```bash
curl -sS -X POST http://localhost:3000/api/providers/test \
  -H 'Content-Type: application/json' \
  -H 'X-Provider: openai' \
  -H 'X-Provider-API-Key: YOUR_KEY_HERE' \
  -d '{"model":"gpt-4o-mini"}'
```

Header names and required fields should be checked against the current provider route implementation before using this example in an integration. Avoid shell history on shared machines when handling secrets.

## Generate a response

```bash
curl -sS -X POST http://localhost:3000/api/ai \
  -H 'Content-Type: application/json' \
  -d '{"mode":"chat","tone":"balanced","prompt":"Explain a REST API in simple terms."}'
```

This server-side request requires a provider configured on the server. Without one, a setup error is expected; the application does not fabricate model output.

## Streaming

The browser uses `POST /api/ai/stream` and consumes server-sent event messages. For reliable integration, inspect the event types in `server.js` and handle metadata, incremental deltas, completion, errors, and cancellation explicitly.

## Common endpoints

| Method | Endpoint | Purpose |
| --- | --- | --- |
| GET | `/api/health` | Health and runtime information |
| GET | `/api/config` | Client capabilities and limits |
| GET | `/api/ready` | Readiness check |
| POST | `/api/providers/test` | Test a provider connection |
| POST | `/api/providers/models` | Discover available model IDs |
| POST | `/api/ai` | Non-streaming generation |
| POST | `/api/ai/stream` | Streaming generation |

For configuration, privacy details, and local setup, see [Quick start](QUICKSTART.md) and [Troubleshooting](TROUBLESHOOTING.md).
