# Security Policy

## Supported version

Security fixes should target the current default branch. Reporters should include the affected version or commit where possible.

## Reporting a vulnerability

Please do not publish exploitable details in a public issue. Use GitHub's private vulnerability reporting feature for this repository if it is enabled. If private reporting is unavailable, contact the repository maintainer privately through a verified contact method listed on the maintainer's GitHub profile.

Include:
- A concise impact description
- Reproduction steps or a minimal proof of concept
- Affected routes, configuration, or versions
- Any practical mitigation

Do not include real API keys, access tokens, personal information, or private user prompts in reports.

## Security expectations

- Keep provider keys in server environment settings or in the browser's in-memory connection flow; never commit secrets.
- Treat browser backups as sensitive because they may contain prompts and generated answers.
- CORS is not authentication. Do not assume a public API is private because it restricts browser origins.
- Validate inputs, limit request sizes, and avoid returning provider credentials in responses or logs.
