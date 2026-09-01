# Verification status

What has actually been checked, what has not, and how to tell the difference.

The ten checks below are separate dimensions, not a ladder. None implies
another, and they can be passed in any order. Static validation says nothing
about whether n8n accepts a file; acceptance says nothing about whether a
request Notion receives is well-formed. Read each row only as itself.

| Check | What it proves | Status |
| --- | --- | --- |
| Static validation | The JSON is well-formed and carries no credentials or private identifiers | Passing |
| Clean import | A fresh n8n `2.36.8` accepts all six workflows and returns them unchanged | Passing |
| Offline execution | Code node logic behaves as documented, against synthetic fixtures | Passing |
| Sandbox regression | The corrected URL handling runs inside a real n8n `2.36.8` Code node | Passing |
| Live HubSpot RSS | Workflow 01 fetches the three public community feeds for real | Passing |
| Live Anthropic | Workflows 01, 02 and 05 classify and draft against the real API | Passing |
| Live Notion | Rows are created and patched in a real database | Passing |
| Computed email content | Workflows 03 and 06 build the digest a send node would receive | Passing, nothing sent |
| Email delivery | A digest email reaches a real inbox | **Not done** |
| Gmail trigger | Workflow 04 reacts to a real notification email | **Not done** |

Nothing here is "fully verified." Two of the ten checks have not happened, and
the eight that passed do not stand in for them. In particular, a correct
computed digest is not a delivered one.

## The first live-verification attempt failed, and why that mattered

The first attempt to run Scout against live services stopped immediately, on
workflow 01, before any external call. It found that n8n `2.36.8` Code nodes do
not define `URL`, so every `new URL(...)` in Scout threw
`ReferenceError: URL is not defined`. Because each call site caught that error
to handle malformed input, valid configuration was reported as invalid.

Four workflows were affected. Workflow 01 could not run at all. Workflow 02
rejected any submission carrying a URL. Workflows 03 and 06 silently dropped
every link from their digests, with no error raised.

Static validation, the clean import, and 322 offline tests had all passed on
that same code. The offline harness supplied a `URL` global that n8n does not,
so the suite was testing a runtime that did not exist. That is the reason this
page keeps the checks separate: each one really can pass while the next fails.

The parser replacement and the harness repair are recorded in
[decision-log.md](decision-log.md). What has been re-verified since the fix is
narrow and listed below.

## What the sandbox regression check covers

Run on the same disposable n8n `2.36.8` instance, after the fix:

- Workflow 01 `Validate Setup` accepts the three shipped feeds and returns
  `validated: true`. Execution was stopped at that node, so `Fetch RSS` did not
  run.
- Workflow 02 `Validate Input` stores a supplied URL unchanged, and rejects
  script schemes, relative paths, malformed input and backslash-confused
  authorities with its existing messages. Execution was stopped before the
  Anthropic node.
- The `safeHref` helper from workflows 03 and 06, executed inside a real Code
  node, keeps ordinary `http` and `https` links, returns empty for script,
  relative and backslash-confused values, and escapes a quote inside the href so
  it cannot break out of the attribute.

This proves the URL handling works in n8n's sandbox. It proves nothing else. No
RSS feed was fetched, no Anthropic request was made, no Notion row was written
or modified, and no Gmail node was configured or executed during either the
failed attempt or the correction itself.

**This check came before the live run recorded below, and is narrower than it.**
It confirms only that the corrected URL parsing behaves inside a real Code node.
The live run against HubSpot Community RSS, Anthropic and Notion happened
afterwards and is reported separately, because passing this check would not have
told you anything about whether those services accept what Scout sends.

## Live run against real services

Performed on 2026-08-28, on the disposable n8n `2.36.8` instance described
below, against a throwaway Notion workspace created for the purpose. The
database held zero rows before the run.

The two rows it ended with do not have the same provenance, and an earlier
version of this page wrongly described both as fictional. Workflow 01 read real
public HubSpot Community RSS content and created **one real public-source row**
from a real community post. Workflow 02 used **one synthetic manual submission**
and created **one synthetic manual-intake row**. No participant name, post
excerpt, board name, or topic URL from the real public-source row is reproduced
anywhere in this record.

Anthropic requests were capped at six for the whole exercise. `retryOnFail` was
switched off on the three model nodes in the disposable instance so a failed
request could not silently become three. **Five requests were used.**

| Workflow | Anthropic requests | Input tokens | Output tokens | Notion writes | Wall time |
| --- | --- | --- | --- | --- | --- |
| Workflow 01, HubSpot Community Signals | 2 | 1304 | 264 | 1 row created | 4.2s |
| Workflow 02, Manual Signal Intake | 1 | 405 | 193 | 1 row created | 3.1s |
| Workflow 05, Draft Backfill | 2 | 775 | 179 | 2 rows patched | 4.1s |
| Workflow 03, Stale Signal Nudge | 0 | none | none | none, read only | 1.1s |
| Workflow 06, Weekly Scorecard | 0 | none | none | none, read only | 1.1s |

Model: `claude-haiku-4-5-20251001`. Totals: 5 requests, 2484 input tokens, 636
output tokens. **Cost was not calculated**, because no current official price
was consulted during the run. The token counts above are recorded so it can be
worked out later.

### Workflow 01, end to end

All three public HubSpot Community RSS endpoints were contacted and all three
responded. This was real traffic against real feeds: the posts it read were
written by real people on a public forum, not fixtures. With
`maxPostsPerFeed: 1` and the shipped `lookbackHours: 48`, two posts survived the
recency and keyword filters, both were classified, and one was judged relevant
and written to Notion.

That write produced the real public-source row. Its name, signal excerpt,
evidence and source URL all came from a real community post, which is what makes
it good evidence that Scout works and unusable as illustrative material.

Two candidates produced exactly two requests here only because retries were
switched off for this run. As the template ships, `Classify (Claude)` retries up
to three times, so the same two candidates could have produced up to six
attempts. The cap limits candidates, not API calls.

The created row carried a valid value in every property Scout sets
automatically: warmth tier, persona type, track, source, next action, status and
pain areas were all inside their documented option lists, and the source URL was
on `community.hubspot.com`. `Company`, `LinkedIn URL` and `Last touch` were left
empty, which is what the reference says an automated row should do.

### Workflow 02, end to end

One synthetic submission, invented for the test and carrying a synthetic URL.
The URL survived validation unchanged, which is the case that failed before the
parser fix. This write produced the synthetic manual-intake row. One row was created with
`Company` populated, the URL routed to `Source URL` rather than `LinkedIn URL`,
and every model-derived field inside its option list.

### Workflow 05, end to end

Both rows had their `Draft` cleared first as test preparation. With
`batchSize: 2`, workflow 05 selected exactly two eligible rows, made exactly two
requests, and patched a new draft onto each. It created no rows and touched no
other property. Neither draft was sent anywhere; that is the whole point of the
workflow.

### Workflows 03 and 06, computed content only

Both were executed as far as their computation node and stopped there. The Gmail
nodes were never executed, no Gmail credential was ever created, and both Gmail
nodes remained unbound throughout.

Workflow 03 found exactly one stale row out of two, correctly excluding the row
inside its follow-up window, and set `shouldEmail` accordingly. Its digest
carried one anchor, on the community host, over https. Workflow 06 counted two
new signals for the week and reported the tier split, replies, and scan/demo
counts consistent with the rows present; its hot-signal listing rendered one
anchor once a Tier 1 row existed.

Neither digest contained a `javascript:` URL or a raw `<script>` tag, and HTML
metacharacters arriving from Notion were escaped. The recipient is supplied to
the Gmail node by expression from `Scout Setup`; that wiring was read, not
executed.

### Test preparation, which is not Scout behaviour

Three edits were made by hand to the two verification rows, one real
public-source row and one synthetic manual-intake row, so later workflows had
something to act on. They are not results:

- `Draft` cleared on both rows, so workflow 05 had eligible input.
- `Last touch` back-dated on one row, so workflow 03 had a stale row.
- `Warmth tier` raised to Tier 1 on one row, so workflow 06's hot-signal listing
  had something to list.

### Provenance and the reuse boundary

The real public-source row was valid input for live verification. It is not
reusable material.

Its participant handle, post excerpt, board name, and topic URL belong to a real
person writing on a public forum who did not volunteer to illustrate anything.
None of it may appear in a screenshot, a portfolio asset, a test fixture, an
example file, or quoted text, in whole or in part. Redacting parts of it does not
make the rest reusable.

The synthetic manual-intake row carries no such constraint, because every value
in it was invented for the test.

This distinction was found by a pre-capture safety check before a planned
screenshot of the verification database. The check stopped the capture: no
screenshot, no temporary copy, and no candidate image was ever created. The
earlier wording on this page, which called both rows fictional, is what the check
caught, and correcting it is why this section exists.

### One defect found by the live run, since corrected

The live run produced the subject `Scout: 1 signal need attention`. Workflow 03
pluralised the noun and left the verb fixed, so the singular case read as broken
English in the one line an operator sees before opening anything. Cosmetic, in
the subject line only, but real, and only a live run surfaced it: the offline
tests asserted the digest's counts, grouping and escaping, and never asserted the
subject string.

It was corrected afterwards through the same authoring and sanitization boundary
as every other change, and workflow 03 was re-run in the disposable instance on
the same two rows. With one stale row the subject is now exactly
`Scout: 1 signal needs attention`. Execution stopped at `Compute Stale`, the
Gmail node did not run, no Notion row was written and no email was sent.

Tests now assert both forms, the singular and the plural at several counts, and
fail if the subject is ever rebuilt by pluralising the noun alone.

## Static validation

`npm run check` runs the tests, then the structure validator, then the safety
scanner, over all six workflows. It runs in CI on every push and pull request.
This proves the files are internally consistent. It proves nothing about whether
n8n accepts them.

## Clean import into n8n 2.36.8

Performed on 2026-08-28 against a disposable container, torn down afterwards.

- Image: `docker.n8n.io/n8nio/n8n:2.36.8`
- Digest: `sha256:cfe2704ff858395503d42548206c2c99ea351a205e941063a9d9b77b0f404478`
- Image created: `2026-08-28T07:38:13Z`
- Platform: `linux/arm64`, on a `darwin/arm64` host
- Docker: client `29.6.1`, server `29.6.1`
- Node.js inside the container: `v24.18.1`
- Reported n8n version inside the container: `2.36.8`

The instance was created empty, with its own throwaway data directory and
encryption key, on a non-default port. The `workflows/` directory was mounted
read-only. Nothing touched an existing n8n installation.

**Result: a fresh n8n `2.36.8` instance accepted all six workflows.** Each was
submitted to `POST /rest/workflows` and returned HTTP 200 with an
instance-generated id.

Two limits on what that proves. **Browser interaction with the Editor UI was not
separately tested**, so this is not a claim that clicking through *Import from
File* was exercised; it is a claim that the instance accepted the files. And
`/rest/` is n8n's internal endpoint, used here as a way to reach the instance
under test, not a public API and not something to build against. It carries no
stability guarantee.

The setup path for users is unchanged: **Import from File in the Editor UI**, as
described in [setup.md](setup.md).

Each imported workflow was then read back through the REST API and compared
against the file this repository ships. Compared: workflow name, node names and
their order, every node's type, `typeVersion`, and full parameter object,
connection count, and the `active` flag.

| Workflow | Nodes | Connections | Active after import | Drift |
| --- | --- | --- | --- | --- |
| 01 HubSpot Community Signals | 15 | 11 | `false` | none |
| 02 Manual Signal Intake | 10 | 6 | `false` | none |
| 03 Stale Signal Nudge | 11 | 7 | `false` | none |
| 04 Community Engagement Sync | 10 | 6 | `false` | none |
| 05 Draft Backfill | 13 | 9 | `false` | none |
| 06 Weekly Scorecard | 10 | 6 | `false` | none |

No node came back carrying a credential binding, and no workflow came back
active, so importing Scout cannot start a schedule on its own.

### v0.1.1 Workflow 01 Editor UI import

Performed on 2026-08-30 against a new disposable n8n `2.36.8` container using
the same pinned image digest recorded above. This check used **Import from
File** in the Editor UI, not the internal REST endpoint used for the original
six-workflow acceptance check.

The editor accepted Workflow 01, rendered all twelve executable nodes and all
five Creator notes, and saved the workflow inactive. A readback from the
disposable instance confirmed the following current state:

| Workflow | Nodes | Connections | Sticky notes | Active after import | Credential bindings | Drift |
| --- | --- | --- | --- | --- | --- | --- |
| 01 HubSpot Community Signals | 17 | 11 | 5 | `false` | none | none |

The executable graph was compared separately from the notes. Its twelve
executable nodes, connections, settings, and other runtime-bearing fields are
byte-for-byte identical to v0.1.0, with the same canonical SHA-256 digest:
`9167e959995a78666455984a90c9959fb1d825206502fa4aa6cb3a9f00ecd4f0`.
Only the five public sticky notes differ from the v0.1.0 file.

The workflow was not executed. No RSS feed, Anthropic endpoint, Notion
database, Gmail account, or other external service was contacted. The earlier
live behavior evidence therefore keeps its original 2026-08-28 date and scope;
this check establishes only Editor UI import, saved structure, and visual
layout for the v0.1.1 documentation patch.

### v0.1.2 Workflow 01 Creator layout correction

Performed on 2026-08-31 against a new disposable n8n `2.36.9` container using
image digest
`sha256:a9e2e3c8006ed453238266669ea1274be7136f515abe290a2f75a0ab9044c93d`.
The workflow was loaded with **Import from File** in the Editor UI and remained
inactive and credential-free.

- Docker: client `29.6.1`, server `29.6.1`
- Platform: `linux/arm64`
- Node.js inside the container: `v24.18.1`
- Reported n8n version: `2.36.9`

The editor rendered all twelve executable nodes and all five Creator notes.
Measured in the rendered canvas, every note's content height fit inside its
container, no note intersected another note, and no note intersected an
executable node. The section notes end above the node row with a visible gap.
The overview ends above the section-note row with a visible gap. The full
canvas was inspected end to end and recaptured as `assets/workflow-01.png`.

| Workflow | Nodes | Connections | Sticky notes | Active after import | Credential bindings | Layout overlap |
| --- | --- | --- | --- | --- | --- | --- |
| 01 HubSpot Community Signals | 17 | 11 | 5 | `false` | none | none |

The executable graph retains its canonical SHA-256 digest:
`9167e959995a78666455984a90c9959fb1d825206502fa4aa6cb3a9f00ecd4f0`.
This check was visual and structural only. The workflow was not executed, and
no RSS, Anthropic, Notion, Gmail, or other external service was contacted.
The earlier live behavior evidence keeps its original date and scope.

### The CLI import path does not work, and this is expected

`n8n import:workflow --input=<file>` fails for all six with
`NOT NULL constraint failed: workflow_entity.id`.

That command is built to re-import n8n's *own* `export:workflow` output, which
always carries a top-level `id`, and it does not generate one when the field is
absent. Scout's exports deliberately have no top-level `id`: the safety scanner
rejects one, because a root id is an identifier from whoever's instance produced
the file.

This was diagnosed rather than assumed. A throwaway copy of workflow 01 with an
`id` field added imported through the CLI without error, which isolates the
missing field as the cause.

The fix was **not** to add an id. A fixed id shared by every copy of a published
template is worse than no id: importing the same template twice, or two people
importing into one instance, would collide on it. Templates in n8n's own library
carry no root id either. The CLI limitation is a property of that command, not a
defect in these files, and a fresh instance accepts the files as they ship.

If you import by CLI, add a unique `id` to the file yourself first. Importing
through the Editor UI needs no change to the file.

### n8n's own security audit

`n8n audit`, run inside the container against the six imported workflows,
produced two reports.

| Report | Section | Findings |
| --- | --- | --- |
| Nodes Risk Report | Official risky nodes | 31 |
| Instance Risk Report | Security settings | 0 |

No credentials report and no database report were produced, meaning the audit
found nothing to say about credential risk or expression injection.

The 31 findings are 18 Code nodes and 13 HTTP Request nodes, which is every Code
and HTTP Request node Scout ships and not one more. The audit flags these two
node *types* categorically, for every workflow that uses them, because they can
run arbitrary code or reach arbitrary hosts. It has not found a vulnerability;
it has observed that Scout uses the nodes it is built out of. The reason those
nodes are present at all is recorded in
[decision-log.md](decision-log.md).

The distribution is: 01 eight, 02 five, 03 three, 04 five, 05 six, 06 four.

## Offline execution

The Code nodes are executed by the test suite inside a `node:vm` sandbox, with
synthetic fixtures as input. This is real execution of the shipped code, and it
is why the behavior described in
[workflow-reference.md](workflow-reference.md) cannot silently drift: the tests
read the same JSON that ships.

It is not evidence about the network. No HTTP Request node runs, so nothing here
proves that a Notion request is well-formed enough for Notion to accept, or that
an Anthropic response parses the way the next node expects.

## What has not been done

- **No email has been sent or received.** Workflows 03 and 06 have never
  delivered a digest. Their content was computed and inspected; the Gmail nodes
  were not executed and no Gmail credential exists.
- **Workflow 04 has never run.** Its trigger is Gmail, so without OAuth it
  cannot start. No real HubSpot notification email has been parsed. Its parser
  and the privacy rules described in [source-policy.md](source-policy.md) are
  covered only by offline tests against synthetic fixtures.
- No browser has been pointed at the Editor UI. *Import from File*, which is the
  setup path this project tells users to follow, has not been clicked through.
  What was tested is that a fresh instance accepts the files over
  `POST /rest/workflows`.
- Cost per run and setup time have not been measured, so no figure is published.
  Token counts for one small run are recorded above; nothing was priced.
- The live run was one run, on one day, with `maxPostsPerFeed: 1` and
  `batchSize: 2`. It says nothing about behaviour at volume, about a feed that
  errors or changes format, about Notion pagination past 100 rows, or about what
  happens when the model returns something unusable. The `Needs review` path was
  not exercised live, because both classifications parsed cleanly.
- Retry behaviour was never exercised. Retries were switched off for the run, so
  nothing is known about what the shipped `retryOnFail` policy does in practice.
  As shipped, one item can produce up to three API attempts, which is why
  `maxPostsPerFeed` and `batchSize` limit items rather than requests.
- Nothing has run on a schedule. Every execution was manual, and all six
  workflows are still inactive.

Scout has now been run against real services. It has not been run in production,
and this page does not say it is ready for one.
