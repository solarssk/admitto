# Documentation and Wiki rules

Read when a change adds or edits a Markdown document, the Wiki, or a pull request body.

---

**Do not create new top-level `.md` documentation files in this repo.** This repo's doc set is
fixed: `README.md`, `CHANGELOG.md`, `SECURITY.md`, `VERSIONING.md`, `DATA-PROTECTION.md`,
`THIRD-PARTY-NOTICES.md`, `AGENTS.md`, `CLAUDE.md`, plus package-level `README.md` files,
`standards/` (the rules for agents, see [standards/README.md](README.md)) and `docs/*` referenced from them.
If something doesn't fit an existing file, add a section to the closest one instead of starting a
new file. Avoid hardcoding "current milestone/version" callouts in prose here - point to
`CHANGELOG.md`'s `[Unreleased]` section or the open GitHub milestone instead, so this file can't
drift out of date.

**User Wiki documentation gate:** `docs/wiki/` is the sole, versioned source for the published GitHub Wiki. It is the deliberate exception to the fixed-document-set rule above.

- **When to update:** for every human- or AI-authored PR, assess whether a user-visible workflow, role, terminology, availability status, or recovery step changed. Update the relevant Wiki source page when it did; otherwise complete the `No Wiki update needed` declaration in the PR template with a specific reason.
- **How to update:** edit the source pages under `docs/wiki/`, then run `npm run docs:check`.
- **Publishing:** do not edit the GitHub Wiki directly. The publish workflow replaces it from `docs/wiki/` after merge.
- **Content restrictions:** write user guidance in clear English, use only synthetic examples, and never publish customer names, personal data, environments, credentials, or unsupported operational workarounds.

**`docs:pr-check` (CI wiki-docs job) is not `docs:check`.** The job also runs `scripts/check-pr-docs-impact.mjs`, which requires the PR body to include the template's `## Documentation impact` section with **exactly one** checked line on its own line:

```
- [x] Wiki updated
- [ ] No Wiki update needed - <specific reason>
```

(em/en/hyphen dash accepted before `<specific reason>`.)

- A Checklist bullet that merely mentions "Wiki updated" does **not** pass.
- Keep the other option present and unchecked.
- If wiki files changed, the checked option must be `Wiki updated`; if none changed, it must be `No Wiki update needed` with a real reason.
- **Agents: this is a hard handoff gate** (same priority as local tests before push). See `.cursor/rules/wiki-docs-pr-gate.mdc`.
- Body-only fixes need a **new push** on the PR head (`gh run rerun` keeps the stale event body); stacked PRs each need their own correct checkbox.

For workflow pages, use the same reader-facing structure: `What this page helps you do`, `Before
you start`, `Steps`, `Expected result`, `Important decisions`, `What changes after this action`,
`Common problems`, and `Related pages`. Reference and landing pages may use a structure that fits
their purpose. Verify factual instructions against the current `main` UI and domain behaviour;
the documentation check proves structural consistency, not product correctness.


### Readable text

People with a B1 to C1 level of English read these documents, and they have to want to. Write for them, not for a tool that can read anything.

- One idea per paragraph, three or four lines at most. A sentence that needs a second breath is two sentences.
- Parallel facts go in a list or a table. A table cell holds one short fact. If a paragraph or a table cell runs past about 80 words, split it, and move a long cell's explanation under the table.
- Steps are numbered. Each step is one action, and a command gets its own code block.
- Give the answer first (what to do, what it means), then the detail. Rare detail goes in a collapsed section or on another page.
- No comparisons with other products. Describe how the product works today. Leave out version markers ("v0.4.13+", "since v0.4", "before v0.4"), "previously", "no longer" and "now also" narratives, dated decision logs and the release plan ("planned for v1.0", "the first live event comes with"). History belongs in `CHANGELOG.md`, and the plan in the open milestone.
- When you reword a document, keep every fact: names, numbers, limits and warnings. Compare the old and the new text before you push, and list anything you removed on purpose in the pull request.

### Visual documentation

- Use tables to compare roles, statuses, fields, providers, or actions.
- Use Mermaid only to explain a lifecycle, decision path, scope, or relationship that is harder to understand in a short list.
- Give every Mermaid diagram a nearby text explanation; it must not be the only source of essential guidance.
- Use at most one main diagram per page. Keep labels short and never include personal data, secrets, ticket URLs, QR values, customer names, or internal environment details.
- Use GitHub alerts only for important, risky, or irreversible information. Keep to one or two per page.
- Use collapsed sections only for optional or advanced detail, never for required steps or warnings.

### Checking the PR body before handoff

#### Stacked PRs

Each PR in a stack has its **own** body. Fixing #728 does not fix #729/#730. When rebasing a stack that touches Wiki, re-verify Documentation impact on **every** PR that includes `docs/wiki/` in its base…head diff.

#### Local sanity

```bash
# After drafting the body, confirm before handoff:
gh pr view <n> --json body --jq .body | rg -n 'Documentation impact|Wiki updated|No Wiki'
git diff --name-only <base>...HEAD | rg '^docs/wiki/' || true
```
