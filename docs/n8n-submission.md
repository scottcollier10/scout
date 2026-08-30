# n8n template submission packet

Draft copy for submitting **workflow 01** to the n8n template library. Nothing
here has been submitted. No creator profile has been made and no account has
been logged into.

The repository ships six workflows. This packet covers **workflow 01** only, because
one template that does a whole job is easier to review and easier to adopt than
six that need each other. The other five are described at the end as optional
companions, not as part of this submission.

## Submission route, as of 2026-08-28

Checked read-only on 2026-08-28:

| Page | What it said |
| --- | --- |
| `n8n.io/workflows` | Library categories are AI, Sales, IT Ops, Marketing, Document Ops, Support, Other. A "Submit a template" call to action links to the creator hub. |
| `n8n.io/creators` | Points creators to `creators.n8n.io` to join. Lists programme benefits, not submission mechanics. |
| `creators.n8n.io/hub` | Redirects to an n8n-hosted Creator hub page. |

Two things follow from that check.

**The route is the Creator hub, not a GitHub template repository.** Older
guidance pointed at a templates repository. That is not the current path and
should not be used.

**The exact form fields could not be read.** The Creator hub renders as an
application that a fetch of the page cannot read, so the field list, the review
criteria and the turnaround time are not reproduced here. They are not guessed
at either. Read them at submission time, because they change.

## Title

```
Turn HubSpot Community posts into prioritized RevOps signals with Claude and Notion
```

## One-sentence outcome

Every morning you get a Notion board of the HubSpot Community posts worth
answering, each with a warmth tier, a pain area, a suggested next action, and a
draft reply waiting for you to edit.

## Who this is for

A RevOps consultant, agency, or solo operator who already answers HubSpot
Community questions and wants triage to stop being a browser tab they never
open. It assumes one person doing the reading, not a team with a queue.

It is not for outbound prospecting. Scout does not build lists, does not find
email addresses, and does not contact anyone.

## What it does

- Reads three public HubSpot Community RSS feeds on the schedule you set.
- Drops posts outside your lookback window, and posts that mention no RevOps
  keyword, before any model sees them. That filter is what keeps the cost down.
- Asks Claude to qualify each surviving post: is this an operator describing a
  routing, lifecycle, dedupe, enrichment, data quality, or reporting problem?
- Writes each qualified post to Notion as one row, with a tier, a pain area, a
  next action, a suggested angle, and a draft comment.
- Stops there. You read the draft, edit it, and post it yourself.

## How it works

1. **Daily Trigger** fires on the schedule you set. The workflow ships pinned to
   UTC so the cron expression is unambiguous.
2. **Scout Setup** holds every setting on one node: your Notion database id, the
   model, the feed list, the lookback window, and the per-feed cap.
3. **Validate Setup** checks the configuration before any request leaves n8n.
   Each feed must be an absolute https URL on the HubSpot Community host, with a
   path ending in `.rss`, and no embedded credentials. One bad entry fails the
   whole run rather than quietly fetching somewhere unintended.
4. **Feed URLs** turns the configured list into one item per feed.
5. **Fetch RSS** requests each feed once, unauthenticated.
6. **Parse XML** converts each response.
7. **Extract Posts** flattens the items, strips HTML, drops anything older than
   your lookback window, keeps only posts matching a RevOps keyword, and caps how
   many survive per feed.
8. **Dedupe Across Runs** removes posts already seen, so a daily schedule does
   not reclassify yesterday's board.
9. **Build Claude Request** constructs one Anthropic request per surviving post,
   with a system prompt that fixes the output contract.
10. **Classify (Claude)** sends it. One request per post normally, but the node
    ships with `retryOnFail: true` and `maxTries: 3`, so a transient failure can
    produce up to three attempts for that post.
11. **Parse + Map to Notion** validates every value against the allowed option
    list. A response that cannot be parsed becomes a row with status
    `Needs review` rather than being dropped or written with invalid values.
12. **Create Notion Row** writes the row. That is the last step, on purpose.

## Prerequisites

- n8n `2.36.8` or compatible. Built with built-in nodes only. No community nodes.
- A Notion internal integration and one database built from the schema below.
- An Anthropic API key.
- Nothing else. Workflow 01 does not need Gmail.

## Setup

1. Create the Notion database with the exact property names, types, and options
   listed below. Scout writes by property name, so a rename breaks the write.
2. Share the database with your Notion integration. Without this step every
   request returns a not-found error even though the token is valid. This is the
   single most common setup failure.
3. In n8n, create two **HTTP Header Auth** credentials:
   - Anthropic: header name `x-api-key`, value your API key.
   - Notion: header name `Authorization`, value the word `Bearer`, a space, then
     your integration secret.
   The `anthropic-version` and `Notion-Version` headers are already set on the
   request nodes. Do not add them to the credentials.
4. Import the template. It arrives inactive with no credentials bound.
5. Attach the Anthropic credential to **Classify (Claude)** and the Notion
   credential to **Create Notion Row**.
6. Open **Scout Setup** and paste your Notion database id. Adjust the model,
   `lookbackHours`, and `maxPostsPerFeed` if you want to.
7. Run it manually, with the schedule still off.
8. Check what landed in Notion, and read a few drafts before you trust them.
9. Review your n8n execution-data settings. See the retention note below.
10. Set the workflow timezone, then the schedule, then activate.

## Required credentials

| Credential | Type | Header | Attach to |
| --- | --- | --- | --- |
| Anthropic | HTTP Header Auth | `x-api-key` | `Classify (Claude)` |
| Notion | HTTP Header Auth | `Authorization: Bearer ...` | `Create Notion Row` |

## Notion schema

Seventeen properties. Names are case-sensitive.

| Property | Type | Notes |
| --- | --- | --- |
| `Name` | Title | Post title |
| `Company` | Rich text | Manual intake only |
| `Signal` | Rich text | Source excerpt, capped at 1,900 characters |
| `Evidence` | Rich text | Board name |
| `Warmth tier` | Select | Tier 1 (hot), Tier 2 (warm), Tier 3 (cool), Tier 4 (cold) |
| `Pain area` | Multi-select | Routing, Lifecycle, Dedupe, Enrichment, Data quality, Reporting |
| `Best angle` | Rich text | A reason to engage |
| `Draft` | Rich text | The suggested reply, for you to review |
| `Persona type` | Select | ICP buyer, ICP practitioner, Partner / consultant, Peer / networker, Unknown |
| `Track` | Select | Sales (ICP), Connector, Unknown |
| `Source` | Select | HubSpot Community, plus manual labels |
| `Source URL` | URL | Link to the post |
| `LinkedIn URL` | URL | Manual intake only. Stored, never fetched |
| `Next action` | Select | Comment, DM, Connect, Monitor, Ignore |
| `Status` | Select | New, Engaged, In conversation, Scan/Demo, Closed, Needs review |
| `Replied` | Checkbox | Defaults to unchecked |
| `Last touch` | Date | Set by you |

The full option lists are in `docs/notion-schema.md` in the repository.

## Safe first run

The template ships with `maxPostsPerFeed: 5`, a conservative shipping default
rather than a verified volume. For a first run, go lower: set
`maxPostsPerFeed` to `1` and leave `lookbackHours` at `48`. That caps the first
run at three candidate classifications across the three feeds. It does not
guarantee only three API attempts: the model node retries up to three times on a
transient failure, so the worst case is nine. Set a usage limit in your Anthropic
account if that matters to you. Run it manually, and leave the schedule off until
you have read what it produced.

If you also import the optional draft backfill workflow, set its `batchSize` to
`2` for the same reason. It ships at 5.

## What the first run produced here

One run, on 2026-08-28, on a disposable n8n `2.36.8` instance, with
`maxPostsPerFeed: 1` and `lookbackHours: 48`:

- All three RSS endpoints responded.
- Two posts survived the recency and keyword filters.
- Both were classified, using two Anthropic requests.
- One was judged relevant and written to Notion as one row.

That is one run on one day. It is not a throughput benchmark, and your feeds on
your day will differ. Setup time and cost per run have not been measured, so no
figure is offered for either.

## Customization

- **Feeds.** Change the list in `Scout Setup`. Entries must be HubSpot Community
  `.rss` URLs; the validator rejects anything else.
- **Taxonomy.** Tiers, pain areas, personas, tracks, and actions are defined in
  the prompt and re-checked in `Parse + Map to Notion`. Change both together.
- **Schedule.** Set the workflow timezone first, then the trigger.
- **Model.** `anthropicModel` in `Scout Setup`.
- **Thresholds.** `lookbackHours` and `maxPostsPerFeed`.

## Limitations, stated plainly

**Source policy.** Automated discovery is HubSpot Community RSS and nothing
else. Scout does not log in, does not read member profiles, does not collect
email addresses, and does not fetch any other platform. The feed validator
enforces the host, so pointing it elsewhere is a configuration error that stops
the run. That is a conservative product decision, not a legal clearance.

**Human review.** Scout writes suggestions. It never comments, connects,
messages, or emails anyone in the signal map. Every draft waits in Notion until
a person decides what to do with it.

**Data retention.** n8n can retain the inputs and outputs of every execution,
which here would include post content, prompts, model responses, and Notion
data. That is controlled by your n8n execution-data settings, not by Scout.
Review saving and pruning before you activate anything.

## Verification boundaries

Built and checked against n8n `2.36.8`.

| Checked | Not checked |
| --- | --- |
| A fresh `2.36.8` instance accepts the JSON | Import through the Editor UI in a browser |
| Workflow 01 runs end to end against the real feeds, Anthropic, and Notion | Behaviour at volume, or on a day when a feed errors |
| Code node logic against synthetic fixtures | Cost per run, setup duration |

The `n8n import:workflow` CLI cannot read this file, because it requires a
top-level workflow id that a published template should not carry. Importing
through the editor needs no change to the file.

## Suggested categories and tags

**Categories:** `Sales` and `AI`. Both are current visible library categories.

**Suggested tags or use cases:** HubSpot, Notion, Anthropic, Claude, RSS, lead
qualification, AI summarization, RevOps.

`AI Summarization` is offered as a tag or use case, not as a category, because it
was not visible as one in the library on the date checked. Confirm the current
category list at submission time.

## Support path

Support goes to the repository's issue tracker:

https://github.com/scottcollier10/scout/issues

The submission should carry that link rather than a personal address. Do not
substitute an email.

## Assets to upload

| File | What it shows |
| --- | --- |
| `assets/workflow-01.png` | The full workflow 01 canvas with its three sticky notes, inactive and credential-free |
| `assets/architecture.svg` | How the six workflows relate, and where the human review boundary sits |

Both are in the repository. Neither contains a credential, an identifier, a
recipient address, or a database value.

## Forum post outline

**Title:** *I built a HubSpot Community triage system in n8n, and testing it on a
real instance broke it*

1. **The problem.** A HubSpot Community post is not a lead. It is a person
   describing a broken lifecycle sync at eleven at night. Triage is the part
   nobody does.
2. **What it does.** Three public RSS feeds, a keyword filter before the model,
   Claude for qualification, one Notion row per signal with a draft reply.
3. **The design decision people will ask about.** Filtering before the model,
   not after, so most posts never cost anything. Worth being precise about what
   the caps do: they limit items processed, not API calls, because the model
   nodes retry up to three times. A provider-side usage limit is the real guard.
4. **What real n8n testing caught.** The suite had 322 passing tests. The first
   run on a real `2.36.8` instance failed immediately, because n8n Code nodes do
   not define `URL`, and every `new URL(...)` threw. Four workflows were
   affected: one could not run at all, one rejected valid input, and two silently
   dropped every link from their digests. The tests passed because the offline
   harness supplied a global the runtime does not. Fixing the harness mattered
   more than fixing the bug.
5. **What is still unverified.** Email delivery, the Gmail-triggered companion
   workflow, cost, and setup time.
6. **The template.** Link to the Creator hub listing once it exists.

Keep the product outcome first. The bug is a good story about testing, but it is
supporting evidence, not the pitch.

## The five companion workflows

Not part of this submission. They live in the repository for anyone who wants
them once the board has enough rows to maintain:

| Workflow | Role |
| --- | --- |
| 02 Manual Signal Intake | Capture a signal you found yourself, through a form |
| 03 Stale Signal Nudge | Email you the open rows that have gone quiet |
| 04 Community Engagement Sync | Advance a row when a notification says someone replied |
| 05 Draft Backfill | Fill in drafts for open rows that lack one |
| 06 Weekly Scorecard | Email a Friday summary against targets you set |
