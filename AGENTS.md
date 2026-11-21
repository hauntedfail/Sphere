# Sphere Agent Guide

Sphere is a static web page that controls an IQOS ILUMA over Web Bluetooth.
TypeScript and Vite; no framework, no runtime dependencies, no server.

Start with [docs/INDEX.md](docs/INDEX.md). It names the file that owns each
contract and the test that holds it. Current code, tests and the documents
linked from the index are authoritative; what an earlier session remembers is
not.

## Repository map

- `src/protocol/`: frames, commands, parsers and the model matrix. Pure functions.
- `src/transport/`: the session, the Web Bluetooth adapter and the simulator.
- `src/device/`, `src/console/`, `src/storage/`, `src/app/`: typed operations,
  the command grammar, saved labels, state and the command queue.
- `src/ui/`: rendering. With `src/main.ts`, the only code that touches the page.
- `tests/`: Vitest. Unit tests, DOM tests and checks on the repository itself.
- `e2e/`: Playwright, against the production build and the debug build.
- `Backlog.md`: open outcomes that must outlive a session. Not a log or a plan.

## Commands

- Install from the lockfile: `pnpm install --frozen-lockfile`
- One test file while iterating: `pnpm exec vitest run tests/scp.test.ts`
- Before calling a change done: `pnpm check`
- Against the deployed site: `SPHERE_URL=https://sphere.h1ka.ru pnpm e2e`

`pnpm check` is the one definition of done: typecheck, tests with coverage
thresholds, then Playwright. CI runs the same command. Use the Node.js version
in `.node-version` and the pnpm version in `package.json`.

## Boundaries

- A push to `main` is a deployment. Cloudflare builds and publishes it without
  waiting for the tests. Run `pnpm check` first, and push only when asked.
- The page makes no network request. Add no request, analytics, remote font,
  remote script or runtime dependency.
- Text from a device or from storage reaches the page as text nodes. No markup
  built from strings and no inline styles.
- The simulator ships in the dev server and `pnpm build:debug` only, and
  `src/main.ts` alone reads the switch. A production build has none of it.
- Every control goes through `app.run(line)`, so each action is implemented once.
- Frames come from the `iqos` crate or from a capture. Where one had to be
  invented, the code says so.
- The version on the page is the one in `package.json`. Change it only by the
  release steps in the README.
- Commit no build output, no `.env` file and none of the local `_before-*`
  directories. Stage files by name.

## Evidence

These are four different things. Say which one a claim rests on.

1. Vitest, against a fake GATT stack and the simulator.
2. Playwright, against the two built sites.
3. Playwright against the deployed site (`SPHERE_URL`): headers and the host.
4. A physical IQOS. The first three never stand in for it.

## Working agreement

- Write the failing test first, then the change. Test what can be observed.
- Keep unrelated changes out; commit only when asked, as `<type>: <description>`.
- Put lasting knowledge in the document that owns it, found through the index.
- When an agent breaks the same rule twice, make it a test, not a longer rule
  here. [docs/agent-harness.md](docs/agent-harness.md) gives the order.
