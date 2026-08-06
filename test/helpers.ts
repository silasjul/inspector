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
