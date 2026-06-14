<!--
Required PR format for this repository.
All human- and AI-authored PRs should follow this structure exactly.
Do not replace these sections with custom headings.
If a checklist item does not apply, keep it and add a brief note instead of deleting it.
-->

## Description

<!--
What does this PR do? What problem does it solve?
Be explicit about scope. If this is docs-only or infra-only, say so clearly.
-->

## How to test

<!--
List concrete verification steps.
If tests were not run, state that plainly and explain why.
-->

## What stays / known limitations

<!--
Anything intentionally left out, deferred, or still transitional.
Mention follow-up milestones/prompts when relevant.
-->

---

## Checklist

- [ ] No secrets / keys / passwords in the diff
- [ ] No real personal data (seed/sample data uses synthetic `@example.com` addresses)
- [ ] Tests pass locally (`npm test`)
- [ ] New fields containing personal data are justified and minimised
- [ ] No PII in logs; token/QR contains no personal data
- [ ] DB schema changes include a migration
