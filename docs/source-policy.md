# Source policy

What Scout is allowed to read, why the line is drawn there, and what is your
responsibility rather than Scout's.

**This is product guidance, not legal advice.**

## The rule

The automated v0.1 source is HubSpot Community RSS only.

Scout reads three HubSpot Community RSS feeds, once a day, without logging in.
That is the entire automated surface. There is no second connector, no browser
automation, and no general-purpose feed reader hiding behind a configuration
flag.

The feed list is validated before the first request. Every entry must be an
absolute https URL on the HubSpot Community host exactly, with a path ending in
`.rss` and no embedded username or password. A subdomain, a lookalike host, a
plain HTTP URL, or a non-RSS path fails the whole run before anything is
fetched. This is enforced in code, not just documented.

## What Scout does not do

- It does not log in to the community or hold a session.
- It does not crawl member profiles.
- It does not extract email addresses. Workflow 04 actively strips any address it
  finds in a notification before storing anything.
- It does not automate community engagement. No workflow posts, comments,
  connects, or sends a direct message.
- It does not store full copies of posts. What lands in Notion is a short derived
  signal (a truncated excerpt, a classification, a suggested angle) plus a link
  back to the original.
- It does not follow links out of a feed to fetch anything else.

## Why the boundary is here

HubSpot Community publishes a visible `Subscribe to RSS Feed` interface on its
boards. Scout uses that interface the way a feed reader would: a small number of
low-frequency, unauthenticated GET requests on a schedule you control.

RSS being published is a technical interface. It is not blanket permission for
any downstream reuse, and it does not override the platform's terms. HubSpot's
terms still restrict excessive automated requests and collecting information
about other people. This is not a legal clearance, and this repository does not
claim one. It is a conservative product decision: stay low-volume, stay
unauthenticated, stay off profiles, and keep a human in the loop.

If you raise `maxPostsPerFeed`, add feeds, or shorten the schedule, you are
changing the request profile that this reasoning rests on. That is your call to
make and your responsibility to justify.

## Your responsibilities

You are responsible for the rules that apply to your use:

- the platform terms of every service you point Scout at;
- privacy and data-protection rules covering what you store about people, and
  for how long;
- the outreach and anti-spam rules covering anything you send after reading a
  Scout draft;
- your own organisation's policies.

Scout hands you a suggestion. Everything after that is a human decision you own.

Relevant terms, current at the time of writing:

- HubSpot website terms of use: https://legal.hubspot.com/website-terms-of-use
- HubSpot Community terms of use: https://legal.hubspot.com/community-tou
- LinkedIn crawling terms: https://www.linkedin.com/legal/crawling-terms
- LinkedIn user agreement: https://www.linkedin.com/legal/user-agreement

Terms change. Check them yourself rather than trusting this page.

## LinkedIn

**In v0.1, LinkedIn automated ingestion is not supported.** No workflow in this
repository fetches, polls, crawls, or retrieves anything from LinkedIn.

LinkedIn's user agreement and crawling terms prohibit unapproved automated
crawling, scraping, and bot activity. No automated LinkedIn connector fits inside
the boundary described above, so the feature does not exist here.

This is a decision about v0.1, not a permanent architectural exclusion. Any
future automated source, LinkedIn included, would have to clear the same two
requirements as every other source: a suitable first-party API or RSS interface
published by the platform for this kind of use, and a separate terms review for
that specific platform and request pattern. Without both, it does not ship. See
[Adding a source later](#adding-a-source-later).

What does exist today is a place to record something you saw yourself.

## Manual source labels are user-supplied

Workflow 02 is a form. You type into it. Its `Source` dropdown offers:

- `LinkedIn post`
- `LinkedIn people`
- `HubSpot Community`
- `Reddit`
- `Job posting`
- `Partner directory`
- `Referral`

These are labels describing where **you** saw something. A label is not a
connector. Scout does not fetch, poll, or retrieve any of those platforms, and
selecting `Reddit` does not cause a request to Reddit.

The same applies to the `LinkedIn URL` property. You can paste a profile link
next to a signal so it is there when you come back to it. Scout stores that
string and never fetches it. No workflow reads it back out.

## Adding a source later

A future connector needs two things before it is written:

1. A first-party API or RSS interface published by the platform for this kind of
   use. Not an undocumented endpoint, not a page parser, not a headless browser.
2. A separate terms review for that specific platform and that specific request
   pattern, recorded in [decision-log.md](decision-log.md).

Both, or it does not ship.

### Scope, and what could carry over

Scout v0.1 supports HubSpot Community RSS and a RevOps signal schema, on
purpose. It is not a generic scraper and does not claim support for other
communities. What could carry over to another source is the shape of the system,
not its code: intake, qualification, signal mapping, and human-reviewed action.
A source such as GitHub issues or n8n community discussions would need its own
workflow, its own parsing and validation, and its own access-policy review
before anything is written.

## What lands in Notion

For a community post: the title, a truncated excerpt of the body, the board
name, the public author handle as shown in the feed, the link, and Scout's own
derived fields, meaning tier, persona, track, pain area, angle, next action, and
draft.

For an engagement notification: the public display name and the topic URL, and
nothing else. The notification subject, snippet, body, Gmail message id, and
sender address are read to find those two values and are then discarded before
any Notion request is built. When no display name can be read, the row is named
`HubSpot Community participant` rather than falling back to the subject line,
and the signal text is a fixed phrase rather than a quote from the mail.

For a manual row: the fields you submitted, meaning the name, company, source
label, URL, and note, plus Scout's own derived fields, meaning tier, persona,
track, pain area, angle, next action, and draft. A manual row is not only what
you typed. Your note is sent to Anthropic for classification and what comes back
is stored alongside it.

That is the whole Notion record, and deleting a row deletes it. Notion is not
the only thing holding data, though. n8n keeps deduplication state, and depending
on your instance's execution-data settings it may also keep the inputs and
outputs of each run. Read
[Storage and retention](architecture.md#storage-and-retention) and set your
execution saving and pruning policy before you activate anything.
