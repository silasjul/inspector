import { Item } from 'three/addons/inspector/ui/Item.js';
import { ValueNumber, type ValueNumberParams } from 'three/addons/inspector/ui/Values.js';
import type { Inspector } from 'three/addons/inspector/Inspector.js';
import type { ParametersGroup } from 'three/addons/inspector/tabs/Parameters.js';

export type { ParametersGroup, ValueNumberParams };

/**
 * Every cast the Inspector needs lives here. `@types/three` types `Item` as a constructor and a
 * `domElement`, `Value` as a lone `onChange`, and `ParametersGroup` as `add`/`addFolder`/`addColor`
 * — the rest of the shipped JS is undeclared, and `addColor`'s declared `rgbScale` doesn't exist.
 */
type Row = { parent: List | null; domElement: HTMLElement; userData: Record<string, unknown> };
type List = {
  children: Row[];
  domElement: HTMLElement;
  add: (row: Row) => void;
  remove: (row: Row) => void;
};
type ItemInternals = Row & { children: Row[]; add: (row: Row, index?: number) => void };
type Group = { paramList: ItemInternals };

/**
 * `builtinButton` is the tab's icon in the toolbar; its click handler is the real toggle.
 *
 * `show`/`hide`/`isVisible` come from `ui/Tab.js` and are undeclared like the rest. The Inspector
 * builds this tab hidden and `createParameters` shows it again on the first folder, so `isVisible`
 * is load-bearing rather than informational — see `useParametersToggle`.
 */
export type ParametersTab = {
  groups: unknown[];
  builtinButton?: HTMLButtonElement;
  isVisible: boolean;
  show: () => void;
  hide: () => void;
};

/** A single-number target, so `ValueNumber`'s generics resolve to `(value: number) => void`. */
type Axis = { value: number };

export type Target = Record<string, unknown>;
export type Options = readonly unknown[] | Record<string, unknown>;

export type Editor<V> = {
  name: (label: string) => Editor<V>;
  onChange: (callback: (value: V) => void) => Editor<V>;
  domElement: HTMLElement;
};

export type NumberEditor = Editor<number> & { input: HTMLInputElement };

/** The addon as it actually ships, which is wider and stricter than its declaration file. */
export type Addon = {
  addNumber: (target: Target, key: string, min?: number, max?: number) => NumberEditor;
  addSlider: (target: Target, key: string, min: number, max: number, step: number) => Editor<number>;
  addBoolean: (target: Target, key: string) => Editor<boolean>;
  addString: (target: Target, key: string) => Editor<string>;
  addSelect: (target: Target, key: string, options: Options) => Editor<unknown>;
  addColor: (target: Target, key: string) => Editor<number>;
  addButton: (target: Target, key: string) => Editor<never>;
  addFolder: (name: string) => ParametersGroup;
  close: () => void;
};

/**
 * Folders sort above loose rows, so the save button stays last however folders are rebuilt. `LOOSE`
 * sits far enough out that a folder's own `order` can't climb past it.
 */
const FOLDER = 0;
const LOOSE = 1e9;

let current: Inspector | null = null;
const listeners = new Set<(inspector: Inspector | null) => void>();

/** Called by `createWebGPURenderer`. Stays null in production, where no Inspector is attached. */
export function setInspector(inspector: Inspector | null) {
  current = inspector;

  for (const listener of listeners) listener(inspector);
}

/**
 * Clears the singleton, but only if `inspector` is still the current one. A renderer disposed after
 * a newer one has already registered must not blank the live panel.
 */
export function releaseInspector(inspector: Inspector) {
  if (current === inspector) setInspector(null);
}

/**
 * Fires immediately with whatever exists now, then again each time the renderer builds a new one —
 * the renderer is created asynchronously and again on every Fast Refresh of the Canvas.
 *
 * Listeners fire in subscription order, which is hook call order inside `InspectorControls`.
 */
export function onInspector(listener: (inspector: Inspector | null) => void) {
  listeners.add(listener);
  listener(current);

  return () => {
    listeners.delete(listener);
  };
}

/** The Parameters tab itself — `Inspector.parameters` is absent from @types/three. */
export function getParametersTab(inspector: Inspector): ParametersTab {
  return (inspector as unknown as { parameters: ParametersTab }).parameters;
}

/** The one place a group is taken at its word. Don't spread this cast. */
export function addon(group: ParametersGroup): Addon {
  return group as unknown as Addon;
}

/** The tab only ever appends, so the whole root list is re-sorted by the order stamped on each row. */
function sortRoot(list: List) {
  const sorted = [...list.children].sort(
    (a, b) => ((a.userData.order as number) ?? 0) - ((b.userData.order as number) ?? 0)
  );

  list.children.length = 0;
  list.children.push(...sorted);

  for (const child of sorted) list.domElement.appendChild(child.domElement);
}

/** `createGroup` pushes into a registry it never cleans, so every removed folder leaks. */
function dropGroup(inspector: Inspector, group: ParametersGroup) {
  const { groups } = getParametersTab(inspector);
  const index = groups.indexOf(group);

  if (index !== -1) groups.splice(index, 1);
}

/** Builds a folder and returns its teardown — the addon has no removal API. */
export function addFolder(
  inspector: Inspector,
  name: string,
  build: (group: ParametersGroup) => void,
  order = 0
) {
  const group = inspector.createParameters(name);
  build(group);

  const { paramList } = group as unknown as Group;

  if (paramList.parent) {
    paramList.userData.order = FOLDER + order;
    sortRoot(paramList.parent);
  }

  return () => {
    paramList.parent?.remove(paramList);
    dropGroup(inspector, group);
  };
}

/**
 * Rows pinned below every folder, for a schema with no folder name. The addon only builds rows
 * inside groups, so they are built in a throwaway group and reparented onto the tab's root list.
 */
export function addRootRows(inspector: Inspector, build: (group: ParametersGroup) => void) {
  const group = inspector.createParameters('');
  build(group);

  const { paramList } = group as unknown as Group;
  const list = paramList.parent;
  const rows = [...paramList.children];

  dropGroup(inspector, group);

  if (!list) return () => {};

  for (const row of rows) {
    list.add(row);
    row.domElement.classList.remove('header-wrapper');
    row.userData.order = LOOSE;
  }

  list.remove(paramList);
  sortRoot(list);

  return () => {
    for (const row of rows) row.parent?.remove(row);
  };
}

/**
 * A compound row of numbers on one line, which the addon has no control for. `param-control-vector`
 * is in its stylesheet already with nothing behind it — this is what the rule was written for.
 */
export function vectorRow(
  group: ParametersGroup,
  label: string,
  axes: ValueNumberParams[],
  onChange: (index: number, value: number) => void
) {
  const control = document.createElement('div');
  control.className = 'param-control param-control-vector';

  const inputs = axes.map((axis, index) => {
    const editor = new ValueNumber<Axis, 'value'>(axis);
    editor.onChange((value) => onChange(index, value));

    const { input } = editor as unknown as { input: HTMLInputElement };
    control.appendChild(input);

    return input;
  });

  const name = document.createElement('span');
  name.className = 'value';
  name.textContent = label;

  const row = new Item(name, control) as unknown as ItemInternals;
  (group as unknown as Group).paramList.add(row);
  row.domElement.firstElementChild?.classList.add('actionable');

  return { element: row.domElement, inputs };
}

/** The row wrapper an editor was mounted into — `Value.domElement` is absent from @types/three. */
export function rowOf(editor: { domElement: HTMLElement }) {
  return editor.domElement.closest<HTMLElement>('.list-item-wrapper');
}

/** Uniform across every control, unlike `input` / `checkbox` / `select` / `colorInput`. */
export function setDisabled(element: HTMLElement | null, disabled: boolean) {
  const fields = element?.querySelectorAll<HTMLInputElement>('input, select, button');

  for (const field of fields ?? []) field.disabled = disabled;
}

export function setHint(element: HTMLElement | null, hint: string) {
  if (element) element.title = hint;
}

export function setVisible(element: HTMLElement | null, visible: boolean) {
  if (element) element.style.display = visible ? '' : 'none';
}

/** A colour editor reports a packed int whatever you passed in. */
export function hex(value: unknown): string {
  if (typeof value === 'number') return `#${(value >>> 0).toString(16).padStart(6, '0')}`;
  if (typeof value === 'string') return value.startsWith('#') ? value : `#${value}`;

  return '#000000';
}
