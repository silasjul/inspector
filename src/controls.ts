import { Color, Vector2, Vector3 } from 'three';
import { uniform } from 'three/tsl';
import { onInspector, type Target } from './addon';
import {
  axisValues,
  buildControls,
  initialValues,
  parseArgs,
  toHex,
  type FolderSettings,
  type Schema,
  type Values,
} from './schema';

export { button, folder } from './schema';
export type { FolderSettings, Schema };

/**
 * Never called. `uniform` is overloaded per value type and `ReturnType` on an overloaded signature
 * only ever picks the last one, so the types are read back off a real call instead — which also
 * means they cannot drift from what `bind` actually returns.
 *
 * They must come from `uniform`, not from `float`/`vec3`/etc: those build a converted node with no
 * `.value`, and the whole point of this module is a node whose `.value` the panel can write.
 */
function nodeTypes() {
  return {
    float: uniform(0),
    bool: uniform(false),
    color: uniform(new Color()),
    vec2: uniform(new Vector2()),
    vec3: uniform(new Vector3()),
  };
}

type FloatNode = ReturnType<typeof nodeTypes>['float'];
type BoolNode = ReturnType<typeof nodeTypes>['bool'];
type ColorNode = ReturnType<typeof nodeTypes>['color'];
type Vec2Node = ReturnType<typeof nodeTypes>['vec2'];
type Vec3Node = ReturnType<typeof nodeTypes>['vec3'];

/**
 * `'#ff006e'` and `'hello'` are both `string` here, so every string-valued row types as a colour.
 * A text or dropdown row still works — it just comes back as a live plain value, not a node.
 */
type NodeFor<V> = [V] extends [number]
  ? FloatNode
  : [V] extends [boolean]
    ? BoolNode
    : [V] extends [string]
      ? ColorNode
      : [V] extends [readonly [number, number, number]]
        ? Vec3Node
        : [V] extends [{ x: number; y: number; z: number }]
          ? Vec3Node
          : [V] extends [readonly number[]]
            ? Vec2Node
            : [V] extends [{ x: number; y: number }]
              ? Vec2Node
              : V;

export type Nodes<S> = { [K in keyof Values<S>]: NodeFor<Values<S>[K]> };

type Binding = { node: unknown; write: (value: unknown) => void };

/** A uniform matching the seeded value, or null for something TSL has no node for. */
function bind(value: unknown): Binding | null {
  if (typeof value === 'number') {
    const node = uniform(value);

    return { node, write: (next) => (node.value = next as number) };
  }

  if (typeof value === 'boolean') {
    const node = uniform(value);

    return { node, write: (next) => (node.value = next as boolean) };
  }

  if (typeof value === 'string') {
    // `toHex` falls back to hex plus the CSS colour names when there is no canvas to parse with,
    // which is what this module gets on the server — it is evaluated at module scope.
    if (toHex(value) === null) return null;

    // Values arrive normalised to `#rrggbb`, so `set` is never handed anything it can't parse.
    const node = uniform(new Color(value));

    return { node, write: (next) => node.value.set(next as string) };
  }

  const axes = Array.isArray(value) || isRecord(value) ? axisValues(value) : [];

  if (axes.length === 2 && axes.every(isNumber)) {
    const node = uniform(new Vector2(axes[0], axes[1]));

    return { node, write: (next) => node.value.fromArray(axisValues(next)) };
  }

  if (axes.length === 3 && axes.every(isNumber)) {
    const node = uniform(new Vector3(axes[0], axes[1], axes[2]));

    return { node, write: (next) => node.value.fromArray(axisValues(next)) };
  }

  return null;
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === 'object' && input !== null;
}

function isNumber(input: unknown): input is number {
  return typeof input === 'number';
}

/** Keyed by folder name: Fast Refresh re-runs module scope, so a folder is replaced, not stacked. */
const registered = new Map<string, () => void>();

/**
 * `useControls` without the React — the same Leva schema, callable from any module, returning a TSL
 * uniform per row instead of a plain value. The panel writes `node.value`, which the GPU re-reads
 * every frame, so a tweak reaches a shader with no re-render and no recompile:
 *
 *     const { tint } = controls('Shader', { tint: '#ff006e' });
 *     export const shaderColorNode = tint.mul(uv().y);
 *
 * Rows TSL has no node for — text, dropdowns — come back as plain values on the returned object,
 * kept current in place. Reach for `useControls` when a React component has to re-render.
 *
 * There is no `deps` argument: with no render there is nothing to depend on. In production no
 * Inspector attaches and the uniforms simply hold the schema's own values.
 */
export function controls<const S extends Schema>(
  name: string,
  schema: S,
  settings?: FolderSettings
): Nodes<S>;

export function controls(...args: unknown[]) {
  const { name = '', schema, settings } = parseArgs(args);

  const values: Target = {};
  const writers = new Map<string, (value: unknown) => void>();

  for (const [key, seed] of Object.entries(initialValues(schema))) {
    const binding = bind(seed);

    values[key] = binding ? binding.node : seed;
    writers.set(key, binding ? binding.write : (next) => (values[key] = next));
  }

  const previous = registered.get(name);

  if (previous) {
    // Fast Refresh and a genuine name clash look identical from here, so the warning names both.
    if (process.env.NODE_ENV !== 'production') {
      console.warn(
        `[tsl-inspector] controls('${name}') replaced an existing registration. ` +
          `Expected on Fast Refresh; otherwise two modules share a folder name.`
      );
    }

    previous();
  }

  let teardown: (() => void) | undefined;

  const stop = onInspector((inspector) => {
    teardown?.();
    teardown = inspector
      ? buildControls(inspector, name, schema, settings, (next) => {
          for (const [key, value] of Object.entries(next)) writers.get(key)?.(value);
        })
      : undefined;
  });

  registered.set(name, () => {
    stop();
    teardown?.();
  });

  return values;
}
