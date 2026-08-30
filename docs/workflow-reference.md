# Workflow reference

One section per workflow: what triggers it, what it reads, what it writes, which
credentials it needs, every `Scout Setup` key, what it does when something goes
wrong, and what it cannot do yet.

Every workflow exports inactive with no credential bindings. Every executable
workflow has one `Edit Fields` node named `Scout Setup` immediately after its
trigger, and downstream nodes read configuration with
`$('Scout Setup').first().json`. `Scout Setup` passes incoming fields through, so
form and email payloads survive it.

Shared conventions:

- `notionDatabaseId` and `recipientEmail` default to empty strings. A workflow
  that would otherwise make an external request with an empty required value has
  a validation Code node that throws first, naming the field to fix.
- Anthropic and Notion are called through HTTP Request nodes with HTTP Header
  Auth. Gmail uses n8n's Gmail node with OAuth2.
- Scheduled workflows ship pinned to the `UTC` timezone so their cron
  expressions are unambiguous. Change the workflow timezone before activating.

---

## Core

### Scout 01 | HubSpot Community Signals

`workflows/core/01-hubspot-community-signals.json`

The hero workflow and the only one the quickstart requires.

| | |
| --- | --- |
| Trigger | `Daily Trigger`, schedule, cron `0 7 * * *` |
| Reads | Three public HubSpot Community RSS feeds, unauthenticated |
| Writes | One Notion page per qualified post |
| Sends to Anthropic | The post title, a truncated excerpt of the body, and the board name |
| Credentials | Anthropic (HTTP Header Auth) on `Classify (Claude)`; Notion (HTTP Header Auth) on `Create Notion Row` |

**Setup keys**

| Key | Default | Meaning |
| --- | --- | --- |
| `notionDatabaseId` | `""` | The database Scout writes rows to |
| `anthropicModel` | `claude-haiku-4-5-20251001` | Model used for classification and drafting |
| `hubspotCommunityFeeds` | three community `.rss` URLs | Feeds to read, one request each per run |
| `lookbackHours` | `48` | Posts older than this are dropped before any model call |
| `maxPostsPerFeed` | `5` | Candidate posts kept per feed per run. A conservative shipping default, not a verified volume. Volume limit, not a billing limit: see the retry note below |

**Path**

`Daily Trigger` → `Scout Setup` → `Validate Setup` → `Feed URLs` → `Fetch RSS` →
`Parse XML` → `Extract Posts` → `Dedupe Across Runs` → `Build Claude Request` →
`Classify (Claude)` → `Parse + Map to Notion` → `Create Notion Row`

**Failure behavior**

- `Validate Setup` throws before `Fetch RSS` if `notionDatabaseId` or
  `anthropicModel` is empty, if `lookbackHours` is outside 1 to 168, if
  `maxPostsPerFeed` is outside 1 to 100, or if any feed entry is not an absolute
  https URL on the HubSpot Community host with a `.rss` path and no embedded
  username or password. One bad feed fails the whole run.
- `Fetch RSS` retries twice. Anthropic and Notion requests retry three times with
  a two second wait.

**Retry note, and what the caps actually limit.** This run processes at most
`feed count` times `maxPostsPerFeed` candidate items, and each item normally
produces one Anthropic request. Because `Classify (Claude)` ships with
`retryOnFail: true` and `maxTries: 3`, a transient failure can turn one item into
three billed attempts. The cap limits items, not API calls, so it controls volume
without guaranteeing a billing ceiling. Set a usage limit in your Anthropic
account for that.
- `Classify (Claude)` continues on error rather than aborting the run, so one bad
  response does not lose the rest of the batch.
- A model response that cannot be parsed as the expected JSON produces a row with
  `Status` set to `Needs review`, `Warmth tier` set to `Tier 4 (cold)`, and
  `Next action` set to `Monitor`. Scout does not invent a classification and does
  not silently drop the post.

**What the model decides, and what it does not**

The model returns relevance, warmth tier, pain areas, persona type, track, a best
angle, and a draft comment. It is not asked for a next action. `Parse + Map to
Notion` assigns `Next action` itself: `Comment` on every qualified row and
`Monitor` on a `Needs review` row. If you want a different default action for
this workflow, change that node rather than the prompt.

**Limits**

- Deduplication state lives in the `Remove Duplicates` node. Deleting or
  reimporting the workflow resets it, so previously triaged posts can reappear.
- The keyword pre-filter is a fixed list inside `Extract Posts`. Edit the node to
  change it.
- Feed paths can change without notice. Validation checks the shape of a URL, not
  that it still resolves.

---

### Scout 02 | Manual Signal Intake

`workflows/core/02-manual-signal-intake.json`

For the signal you found yourself, on any platform, and want filed the same way.

| | |
| --- | --- |
| Trigger | `Capture Form`, n8n form trigger |
| Reads | Only what you type into the form |
| Writes | One Notion page |
| Sends to Anthropic | The person's name, their company, the source label, the URL, and your note, all exactly as typed |
| Credentials | Anthropic on `Classify (Claude)`; Notion on `Create Notion Row` |

Everything you type about another person in this form, including their name,
their company, and a link to them, is sent to Anthropic for classification. If
that is not acceptable for a given signal, do not put it in the form.

**Setup keys**

| Key | Default | Meaning |
| --- | --- | --- |
| `notionDatabaseId` | `""` | The database Scout writes the row to |
| `anthropicModel` | `claude-haiku-4-5-20251001` | Model used to classify what you typed |

**Path**

`Capture Form` → `Scout Setup` → `Validate Input` → `Build Claude Request` →
`Classify (Claude)` → `Build Notion Row` → `Create Notion Row`

**Form fields**

`Name`, `Company`, `URL`, `Source`, and `What you saw`. The `Source` dropdown
offers LinkedIn post, LinkedIn people, HubSpot Community, Reddit, Job posting,
Partner directory, and Referral. These are labels describing where *you* saw
something. Scout does not fetch any of those platforms. A LinkedIn source stores
its URL in `LinkedIn URL`, which no workflow ever retrieves.

**Failure behavior**

- `Validate Input` throws when the name or the note is empty, when the URL is not
  an absolute URL, or when the URL is not http or https. It runs before the
  Anthropic call, so a bad submission costs nothing.
- An unreadable model response produces a `Needs review` row with the raw note
  preserved, rather than a guess.

**Limits**

- The form trigger is unauthenticated by default. Put it behind n8n's form
  authentication if the URL will be shared.
- There is no duplicate check. Submitting the same post twice creates two rows.

---

### Scout 03 | Stale Signal Nudge

`workflows/core/03-stale-signal-nudge.json`

The follow-up loop. Open rows that have gone quiet come back to you.

| | |
| --- | --- |
| Trigger | `Weekday Trigger`, schedule, cron `0 8 * * 1-5` |
| Reads | Open rows from Notion |
| Writes | Nothing to Notion. One email to you |
| Credentials | Notion on `Query Open Signals`; Gmail OAuth2 on `Email Nudge` |

**Setup keys**

| Key | Default | Meaning |
| --- | --- | --- |
| `notionDatabaseId` | `""` | The database to read |
| `recipientEmail` | `""` | The one address the digest is sent to |
| `staleDaysByAction` | `{ DM: 4, Comment: 5, Connect: 6, Monitor: 14, default: 7 }` | Follow-up window per next action, in days |

**Path**

`Weekday Trigger` → `Scout Setup` → `Validate Setup` → `Query Open Signals` →
`Compute Stale` → `Any Stale?` → `Email Nudge` or `No Stale Signals`

**Behavior**

A row is stale when its status is not `Closed`, its next action is not `Ignore`,
and its `Last touch` is older than the window for its action. A row that has
never been touched ages from its Notion page creation time, so a new row still
becomes visible instead of sitting invisible forever. The digest groups rows by
next action and orders them hottest tier first, then longest stale.

**Failure behavior**

- `Validate Setup` throws before the Notion query if `notionDatabaseId` is empty,
  if `recipientEmail` is empty or is not shaped like an address, or if any of the
  five required windows is not a whole number of days from 1 to 90.
- When nothing is stale, `Any Stale?` routes to `No Stale Signals` and the run
  ends. Scout does not send a "nothing to do" email.
- Names, angles, and links are HTML-escaped before they reach the email, and only
  http and https URLs become clickable.

**Limits**

- The Notion query asks for 100 rows and this version does not follow the
  pagination cursor. Past 100 open rows the digest covers only the first page.

---

## Extensions

### Scout 04 | Community Engagement Sync

`workflows/extensions/04-community-engagement-sync.json`

Closes the loop when someone actually replies.

| | |
| --- | --- |
| Trigger | `Community Notifications`, Gmail trigger, polling hourly with query `from:hubspot.com` |
| Reads | HubSpot notification mail, and one Notion row per notification |
| Writes | Updates a matching Notion row, or creates a new one |
| Credentials | Gmail OAuth2 on the trigger; Notion on `Find Existing Row` and `Write to Notion` |

**Setup keys**

| Key | Default | Meaning |
| --- | --- | --- |
| `notionDatabaseId` | `""` | The database to search and write |

**Path**

`Community Notifications` → `Scout Setup` → `Validate Setup` →
`Parse Notification` → `Find Existing Row` → `Decide & Build` → `Write to Notion`

**Behavior**

`Parse Notification` builds one haystack from whichever body fields Gmail
exposes and looks for a community topic link of the form `/t/<slug>/<id>`.
Messages without one are dropped, so ordinary HubSpot mail is ignored.

Only two values leave that node: the topic URL and the public display name. Email
addresses are redacted before the name is matched, and the subject, snippet,
body, and Gmail message id are then discarded along with the rest of the mail, so
no later node can put them in a Notion request.

A match advances the row to `Replied`, status `In conversation`, next action
`DM`, and today's `Last touch`. No match creates a `Tier 1 (hot)` row with status
`Engaged` and `Unknown` persona and track, because there is no classifier on this
path. That row carries the display name, or `HubSpot Community participant` when
no name could be read, the topic URL in `Source URL`, and the fixed `Signal` text
`Inbound HubSpot Community engagement`. Nothing on it is quoted from the mail.

**Failure behavior**

- `Validate Setup` throws before `Find Existing Row` if `notionDatabaseId` is
  empty, so an unconfigured instance never builds a Notion request.
- A notification that parses but matches nothing creates a row rather than being
  discarded.

**Limits**

- This depends on HubSpot's notification email format, which can change at any
  time. When it does, the workflow quietly stops matching. Forward yourself a
  real notification and run it manually before activating.
- The Gmail query is broad on purpose. Narrow it if your inbox gets other
  HubSpot mail.

---

### Scout 05 | Draft Backfill

`workflows/extensions/05-draft-backfill.json`

Fills the gaps left by manual rows, engagement rows, and classifier misses.

| | |
| --- | --- |
| Trigger | `Daily Trigger`, schedule, cron `30 7 * * *` |
| Reads | Open Notion rows with an empty `Draft` |
| Writes | The `Draft` property of those rows |
| Sends to Anthropic | The row's next action, its `Signal` text, its `Best angle` text, its `Pain area` values, and the row title, which is the person's name |
| Credentials | Notion on `Query Rows Missing Draft` and `Write Draft`; Anthropic on `Draft (Claude)` |

This workflow sends stored signal context back out for drafting, so text that
originally came from a community post or from your own note crosses the Anthropic
boundary a second time.

**Setup keys**

| Key | Default | Meaning |
| --- | --- | --- |
| `notionDatabaseId` | `""` | The database to read and patch |
| `anthropicModel` | `claude-haiku-4-5-20251001` | Model used to write the draft |
| `batchSize` | `5` | Rows processed per run. A conservative shipping default, not a verified volume. Volume limit, not a billing limit: see the retry note below |

**Path**

`Daily Trigger` → `Scout Setup` → `Validate Setup` → `Query Rows Missing Draft` →
`Prep Rows` → `Draft (Claude)` → `Build Patch` → `Draft Ready?` → `Write Draft`
or `Needs Review`

**Behavior**

Only rows whose next action is `Comment`, `DM`, or `Connect` get a draft.
`Monitor` and `Ignore` rows never need one, so they are skipped in code rather
than filtered in Notion. Drafts are capped at 1,900 characters before the patch.

**Failure behavior**

- `Validate Setup` throws before the Notion query if `notionDatabaseId` or
  `anthropicModel` is empty, or if `batchSize` is not a whole number from 1 to
  50.

**Retry note, and what the caps actually limit.** This run processes at most
`batchSize` rows, and each row normally produces one Anthropic request. Because
`Draft (Claude)` ships with `retryOnFail: true` and `maxTries: 3`, a transient
failure can turn one row into three billed attempts. The cap limits rows, not API
calls. Set a usage limit in your Anthropic account for a real ceiling.
- An empty or unreadable model response marks the item `draftReady: false` and
  routes it to `Needs Review`, which writes nothing. The row keeps its empty
  `Draft` and is picked up on the next run. The reason is visible in the
  execution.

**Limits**

- `batchSize` caps the Notion page size and the number of rows processed, so a
  backlog larger than `batchSize` takes several days to clear. Rows are not the
  same as model calls: a retried request costs up to three attempts for one row.
- Drafts are suggestions. Nothing reads them back or sends them.

---

### Scout 06 | Weekly Scorecard

`workflows/extensions/06-weekly-scorecard.json`

A Friday summary, so the board does not quietly rot.

| | |
| --- | --- |
| Trigger | `Friday Trigger`, schedule, cron `0 16 * * 5` |
| Reads | Rows created this week and rows touched this week |
| Writes | Nothing to Notion. One email to you |
| Credentials | Notion on `Query New This Week` and `Query Touched This Week`; Gmail OAuth2 on `Email Scorecard` |

**Setup keys**

| Key | Default | Meaning |
| --- | --- | --- |
| `notionDatabaseId` | `""` | The database to read |
| `recipientEmail` | `""` | The one address the scorecard is sent to |
| `weeklyTargets` | `{ newSignals: 10, tier2Plus: 4, replies: 1, scanOrDemo: 1 }` | Targets each count is measured against |

**Path**

`Friday Trigger` → `Scout Setup` → `Validate Setup` → `Query New This Week` →
`Query Touched This Week` → `Compute Scorecard` → `Email Scorecard`

**Behavior**

New signals are counted from Notion's built-in page creation time, so no extra
property is needed. The email reports new rows, tier 2 and hotter, replies, and
scan or demo conversations, each against its target.

**Failure behavior**

- `Validate Setup` throws before the first Notion query if `notionDatabaseId` is
  empty, if `recipientEmail` is empty or malformed, or if any target is not a
  whole number from 0 to 1000.
- A week with no activity sends a short "quiet week" email rather than failing or
  sending an empty table.
- Everything interpolated into the email is HTML-escaped, and only http and https
  URLs become links.

**Limits**

- Both queries ask for 100 rows without following the pagination cursor. A busier
  week than that undercounts.

---

## Cross-workflow limits

- **Pagination is deferred.** Every Notion query in this version uses a page size
  of 100 and ignores `next_cursor`. Keep the board pruned, or add pagination
  before you rely on the counts.
- **No outreach is sent.** No workflow posts, comments, connects, or messages
  anyone in the signal map. Workflows 03 and 06 do send email, but only a digest
  to the single address you configure.
- **Only workflows 01, 02, and 05 call Anthropic.** Workflows 03, 04, and 06 make
  no model request at all.
- **n8n may retain what passed through each run.** Execution inputs and outputs
  are kept according to your instance's execution-data settings, which is a
  setting you own rather than something these workflows control. See
  [architecture.md](architecture.md#storage-and-retention).
- **Import and live execution are unverified.** See the verification status table
  in the [README](../README.md).
