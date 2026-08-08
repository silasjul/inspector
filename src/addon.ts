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
type Row = { parent: Container | null; domElement: HTMLElement; userData: Record<string, unknown> };

/**
 * `ui/List.js` and `ui/Item.js` are the same shape where it counts — both hold children and both are
 * somebody's `parent`. The one difference: a List appends a child's DOM into `domElement`, an Item
 * into the `childrenContainer` it builds lazily on its first child.
 */
type Container = {
  children: Row[];
  domElement: HTMLElement;
  childrenContainer?: HTMLElement | null;
  add: (row: Row, index?: number) => void;
  remove: (row: Row) => void;
};
type ItemInternals = Row & Container;

/** `objects` is push-only — nothing in the Inspector ever reads it back. See `dropObjects`. */
type Group = { paramList: ItemInternals; objects: { subItem: Row }[] };

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
 *
 * `SUBFOLDER` is the same trick one level in: a path folder has no declaration point to sit at, so
 * it sorts below the rows its parent declared. Rows carry no stamp, which reads as 0.
 */
const FOLDER = 0;
const SUBFOLDER = 1e6;
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

/**
 * The tab only ever appends, so a container is re-sorted whole by the order stamped on each child.
 * `sort` is stable, so anything unstamped keeps the order it was built in.
 */
function sortChildren(container: Container) {
  const sorted = [...container.children].sort(
    (a, b) => ((a.userData.order as number) ?? 0) - ((b.userData.order as number) ?? 0)
  );

  container.children.length = 0;
  container.children.push(...sorted);

  const host = container.childrenContainer ?? container.domElement;

  for (const child of sorted) host.appendChild(child.domElement);
}

/** `createGroup` pushes into a registry it never cleans, so every removed folder leaks. */
function dropGroup(inspector: Inspector, group: ParametersGroup) {
  const { groups } = getParametersTab(inspector);
  const index = groups.indexOf(group);

  if (index !== -1) groups.splice(index, 1);
}

/**
 * One folder in the tree. `refs` counts the registrations whose path runs *through* it, not the rows
 * in it — `controls('Cube/Pattern')` holds a reference to `Cube` as well as to `Pattern`, which is
 * what lets a module-scope shader folder outlive the component that built its parent, and the other
 * way round. The node goes when that count reaches zero.
 */
type FolderNode = {
  group: ParametersGroup;
  item: ItemInternals;
  parent: FolderNode | null;
  key: string;
  refs: number;
  /** Root folders are the ones `createGroup` pushed into `tab.groups`, so only they need dropping. */
  root: boolean;
  children: Map<string, FolderNode>;
};

/**
 * Keyed by Inspector: a Fast Refresh builds a new one and every folder in the old tree went with it,
 * so the stale tree must not be found. Weak, so it is collectable with the Inspector it describes.
 */
const trees = new WeakMap<Inspector, Map<string, FolderNode>>();

function rootsOf(inspector: Inspector) {
  let roots = trees.get(inspector);

  if (!roots) {
    roots = new Map();
    trees.set(inspector, roots);
  }

  return roots;
}

/**
 * `'Cube/Pattern'` is a path; a name with no separator is a single segment and behaves exactly as it
 * did. An empty name stays one empty segment — `addRootRows` builds a folder called `''`.
 */
export function pathOf(name: string) {
  const segments = name
    .split('/')
    .map((segment) => segment.trim())
    .filter(Boolean);

  return segments.length > 0 ? segments : [name];
}

function stampOrder(node: FolderNode, order: number) {
  node.item.userData.order = (node.root ? FOLDER : SUBFOLDER) + order;

  if (node.item.parent) sortChildren(node.item.parent);
}

function createNode(
  inspector: Inspector,
  parent: FolderNode | null,
  key: string,
  order: number
): FolderNode {
  const group = parent ? addon(parent.group).addFolder(key) : inspector.createParameters(key);
  const node: FolderNode = {
    group,
    item: (group as unknown as Group).paramList,
    parent,
    key,
    refs: 0,
    root: parent === null,
    children: new Map(),
  };

  stampOrder(node, order);

  return node;
}

/** Walks the path, building whatever is missing, and takes a reference on every folder along it. */
function acquire(inspector: Inspector, segments: string[], order: number) {
  let parent: FolderNode | null = null;

  for (const [index, key] of segments.entries()) {
    const siblings: Map<string, FolderNode> = parent ? parent.children : rootsOf(inspector);
    const leaf = index === segments.length - 1;
    const existing = siblings.get(key);

    // Only the leaf is the folder this registration named. An ancestor built on the way there is a
    // container someone else may own already, so it is never given this call's order.
    const node: FolderNode = existing ?? createNode(inspector, parent, key, leaf ? order : 0);

    if (!existing) siblings.set(key, node);
    // A folder that arrived as a bare container takes its real order when its owner turns up.
    else if (leaf && order !== 0) stampOrder(node, order);

    node.refs++;
    parent = node;
  }

  // `pathOf` never returns an empty path, so the loop always ran at least once.
  return parent as FolderNode;
}

/** Drops a reference on every folder along the path, removing each one that no longer has any. */
function release(inspector: Inspector, segments: string[]) {
  const path: FolderNode[] = [];
  let parent: FolderNode | null = null;

  for (const key of segments) {
    const siblings: Map<string, FolderNode> = parent ? parent.children : rootsOf(inspector);
    const node = siblings.get(key);
    if (!node) return;

    path.push(node);
    parent = node;
  }

  // Deepest first. A parent's count includes every child's, so it can only reach zero after them.
  for (const node of path.reverse()) {
    node.refs--;
    if (node.refs > 0) continue;

    node.item.parent?.remove(node.item);
    if (node.root) dropGroup(inspector, node.group);

    (node.parent ? node.parent.children : rootsOf(inspector)).delete(node.key);
  }
}

/**
 * A folder that outlives one of its registrations keeps that registration's `objects` entries, which
 * hold the editor, the row and the bound value map. Nothing reads the array, so this only stops it
 * retaining them — but a component that mounts and unmounts would otherwise grow it without end.
 */
function dropObjects(group: Group, rows: Row[]) {
  const removed = new Set(rows);
  const kept = group.objects.filter((entry) => !removed.has(entry.subItem));

  group.objects.length = 0;
  group.objects.push(...kept);
}

/**
 * Builds one registration into the folder `name` points at, and returns its teardown — the addon has
 * no removal API. `name` may be a path: `'Cube/Pattern'` nests, building any missing ancestor.
 *
 * Two registrations can land in the same folder, so a teardown may only take back what its own
 * `build` added. Everything else in there belongs to somebody who is still using it.
 */
export function addFolder(
  inspector: Inspector,
  name: string,
  build: (group: ParametersGroup) => void,
  order = 0
) {
  const segments = pathOf(name);
  const node = acquire(inspector, segments, order);
  const group = node.group as unknown as Group;

  const before = new Set(node.item.children);
  build(node.group);
  const added = node.item.children.filter((row) => !before.has(row));

  // Rows land unstamped and a sub-folder is stamped, so this is what sinks an already-built
  // sub-folder below the rows that arrived after it.
  if (added.length > 0) sortChildren(node.item);

  return () => {
    for (const row of added) row.parent?.remove(row);

    dropObjects(group, added);
    release(inspector, segments);
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
  sortChildren(list);

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
