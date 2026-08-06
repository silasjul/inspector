import { Color } from 'three';
import type { Inspector } from 'three/addons/inspector/Inspector.js';
import {
  addFolder,
  addRootRows,
  addon,
  hex,
  rowOf,
  setDisabled,
  setHint,
  setVisible,
  vectorRow,
  type Options,
  type ParametersGroup,
  type Target,
} from './addon';

export type Schema = Record<string, unknown>;

export type FolderSettings = { collapsed?: boolean; order?: number };

export type ButtonInput = { __control: 'button'; onClick: () => void };
export type FolderInput<S extends Schema = Schema> = {
  __control: 'folder';
  schema: S;
  settings: FolderSettings;
};

/** A full-width button row. The schema key is the label. */
export function button(onClick: () => void): ButtonInput {
  return { __control: 'button', onClick };
}

/**
 * A nested folder. Its values flatten into the object `useControls` returns.
 *
 * `const` for the same reason the entry points take it — see `Widen`.
 */
export function folder<const S extends Schema>(
  schema: S,
  settings: FolderSettings = {}
): FolderInput<S> {
  return { __control: 'folder', schema, settings };
}

/** All four Leva overloads collapse to: an optional leading name, then the schema, then the rest. */
export function parseArgs(args: unknown[]) {
  const named = typeof args[0] === 'string';
  const name = named ? (args[0] as string) : undefined;
  const rest = named ? args.slice(1) : args;

  const schema = rest[0] as Schema;
  const settings = Array.isArray(rest[1]) ? {} : ((rest[1] as FolderSettings) ?? {});
  const deps = (Array.isArray(rest[1]) ? rest[1] : rest[2]) as unknown[] | undefined;

  return { name, schema, settings, deps };
}

type Simplify<T> = { [K in keyof T]: T[K] } & {};

type UnionToIntersection<U> = (U extends unknown ? (arg: U) => void : never) extends (
  arg: infer I
) => void
  ? I
  : never;

/**
 * Entry points infer their schema with `const`, so `transient: false` stays `false` rather than
 * widening to `boolean` — without which `Infer`'s check below can never match, and a non-transient
 * `onChange` row is dropped from the return type while still being present at runtime.
 *
 * The cost is that every value would come back literal and deeply readonly, so this puts them back:
 * `[0, 0, 0]` types as `number[]`, not `readonly [0, 0, 0]`. Applied to values only — an `options`
 * union is left alone, where `'a' | 'b'` beats `string`.
 */
type Widen<T> = T extends string
  ? string
  : T extends number
    ? number
    : T extends boolean
      ? boolean
      : T extends readonly (infer E)[]
        ? Widen<E>[]
        : T extends object
          ? { -readonly [K in keyof T]: Widen<T[K]> }
          : T;

type ValueOf<I> = I extends { options: infer O }
  ? O extends readonly (infer T)[]
    ? T
    : O[keyof O]
  : I extends { value: infer V }
    ? Widen<V>
    : Widen<I>;

/** Buttons and transient inputs are absent from the returned object, exactly as in Leva. */
type Infer<I> = I extends ButtonInput
  ? never
  : I extends FolderInput
    ? never
    : I extends { transient: false }
      ? ValueOf<I>
      : I extends { onChange: (...args: never[]) => void }
        ? never
        : ValueOf<I>;

type Own<S> = { [K in keyof S as [Infer<S[K]>] extends [never] ? never : K]: Infer<S[K]> };

/** `UnionToIntersection<never>` is `unknown`, so a folder-free schema intersects harmlessly. */
type Nested<S> = UnionToIntersection<
  { [K in keyof S]: S[K] extends FolderInput<infer C> ? Values<C> : never }[keyof S]
>;

export type Values<S> = Simplify<Own<S> & Nested<S>>;

export type Spec = {
  value?: unknown;
  min?: number;
  max?: number;
  step?: number;
  label?: string;
  options?: Options;
  hint?: string;
  disabled?: boolean;
  onChange?: (value: never) => void;
  transient?: boolean;
  order?: number;
  render?: (get: (key: string) => unknown) => boolean;
};

export type Kind = 'select' | 'boolean' | 'range' | 'number' | 'color' | 'string' | 'vector' | 'interval';

const AXES = ['x', 'y', 'z'];

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === 'object' && input !== null && !Array.isArray(input);
}

function isButton(input: unknown): input is ButtonInput {
  return isRecord(input) && input.__control === 'button';
}

function isFolder(input: unknown): input is FolderInput {
  return isRecord(input) && input.__control === 'folder';
}

function isVector(value: unknown): value is Record<string, number> {
  return isRecord(value) && typeof value.x === 'number' && typeof value.y === 'number';
}

/**
 * Leva's own rule: an object carrying `value` or `options` is a full input spec, anything else is
 * the value itself — which is what lets `{ x: 0, y: 0 }` mean a vector rather than a settings bag.
 */
function toSpec(input: unknown): Spec {
  if (isRecord(input) && ('value' in input || 'options' in input)) return input as Spec;

  return { value: input };
}

/** Lazy, so this module stays DOM-free at import — `controls` evaluates it on the server. */
let parser: CanvasRenderingContext2D | null | undefined;

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

/**
 * Hex and the 148 CSS colour names, for when there is no canvas to parse with: the server, a
 * hardened context where `getContext` returns null, and jsdom. Narrower than the canvas — no
 * `rgb()`, `hsl()` or `color()` — but far better than treating every colour as text.
 */
function fromName(value: string): string | null {
  if (HEX.test(value)) {
    const digits = value.slice(1).toLowerCase();

    return `#${digits.length === 3 ? [...digits].map((d) => d + d).join('') : digits}`;
  }

  const named = Color.NAMES[value.toLowerCase() as keyof typeof Color.NAMES];

  return named === undefined ? null : `#${named.toString(16).padStart(6, '0')}`;
}

/**
 * Normalises any CSS colour to `#rrggbb`, and returns null for a string that isn't one. Canvas
 * `fillStyle` is the parser; two different fallbacks agreeing is the only reliable "it parsed" signal.
 * One context for the whole module — every call is a colour row being built, and a canvas apiece
 * allocates a backing store per row.
 */
export function toHex(value: string): string | null {
  if (parser === undefined) {
    parser = typeof document === 'undefined' ? null : document.createElement('canvas').getContext('2d');
  }

  const context = parser;
  if (!context) return fromName(value);

  context.fillStyle = '#000000';
  context.fillStyle = value;
  const black = context.fillStyle;

  context.fillStyle = '#ffffff';
  context.fillStyle = value;

  return black === context.fillStyle && black.startsWith('#') ? black : null;
}

function selectDefault(options: Options) {
  return Array.isArray(options) ? options[0] : Object.values(options)[0];
}

export function kindOf(spec: Spec): Kind {
  const { value, min, max } = spec;
  const bounded = min !== undefined && max !== undefined;

  if (spec.options) return 'select';
  if (typeof value === 'boolean') return 'boolean';
  if (typeof value === 'number') return bounded ? 'range' : 'number';
  if (typeof value === 'string') return toHex(value) ? 'color' : 'string';
  if (Array.isArray(value)) return value.length === 2 && bounded ? 'interval' : 'vector';
  if (isVector(value)) return 'vector';

  return 'string';
}

export function axisValues(value: unknown): number[] {
  if (Array.isArray(value)) return value as number[];

  const vector = value as Record<string, number>;

  return AXES.filter((axis) => axis in vector).map((axis) => vector[axis]);
}

function fromAxes(shape: unknown, numbers: number[]): unknown {
  if (Array.isArray(shape)) return [...numbers];

  const keys = AXES.filter((axis) => axis in (shape as object));

  return Object.fromEntries(keys.map((key, index) => [key, numbers[index]]));
}

function orderOf(input: unknown) {
  if (isFolder(input)) return input.settings.order ?? 0;
  if (isRecord(input) && typeof input.order === 'number') return input.order;

  return 0;
}

/** The addon appends, and sort is stable — so building in order is all the ordering there is. */
export function ordered(schema: Schema) {
  return Object.entries(schema).sort(([, a], [, b]) => orderOf(a) - orderOf(b));
}

export function isTransient(spec: Spec) {
  return spec.transient ?? spec.onChange !== undefined;
}

/** What `useControls` returns on its very first render, before any row exists. */
export function initialValues(schema: Schema): Target {
  const values: Target = {};

  for (const [key, input] of Object.entries(schema)) {
    if (isButton(input)) continue;

    if (isFolder(input)) {
      Object.assign(values, initialValues(input.schema));
      continue;
    }

    const spec = toSpec(input);
    if (isTransient(spec)) continue;

    values[key] = spec.options && spec.value === undefined ? selectDefault(spec.options) : spec.value;
  }

  return values;
}

/**
 * Builds one `useControls` call into the Parameters tab and returns its teardown. Rows bind to a
 * flat `values` object the addon writes into directly; every change then re-reads it into React.
 */
export function buildControls(
  inspector: Inspector,
  name: string | undefined,
  schema: Schema,
  settings: FolderSettings,
  onValues: (values: Target) => void
) {
  const values: Target = {};
  const returned = new Set<string>();
  const conditionals: { element: HTMLElement | null; render: NonNullable<Spec['render']> }[] = [];

  const get = (key: string) => values[key];

  /**
   * A transient row is left out of the returned object, so nothing downstream can observe it —
   * pushing a new object anyway is a render per pointer-move on a dragged slider, which is the one
   * thing `transient` exists to avoid. Conditionals still re-run: a `render(get)` predicate reads
   * `values`, which holds transient keys too.
   */
  const emit = (changed?: string) => {
    if (changed === undefined || returned.has(changed)) {
      onValues(Object.fromEntries([...returned].map((key) => [key, values[key]])));
    }

    for (const { element, render } of conditionals) setVisible(element, render(get));
  };

  const change = (key: string, spec: Spec, value: unknown) => {
    values[key] = value;
    spec.onChange?.(value as never);
    emit(key);
  };

  const addRow = (group: ParametersGroup, key: string, input: unknown) => {
    if (isFolder(input)) {
      const nested = addon(group).addFolder(key);
      build(nested, input.schema);

      if (input.settings.collapsed) addon(nested).close();

      return;
    }

    const api = addon(group);

    if (isButton(input)) {
      values[key] = input.onClick;
      api.addButton(values, key).name(key);

      return;
    }

    const spec = toSpec(input);
    const kind = kindOf(spec);

    const finish = (editor: { domElement: HTMLElement; name: (label: string) => unknown }) => {
      if (spec.label) editor.name(spec.label);

      return rowOf(editor);
    };

    let element: HTMLElement | null = null;

    // Every control reads `object[property]` for its starting value, so seed before adding the row.
    switch (kind) {
      case 'select': {
        const options = spec.options ?? [];
        values[key] = spec.value ?? selectDefault(options);

        const editor = api.addSelect(values, key, options);
        editor.onChange((value) => change(key, spec, value));
        element = finish(editor);
        break;
      }

      case 'boolean': {
        values[key] = spec.value;

        const editor = api.addBoolean(values, key);
        editor.onChange((value) => change(key, spec, value));
        element = finish(editor);
        break;
      }

      case 'range': {
        values[key] = spec.value;

        const editor = api.addSlider(values, key, spec.min ?? 0, spec.max ?? 1, spec.step ?? 0.01);
        editor.onChange((value) => change(key, spec, value));
        element = finish(editor);
        break;
      }

      case 'number': {
        values[key] = spec.value;

        // `values[key]` can't be the previous value here: `addNumber` registers its own `change`
        // listener that writes `object[property]` synchronously, while every `Value` defers its
        // callback by a frame — so by the time this runs the map already holds the raw new value.
        // Without a separate copy `clampNumber`'s NaN guard compares NaN against NaN and an emptied
        // input writes NaN onward, which in a uniform blanks whatever the shader draws.
        let last = spec.value as number;

        // Bounds are deliberately withheld — see `clampNumber`. A both-bounded number is a
        // slider, so this row can only ever carry one of them anyway.
        const editor = api.addNumber(values, key);
        // `addNumber` takes no step — the input is the only way to set one.
        if (spec.step !== undefined) editor.input.step = String(spec.step);

        editor.onChange((value) => {
          const next = clampNumber(value, last, spec);
          last = next;

          // Writing the input directly; `setValue` dispatches a change and would recurse.
          if (next !== value) editor.input.value = String(next);

          change(key, spec, next);
        });

        element = finish(editor);
        break;
      }

      case 'color': {
        // Seeding a padded `#rrggbb` also dodges `_getColorHex`, which skips `padStart`.
        values[key] = toHex(String(spec.value)) ?? '#000000';

        const editor = api.addColor(values, key);
        editor.onChange((value) => change(key, spec, hex(value)));
        element = finish(editor);
        break;
      }

      case 'string': {
        values[key] = spec.value;

        const editor = api.addString(values, key);
        editor.onChange((value) => change(key, spec, value));
        element = finish(editor);
        break;
      }

      case 'vector':
      case 'interval': {
        values[key] = spec.value;

        const axes = axisValues(spec.value).map((value) => ({
          value,
          min: spec.min,
          max: spec.max,
          step: spec.step,
        }));

        const row = vectorRow(group, spec.label ?? key, axes, (index, value) => {
          const next = [...axisValues(values[key])];
          next[index] = value;

          if (kind === 'interval') clampInterval(next, index, row.inputs);

          change(key, spec, fromAxes(spec.value, next));
        });

        if (kind === 'vector') {
          row.inputs.forEach((input, index) => {
            input.title = AXES[index] ?? String(index);
          });
        }

        element = row.element;
        break;
      }
    }

    if (spec.hint) setHint(element, spec.hint);
    if (spec.disabled) setDisabled(element, true);
    if (spec.render) conditionals.push({ element, render: spec.render });
    if (!isTransient(spec)) returned.add(key);
  };

  const build = (group: ParametersGroup, entries: Schema) => {
    for (const [key, input] of ordered(entries)) addRow(group, key, input);
  };

  const teardown =
    name === undefined
      ? addRootRows(inspector, (group) => build(group, schema))
      : addFolder(
          inspector,
          name,
          (group) => {
            build(group, schema);

            if (settings.collapsed) addon(group).close();
          },
          settings.order
        );

  // Colours come back normalised, so React has to be told what the panel actually holds.
  emit();

  return teardown;
}

/**
 * `addNumber` leaves an unset bound at ±Infinity, and `ValueNumber`'s drag handler reads both back
 * to size its step as `(max - min) / 100` — Infinity — so one drag on a `min`-only row writes
 * Infinity, or NaN when the drag is flat. Keeping bounds off the input leaves that handler on its
 * plain-step path; the bound is enforced here instead. An emptied input also reads back as NaN,
 * which holds the last value rather than propagating it into a uniform.
 */
export function clampNumber(value: number, previous: number, spec: Spec) {
  if (Number.isNaN(value)) return previous;
  if (spec.min !== undefined && value < spec.min) return spec.min;
  if (spec.max !== undefined && value > spec.max) return spec.max;

  return value;
}

/** Drag one end of an interval past the other and it pushes, rather than snapping back. */
export function clampInterval(next: number[], index: number, inputs: HTMLInputElement[]) {
  if (next[0] <= next[1]) return;

  const other = index === 0 ? 1 : 0;
  next[other] = next[index];

  // Writing the input directly; `setValue` dispatches a change and would recurse.
  inputs[other].value = String(next[other]);
}
