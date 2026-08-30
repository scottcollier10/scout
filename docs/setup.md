# Setup

Everything needed to get one workflow running, then the rest.

Read [notion-schema.md](notion-schema.md) first and build the database. Nothing
below works without it.

## 1. Credentials

Scout calls Anthropic and Notion through n8n's HTTP Request node using **HTTP
Header Auth**, and Gmail through n8n's Gmail node using **OAuth2**.

Tokens live in n8n's credential store. Never put a token in a node parameter,
a `Scout Setup` field, or the workflow JSON. The exported workflows in this
repository carry no credential bindings at all, and the repository's scanner
fails if a token-shaped value ever appears in one.

### Anthropic

Create an **HTTP Header Auth** credential in n8n:

| Field | Value |
| --- | --- |
| Name | something like `Anthropic (Scout)` |
| Header Name | `x-api-key` |
| Header Value | your Anthropic API key |

The `anthropic-version` header is already set to `2023-06-01` on the request
nodes themselves, along with `content-type`. You do not add those to the
credential.

Attach this credential to:

- `Classify (Claude)` in workflows 01 and 02
- `Draft (Claude)` in workflow 05

### Notion

Create a second **HTTP Header Auth** credential:

| Field | Value |
| --- | --- |
| Name | something like `Notion (Scout)` |
| Header Name | `Authorization` |
| Header Value | the word `Bearer`, a space, then your integration secret |

The `Notion-Version` header is already set to `2022-06-28` on the request nodes.

Attach this credential to every Notion HTTP Request node in the workflows you
import:

- `Create Notion Row` in workflows 01 and 02
- `Query Open Signals` in workflow 03
- `Find Existing Row` and `Write to Notion` in workflow 04
- `Query Rows Missing Draft` and `Write Draft` in workflow 05
- `Query New This Week` and `Query Touched This Week` in workflow 06

If Notion returns a not-found error while the token is valid, the database has
not been shared with the integration yet. Go back to
[notion-schema.md](notion-schema.md).

### Gmail

Workflows 03, 04, and 06 use n8n's Gmail node with an **OAuth2** credential.
Follow n8n's Gmail credential flow; there is nothing Scout-specific about it.

Workflow 04 reads mail. Workflows 03 and 06 send mail, to one address that you
configure and to no one else.

## 2. Import a workflow

In n8n, create a new workflow and import from file. Every export in this
repository arrives inactive, with no credentials bound and no schedule running.

Start with `workflows/core/01-hubspot-community-signals.json`. Add the others
later; they are independent and share only the Notion database.

## 3. Fill in `Scout Setup`

Each workflow has one `Edit Fields` node named `Scout Setup`, immediately after
the trigger. Everything configurable lives there. Its keys per workflow are in
[workflow-reference.md](workflow-reference.md).

At minimum, paste your Notion database id into `notionDatabaseId`. Workflows
that email you also need `recipientEmail`.

Values that are empty or out of range are caught by a validation node that runs
before any external request and throws an error naming the field. You will not
burn an Anthropic call discovering that the database id was blank.

### Changing the feed list

`hubspotCommunityFeeds` on workflow 01 ships with three public HubSpot Community
feeds. You can replace them with other HubSpot Community RSS URLs. Each entry
must be:

- an absolute URL;
- `https`, not plain HTTP;
- on the HubSpot Community host exactly, so a subdomain or a lookalike is
  rejected;
- a path ending in `.rss`;
- free of an embedded username or password.

One bad entry fails the whole run before any request goes out. This is
deliberate: it means a typo cannot quietly point Scout at a different site. See
[source-policy.md](source-policy.md) for why the boundary is drawn there.

## 4. Run it manually first

Use n8n's manual execution with the schedule still off. Then open Notion and
look at what arrived. Check that:

- the `Name` matches the post you expected;
- `Warmth tier`, `Persona type`, `Track`, and `Next action` are filled;
- `Source URL` opens the right thread;
- the `Draft` text is something you would actually consider sending.

If the drafts read wrong, edit the system prompt inside `Build Claude Request`.
It is plain text in a Code node.

If rows arrive with `Status` set to `Needs review`, the model returned something
Scout could not parse. The row is preserved rather than dropped so you can see
what happened.

## 5. Review your execution-data settings before activating

Do this before you turn on a schedule, because it decides what your n8n instance
keeps.

n8n can store the inputs and outputs of every node in every execution. For Scout
that can include RSS post content, manual form submissions, the prompts and
responses exchanged with Anthropic, Notion rows, and Gmail notification data. It
is n8n behavior rather than something the workflows control, and the operator of
the instance decides the policy.

Decide two things:

1. **What gets saved.** n8n can save all executions, only failed ones, or none,
   and it treats manual runs separately. If you do not need successful runs kept,
   do not keep them.
2. **How old data gets pruned.** Enable pruning and set a maximum age and count,
   so anything you do keep expires on a schedule instead of accumulating.

Both are configurable for the whole instance and per workflow:

- [Manage execution data](https://docs.n8n.io/deploy/host-n8n/configure-n8n/scaling/manage-execution-data/)
  covers the instance-level environment variables, including
  `EXECUTIONS_DATA_SAVE_ON_SUCCESS`, `EXECUTIONS_DATA_SAVE_MANUAL_EXECUTIONS`,
  `EXECUTIONS_DATA_PRUNE`, and `EXECUTIONS_DATA_MAX_AGE`.
- [Configure workflow settings](https://docs.n8n.io/build/manage-workflows/configure-workflow-settings/)
  covers the per-workflow overrides, reachable from the workflow settings panel.

If you use n8n Cloud, the same choices are in workflow settings; retention on
your plan is set by the platform.

[architecture.md](architecture.md#storage-and-retention) lists what would be in
that stored data for each workflow.

## 6. Set the timezone, then the schedule

Every scheduled workflow ships with its workflow timezone pinned to `UTC`, so the
cron expression means one unambiguous thing regardless of where the instance
runs. Before activating:

1. Open workflow settings and change the timezone to yours.
2. Adjust the cron expression on the trigger if you want a different hour.
3. Activate.

Skipping step 1 means your "7am" run fires at whatever 7am UTC is where you are.

Default schedules:

| Workflow | Cron | Meaning |
| --- | --- | --- |
| 01 signals | `0 7 * * *` | daily, early |
| 03 stale nudge | `0 8 * * 1-5` | weekday mornings |
| 05 draft backfill | `30 7 * * *` | daily, after the signal run |
| 06 scorecard | `0 16 * * 5` | Friday afternoon |

Workflow 02 is triggered by its form. Workflow 04 polls Gmail hourly.

## 7. Keep the volume low

Scout ships with `maxPostsPerFeed: 5` and `batchSize: 5`. The default
configuration therefore makes three unauthenticated RSS requests per day and
processes at most 5 candidate posts per feed, so at most 15 candidates across
the three shipped feeds. Workflow 05 processes at most 5 rows per run. Each
candidate or row normally costs one model call, and up to three if the request
is retried.

**Five is a conservative shipping default.** It is not a verified volume, and
it is not a billing ceiling. Nothing has been observed running at 5: the single
recorded live run used `maxPostsPerFeed: 1` and `batchSize: 2`. The number was chosen to
be small enough that a first scheduled day cannot surprise you, not because it
was measured. Because the model nodes ship with `retryOnFail: true` and
`maxTries: 3`, neither setting bounds what you are billed; a provider-side usage
limit is the only reliable guard.

**On your first run, go lower still.** Set `maxPostsPerFeed` to `1` and
`batchSize` to `2`, run each workflow manually, and read what lands in Notion
before you raise either number or turn on a schedule.

Raising these numbers raises both your cost and your request volume against a
platform that did not ask to be polled harder.
[source-policy.md](source-policy.md) covers the reasoning.

## Costs

Workflow 01 processes at most `feed count` times `maxPostsPerFeed` candidate
items per run. Workflow 05 processes at most `batchSize` rows. Each item normally
produces one Anthropic request.

These are limits on logical items, not on API calls. `Classify (Claude)` and
`Draft (Claude)` ship with `retryOnFail: true` and `maxTries: 3`, so one item
whose request fails transiently can produce up to three attempts, each of which
may be billed. Multiply the item cap by three for the worst case.

So these settings control volume and do not guarantee a billing ceiling. The
reliable guard is external: set a usage limit or a spend alert in your Anthropic
account. Cost per run has not been measured here, so this repository quotes no
figure.

## Troubleshooting

| Symptom | Likely cause |
| --- | --- |
| `Scout Setup is not configured correctly` | A required field is empty or out of range. The error names it |
| Notion returns not found, token is valid | The database has not been shared with the integration |
| Notion rejects a property | A property name, type, or option does not match the schema exactly |
| No rows appear, no error | Every post was filtered out by `lookbackHours` or the keyword list, or already seen by the dedupe node |
| Rows arrive as `Needs review` | The model response could not be parsed. The row is kept on purpose |
| The stale digest never arrives | Nothing was stale. Scout sends no email when there is nothing to report |
| Workflow 04 stops matching | HubSpot changed its notification email format. Test with a forwarded notification |
