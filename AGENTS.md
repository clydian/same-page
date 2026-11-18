## Agent skills

### Project skills

Before using a skill in `.agents/skills`, read `docs/agents/project-skills.md`
for SamePage's scope, safety, and verification constraints. These vendored
methods do not override project instructions or the user's authorization.

### Development stage

This product is in active use. Preserve existing user data and deployed-client
compatibility when changing schemas, APIs, or local storage. Plan safe migrations
and rollout transitions alongside changes to callers, tests, and documentation.

### Issue tracker

Issues and specs are tracked in GitHub Issues. See `docs/agents/issue-tracker.md`.

### Product messages

Put product messages in `src/i18n/messages/<locale>/<feature>.json`. Add the
source message in `zh-Hans` and use its stable key and parameters in code.
Add the same key to all supported locales and run `npm run i18n:check`.
Use the established domain glossary in `CONTEXT.md` when translating.

### Triage labels

Use the five default mattpocock/skills triage labels. See `docs/agents/triage-labels.md`.

### Domain docs

This repository uses a single-context domain documentation layout. See `docs/agents/domain.md`.
