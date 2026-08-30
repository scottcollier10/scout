# Architecture

How data moves through Scout, and where it deliberately stops.

Scout is six independent n8n workflows that share one Notion database. There is
no server and no queue. Each workflow can be imported, run, and deleted on its
own. Durable records live in Notion; n8n holds deduplication state and, subject
to your settings, a copy of what passed through each execution.

## The shape of it

```text
                 community.hubspot.com (RSS, unauthenticated)
                               |
                               v
  +---------------------------------------------------------------+
  |                       your n8n instance                        |
  |                                                                |
  |   01 signals        02 manual form         04 engagement sync  |
  |       |                   |                        |           |
  |       +---------+---------+                        |           |
  |                 |                                  |           |
  |                 v                                  |           |
  |          api.anthropic.com                         |           |
  |           classify and draft                       |           |
  |                 |                                  |           |
  |                 v                                  |           |
  |           api.notion.com  <------------------------+           |
  |            the signal map                                      |
  |                 |                                              |
  |       +---------+---------+--------------------+               |
  |       |                   |                    |               |
  |  03 stale nudge      06 scorecard      05 draft backfill       |
  |       |                   |                    |               |
  |       |                   |                    v               |
  |       |                   |            api.anthropic.com       |
  |       |                   |            then back to Notion     |
  +-------|-------------------|------------------------------------+
          v                   v
      your inbox          your inbox
                               |
                               v
                       a human decides
```

Workflow 04 does not call Anthropic. It reads notification mail and writes to
Notion directly.

The arrow at the bottom is the point of the system. Every path ends at a person
reading a row or an email, not at a message going out.

## Data flow, one workflow at a time

**Signal discovery (01).** A schedule trigger fires. `Scout Setup` supplies
configuration. `Validate Setup` rejects the run if anything is missing or if a
feed URL is not an https HubSpot Community `.rss` URL. `Fetch RSS` makes one
unauthenticated GET per feed. `Extract Posts` strips HTML, drops posts outside
the lookback window, and keeps only posts matching a RevOps keyword list, which
is a cheap filter that runs before any model call. `Dedupe Across Runs` removes
posts already seen. `Classify (Claude)` sends the surviving title, excerpt, and
board name to the Anthropic Messages API. `Parse + Map to Notion` turns the
model's JSON into Notion properties. `Create Notion Row` writes one page.

**Manual intake (02).** An n8n form trigger accepts a name, company, URL,
source label, and free-text note that you typed. `Validate Input` rejects a
missing name or note and rejects a URL that is not absolute http or https. The
rest of the path matches workflow 01 from classification onward.

**Stale nudge (03).** A weekday schedule queries open rows from Notion,
compares each row's `Last touch` (or its Notion page creation time when it has
never been touched) against a per-action window, and emails you the ones past
their window. If nothing is stale, it sends nothing.

**Engagement sync (04).** A Gmail trigger polls for HubSpot notification mail.
`Parse Notification` looks for a community topic link and drops any message
without one. It strips email addresses out of the text it reads, and keeps only
that link and the public display name; the subject, snippet, body, and message
id are discarded there. Matching rows are advanced to `In conversation`;
unmatched ones become a new hot row built from the name and the link alone.

**Draft backfill (05).** A daily schedule finds open rows with an empty `Draft`
and a next action a human would actually write, asks Claude for one message per
row, and patches the row. A response it cannot read leaves the row untouched and
routes to a `Needs Review` branch.

**Scorecard (06).** A Friday schedule counts the week's rows and emails a
summary against targets you set.

## Trust boundaries

There are four places data crosses out of your n8n instance. Nothing else leaves.

| Boundary | Direction | What crosses | Authentication |
| --- | --- | --- | --- |
| HubSpot Community RSS | outbound read | Nothing but the GET itself | None. Scout never logs in |
| Anthropic Messages API | outbound write | See the field list below | Your API key, from n8n's credential store |
| Notion API | outbound read and write | The signal map rows Scout creates and reads | Your integration token, from n8n's credential store |
| Gmail | inbound read, outbound send | Community notification mail in; digest email to your own configured address out | Your OAuth2 credential |

### Exactly what Scout sends to Anthropic

Three of the six workflows call Anthropic. Each one sends specific fields, and
this is the complete list.

| Workflow | Fields sent to `api.anthropic.com` |
| --- | --- |
| 01 signals | The post title, a truncated excerpt of the post body, and the board name |
| 02 manual form | The person's name, their company, the source label you picked, the URL you pasted, and your free-text note, all exactly as you typed them |
| 05 draft backfill | The row's next action, its `Signal` text, its `Best angle` text, its `Pain area` values, and the row title, which is the person's name |

Workflow 02 is worth reading twice. Whatever you type into that form about
another person, including their name, their company, and a link to them, is sent
to Anthropic for classification. If that is not acceptable for a given signal, do
not put it in the form.

Workflow 05 sends stored signal context back out for drafting, which means text
that originally came from a community post or from your own note crosses this
boundary a second time.

Workflows 03, 04, and 06 make no Anthropic request at all.

Things that are true at every boundary:

- **Credentials never live in the workflow JSON.** The exported files carry no
  credential bindings at all. n8n resolves them at run time from its own
  credential store. The repository's scanner fails the build if a token, an
  instance id, or a private identifier appears in an export.
- **Scout is a read-only visitor to HubSpot Community.** Three unauthenticated
  GETs per day against feeds the platform publishes. No login, no session, no
  member profiles, no email addresses, no automated engagement.
- **The model sees excerpts, not archives.** For community posts, Scout sends a
  truncated excerpt for classification and stores a short derived signal. It
  does not mirror full posts into Notion. Manual form submissions are the
  exception: they are sent in full, because you wrote them.
- **Email goes to you.** The address in `recipientEmail` is validated as an
  address before Gmail is asked to send, and it is the only recipient.

## Where untrusted input is handled

Two kinds of input arrive from outside and are treated as hostile.

**Model output.** The classifier is asked for JSON, but a model can return
anything. `Parse + Map to Notion` and `Build Patch` both handle an unparseable
response by writing a `Needs review` row or leaving the row unchanged, never by
inventing content and never by silently dropping the item. Every unreadable
response is recorded with a reason.

**Text destined for HTML email.** Names, angles, and links come out of Notion,
where anyone's post title may already have landed. Workflows 03 and 06 escape
every HTML metacharacter before interpolation and only turn a URL into a link if
it parses as http or https. A `javascript:` URL renders as inert text.

## Storage and retention

Scout stores data in three places. Two of them are obvious. The third is n8n
itself, and it is the one people miss.

**Notion holds the durable signal map.** Every row Scout creates or updates
lives there, and it is the record you work from. Deleting a row deletes the
record.

**The `Remove Duplicates` node holds seen-post state inside n8n.** Workflow 01
keeps the keys of posts it has already processed so a daily run does not re-file
yesterday's posts. That state lives in n8n's own storage, not in Notion.
Deleting or reimporting the workflow resets it, which means a reimport may
re-add posts you already triaged.

**n8n may retain the inputs and outputs of every execution.** This is n8n
behavior, not something Scout controls. Depending on your instance's
execution-data settings, n8n can store what each node received and returned,
which for Scout can include:

- RSS content fetched from HubSpot Community, including post titles and bodies;
- manual form submissions, including the name, company, URL, and note you typed;
- the request bodies sent to Anthropic and the responses returned, which means
  prompts and generated drafts;
- Notion request and response data, which means signal map rows;
- Gmail notification data read by workflow 04, including message content.

Whether any of that is kept, and for how long, is decided by the operator of the
n8n instance through execution saving and pruning settings.

**Review your execution saving and pruning settings before you activate
anything.** Decide what your instance saves on success, on error, and on manual
runs, and decide how aggressively old executions are pruned. n8n documents both the instance-level
environment variables and the per-workflow overrides:

- [Manage execution data](https://docs.n8n.io/deploy/host-n8n/configure-n8n/scaling/manage-execution-data/)
- [Configure workflow settings](https://docs.n8n.io/build/manage-workflows/configure-workflow-settings/)

Scout writes no local database of its own, no cache directory, and no file to
disk. That is a statement about Scout's nodes, not about n8n's backing store.

## Review boundary

Scout ends at a suggestion:

- a Notion row with a tier, a pain area, and a next action;
- a `Draft` value you can read, edit, or delete;
- an email in your own inbox.

There is no node in any of the six workflows that posts to a community, sends a
connection request, sends a direct message, or contacts anyone in the signal
map. Adding one would be a different product with a different source policy. See
[source-policy.md](source-policy.md).

## Limits worth knowing before you rely on it

- **One page of Notion results.** Queries request 100 rows and this version does
  not follow the pagination cursor. Past 100 open rows, the stale nudge and the
  scorecard cover only the first page.
- **Feed paths change.** HubSpot can move or retire a community feed. Validation
  checks the shape of a feed URL, not that it still resolves.
- **Notification templates change.** Workflow 04 depends on HubSpot's email
  format. Test it against a real forwarded notification before activating it.
- **What has and has not been exercised.** All six workflows were accepted by a
  fresh n8n `2.36.8` instance over the internal route used to reach the instance
  under test, and each round-tripped without drift. The recorded live checks
  passed within their recorded scope: workflows 01, 02, and 05 ran end to end
  against the real feeds, Anthropic, and Notion, and workflows 03 and 06 had
  their digest content computed and inspected without sending. Import through
  the Editor UI in a browser, workflow 04's Gmail trigger, and email delivery
  remain unverified. The boundaries are in the README verification table and in
  [live-verification.md](live-verification.md).
