# Contributing to NodeAI Studio

Thanks for helping improve NodeAI Studio. Keep changes focused, explain the user impact, and avoid committing secrets or personal conversation data.

## Before you start

1. Check existing issues and open pull requests for duplicate work.
2. For larger changes, open an issue to discuss the approach first.
3. Use a feature branch instead of committing directly to the default branch when collaborating.

## Local setup

```bash
npm ci
npm run check
npm test
npm start
```

Use Node.js 22 or newer. Configure provider credentials in a local `.env` file only; never commit it.

## Change guidelines

- Keep the frontend dependency-light and accessible by keyboard.
- Preserve the no-fabricated-output behavior when no provider is connected.
- Keep browser session data in the browser; do not add shared-server prompt persistence without an explicit privacy design.
- Validate untrusted input at API boundaries and keep error responses useful without exposing secrets.
- Add or update tests for behavior changes, including failure paths.
- Update the README or docs when setup, configuration, endpoints, or user-facing behavior changes.

## Pull request checklist

- [ ] The change solves a clearly described problem.
- [ ] `npm run check` passes.
- [ ] `npm test` passes, or any known failure is explained.
- [ ] No API keys, tokens, private prompts, or personal data are included.
- [ ] UI changes work at desktop and mobile widths.
- [ ] Accessibility labels and keyboard behavior remain usable.
- [ ] Documentation reflects any changed behavior.

Use a concise commit message such as `fix: handle provider timeout` or `docs: clarify local setup`.
