# Fixtures

Every file in `fixtures/` is synthetic. They were written by hand to exercise
specific paths through the workflows' Code nodes. They are entirely fictional:
no real person, company, handle, URL, or Notion id appears in any of them.

The tests in `tests/workflows.test.mjs` run the actual Code node source from the
shipped workflow JSON against these inputs, so a behavior change in a workflow
shows up as a test failure rather than a surprise in production.

Dates are anchored to `2026-08-26T12:00:00Z`, which the tests pin as "now".

## The files

**`community-post.json`** is an RSS feed response shaped like what `Parse XML`
hands to `Extract Posts`. Contains one post that mentions a RevOps pain and one
that does not, so the keyword pre-filter is exercised in both directions, plus a
post outside the lookback window.

**`anthropic-relevant.json`** is an Anthropic Messages response whose content
block holds the JSON verdict for a qualified post. Drives the happy path through
`Parse + Map to Notion`.

**`anthropic-irrelevant.json`** is the same shape, for a post the model rejects.
Confirms Scout writes nothing rather than filing a low-quality row.

**`expected-notion-record.json`** is the exact Notion page body the relevant
fixture should produce. Asserted field by field, so a silent mapping change
fails.

**`manual-signal.json`** is a form submission as workflow 02 receives it after
the `Capture Form` trigger. Field names match the form labels exactly.

**`notion-open-signals.json`** is a Notion database query response with seven
rows, used by workflows 03, 05, and 06. It deliberately includes rows the live
Notion filter would have excluded, an `Ignore` row and a `Closed` row, so the
workflows' own guards are exercised rather than assumed. One row has a hostile
name and a `javascript:` URL so HTML escaping and link filtering are covered.

## Writing a new one

Keep them fake, keep them obviously fake, and make each one earn its place by
covering a path nothing else covers. `page-001` is a better id than something
that looks real. `example.com` is the right host for a fake link.

Add a `description` field at the top of the file saying what shape it imitates
and which path it exercises. Every fixture here has one.

Include at least one hostile value if the fixture feeds an email or HTML path.
Escaping only stays correct while something is trying to break it.
