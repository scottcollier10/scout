# Security

## Reporting something sensitive

Do not open a public issue for a security problem, and do not describe it
publicly before it is fixed.

Use GitHub's private vulnerability reporting on this repository. It creates a
private thread visible only to maintainers, and it is the right channel for
anything involving a leaked value, an injection path, or data reaching somewhere
it should not.

When you report, include what you would put in a normal issue (the file, the
node, and what happens) and nothing more. Do not include a real token, a real
export, or an execution log, even in a private report. Describe the shape of the
value rather than sending it.

## What is in this repository

The workflow exports contain no credentials. They ship inactive, with no
credential bindings, no instance metadata, and no pinned data. Credentials stay
in n8n's own credential store at run time.

Two checks run in `npm run check`:

- `npm run validate` checks structure: node types, connections, setup contract.
- `npm run scan` looks for material that should never be in a public export:
  token shapes, high-entropy strings, credential blocks, instance identifiers,
  private hostnames, and email addresses.

The scanner is a safety net, not a proof. It looks for known shapes, so a value
in an unexpected shape can pass it. Treat a clean scan as one check that passed,
and still read the diff.

## Threat model

Scout runs inside your own n8n instance and talks to four services. Things worth
knowing:

- **Model output is untrusted.** The classifier is asked for JSON and can return
  anything. Both parsing paths handle an unreadable response by writing a review
  state or leaving the row unchanged. Neither invents content.
- **Notion content is untrusted.** Post titles and angles originate with other
  people. Every value interpolated into a digest email is HTML-escaped, and only
  `http` and `https` URLs become links, so a `javascript:` URL renders as inert
  text.
- **Feed URLs are untrusted configuration.** The signal workflow validates every
  feed entry for scheme, exact host, `.rss` path, and absence of embedded
  credentials before the first request, so a typo cannot redirect the run to
  another host.
- **The form trigger is open by default.** Workflow 02 accepts submissions from
  anyone who has its URL. Put it behind n8n's form authentication before sharing
  it.
- **Email goes to one configured address.** Digest recipients are validated
  before Gmail is asked to send.

## What is outside the model

- The security of your n8n instance, its credentials, and its network.
- Your Notion workspace permissions and who else can read the signal map.
- Anything you do after reading a draft.

## Supported versions

This is pre-release. Only the current state of the default branch is supported.
