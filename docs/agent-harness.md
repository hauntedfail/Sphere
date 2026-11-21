# Agent Harness

Coding agents work in this repository through the same files, commands and
tests as a person does. Nothing depends on one vendor's agent or on a prompt
kept somewhere else.

## Layers

1. **Orientation.** [AGENTS.md](../AGENTS.md): what Sphere is, a map, the
   commands, the boundaries. `CLAUDE.md` imports it, so there is one copy.
2. **Knowledge.** [INDEX.md](INDEX.md) names the owner of each contract and
   the test that holds it.
3. **Open work.** [Backlog.md](../Backlog.md) holds outcomes that are not
   done. Git holds what is.
4. **Fast feedback.** One Vitest file runs in well under a second:
   `pnpm exec vitest run tests/scp.test.ts`.
5. **Definition of done.** `pnpm check`: typecheck, tests with coverage
   thresholds, Playwright against both builds.
6. **Independent enforcement.** `.github/workflows/ci.yml` installs from the
   lockfile on a clean machine and runs `pnpm check`. A release waits for it.
7. **Reproducible tools.** `.node-version` and the `packageManager` field pin
   Node.js and pnpm.

## Rules that are tests

A rule that can be decided by looking at the repository is a test, not a
sentence for an agent to remember. A test costs no context, fails every time,
and its failure message arrives only when it is needed.

`tests/harness.test.ts` holds the harness itself:

- the harness files exist, `AGENTS.md` stays within its line budget, and
  `CLAUDE.md` is the import and nothing else;
- `pnpm check` still runs its three steps, and CI and the release workflow
  still run it;
- no build output, `.env` file or local snapshot is committed;
- every local link and heading anchor in the documents resolves, every
  document under `docs/` is reachable from the index, every `pnpm` command
  shown exists, and every path named under a committed directory is there.

`tests/boundaries.test.ts` holds what the README says about the source:
Bluetooth from one file, the simulator switch read in one file, the page
touched from `src/ui/` and the entry point only, no markup from text, no
inline styles, no network call, no runtime dependencies.

What stays in prose is what a test cannot decide: which kind of evidence a
claim rests on, and when a push is wanted.

## Evidence

A passing test, a built site, the deployed site and a physical device answer
different questions. `AGENTS.md` lists the four kinds; a report says which
one it has.

## Changing the harness

When an agent fails the same way twice, fix the repository in this order and
stop at the first step that works:

1. Add or sharpen a test that observes the failure.
2. Add a check on the repository, in `tests/harness.test.ts` or
   `tests/boundaries.test.ts`.
3. Make the state the agent could not see inspectable: a clearer error, a
   line in the session log.
4. Correct the document that owns the subject.
5. Add a line to `AGENTS.md` only when nothing above can express the rule.

Add a layer only after a failure shows the present ones cannot hold the rule.
Look at the harness again after a change of model, toolchain or host, and
take out what no longer earns its place.
