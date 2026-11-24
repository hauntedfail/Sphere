/**
 * Pure checks behind `harness.test.ts`: each takes text or a list of paths
 * and returns what it found, so the checks themselves can be tested without
 * a repository around them.
 */

/** Build output, local state and secrets: files that must never be committed. */
const FORBIDDEN_TRACKED: readonly RegExp[] = [
  /^(dist|dist-debug|coverage|node_modules|\.wrangler)\//,
  /^e2e\/\.(results|shots)\//,
  // Local snapshots of the tree taken before a redesign.
  /^_before-[^/]*\//,
  /(^|\/)\.env(\.(?!example$)[^/]*)?$/,
  /(^|\/)\.DS_Store$/,
  /\.local$/,
];

export function forbiddenTrackedPaths(paths: readonly string[]): string[] {
  return paths.filter((path) => FORBIDDEN_TRACKED.some((pattern) => pattern.test(path)));
}

/** A line that opens a code block: three or more backticks or tildes, after up to three spaces. */
const OPENING_FENCE = /^ {0,3}(`{3,}(?=[^`]*$)|~{3,})/;
const CLOSING_FENCE = /^ {0,3}(`{3,}|~{3,})[ \t]*$/;

/**
 * The document split into prose and fenced code blocks, as CommonMark reads
 * fences: a block closes only on a fence of the same character, at least as
 * long as the one that opened it, with nothing after it. One left open runs
 * to the end of the document.
 */
function fences(markdown: string): { prose: string; blocks: string[] } {
  const prose: string[] = [];
  const blocks: string[] = [];
  let open: { fence: string; lines: string[] } | null = null;
  // CommonMark ends a line at LF, CRLF or a lone CR.
  for (const line of markdown.split(/\r\n|\n|\r/)) {
    if (open === null) {
      const fence = OPENING_FENCE.exec(line)?.[1];
      if (fence === undefined) prose.push(line);
      else open = { fence, lines: [line] };
      continue;
    }
    open.lines.push(line);
    const fence = CLOSING_FENCE.exec(line)?.[1];
    if (fence !== undefined && fence[0] === open.fence[0] && fence.length >= open.fence.length) {
      blocks.push(open.lines.join('\n'));
      open = null;
    }
  }
  if (open !== null) blocks.push(open.lines.join('\n'));
  return { prose: prose.join('\n'), blocks };
}

/** The document without its fenced code blocks, which hold no links or headings. */
function prose(markdown: string): string {
  return fences(markdown).prose;
}

export interface LocalLink {
  /** Path as written, relative to the document. Empty for a link within the document. */
  readonly path: string;
  /** Heading anchor without the `#`, or null. */
  readonly anchor: string | null;
}

/** Links to files and headings in this repository; addresses elsewhere are left out. */
export function localLinks(markdown: string): LocalLink[] {
  const links: LocalLink[] = [];
  for (const match of prose(markdown).matchAll(/(?<!!)\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
    const destination = match[1] ?? '';
    if (/^[a-z][a-z\d+.-]*:/i.test(destination) || destination.startsWith('//')) continue;
    const hash = destination.indexOf('#');
    links.push({
      path: hash === -1 ? destination : destination.slice(0, hash),
      anchor: hash === -1 ? null : destination.slice(hash + 1).toLowerCase(),
    });
  }
  return links;
}

/** The anchors GitHub gives a document's headings. */
export function headingAnchors(markdown: string): Set<string> {
  const anchors = new Set<string>();
  const seen = new Map<string, number>();
  for (const line of prose(markdown).split('\n')) {
    const heading = /^#{1,6}\s+(.+?)\s*#*\s*$/.exec(line)?.[1];
    if (heading === undefined) continue;
    const base = heading
      .toLowerCase()
      .replace(/[`*~]/g, '')
      .replace(/[^\p{L}\p{N}\s_-]/gu, '')
      .replace(/\s/g, '-');
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    anchors.add(count === 0 ? base : `${base}-${count}`);
  }
  return anchors;
}

/** Everything written as code: fenced blocks and inline spans. */
function code(markdown: string): string[] {
  const { prose: text, blocks } = fences(markdown);
  const inline = [...text.matchAll(/`([^`\n]+)`/g)].map((match) => match[1] ?? '');
  return [...blocks, ...inline];
}

/** What follows `pnpm` wherever a document shows a command: `pnpm check` gives `check`. */
export function pnpmCommands(markdown: string): string[] {
  const names = new Set<string>();
  for (const text of code(markdown)) {
    for (const match of text.matchAll(/\bpnpm\s+([a-z][\w:-]*)/g)) names.add(match[1] ?? '');
  }
  return [...names];
}

const TRACKED_ROOTS = /^(src|tests|e2e|docs|public|tools|\.github)\/[\w./@-]*$/;

/** Inline code that names a file or directory under one of the committed directories. */
export function namedPaths(markdown: string): string[] {
  const paths = new Set<string>();
  for (const match of prose(markdown).matchAll(/`([^`\n]+)`/g)) {
    const text = match[1] ?? '';
    if (TRACKED_ROOTS.test(text)) paths.add(text);
  }
  return [...paths];
}
