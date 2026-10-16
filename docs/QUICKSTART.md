# NodeAI Studio — Quick Start

This guide takes you from a clean clone to a verified first response.

## 1. Requirements

- Node.js 22 or newer
- npm (included with Node.js)
- An API key from a supported provider, or access to a deployment whose server has a provider configured

## 2. Install and run

```bash
git clone https://github.com/mahitech580/NodeAI-Studio.git
cd NodeAI-Studio
npm ci
npm run check
npm test
npm start
```

Open [http://localhost:3000](http://localhost:3000). Keep the terminal open while using the app.

## 3. Connect a model

1. Select **Connect AI** in the top bar or the first-run setup card.
2. Choose OpenAI, Google Gemini, Groq, or OpenRouter.
3. Enter a key you control and select **Test connection**.
4. Optionally load available model IDs, choose a model, then save the connection.
5. Start with a short prompt in AI Chat, Code Generator, AI Debugger, or SQL Assistant.

The browser key is held in page memory by default. The optional remember setting uses session storage until the tab closes. Do not enter a key on a shared computer. Provider requests may incur charges.

## 4. Server-side configuration

Copy `.env.example` to `.env` and set values for your chosen provider:

```dotenv
AI_PROVIDER=openai
AI_API_KEY=replace-with-your-own-key
# AI_MODEL=gpt-4o-mini
PORT=3000
```

Use the provider/model combination supported by your account. Never commit `.env`, put secrets under `public/`, or paste secrets into issue reports. Restart the server after changing environment variables.

## 5. Keyboard shortcuts

| Shortcut | Action |
| --- | --- |
| Ctrl/Cmd + K | Open command palette |
| Ctrl/Cmd + Enter | Generate a response |
| Ctrl/Cmd + B | Collapse or expand desktop navigation |
| / | Focus session search when not typing in a form field |

## 6. Browser data and backups

Sessions and saved prompts live in the current browser profile, not in a shared account. Use the sidebar export/import controls to make JSON backups. Treat backups as sensitive because they can contain prompts and full responses. Clearing browser storage or changing profiles can make local history unavailable.

## 7. Before opening a bug report

Run `npm run check` and `npm test`. Include the workflow, provider (never the API key), browser/Node version, expected result, actual result, and any request ID shown by the app. Remove private code and personal data from screenshots and logs.
