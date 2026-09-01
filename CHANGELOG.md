# Changelog

Notable changes to Scout. This project follows semantic versioning once it has a
first tagged release.

## 0.1.2 - 2026-08-31

### Fixed

- Repositioned and resized Workflow 01's five Creator notes so no note
  overlaps another note or an executable node in n8n `2.36.9`.
- Added a geometry regression test that checks note-to-note and note-to-node
  separation with conservative node bounds.
- Recaptured the Workflow 01 canvas from the corrected, inactive,
  credential-free import.
- Corrected the private-marker release scanner so repositories with multiple
  annotated tags scan every tag object without treating a record newline as
  part of the next tag name.

Workflow 01's executable graph keeps the same canonical digest as v0.1.0 and
v0.1.1. No executable node, connection, setting, prompt, credential binding,
activation state, pin data, tag, or workflow name changed. The live behavior
evidence therefore keeps its original date and scope.

## 0.1.1 - 2026-08-30

### Changed

- Rebuilt Workflow 01's canvas notes to match the current n8n Creator template
  contract: one yellow overview with `How it works` and `Setup`, followed by
  four neutral section notes under 50 words.
- Recaptured the Workflow 01 canvas after a fresh n8n `2.36.8` import.

Workflow 01's executable nodes, connections, settings, activation state, pin
data, tags, and workflow name are byte-identical to v0.1.0. The behavioral
verification below therefore carries forward; v0.1.1 adds import and visual
verification for the documentation-only canvas change.

## 0.1.0 - 2026-08-29

Initial public release.

### Added

- `Scout 01 | HubSpot Community Signals`: reads three public HubSpot Community
  RSS feeds daily, filters by age and RevOps keyword before any model call,
  classifies with Claude, and writes one Notion row per qualified post with a
  warmth tier, pain area, next action, and draft.
- `Scout 02 | Manual Signal Intake`: an n8n form for recording a signal you
  found yourself, classified and filed the same way.
- `assets/architecture.svg` and `assets/workflow-01.png`: a system diagram and
  the workflow 01 canvas, for the README and a future template submission.
- `docs/n8n-submission.md`: draft copy for submitting workflow 01 to the n8n
  template library. Nothing has been submitted.
- `Scout 03 | Stale Signal Nudge`: a weekday email of open rows past their
  per-action follow-up window, grouped by action and ordered hottest first.
- `Scout 04 | Community Engagement Sync`: parses HubSpot Community notification
  mail, advances the matching Notion row, and creates a hot row when there is no
  match. Stores the public display name and the topic URL and nothing else: the
  subject, snippet, body, message id, and sender address are discarded in the
  parser before any Notion request is built.
- `Scout 05 | Draft Backfill`: fills empty drafts on open rows whose next action
  is one a human would actually write.
- `Scout 06 | Weekly Scorecard`: a Friday summary of the week's rows against
  configurable targets.
- Feed URL validation on workflow 01: https only, the HubSpot Community host
  exactly, a `.rss` path, and no embedded credentials, enforced before the first
  request.
- Setup validation on every workflow that would otherwise make an external
  request with an empty required field. Errors name the field.
- A public-export safety scanner (`npm run scan`) and a structure validator
  (`npm run validate`).
- A deterministic sanitizer that rebuilds public exports with stable, derived
  node ids.
- Behavior tests that execute the Code node source from the shipped workflow JSON
  against synthetic fixtures.
- Documentation tests that check the README and `docs/` against the shipped
  workflows, so the reference cannot drift.

### Known limits

- Retention of execution inputs and outputs is controlled by your n8n
  execution-data settings, not by Scout. Review saving and pruning before
  activating anything.
- Notion queries use a page size of 100 and do not follow the pagination cursor.
- Public defaults ship at `maxPostsPerFeed: 5` and `batchSize: 5`. Five is a
  conservative shipping choice, not a verified volume and not a billing ceiling:
  nothing has been observed running at 5, and the model nodes retry up to three
  times. The documented first run uses `maxPostsPerFeed: 1` and `batchSize: 2`.
- The `n8n import:workflow` CLI cannot import these files, because it requires a
  top-level workflow id that a public export should not carry. A fresh n8n
  `2.36.8` instance accepts all six over `POST /rest/workflows`; browser
  interaction with the Editor UI was not separately tested. See
  [docs/live-verification.md](docs/live-verification.md).
- Workflows 01, 02, and 05 have been run once against the real HubSpot
  Community feeds, Anthropic, and a Notion database. Workflows 03 and 06 had
  their digest content computed and inspected without sending. No email has
  been delivered, and workflow 04 has never run because its trigger needs
  Gmail OAuth. See [docs/live-verification.md](docs/live-verification.md).
- Cost per run has not been measured.
