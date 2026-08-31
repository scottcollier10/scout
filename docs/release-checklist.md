# Release checklist

Everything that has to be true before Scout is published, and how each item is
checked. An item is not done because it looks right. It is done because a
command exited zero, or because a probe proved the command would have exited
non-zero if it were wrong.

Publishing to GitHub and submitting to the n8n template library are manual
approval gates at the end. Nothing in this checklist performs either.

## Two kinds of item

**Release gates** must be checked before publication. Every security, privacy,
import, source-policy, and secret-scan item is a gate. None of them may be
waived, and nothing below softens one.

**Accepted limitations** are things v0.1 does not verify. An unchecked box in
this class is not a blocker, but it is only acceptable when two conditions hold:
the limitation is disclosed in the README, the changelog, and
[live-verification.md](live-verification.md), and Scott has explicitly accepted
it. They are listed in their own section at the end, so an unchecked box in
sections 1 to 5 always means work is outstanding.

## 1. The six workflows are safe to publish

- [ ] `npm run scan` reports zero errors and zero warnings for all six JSON
      files.
- [ ] `npm run validate` reports zero errors and zero warnings for all six.
- [ ] No private export entered Git history. The six live exports in the private
      Scout folder are read-only source material; the public files were rebuilt
      from sanitized derivatives in a throwaway directory outside this
      repository. Confirm with a full-history scan, below, and by checking that
      the private export checksums are unchanged.
- [ ] Every workflow has `active: false`.
- [ ] No workflow carries a `credentials` block. n8n resolves credentials at run
      time from its own store.
- [ ] Every node id is a deterministic public template id derived from the
      workflow and node name, not an id copied from a live instance.
- [ ] No sticky note contains a URL.
- [ ] Workflow 01 has exactly one yellow overview of 100 to 300 words with
      `How it works` and `Setup`, followed by neutral section notes under 50
      words that group its executable nodes.
- [ ] For v0.1.1, the serialized executable nodes, connections, settings,
      activation state, pin data, tags, and workflow name match the pinned
      v0.1.0 digest. The workflow diff is confined to sticky-note nodes.
- [ ] All fixture and example content is synthetic. No real person, company,
      post, or address appears in `tests/` or `examples/`.
- [ ] Structural coverage reads every tracked text file from `git ls-files`,
      not a maintained list of prose files. `tests/tree-hygiene.test.mjs` owns
      this, and it checks itself along with everything else.

## 2. The two secret scans are clean

Two scans, and they are genuinely different. One reads what is on disk now, the
other reads what the commits contain. A pass on one says nothing about the
other.

- [ ] **Directory.** `gitleaks dir . --config .gitleaks.toml --redact` exits
      zero. It reads the files currently on disk, and it does not honour
      `.gitignore`: `.env` and `.n8n/` are scanned even though Git ignores them,
      which is exactly where a real credential would sit.
- [ ] **History.** `gitleaks git . --config .gitleaks.toml --redact` exits zero
      across every reachable commit. A secret that was committed and then
      deleted is invisible to the directory scan and still public forever.
      Deleting it is what someone does immediately after noticing, so this is
      the case that actually matters.

A third run against a copy with `.gitignore` removed is **not** required. It was
part of the original procedure and was later measured against gitleaks
`8.30.1`: the directory scan reaches ignored paths whether `.gitignore` is
present or not, so removing the file adds no coverage. The reasoning is in
[decision-log.md](decision-log.md) entry 15.

## 2a. No private operational value reaches a public artifact

The two scans above look for credential shapes. They do not know Scott's
account handle, an instance-issued workflow id, or a credential display name,
and no public rule could without listing them.

That list is checked separately, from outside. `scripts/scan-private-markers.mjs`
takes the marker file as a runtime path, reports only positions and counts, and
never prints a value, a fragment, or a matching line.

- [ ] **The marker file lives outside every Git repository** that could become
      public, at owner-only permissions. It is never committed to `scout-oss`,
      to the launch workspace, or to a public repository, and never pasted into
      a report, a commit message, or a test.
- [ ] **Run it against a fresh clone**, not the working directory, so what is
      checked is what was published:
      `node scripts/scan-private-markers.mjs --markers <path> --repo <fresh clone>`
      with all four scopes, covering the tracked tree, every blob in every
      reachable commit, every commit message, and every annotated tag.
- [ ] It exits zero. A non-zero exit blocks publication and is not waived.
- [ ] Record the marker-file SHA-256 and the counts. Record nothing else.
- [ ] Remove the marker file and its directory by exact path afterwards, and
      confirm no copy remains.
- [ ] Mutation probes pass: a synthetic value generated at probe time is found
      in a tracked file, in a blob after the file is deleted in a later commit,
      in a commit message, and in an annotated tag, and the scanner's output
      contains no fragment of it.

**This repository is the clean public snapshot,** not the private development
archive it derives from. That archive is `scottcollier10/scout-archive-2026-08`,
it is private, and it stays private: twenty-four of its historical blobs carry
at least one marker across two test paths, so its history is not clean and is
not described as clean. This repository begins at one commit whose tree was
gated before it existed, so this gate is expected to pass here and to keep
passing.

## 2b. No user-specific absolute home paths

Secrets are not the only thing that should not be published. A machine-specific
absolute path pins behaviour to one checkout and puts a username and directory
layout into a public tree.

- [ ] **Current tree.** `npm run paths` exits zero. It reads every tracked file
      from the working tree, so it sees what is about to be committed rather
      than what was committed last time.
- [ ] **Current index.** The same command reads the staged copy of every
      tracked file as well as the working copy. The staged copy is what becomes
      the commit, and the two can differ.
- [ ] **History.** `npm run paths:history` exits zero. It walks every reachable
      commit tree and deduplicates exact (blob, path) pairs, rather than
      trusting the single path `git rev-list --objects` happens to print.
- [ ] **There is no accepted exception, and no mechanism for one.** The strict
      form requires three things together: the repository is not shallow, there
      are zero findings, and there are zero accepted exceptions. The third is
      not vestigial. It fails if an allowlist is ever reintroduced, which is how
      a clean history quietly stops being one. There is no path, directory,
      commit-range, blob, or pattern allowlist anywhere in the gate.
- [ ] That command runs in the full-depth job. A shallow clone fails rather than
      reporting success, because a shallow clone can find nothing by reading
      almost nothing.
- [ ] Portable references (`~/`, `/tmp`, `/private/tmp`) still pass, so the gate
      has not been satisfied by banning something useful.
- [ ] Mutation probes: a tracked file carrying a synthetic home path fails the
      tree check on all four platform shapes, and on upper, lower, and mixed
      case Windows spellings; a finding staged and then edited out of the
      working copy still fails through the index; a synthetic path committed and
      then deleted in a throwaway repository fails the history check; a clean
      one-commit history passes the strict form; a shallow clone fails it; a
      repository with no commits fails it; and no accepted-exception mechanism
      remains in the gate source.
- [ ] Neither the gate nor its tests contain the path they exist to remove.

## 3. Each scan has a mutation probe proving it fails

A scan that has never failed is not evidence. A clean result is equally
consistent with a rule set that matches nothing. Before trusting one, prove the
scan would have caught something. One probe for each of the two scans.

- [ ] Directory probe: in a throwaway copy under `/private/tmp`, **keeping
      `.gitignore` intact**, record a clean run, generate a high-entropy
      secret-shaped value into an ignored path such as `.n8n/`, rerun, and
      require `gitleaks dir` to exit non-zero. Keeping `.gitignore` in place is
      the point of the probe: it is what proves the directory scan reaches
      ignored paths on its own.
- [ ] History probe: clone to a throwaway directory, commit a generated value,
      **delete it in a later commit**, and require `gitleaks git` to fail while
      `gitleaks dir` passes. That difference is the reason the history scan
      exists.
- [ ] Every mutation value was generated at probe time, lived only inside a
      throwaway directory, and never entered this repository or its history.
- [ ] Only the exact throwaway directories created for the probes were removed.

## 4. Tests and CI

- [ ] `npm run check` passes: tests, then validator, then scanner.
- [ ] CI runs on pushes to `main` and on pull requests.
- [ ] CI sets `permissions: contents: read` and no job widens it.
- [ ] Every third-party action is pinned to an immutable commit SHA, with the
      release tag in a trailing comment. No `@main`, `@master`, or major-only
      tag.
- [ ] The pinned tag and SHA of each action are recorded in
      [decision-log.md](decision-log.md).
- [ ] `.gitleaks.toml` contains no `paths` allowlist and no whole-file
      exemption.

## 5. Import and live behavior

Results for this section are recorded in
[live-verification.md](live-verification.md).

- [x] Import into a disposable n8n `2.36.8` container succeeds for all six
      workflows, recorded with the image digest and date.
- [x] A round-trip export shows no schema drift in node names, types,
      parameters, connection counts, or inactive state.
- [x] n8n's security audit findings are recorded by category and count, with
      expected Code-node and HTTP-node warnings explained rather than hidden.
- [x] Any import path that does not work is documented rather than worked
      around by weakening an export rule.
- [x] The shipped public defaults are conservative and described as such.
      `maxPostsPerFeed: 5` and `batchSize: 5`, both inside the range their own
      `Validate Setup` node accepts, both documented as a shipping choice rather
      than a verified volume, and both smaller in the first-run guidance.
- [x] Workflows 01, 02, and 05 have been run end to end against the real HubSpot
      Community feeds, Anthropic, and a Notion database, with request counts and
      token totals recorded.
- [x] Workflows 03 and 06 have had their digest content computed and inspected
      without executing a send node.
- [x] Every claim about live execution is accurate. Anything not actually run
      against Notion, Anthropic, or Gmail is labelled unverified in the README
      verification table, in [architecture.md](architecture.md), and in the
      changelog.
- [x] The README does not describe an outcome nobody has observed.

## 6. Release assets

- [ ] The architecture diagram carries no logo, no external font or script, no
      embedded link, and no private identifier, and validates as XML.
- [ ] The workflow screenshot shows an inactive, credential-free, unexecuted
      copy with the repository's placeholder values, and carries no workflow or
      execution id, credential name, setup value, recipient, browser chrome, or
      private URL.
- [ ] Both images have alt text that describes what they show.
- [ ] The submission packet contains no URL that does not yet exist.

## 7. Accepted limitations for v0.1

These are unverified on purpose. Each one is disclosed in the README, the
changelog, and [live-verification.md](live-verification.md). They do not block
publication, and they must not be presented as verified.

- [ ] **Accepted.** No digest email has been delivered to a real inbox.
      Workflows 03 and 06 have had their content computed and inspected only.
- [ ] **Accepted.** Workflow 04 has never run. Its trigger requires Gmail OAuth,
      which was deliberately not configured.
- [ ] **Accepted.** Import through the Editor UI in a browser has not been
      clicked through. A fresh instance accepting the JSON was verified instead.
- [ ] **Accepted.** Cost per run and setup duration are unmeasured, so neither
      is published.
- [ ] **Accepted.** Behaviour has been observed for one run on one day. Nothing
      is known about volume, a feed that errors, or a model response that cannot
      be parsed in production conditions.

Marking any of these as done requires actually doing the thing, not deciding it
is unimportant.

## 8. Publication

- [ ] Screenshots contain no private data: no real database ids, no tokens, no
      instance hostnames, no real names in rows, no browser tabs or bookmarks
      revealing private URLs.
- [ ] The changelog's `Known limits` section still matches reality.
- [ ] Publishing the GitHub repository is a manual step, taken only after every
      box above is ticked.
- [ ] Submitting to the n8n template library is a separate manual step. It has
      not been made, and the documentation does not imply it has.
