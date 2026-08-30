# The Notion signal map

Scout writes to Notion by property name. If a name, type, or option does not
match this page exactly, the write fails or the value is dropped. Build the
database from this table before importing any workflow.

## Create the database

1. In Notion, create a new database as a full page. Name it whatever you like;
   Scout never reads the database title.
2. Add every property below, with the exact name, type, and options.
3. Delete Notion's default `Tags` property if you do not want it. Extra
   properties are harmless. Scout only writes the ones it knows.

## Properties

Seventeen properties. Names are case-sensitive and space-sensitive.

| Property | Type | Required by Scout | Notes |
| --- | --- | --- | --- |
| `Name` | Title | Yes | Post title, person label, or manual signal name |
| `Company` | Rich text | No | Only ever filled from manual intake in this version |
| `Signal` | Rich text | Yes | Short source excerpt or your note, capped at 1,900 characters |
| `Evidence` | Rich text | No | Board name, or how the engagement was seen |
| `Warmth tier` | Select | Yes | See options below |
| `Pain area` | Multi-select | No | See options below |
| `Best angle` | Rich text | No | A human-readable reason to engage |
| `Draft` | Rich text | No | The suggested response, for you to review |
| `Persona type` | Select | Yes | See options below |
| `Track` | Select | Yes | See options below |
| `Source` | Select | Yes | Where the signal came from |
| `Source URL` | URL | No | The primary link for the signal |
| `LinkedIn URL` | URL | No | Manual intake only |
| `Next action` | Select | Yes | See options below |
| `Status` | Select | Yes | See options below |
| `Replied` | Checkbox | Yes | Defaults to unchecked |
| `Last touch` | Date | No | Set by you, or by the engagement sync |

`LinkedIn URL` exists so you can keep a profile link next to a signal you
recorded by hand. It is stored and never fetched. No workflow in this repository
reads it back out or requests it.

## Select and multi-select options

Create these options with exactly this spelling, including the parentheses and
the spaces around the slashes.

**`Warmth tier`** (Select)

- `Tier 1 (hot)`
- `Tier 2 (warm)`
- `Tier 3 (cool)`
- `Tier 4 (cold)`

**`Pain area`** (Multi-select)

- `Routing`
- `Lifecycle`
- `Dedupe`
- `Enrichment`
- `Data quality`
- `Reporting`

**`Persona type`** (Select)

- `ICP buyer`
- `ICP practitioner`
- `Partner / consultant`
- `Peer / networker`
- `Unknown`

**`Track`** (Select)

- `Sales (ICP)`
- `Connector`
- `Unknown`

**`Source`** (Select)

- `LinkedIn post`
- `LinkedIn people`
- `HubSpot Community`
- `Reddit`
- `Job posting`
- `Partner directory`
- `Referral`

These are labels for where a signal came from. Only `HubSpot Community` is ever
set automatically. The rest describe what you saw yourself, and Scout does not
fetch those platforms. See [source-policy.md](source-policy.md).

**`Next action`** (Select)

- `Comment`
- `DM`
- `Connect`
- `Monitor`
- `Ignore`

**`Status`** (Select)

- `New`
- `Engaged`
- `In conversation`
- `Scan/Demo`
- `Closed`
- `Needs review`

`Needs review` is what Scout writes when a model response could not be read. It
means the row is real but the classification is not trustworthy.

## No date-added property

The weekly scorecard counts new signals using the built-in Notion
creation time that every page already has. You do not need a separate date
property for it, and adding one will not be used.

## Connect the integration

Notion databases are private to the integration until you share them.

1. Create an internal integration in Notion's integration settings. Give it
   content read, update, and insert capability. It does not need user
   information.
2. Copy the integration's secret. It goes into an n8n credential, never into a
   workflow. See [setup.md](setup.md).
3. Open the database as a full page, open its connection menu, and add your
   integration as a connection. Without this step every request returns a
   not-found error even though the token is valid.

## Find the database id

Open the database as a full page and look at the URL. The database id is the
32-character segment after the workspace name and before the `?`. Notion also
accepts it with dashes.

That value goes into the `notionDatabaseId` field on the `Scout Setup` node of
each workflow you import. It is not a secret in the way a token is, but it does
identify your workspace, so treat it as private when sharing screenshots or
issue reports.

## When you change the schema

Scout writes property names as literal strings inside its Code nodes. Renaming a
property in Notion will not rename it in the workflow. If you rename `Best angle`
or add a tier, update the matching Code node and rerun `npm run check` so the
tests tell you what else moved.
