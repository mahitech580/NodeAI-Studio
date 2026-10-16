# NodeAI Studio — Troubleshooting

## The app says “Connect AI” or generation returns HTTP 503

No provider is available for the request. Connect a browser provider from **Connect AI**, or configure `AI_PROVIDER` and `AI_API_KEY` in the server environment. This is an intentional setup error; the app does not substitute a fabricated answer.

## Provider connection test fails

- Confirm that the selected provider matches the key.
- Check that the key is active and has permission/billing enabled.
- Check that the model ID is available to your account.
- Try **Load models** if the provider supports model discovery.
- Never include the key in a bug report or terminal screenshot.

## The page opens, but the API appears offline

1. Check the deployment's health endpoint: `/api/health`.
2. Wait for a sleeping free host to start, then reload.
3. Check the host logs for startup or environment-variable errors.
4. Verify the frontend origin is included in the API's exact `CORS_ORIGIN` allowlist when the frontend and API use different origins.
5. Inspect the browser Network panel and note the request ID if present.

CORS is not authentication. Do not treat a public API as a private user workspace.

## A response stops or streaming fails

- Check your connection and provider status.
- Retry with a shorter prompt and less attached source context.
- Confirm that your provider/model supports the request.
- The Stop button intentionally cancels the active request.
- A server restart or provider-side rate limit can interrupt a response.

## Session history or saved prompts are missing

They are local to the browser profile and origin. Check whether you changed browser, profile, device, or site origin. If you previously exported a JSON archive, use the matching import control. Importing merges valid entries and skips duplicates; it does not recover data that was never backed up.

## Import/export errors

- Use a JSON archive exported by NodeAI Studio.
- Keep the archive under the documented 2 MB file limit.
- Avoid editing IDs, mode names, or required fields manually.
- Check browser storage capacity if an import cannot be saved.

## Run the checks

```bash
npm ci
npm run check
npm test
```

When reporting a reproducible issue, include the command output and Node.js version, but redact tokens, API keys, private prompts, and personal data.
