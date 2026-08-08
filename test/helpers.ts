import { Inspector } from 'three/addons/inspector/Inspector.js';

/** The Parameters tab's root list — folders and loose rows both live in its `domElement`. */
export function rootList(inspector: Inspector) {
  const { paramList } = (inspector as unknown as { parameters: { paramList: { domElement: HTMLElement } } })
    .parameters;

  return paramList.domElement;
}

export function groups(inspector: Inspector) {
  return (inspector as unknown as { parameters: { groups: unknown[] } }).parameters.groups;
}

/** The Parameters tab itself. `content` is the pane `Tab.show()`/`hide()` toggles. */
export function parametersTab(inspector: Inspector) {
  return (
    inspector as unknown as {
      parameters: { isVisible: boolean; content: HTMLElement; groups: unknown[] };
    }
  ).parameters;
}

/**
 * `List.add` stamps `header-wrapper` on anything added at root level, which is how a folder's own
 * title row is marked — `addRootRows` strips it back off the loose rows it reparents. So this is the
 * value rows only, with folder headers left out.
 */
export function rows(inspector: Inspector) {
  return [...rootList(inspector).querySelectorAll<HTMLElement>('.list-item-wrapper')].filter(
    (row) => !row.classList.contains('header-wrapper')
  );
}

/** Every `Value` defers its callback by one frame, so nothing propagates within the same tick. */
export function flush() {
  return new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
}

/** A row is `.list-item-wrapper > .list-item-row > .list-item-cell` twice: label, then control. */
export function labelOf(row: HTMLElement) {
  return row.querySelector('.list-item-cell')?.textContent?.trim() ?? '';
}

export function rowFor(inspector: Inspector, label: string) {
  const row = rows(inspector).find((candidate) => labelOf(candidate) === label);
  if (!row) throw new Error(`no row labelled "${label}" in [${rows(inspector).map(labelOf)}]`);

  return row;
}

/**
 * A row's or a folder's own title, ignoring anything nested under it — `labelOf` finds a child's
 * cell first once a folder has children. The toggler span a folder grows trims away.
 */
export function titleOf(element: HTMLElement) {
  return (
    element.querySelector(':scope > .list-item-row > .list-item-cell')?.textContent?.trim() ?? ''
  );
}

/**
 * What sits directly inside a folder, or at the root. An `Item` holds its children in the
 * `.list-children-container` it builds on the first one; the root `List` appends them into its own
 * element, beside a `<style>` and the header row — hence the filter.
 */
export function childrenOf(element: HTMLElement) {
  const container = element.querySelector<HTMLElement>(':scope > .list-children-container');

  return [...(container ?? element).children].filter((child): child is HTMLElement =>
    child.classList.contains('list-item-wrapper')
  );
}

/** Walks a `'Cube/Pattern'` path through the rendered panel, saying what it found where it stops. */
export function folderAt(inspector: Inspector, path: string) {
  let scope = childrenOf(rootList(inspector));
  let found: HTMLElement | undefined;

  for (const key of path.split('/')) {
    found = scope.find((child) => titleOf(child) === key);
    if (!found) throw new Error(`no folder "${key}" in [${scope.map(titleOf)}]`);

    scope = childrenOf(found);
  }

  return found as HTMLElement;
}

/** The labels directly inside a folder — its own rows and its sub-folders, in rendered order. */
export function labelsIn(element: HTMLElement) {
  return childrenOf(element).map(titleOf);
}

/** A slider composes a ValueNumber, so the range input has to be preferred over the number one. */
export function controlOf(row: HTMLElement) {
  return (row.querySelector<HTMLElement>('input[type=range]') ??
    row.querySelector<HTMLElement>('input, select'))!;
}

/**
 * Drives a row the way a user would. Each widget listens for a different event — `change` on a
 * number, checkbox and select, `input` on a slider, colour and text — so this dispatches per type.
 */
export function set(row: HTMLElement, value: unknown, axis = 0) {
  const field = row.querySelectorAll<HTMLInputElement>('input[type=number]')[axis];
  const control = field && axis > 0 ? field : controlOf(row);

  if (control instanceof HTMLSelectElement) {
    control.value = String(value);
    control.dispatchEvent(new Event('change'));
  } else {
    const input = control as HTMLInputElement;

    if (input.type === 'checkbox') {
      input.checked = Boolean(value);
      input.dispatchEvent(new Event('change'));
    } else {
      input.value = String(value);
      input.dispatchEvent(new Event(input.type === 'number' ? 'change' : 'input'));
    }
  }

  return flush();
}

export function makeInspector() {
  return new Inspector();
}
