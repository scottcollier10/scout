# Contributing

Scout is a small repository with a strict boundary. The most useful thing you
can do is report a real problem clearly, without sending anything sensitive.

## Before you file an issue

Run the check suite and include its output:

```bash
npm run check
```

That runs the behavior tests, the workflow structure validator, and the safety
scanner. If it fails on a clean checkout, that alone is a good issue.

## What to include in an issue

- Which workflow file, by path.
- Which node, by its name on the canvas.
- What you expected and what happened instead.
- The n8n version and the Node.js version.
- A **redacted** description of the input, or a synthetic example that
  reproduces it.

## What never to include

Do not attach, paste, or send any of the following. If an issue contains one,
it will be closed and you will be asked to open a new one.

- A raw workflow export from your own instance. It carries instance ids,
  credential references, and often pinned data.
- An execution log or execution JSON. n8n execution data contains request and
  response bodies, which means API keys, Notion content, and email content.
- A screenshot of a credential screen, filled or empty.
- Any OAuth trace, authorization code, refresh token, or callback URL.
- Your Notion database id, workspace URL, or a screenshot showing them.
- Real names, email addresses, or post content belonging to other people.

Scout exists to help you triage other people's public questions. Do not turn a
bug report into a place where their data leaks.

If a maintainer needs more than a redacted description, they will ask for a
specific field, not for the whole export.

## Sending a fixture

Test fixtures in `examples/fixtures/` are synthetic. Every one was written by
hand to exercise a specific path. None of them contains real data.

If you contribute a fixture:

1. Sanitize it. Replace names, companies, URLs, ids, and dates with invented
   values. `example.com` is the right host for a fake link.
2. Make the fake obviously fake. `page-001` is better than something that looks
   like a real Notion id.
3. Add a `description` field at the top saying what shape it imitates and which
   path it exercises.
4. Include at least one hostile value if the fixture feeds an email or HTML
   path, so escaping stays covered.

## Changing a workflow

Workflows are JSON exports. Editing them by hand is fine, but:

- Keep the export inactive, with no credential bindings.
- Keep node ids deterministic. Do not paste ids from a running instance.
- Keep sticky notes free of URLs. Links belong in the README or `docs/`.
- Add or update a test in `tests/workflows.test.mjs` for whatever behavior
  changed. Code node behavior is tested directly, so there is no excuse not to.
- Run `npm run check` before opening a pull request.

If you change a property name, a select option, or a setup key, update
[docs/notion-schema.md](docs/notion-schema.md) and
[docs/workflow-reference.md](docs/workflow-reference.md) in the same change. The
documentation tests read the workflow JSON, so they will tell you if you missed
one.

## Scope

Things that fit: bug fixes, clearer sticky notes, better prompts, tests,
documentation corrections, and pagination.

Things that do not fit: new automated sources, anything that sends a message to
a third party, community nodes, and abstraction layers for providers that nobody
has asked for. See [docs/source-policy.md](docs/source-policy.md) and
[docs/decision-log.md](docs/decision-log.md) before proposing one of those. The
reasoning is written down, and disagreeing with it is a fine issue to open.

## Style

- Plain language. Say what a thing does, not how impressive it is.
- Comments explain why, not what.
- No new runtime dependencies. This repository has none on purpose.
