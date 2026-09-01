# Decision log

Why Scout is built the way it is. Each entry records the decision, the reason,
what was rejected, and what evidence exists, including where there is none yet.

Entries are append-only. When a decision changes, add a new entry rather than
editing the old one.

### 1. Scout ships as a separate product in its own repository

**Decision.** Scout is a standalone product with its own name, repository, and
documentation. It does not reference, depend on, or share a release cycle with
any other project.

**Why:** Scout solves one narrow problem, turning HubSpot Community questions
into prioritized RevOps follow-up, and its whole credibility rests on a source
boundary that is easy to state and easy to check. Bundling it into a larger
product would blur that boundary and force readers to work out which constraints
apply to which half.

**Rejected.** Shipping it as a module of a larger system. The source policy
would have become a footnote instead of the thing you read first.

**Evidence.** Enforced by a test asserting no cross-product reference appears in
any documentation file.

### 2. Notion is the only signal map backend in v0.1, and Anthropic the only model provider

**Decision.** Rows go to Notion. Classification and drafting go to Anthropic. The
model id is configurable per workflow; the providers are not. This is a choice
about where the signal map lives and says nothing about what the n8n runtime
retains; see entry 12 for that.

**Why:** A provider abstraction in a six-workflow n8n project buys nothing and
costs a lot. Every abstraction layer would have to be expressed as extra nodes on
a canvas, which is exactly where complexity is most expensive to read. One
concrete path that works is more useful than a configurable one that nobody has
run.

**Rejected.** A storage adapter pattern, an Airtable branch, and a
provider-selector node. All three were speculative.

**Evidence.** The setup key contract is asserted per workflow in the test suite.

### 3. HubSpot Community RSS is the only automated source

**Decision.** Automated discovery reads three HubSpot Community RSS feeds, once
a day, unauthenticated. Feed URLs are validated for scheme, exact host, `.rss`
path, and absence of embedded credentials before the first request.

**Why:** The platform publishes an RSS interface, and a low-volume unauthenticated
reader is the most defensible way to use it. Everything else, meaning logins,
profile pages, and general web fetching, trades a clear boundary for marginal
coverage. A
boundary that can be stated in one sentence and enforced in code is worth more
than breadth.

**Rejected.** A generic RSS input, which would have been one line of code and an
open-ended claim. Also rejected: following links out of a feed to fetch the full
thread.

**Evidence.** Ten tests cover the feed validator, including plain HTTP, a
foreign host, a subdomain, a suffix lookalike, a non-RSS path, and embedded
credentials. See [source-policy.md](source-policy.md).

### 4. LinkedIn is excluded in v0.1, but a manual LinkedIn label is kept

**Decision.** No automated LinkedIn ingestion in this version. The manual intake
form keeps LinkedIn source labels and a `LinkedIn URL` property that is stored
and never fetched. Entry 13 records the scope of the exclusion.

**Why:** LinkedIn's terms prohibit unapproved automated crawling and bot
activity, so an automated connector is ruled out on principle rather than on
effort. The manual label is a different thing: you saw something, you typed it
in, and Scout files it. Removing the label would have made the product worse
without making it safer.

**Rejected.** A "LinkedIn enrichment" step behind a disabled toggle. A disabled
feature is still a claim.

**Evidence.** Tests assert the label set and that no workflow reads
`LinkedIn URL` back out.

### 5. Configuration lives in a connected `Scout Setup` node

**Decision.** Every executable workflow has one `Edit Fields` node named
`Scout Setup` immediately after its trigger, and downstream nodes read it with
`$('Scout Setup').first().json`, instead of `$env`, `$vars`, or a separate
configuration workflow.

**Why:** A public template has to be configurable by someone who just clicked
import. Environment variables require instance access that many n8n users do not
have, and `$vars` is not available on every plan. One visible node with plain
fields is the only option that works everywhere and is obvious on the canvas.

**Rejected.** Environment variables, n8n variables, and a shared credential
holding configuration.

**Evidence.** A test asserts the exact setup key list, in order, for all six
workflows, and that `Scout Setup` passes incoming fields through so form and
email payloads survive it.

### 6. Live exports never enter public Git history

**Decision.** The private operational workflows are treated as read-only source
material. Each public workflow was rebuilt from a sanitized derivative in a
throwaway directory, scanned there, and only then copied into this repository.

**Why:** Sanitizing in place risks committing an intermediate state, and a
secret that reaches Git history is not removed by deleting it later. Keeping the
dirty step outside the repository means the repository never had the value to
begin with.

**Rejected.** Sanitizing inside the repository and relying on `.gitignore`, and
scrubbing after committing.

**Evidence.** The scanner runs on every workflow in `npm run check` and reports
zero findings. Private export checksums were recorded before and after each task
and are unchanged.

### 7. HTTP Request nodes were retained for Notion and Anthropic, replaced for Gmail

**Decision.** Notion and Anthropic are called through generic HTTP Request nodes
with HTTP Header Auth. Gmail uses n8n's built-in Gmail node with OAuth2.

**Why:** For Notion, the HTTP Request node lets one node handle both `PATCH` and
`POST` by expression, which is what makes the engagement sync a single write path
instead of a branch. For Anthropic, it pins the API version header explicitly and
keeps the request body visible and editable, which matters when the prompt is the
product. Gmail is the opposite case: OAuth2 is genuinely easier through the
native node and there is no request shape worth controlling.

**Rejected.** Native Notion nodes, which cannot express a dynamic method, and a
raw HTTP Gmail integration, which would have meant hand-rolling OAuth.

**Evidence.** Node types and authentication modes are asserted per workflow.

### 8. Notion page size stays at 100 and pagination is deferred

**Decision.** Every Notion query uses a page size of 100 and ignores
`next_cursor`. The limit is documented on the workflow canvas and in the
reference rather than hidden.

**Why:** Pagination in an n8n Code node means a loop node, a cursor variable, and
a termination condition on a canvas that is already twelve nodes wide. For a
board a single operator prunes, 100 open rows is a working ceiling. Building the
loop before anyone has hit the ceiling would be speculative complexity.

**Rejected.** A pagination loop, and silently truncating without saying so. The
second is worse than the limit itself.

**Evidence.** Documented in [workflow-reference.md](workflow-reference.md) and on
the relevant sticky notes. No test asserts behavior past 100 rows because the
behavior past 100 rows is "not implemented".

### 9. Drafts stay human-reviewed and no outreach is sent

**Decision.** Scout writes suggestions to Notion and digests to your own inbox.
Workflows 03 and 06 do send email, to the single operator address you configure
and to nobody else. No node in any workflow posts, comments, connects, or
messages anyone in the signal map.

**Why:** The value is triage, not volume. An automated sender would change the
source policy, the terms analysis, and the failure modes all at once, since a bad
draft stops being an edit and becomes a message someone received. Human review is
the feature, not a limitation waiting to be removed.

**Rejected.** An auto-comment path behind a confidence threshold. A threshold is
a guess about a model's self-assessment.

**Evidence.** A test asserts that no workflow contains a send-to-third-party
node, and that both model-failure paths write a review state rather than
inventing content.

### 10. Every verification claim carries its evidence, or says there is none

**Decision.** Claims about structure, safety, and Code node behavior are backed
by checks in this repository. Claims about import and live execution are marked
unverified until the corresponding check has actually run.

**Why:** The easiest way to lose a reader's trust is to say "tested" about
something that was never run. Splitting the claims by what has evidence behind
them costs one table in the README and makes every other claim worth believing.

**Rejected.** Claiming a readiness nobody had measured and sorting it out later.

**Evidence.** The README verification status table. Clean import into a fresh
n8n instance and live execution against Notion, Anthropic, and Gmail are not yet
verified, and the documentation says so in every place it would otherwise be
tempting to imply otherwise.

### 11. The repository shows all six workflows; an n8n template submission would lead with one hero workflow

**Decision.** This repository presents the complete six-workflow system. Any
future submission to the n8n template library leads with one hero workflow,
`Scout 01 | HubSpot Community Signals`, and points at this repository for the
other five. No submission has been made.

**Why:** The two audiences want different things. Someone reading the repository
wants to see the whole system, including the parts that only make sense together.
Someone browsing a template library wants one workflow that does one legible
thing on import. Workflow 01 is the only one that stands alone: it has its own
trigger, it needs no prior rows, and it produces a visible result on the first
run. Leading with the set would ask a browser to evaluate six imports before
getting a single outcome.

**Rejected.** Submitting all six as a bundle, and trimming the repository down to
the hero workflow so both surfaces match. The first buries the entry point; the
second throws away the system to make the packaging simpler.

**Evidence.** The README quickstart uses workflow 01 alone, end to end, and a
test asserts it does not depend on any other workflow. Whether the template
listing is accepted is unverified, because it has not been submitted.

### 12. Retention is documented as a shared responsibility, not claimed away

**Decision.** The documentation states plainly that Notion holds the durable
signal map, that the `Remove Duplicates` node keeps seen-post state inside n8n,
and that n8n may retain the inputs and outputs of every execution according to
the operator's execution-data settings. Operators are told to review execution
saving and pruning before activating anything, and the n8n documentation for
both is linked. This supersedes any earlier reading of entry 2 as a claim that
Notion holds everything and n8n holds nothing.

**Why:** Entry 2 chose Notion as the storage backend for the signal map, which is
a product decision. It says nothing about what the runtime keeps, and an earlier
draft of the documentation let those two ideas blur together into a claim that
Notion held everything. That was wrong in a way that matters: a reader
deciding whether to put someone else's post content, or their own typed notes
about a named person, through this system needs to know that the execution log
can hold all of it. Getting that wrong is worse than any feature gap in the
repository, because the reader cannot discover it by reading the workflows.

**Rejected.** A single sentence saying execution data "may be retained", with no
list of what that includes. Naming the categories is the part that changes what
an operator does.

**Evidence.** Tests assert that the storage explanation names all three
locations, that it lists the retained data categories, that it tells operators to
review saving and pruning, that it links the n8n execution-data documentation,
and that the superseded claims no longer appear in any file.

### 13. The LinkedIn exclusion is scoped to v0.1

**Decision.** In v0.1 there is no automated LinkedIn ingestion. Restating entry
4: this is a decision about this version, not a permanent architectural
exclusion. Any future automated source, LinkedIn included, must clear the same
two requirements as every other source: a first-party API or RSS interface
published by the platform for this kind of use, and a separate terms review for
that specific platform and request pattern.

**Why:** Entry 4 and the source policy originally wrote the exclusion as
permanent, ruling it out for all future versions. That overreached. The reason
LinkedIn is excluded is that its user agreement and
crawling terms prohibit unapproved automated activity and there is no published
interface that fits the boundary, which is a fact about the current situation and
the current terms. Writing it as permanent stated a prediction as a principle,
and left no honest route to reconsider if a suitable interface ever exists.

**Rejected.** Keeping the absolute wording because it sounds more reassuring. A
promise that outruns its own reasoning is not reassuring once someone checks it.

**Evidence.** A test asserts the source policy scopes the exclusion to v0.1, ties
any future source to the two requirements, and no longer contains the permanent
wording. Whether a suitable interface will exist is unverified and not predicted
here.

### 14. Third-party CI actions are pinned to commit SHAs, not tags

**Decision.** Every third-party GitHub Action in `.github/workflows/ci.yml` is
referenced by the immutable commit SHA of a release, with the human-readable tag
in a trailing comment. The SHAs in use, resolved from the GitHub API on
2026-08-28:

| Action | Release tag | Pinned commit SHA |
| --- | --- | --- |
| `actions/checkout` | `v7.0.1` | `3d3c42e5aac5ba805825da76410c181273ba90b1` |
| `actions/setup-node` | `v7.0.0` | `820762786026740c76f36085b0efc47a31fe5020` |
| `gitleaks/gitleaks-action` | `v3.0.0` | `e0c47f4f8be36e29cdc102c57e68cb5cbf0e8d1e` |

The gitleaks binary the action downloads is pinned separately, through
`GITLEAKS_VERSION: 8.30.1`, so a CI run and a local run apply the same rules.

**Why:** A Git tag is a movable pointer. Anyone who can push to the action's
repository can repoint `v7` at different code, and every workflow referencing
that tag executes it on the next run without any change landing in this
repository. A commit SHA cannot be repointed. This matters more than usual here
because CI runs against a repository whose entire claim is that it contains no
secrets: an action that has been swapped underneath us runs with access to the
checkout and the workflow token.

Pinning costs a manual bump to pick up a security fix. That is the trade, and it
is the right way round, because an unnoticed bump is worse than a late one.

**Rejected.** Major-version tags like `@v7`, which is the common convention and
gives exactly the mutability described above. Also rejected: `@main`, which is
the same problem without even a release behind it.

**Evidence.** Each SHA was resolved from the GitHub API for the named tag before
the workflow file was written, and the tag-to-SHA mapping is the table above.
Whether CI passes on GitHub is unverified: the repository has not been pushed and
no workflow run exists.

### 15. Two distinct secret scans, each with a mutation probe

**Decision.** Publication requires two separate gitleaks runs, not one:
`gitleaks dir` over the files currently on disk, and `gitleaks git` over the
reachable commit history. Each must be accompanied by a probe that proves it
fails when a secret is present. `.gitleaks.toml` extends the default rule set
and carries no `paths` allowlist and no whole-file exemption.

**Why:** The two scans fail differently and a pass on one says nothing about the
other. The directory scan reads what is on disk and cannot see a secret that was
committed and then deleted, which is the case that actually matters, because
deleting it is what someone does immediately after noticing. The history scan
reads the commits and cannot see an uncommitted credential sitting in a working
file. Neither substitutes for the other.

The directory scan does not honour `.gitignore`. That matters, because `.env`
and `.n8n/` are precisely where a real credential would sit, and it means a
single `gitleaks dir` run already covers them.

The probes exist because a scan that has never failed is not evidence that it
works; it is equally consistent with a misconfigured rule set matching nothing.
Each probe is chosen so that it can only pass for the right reason. The
directory probe deliberately leaves `.gitignore` in place and plants its value
inside an ignored path, because that is what demonstrates the scan reaches
ignored files unaided. The history probe commits a value and deletes it in a
later commit, so `gitleaks dir` passes and `gitleaks git` fails, which is the
one difference that justifies running the second scan at all.

Path allowlists were ruled out for the same reason. `workflows/`, `tests/`, and
`examples/` are where a leaked credential would land, so exempting them would
make a clean result meaningless. If a synthetic fixture ever trips a rule, the
fix is an allowlist on that one exact literal value. That rule is unchanged and
is not relaxed by anything below.

**Rejected.** A single working-tree scan, which was the original plan and would
have passed while missing the deleted-secret case. Also rejected: allowlisting
the fixture directories, which is the quickest way to make the scan quiet and
useless.

**Corrected on 2026-08-30.** This decision originally required *three* runs: the
working tree, a copy with `.gitignore` removed, and the history. The third run
rested on the belief that `gitleaks dir` honours `.gitignore`, so that a scan
respecting it could report clean while a token sat in an ignored path. That
belief was wrong. Measured directly against gitleaks `8.30.1`, the same planted
value inside an ignored path fails the scan whether `.gitignore` is present or
absent, and whether or not a Git directory is present. The
`.gitignore`-removed run is therefore a duplicate of the directory scan, not
coverage of a blind spot, and it is no longer required.

Nothing was weakened by the correction. The genuine blind spot, a secret
committed and later deleted, was always covered by the history scan and still
is. What changed is the count and the stated reason, not the coverage.

**Evidence.** The original three runs were executed and all exited zero: the
working tree, a throwaway copy with `.gitignore` removed, and nine commits of
history. All three probes ran in throwaway directories under `/private/tmp` with
values generated at probe time, and each produced a non-zero exit. That work
happened and is not withdrawn; only its third element is now known to be
redundant. The scans were run again at 27 commits and again exited zero. The
measurement that prompted this correction planted one generated value inside an
ignored path four ways, with and without `.gitignore`, with and without a Git
directory, and `gitleaks dir` exited non-zero in every case. The history probe
continues to show the contrast it was built to show: `gitleaks dir` exits zero
after the deletion while `gitleaks git` exits one. No mutation value was ever
written into this repository or its history. The current procedure is recorded
in [release-checklist.md](release-checklist.md).

### 16. Public exports carry no top-level workflow id, and the n8n CLI importer is left unsupported

**Decision.** Keep the safety scanner's rule that a public export must not have
a root `id`, even though this makes `n8n import:workflow` fail. Document the CLI
limitation and the one-line workaround instead of changing the files.

**Why:** A root id in an exported file is an identifier belonging to whichever
instance produced it, which is exactly the class of value these exports exist to
strip. Adding a fixed id back to satisfy the CLI would also make every published
copy of a template share one id, so importing the same template twice, or two
people importing into the same instance, would collide. n8n's own template
library ships workflows without a root id for the same reason.

The failure is narrow. `import:workflow` exists to re-import n8n's own
`export:workflow` output, which always has an id, and it does not generate one
when the field is missing. A running instance, by contrast, generates a fresh id
per import, so the missing field costs nothing on the path users take. The setup
path this project documents is *Import from File* in the Editor UI.

**Rejected.** Adding `id: stableTemplateId(workflowName)` to every export. It
would have made the CLI work and would have introduced a collision between
copies, weakened the scanner rule that catches real instance identifiers, and
solved a problem nobody importing a template has.

**Evidence.** All six workflows failed the CLI import with `NOT NULL constraint
failed: workflow_entity.id`, and a throwaway copy of workflow 01 with an id
added imported without error, isolating the missing field as the cause. A fresh
n8n `2.36.8` instance then accepted all six over `POST /rest/workflows`, and each
round-tripped with no drift in node names, types, parameters, connection counts,
or inactive state. That endpoint was a way to reach the instance under test, not
a recommended interface; browser interaction with the Editor UI was not
separately tested. Recorded in [live-verification.md](live-verification.md).

### 17. Scout parses URLs itself, because n8n's Code sandbox has no `URL`

**Decision.** Replace every `new URL(...)` call in the shipped Code nodes with
`parseHttpUrl`, a dependency-free parser inlined into each node, and stop the
test harness from providing a `URL` global that n8n does not.

**Why:** n8n `2.36.8` Code nodes run in a sandbox that does not define `URL` or
`URLSearchParams`. `new URL(...)` throws `ReferenceError: URL is not defined`.
Every call site had wrapped that constructor in `try/catch` to handle malformed
input, so the reference error was caught and reported as a bad URL. Valid
configuration was rejected as invalid, and nothing in the logs said why.

Four of the six workflows were affected, with three different failure shapes:

- Workflow 01 could not run at all. Every feed failed validation, so the run
  stopped before `Fetch RSS` on a correctly configured instance.
- Workflow 02 rejected any submission that carried a URL.
- Workflows 03 and 06 silently dropped every link from the digest emails.
  `safeHref` returned an empty string for all input, so the failure was
  invisible: no error, just no links.

The digest case failed closed rather than open, so no unsafe link was ever
rendered. That is luck about which direction the bug ran, not a mitigation.

A parser was chosen over the alternatives because Code nodes cannot import, and
n8n's sandbox offers no URL facility to fall back on. `parseHttpUrl` uses only
`String`, `RegExp` and `Number`, which were confirmed present by probing a live
`2.36.8` Code node. It accepts only absolute `http:` and `https:` URLs, rejects
whitespace, control characters and backslash authority confusion, separates
user information so workflow 01 can refuse embedded credentials, and keeps the
port distinct from the hostname so a lookalike cannot slip past an exact host
match. It accepts ASCII hosts only; an internationalised name would need
punycode conversion to compare safely, and Scout has no use for one.

**Why the tests did not catch it.** `scripts/lib/code-node-runner.mjs` injected
`URL` into its sandbox, reasoning that it is a parsing primitive rather than a
network primitive. The reasoning was sound and the premise was wrong: what
matters is not whether a global is safe, but whether n8n provides it. A harness
more capable than the runtime it stands in for will pass code that cannot run.
The global was removed, and the sandbox now asserts that `URL`,
`URLSearchParams`, `fetch`, `process`, `require` and `setTimeout` are all
absent, with a structural test that fails if any shipped Code node reaches for
`URL` again.

**Rejected.** Keeping `new URL` and documenting n8n as unsupported, which would
have shipped a hero workflow that cannot run. Also rejected: allowing the
harness to keep the global and testing the difference elsewhere, which leaves
the same gap open for the next runtime assumption.

**Evidence.** Found by the first Task 9 attempt, on a disposable n8n `2.36.8`
instance. That attempt stopped at the failure: no RSS feed was contacted, no
Anthropic request was made, and no Notion row was written or modified. A Code
node probe on that instance reported `typeof URL === 'undefined'` and
`ReferenceError: URL is not defined`. After the fix, on the same instance,
workflow 01 `Validate Setup` returned `validated: true` with three feeds,
workflow 02 stored a supplied URL unchanged and rejected malformed and
non-http input with its existing messages, and the `safeHref` from workflows 03
and 06 kept ordinary links while refusing script, relative and
backslash-confused values. Recorded in
[live-verification.md](live-verification.md).

### 18. Public defaults ship at 5, and non-sensitive numeric defaults may be edited directly

**Decision.** Ship `maxPostsPerFeed: 5` in workflow 01 and `batchSize: 5` in
workflow 05, down from 25. Keep the documented first run lower still, at
`maxPostsPerFeed: 1` and `batchSize: 2`.

**Why:** 25 is the wrong number to hand a stranger who is about to put Scout on
a schedule. At 25 across three feeds, a first scheduled day could classify 75
candidates before anyone has read a single row, and the retry policy means that
is not even the worst case. Five keeps the first surprise small.

No evidence supports any particular working value, including 25. Nobody has run
Scout at a sustained volume, so this entry recommends no number for later use.
Raising the cap is an operator judgement made with their own observed volume in
front of them.

**Five is a conservative shipping default, not a verified volume.** Nothing has
been observed running at 5. The one recorded live run used `maxPostsPerFeed: 1`
and `batchSize: 2`, which is the only volume anyone has watched. Five was chosen
to be defensible in the absence of measurement, not because measurement
supported it.

**It is also not a billing ceiling.** `Classify (Claude)` and `Draft (Claude)`
ship with `retryOnFail: true` and `maxTries: 3`, so both settings cap logical
items rather than API attempts. A provider-side usage limit is the only reliable
guard, and the documentation says so wherever a cap is mentioned near cost.

**Rejected.** Leaving both at 25 and relying on the reader to lower them, which
puts the cost of a bad default on the person least able to predict it.

Also rejected: shipping at 1. The reason is structural rather than aesthetic.
In workflow 01 the cap is applied in `Extract Posts`, which keeps the first N
qualifying posts per feed and stops, and `Dedupe Across Runs` runs **after** it.
So the cap selects candidates before anything knows which have been seen before.
On a busy feed a very low cap can fill its whole allowance with posts that
deduplication then removes, producing no new rows while genuinely new posts
further down the feed were already excluded by the cap. Five reduces how often
that happens without claiming to prevent it.

**On process.** These two numbers were changed by editing the public JSON
directly, rather than rebuilding through the private-to-public sanitization
boundary described in entry 6. That boundary exists to keep a half-sanitized
export out of Git history, and it protects nothing here: both files were already
public and already scanned, and the change is one numeric literal in each, with
no private source material involved.

**The rule this sets is deliberately narrow.** A direct edit is permitted only
for a **non-sensitive numeric default in an already-sanitized public artifact**,
and only when all of the following hold:

- the change is an exact, reviewable diff, limited to numeric literals;
- no private, operational, or source-derived material is involved at any point;
- the full gate passes afterwards: validator, scanner, the test suite, and all
  three secret scans with their mutation probes.

**Everything else still requires the sanitization boundary.** That includes any
change touching URLs, credentials, identifiers, recipient addresses, prompt
text, or any text derived from a private source; any change to workflow
structure, meaning nodes, connections, node parameters other than a numeric
default, or sticky-note content; and any change that refreshes content from a
private export.

The distinction is not effort but exposure. A numeric literal cannot carry
private material. Almost everything else in a workflow can.

The boundary itself is now release-process debt. It lived in a temporary
directory that has since been cleared, taking the six build scripts with it. It
should be rebuilt as a durable private mechanism before the next structural
maintenance. It does not block this v0.1 parameter change, but the next
structural one cannot proceed until it exists again.

**Evidence.** The workflow diff is two lines: `"value": 25` to `"value": 5` in
each file, with workflows 02, 03, 04, and 06 byte-identical. Tests assert both
shipped values, that each sits inside the range its own `Validate Setup` node
accepts, that the documentation calls five conservative rather than verified,
and that the first-run guidance still recommends lower numbers than the
defaults.

### 19. The sanitizer derives its own repository root, and local paths are now gated

**Decision.** Derive the repository root from the script's own location, replace
the CLI entry guard with a cross-platform comparison, and add a standing gate
that rejects user-specific absolute home paths in tracked files and in history.

**Why:** The defect was correctness, not privacy. `scripts/sanitize-export.mjs`
pinned the repository root to one absolute path. That path is where the
pre-write safety gate got its answer to "is this output landing inside the
public repository?", and the gate is what runs `scanWorkflow` and the metadata
validation before anything is written.

In the checkout the path named, everything worked. In any other checkout, a
clone, a second working tree, a contributor's machine, a CI runner, the
comparison was false for every output path. Sanitization still happened, but the
extra safety pass was skipped, and unscanned output could be written straight
into that working tree. The tool was least careful exactly where it was least
familiar.

**A second failure could hide the first.** The entry guard compared
`import.meta.url` against a hand-built `file://` string. That comparison breaks
when the checkout path contains a space, when the script is reached through a
symlink, and on Windows. The failure mode is the worst kind: exit 0, no output,
no error. A caller could believe sanitization had run when nothing had.

**The gates did not cover this class.** The secret scans looked for credentials
and correctly found none, because there were none. Nothing looked for a
machine-specific absolute path, so nothing objected.

**What was exposed, precisely.** The constant reached a public repository for a
short window. It contained a username that is already public, since it matches
the account that owns the repository and the commit author address, and one
local directory name. It contained no credential, no token, no private source
path, no Notion or workspace identifier, and no private export content. The
private source directory never appeared anywhere in the tree or the history.

**The historical object is known and accepted, and the history is not clean.**
One blob at one path carries the old constant. The gate pins that exact pair and
accepts nothing else: the same blob committed at a second path fails, as does
any other occurrence, including a future version of the same file. There is no
path, directory, commit-range, or pattern allowlist.

Making that true required walking every reachable commit tree and
deduplicating exact (blob, path) pairs. The first implementation used
`git rev-list --objects`, which prints one path per object, whichever it walked
first. Under that enumeration a blob accepted at one path was invisible at every
other path it had ever been committed to, which would have turned a pair pin
into a content-based exemption without anyone noticing.

The full-depth form additionally requires the accepted pair to be reachable. A
shallow clone walks almost no history, finds nothing, and would otherwise report
success, making the strictest gate the easiest one to pass by accident. The
ordinary developer and CI check does not walk history at all, so it still works
in a depth-one clone.

The history was preserved rather than rewritten. Rewriting would invalidate the
reviewed commit and every hash in the evidence trail, and it would not guarantee
erasure: clones, forks, and caches keep what they already have. Trading a
verifiable record for an unverifiable cleanup is a bad exchange for a value that
is not secret.

**No such rule existed before.** This repository had no zero-local-path
requirement until now. The gate is new, and its historical pin exists precisely
because the rule is being applied to a history that predates it.

**Rejected.** Reading the root from `process.cwd()`, which would have made the
gate depend on where the caller happened to stand. An environment variable or
configuration flag, which would have made the safety gate opt-out. Rewriting
history, for the reasons above.

**The tree check reads the index as well as the working copy.** The staged copy
is what becomes the commit, and the two can differ: editing a path out of a file
after staging it leaves the finding in the index, where a working-tree-only scan
sees nothing. Windows matching is case-insensitive, because Windows paths are.

**Evidence.** Eleven process-level CLI tests cover refusal inside an arbitrary
checkout, refusal from an unrelated working directory, the throwaway authoring
boundary still working, a prefix-lookalike sibling directory, path
normalization, a symlinked checkout alias, invocation through a symlink and
through a path containing spaces, safe output succeeding, and a controlled exit
1 with no stack trace when the output directory is missing. Replacing the script
with the old version fails ten of the eleven. Ten further tests probe the
local-path gate on all four platform shapes, prove portable references such as
`~/`, `/tmp`, and `/private/tmp` still pass, prove a value committed and then
deleted still fails the history check, prove the accepted pair does not hide an
unrelated occurrence, prove the accepted blob committed at a second path and
later removed still fails while the legitimate pair stays accepted, prove a
finding staged and then edited out of the working copy still fails through the
index, cover upper, lower, and mixed case Windows spellings, and prove the
strict form fails when the accepted pair is unreachable.

**In this repository there is no exception.** The paragraphs above describe what
was decided in the private development archive, and they remain an accurate
record of it: that archive's history did contain the object, and rewriting the
history to remove it would have invalidated a reviewed commit and every hash in
its evidence trail. This repository is not that archive. It begins at a single
commit whose tree was gated before the commit existed, so there is nothing to
except, the pin has been removed, and the strict history gate now requires zero
accepted exceptions alongside a non-shallow repository and zero findings. The
zero-exception requirement is the part that matters going forward: it fails if
an allowlist is ever reintroduced. See entry 21.

### 20. Private exact values are checked from outside the repository, never listed inside it

**Decision.** No repository that could become public may contain a list of
private operational values, not even as the input to a test that exists to keep
them out. Public repositories get structural checks: shapes, positive contracts,
and derivations that can be recomputed. Exact private values are checked by
`scripts/scan-private-markers.mjs`, which takes the list as a runtime path,
reports only positions and counts, and is run against a fresh clone before any
publication. The list itself lives outside every Git repository involved.

**Why:** A test here held twelve private operational values as string literals
so it could assert they never appeared in the documentation. It published
exactly what it existed to keep out. The failure is structural, not careless: a
denylist of real values has to contain those values, so putting one inside the
artifact it protects can only ever move the exposure rather than prevent it.

The same test was also narrower than it looked. It scanned a hand-listed set of
prose files, so it never read the test files, which is where the values were.
A gate that maintains its own list of what to look at will eventually stop
looking at the place that matters.

**The marker classes**, without values: one instance-issued workflow
identifier; four credential identifiers in the shape the automation platform
issues; three credential display names; one account handle; one unrelated
business name; one internal classification label; one third-party platform name.
Twelve in total.

**Where they were.** Two files, and only two. All twelve entered
`tests/docs.test.mjs` at the seventh commit and are present in twenty-two of the
twenty-eight commits. Two of them entered `tests/workflows.test.mjs` at the
fourth commit and are present in twenty-five. Twenty-four historical blobs carry
at least one. No workflow JSON, fixture, documentation file, script, commit
message, or tag annotation has ever contained one, and neither has the release
body.

**What replaced them.** `tests/tree-hygiene.test.mjs` reads every tracked text
file from `git ls-files` rather than a maintained list, and checks shapes:
credential-token prefixes, credentials blocks, absolute home paths, email
addresses, external hosts, platform-issued identifier shapes, and derived
identifiers. Where a positive contract is possible it is used instead of a
negative one, because a positive contract needs no examples of what is
forbidden. Every setup key set and every Notion property set is asserted as an
exact set, so an unexpected key fails without any test naming a forbidden key.
Identifiers in shipped workflows are recomputed from the sanitizer rather than
pattern-matched, which is a stronger statement than checking a version nibble.

Patterns and negative fixtures are assembled from fragments at run time, the
same technique `scripts/check-local-paths.mjs` uses, so the test source ships no
literal that looks live.

**A guard on the guard.** Three tests make the old shape hard to reintroduce:
one rejects an array of several opaque high-entropy literals inside a test file,
one rejects a binding named like a denylist, and one asserts the scanner carries
no embedded list. They can be worked around by someone determined to, but not
by accident, which is how this happened the first time.

**Rejected.** Rewriting history to remove the values. It would invalidate the
reviewed commit, the tag, and every hash in the evidence trail, and it cannot
retract anything already fetched. Also rejected: keeping the denylist and adding
the test file to the scanned set, which fixes the coverage gap and leaves the
values in place.

**The development history stays private.** Twenty-four blobs across
twenty-eight commits carry at least one value, so this archive is not publishable
and is not described as clean. It remains a private archive. Its CI, its tag,
and its release stay as they are.

**A public repository will begin from a clean snapshot** rather than from this
history, because a snapshot is the only way to publish the work without either
publishing the values or rewriting the record of how it was built. That snapshot
will derive from this archive's final tree with one narrowly reviewed
release-tooling adjustment, so it will not be tree-hash identical, and it will
be described that way rather than as a copy.

**Evidence.** The corrected tree scans clean against the real list: fifty-two
tracked files, twenty-eight commit messages, one annotated tag, zero findings.
The same list against this archive's history returns twenty-four findings across
those two paths, which is evidence the scanner reaches history rather than a
release pass. The list was read from a file outside every repository, held at
owner-only permissions, identified by digest, and deleted afterwards. No value
appears in this entry, in any test, in any commit message, or in any report.

### 21. This repository begins at a clean v0.1 snapshot, not at the development history

**Decision.** The public repository starts from a single commit containing the
reviewed v0.1 tree. The development history stays in a private archive,
`scottcollier10/scout-archive-2026-08`, and is not published.

**Why:** Pre-release test files carried a list of private operational values as
string literals, so that a test could assert they never appeared in the
documentation. Twenty-four historical blobs across two test paths hold at least
one. The current tree is clean, but a Git history is not a current tree: every
one of those blobs is reachable from any clone of that history.

Three options, and only one of them is honest. Publishing the archive publishes
the values. Rewriting its history to remove them invalidates a reviewed commit
and every hash in its evidence trail, and cannot retract anything already
fetched by anyone. Starting the public repository from a clean snapshot
publishes the work without publishing either the values or a falsified record of
how it was built.

The cost is real and is not hidden: this repository has no development history.
Anyone reading it sees one commit. The record of how Scout was built exists, it
is simply private, and the reports that describe it name the archive by its
actual repository name so the trail is followable by whoever has access.

**What this repository is.** Every product file derives from the archive's final
reviewed commit: all six workflow JSON files, every script apart from the
release tooling named below, every fixture, every asset, and every document
apart from those named below are byte-identical to it.

**What differs, and only this.** Release tooling and the documentation that
describes it:

- `scripts/check-local-paths.mjs`, with the accepted historical exception and
  its mechanism removed
- `.github/workflows/ci.yml`, invoking the renamed strict flag
- `tests/local-path-gate.test.mjs`, proving the new contract
- `docs/release-checklist.md`, section 2a and 2b current-state language
- `docs/decision-log.md`, this entry and the amendment to entry 19

**This snapshot is not tree-hash identical to the archive** and must not be
described as a copy. Those five files differ on purpose.

**Rejected.** Publishing the archive as it stands, which publishes the values.
Rewriting its history, which destroys the evidence trail without retracting
anything. Keeping the archive's accepted historical exception here, which would
carry a mechanism this repository has no use for and leave a door open for an
allowlist to reappear behind.

**Evidence.** The archive's final tree was exported at the tracked-object level
and every file confirmed byte-identical before any change was made. The
difference between archive and snapshot was then enumerated file by file and
confirmed to be exactly the five paths above. The private value list is checked
by `scripts/scan-private-markers.mjs` against a list held outside every
repository; this repository's paths, blobs, history, commit object, tags, and
refs all return zero. No private value appears in this repository, in this
entry, or in its commit message.

### 22. Public-only sticky notes may use a throwaway authoring route

**Decision.** Newly written public sticky-note text may be changed without a
private export when the work happens in a throwaway copy outside this
repository, passes through `scripts/sanitize-export.mjs`, and returns as a diff
confined to sticky-note nodes. This is an extension of entry 18 for one class of
public documentation, not a general structural-edit exception.

**Why:** The n8n Creator rules changed after v0.1.0 was prepared. Workflow 01
needed one yellow overview containing `How it works` and `Setup`, plus short
neutral section notes grouping its executable nodes. The existing notes did not
meet that contract. None of the replacement text comes from an operational
workflow, a live service, or a private export, so involving the private source
would add exposure without adding evidence.

The route is allowed only when all of these controls hold:

- no private export, credential, identifier, live value, source-derived text,
  or private marker value enters the authoring input or diff, and the authoring
  process never reads the external marker list;
- authoring happens in a disposable copy outside the public working tree;
- the edited workflow passes through the public sanitizer, which regenerates
  every deterministic node id;
- the diff is confined to sticky-note nodes, while executable nodes,
  connections, settings, activation state, pin data, tags, and workflow name
  remain byte-identical to v0.1.0;
- existing sticky-note tests are updated in the same reviewed change and a
  Workflow 01-specific test encodes the current Creator overview, section,
  color, heading, and word-count rules;
- the full test, validation, scanner, path, history, marker, and secret-scan
  gates pass without a waiver, including their mutation probes;
- the post-commit marker gate is a separate verification boundary: only the
  scanner may load the owner-only external list, it prints no value or fragment,
  records only its count and SHA-256 plus scope totals, and the list is removed
  by exact path immediately after the fresh-clone scan;
- the changed file is accepted by a disposable n8n `2.36.8` instance and the
  workflow screenshot is recaptured from that inactive, credential-free copy;
- previously observed live behavior is not re-dated or presented as rerun;
  it carries forward only because the executable graph is unchanged;
- the patch is released as v0.1.1 and the v0.1.0 tag and Release remain
  immutable.

**The existing debt remains.** Any private-sourced refresh or change to an
executable node, connection, prompt, URL, credential reference, recipient,
identifier, or non-sticky workflow parameter still requires a durable
private-to-public authoring mechanism. This decision neither rebuilds that
mechanism nor makes its absence acceptable for those changes.

**Evidence.** The v0.1.1 test suite pins a SHA-256 digest of Workflow 01's
executable nodes, connections, settings, and root runtime state as serialized
in v0.1.0. A second test enforces the Creator sticky-note contract on Workflow
01 only. The changelog and live-verification record distinguish carried-forward
behavioral evidence from the fresh import and visual checks performed on the
documentation-only patch.

### 23. Creator notes sit above the graph instead of behind it

**Decision.** Workflow 01's four section notes sit in a separate row above the
executable nodes. The overview sits in its own row above the section notes. No
sticky note is used as a background container for executable nodes.

**Why:** n8n Creator review on the latest renderer treated the v0.1.1 section
notes as overlapping the nodes they grouped. The layout was intentional, but
the visual convention was ambiguous to a reviewer and harder to scan than a
strictly separated diagram. Moving the notes above the graph keeps the same
explanation while removing the ambiguity.

This is a layout-only correction under decision 22. The patch changes only the
five public sticky notes and the screenshot. Workflow 01's executable graph
keeps the canonical digest
`9167e959995a78666455984a90c9959fb1d825206502fa4aa6cb3a9f00ecd4f0`.
No executable node, connection, setting, prompt, credential binding,
activation state, pin data, tag, or workflow name changed.

**Evidence.** A new geometry test rejects note-to-note and note-to-node
intersections with conservative node bounds. The corrected file was imported
through the n8n `2.36.9` Editor UI. Rendered DOM measurements showed every note
fully visible and every pair separated, and the canvas was then inspected and
recaptured from that inactive, credential-free copy.
