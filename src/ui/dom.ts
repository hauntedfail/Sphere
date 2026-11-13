/**
 * Minimal DOM builder. Text always goes in as text nodes, never as markup,
 * so nothing a device or a storage entry says can become HTML.
 */
export type Child = Node | string | null | undefined | false;

export interface Props {
  readonly class?: string;
  /** Stable identity, used to restore focus after a pane is redrawn. */
  readonly key?: string;
  readonly attrs?: Readonly<Record<string, string | boolean | undefined>>;
  readonly on?: Readonly<Record<string, (event: Event) => void>>;
}

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Props = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  if (props.class !== undefined) element.className = props.class;
  if (props.key !== undefined) element.dataset['key'] = props.key;
  for (const [name, value] of Object.entries(props.attrs ?? {})) {
    if (value === undefined || value === false) continue;
    element.setAttribute(name, value === true ? '' : value);
  }
  for (const [type, listener] of Object.entries(props.on ?? {})) {
    element.addEventListener(type, listener);
  }
  append(element, children);
  return element;
}

export function append(parent: Node, children: readonly Child[]): void {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    parent.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
  }
}

/**
 * Replace a container's content, keeping keyboard focus on the element with
 * the same `key` if the user was inside the container.
 */
export function redraw(container: HTMLElement, children: readonly Child[]): void {
  const active = document.activeElement;
  const focusedKey =
    active instanceof HTMLElement && container.contains(active) ? active.dataset['key'] : undefined;

  const fragment = document.createDocumentFragment();
  append(fragment, children);
  container.replaceChildren(fragment);

  if (focusedKey === undefined) return;
  for (const candidate of container.querySelectorAll<HTMLElement>('[data-key]')) {
    if (candidate.dataset['key'] === focusedKey) {
      candidate.focus({ preventScroll: true });
      return;
    }
  }
}

/** Look up an element by id and check it is the kind of element expected. */
export function byId(id: string): HTMLElement;
export function byId<T extends HTMLElement>(id: string, type: abstract new () => T): T;
export function byId(id: string, type: abstract new () => HTMLElement = HTMLElement): HTMLElement {
  const element = document.getElementById(id);
  if (!(element instanceof type)) throw new Error(`missing or unexpected element #${id}`);
  return element;
}
