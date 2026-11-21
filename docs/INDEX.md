# Sphere Documentation Index

Where each thing is decided. Read the owner of what you are changing, not
everything. When a document and the code disagree, the code and its tests are
right: correct the document.

## The product

The [README](../README.md) is written for someone who uses or hosts Sphere,
and it owns the description of the product:

- [The page](../README.md#the-page) and [Commands](../README.md#commands):
  what a user sees, and the vocabulary every control speaks.
- [Differences from the CLI](../README.md#differences-from-the-cli): where
  Sphere departs from `iqos_cli`, and why.
- [How it is built](../README.md#how-it-is-built): the layers under `src/`
  and the direction they depend in.
- [Browser support](../README.md#browser-support).

## Contracts

Each contract has one owner. The last column is what fails when it is broken.

| Contract | Owner | Held by |
| --- | --- | --- |
| No network, no inline script, no markup from text | `vite.config.ts` (the policy in the page), `public/_headers` (the policy as a header) | `e2e/release.spec.ts`, `tests/boundaries.test.ts` |
| Simulator in the dev server and the debug build only | `vite.config.ts`, `src/main.ts` | `tests/build.test.ts`, `e2e/release.spec.ts`, `e2e/debug.spec.ts` |
| Bluetooth from one file; the page from `src/ui/` only | `src/transport/web-bluetooth.ts`, `src/ui/` | `tests/boundaries.test.ts` |
| No runtime dependencies | `package.json` | `tests/boundaries.test.ts` |
| Frame layout, checksums, command bytes | `src/protocol/` | `tests/scp.test.ts`, `tests/protocol.test.ts` |
| Request and reply matching, fragments, timeouts | `src/transport/session.ts` | `tests/session.test.ts` |
| What is deployed, and to which one origin | `wrangler.jsonc` | `tests/deploy.test.ts` |
| Response headers | `public/_headers` | `tests/deploy.test.ts`, `e2e/live.spec.ts` |
| Pinned Node.js and pnpm | `.node-version`, `package.json` | `tests/deploy.test.ts` |
| The version on the page | `package.json`, read by `vite.config.ts` | `.github/workflows/release.yml` |

More on each: [Privacy and security](../README.md#privacy-and-security),
[Deploying](../README.md#deploying), [Releasing](../README.md#releasing).

## Verification

- [Verification](../README.md#verification): the commands, what the tests
  establish, and what they do not.
- [Agent harness](agent-harness.md): how the repository keeps agents on those
  rails, the kinds of evidence, and how the harness is changed.
- [Fonts](fonts.md): the faces made for each language, and how to rebuild them
  when a translation changes.

## Work

- [Backlog](../Backlog.md): open outcomes. Finished work is in the Git history.

## Rules for these documents

- `AGENTS.md` stays a short entry point; `CLAUDE.md` only imports it.
- One owner for each contract. Link to it; do not copy it.
- No task plans, session notes or review transcripts in the repository.
- `tests/harness.test.ts` fails on a broken link, a document the index does
  not reach, a command `package.json` does not have, or a path that is gone.
