# tsl-inspector

Leva's `useControls` API over the **Parameters** tab of three.js's built-in WebGPU Inspector — plus
`controls()`, the same schema with no React around it, handing back **TSL uniforms** you can call at
module scope from a shader file.

A uniform lives in a buffer the GPU re-reads every frame. The panel writes `node.value` and the next
frame differs: no re-render, no recompile, no store.

```ts
import { mix, uv } from 'three/tsl';
import { controls } from 'tsl-inspector';

const { colorA, colorB } = controls('Shader', {
  colorA: '#ff006e',
  colorB: '#3a86ff',
});

export const shaderColorNode = mix(colorA, colorB, uv().y);
```

For React Three Fiber + WebGPU. It is not built to work anywhere else.

## Install

Not on npm — install straight from the repo:

```sh
npm i github:silasjul/inspector
```

npm clones it, installs the dev dependencies and runs `prepare` (`tsc`), so `dist/` is built on
install and nothing needs to be committed. Pin to a tag when you want a version that can't move
under you:

```sh
npm i github:silasjul/inspector#v0.1.0
```

Without a tag or commit you're tracking whatever `main` last built, and `npm update` won't tell you
it moved. Peers: `three` (exact minor — see below), `react` >= 19, `react-dom` >= 19,
`@react-three/fiber` >= 9.

Hand the renderer factory to your Canvas, and the Inspector attaches itself in development:

```tsx
import { createWebGPURenderer } from 'tsl-inspector';

<Canvas gl={createWebGPURenderer}>…</Canvas>;
```

Call it to say so explicitly instead — this is how you keep the panel in a production build:

```tsx
<Canvas gl={createWebGPURenderer({ inspector: true })}>…</Canvas>;
```

`inspector` defaults to development only. The Inspector is behind a dynamic `import()`, so with it
off nothing is fetched and the panel costs a production bundle nothing; with it on, the chunk loads
at runtime. The flag is settled per canvas along with the renderer, so changing it takes a remount.

Press **`h`** to hide and reopen, once something calls `useParametersToggle()` (your rows) or
`useInspectorToggle()` (the entire inspector).

## `useControls`

The Leva hook, backed by the Parameters tab. Callable from any component, inside or outside the
Canvas — it reaches the Inspector through a module singleton, not through R3F.

```ts
const { size, tint } = useControls('Sphere', {
  size: { value: 10, min: 1, max: 40, step: 0.5 },
  tint: '#c98f5a',
});
```

Four call shapes, all Leva's: `useControls(schema)`, `(schema, settings)`, `(name, schema)`,
`(name, schema, settings)`. Any of them takes a trailing `deps` array, which is the only thing that
rebuilds a folder. `settings` is `{ collapsed?, order? }`.

A folder's lifetime follows its caller, so to make one mount and unmount with a swappable scene,
call its hook from that component.

In production no Inspector is ever attached, so `useControls` returns the schema's own values and
never renders anything.

## Folder paths

A folder name can be a path. `'Cube/Pattern'` builds `Pattern` inside `Cube`, and builds `Cube` too
if nothing has yet:

```ts
useControls('Cube', { size: 10, spin: 0.3 });
controls('Cube/Pattern', { colorA: '#c98f5a', speed: 1.2 });
```

One panel folder, `Cube`, with its own rows and a `Pattern` folder under them. Nest as deep as you
like: `'Cube/Pattern/Shape'`.

This is the one thing `folder()` can't do, because `folder()` nests inside **one** schema and a call
is either React or it isn't. A path crosses that line — which is the point, since a shader's rows
come from `controls` at module scope while the object's own rows come from `useControls` in the
component.

The rules:

- **Order of arrival doesn't matter.** Whichever call runs first builds the folder; the other finds
  it. A missing ancestor is built as an empty container.
- **A folder lives as long as any registration through it does.** Unmount the component and its rows
  go, while the shader's folder stays up. When the last one goes, the whole path goes with it.
- **A registration only ever takes back its own rows.** Two calls naming the same folder merge into
  it rather than building it twice.
- **A path folder sorts below the rows its parent declared**, since it has no declaration point of
  its own to sit at. `order` in `settings` sorts path folders against each other.
- Segments are trimmed and empty ones ignored, so `'Cube / Pattern'` is the same path. A name with no
  separator behaves exactly as it always did.

Nothing here runs per frame. The path is resolved once when a folder is built and once when it is
torn down — a `Map` lookup per segment. The render loop never sees it.

## The schema

A schema value is either the value itself or a `{ value, … }` spec. The widget follows from it:

| you write | you get |
| --- | --- |
| `4` | drag-input |
| `{ value: 4, min: 0, max: 10, step: 1 }` | slider |
| `true` | checkbox |
| `'#c98f5a'`, `'royalblue'` | colour picker — any string CSS can parse as a colour |
| `'hello'` | text |
| `{ options: ['a', 'b'] }` or `{ options: { Label: value } }` | dropdown |
| `{ x: 0, y: 0 }`, `{ x: 0, y: 0, z: 0 }`, `[0, 0]`, `[0, 0, 0]` | one row of numbers side by side |
| `{ value: [1, 5], min: 0, max: 10 }` | interval — two numbers that push rather than cross |
| `button(() => …)` | full-width button, the key is the label |
| `folder({ … }, { collapsed: true })` | nested folder; its values **flatten** into the result |

Any spec also takes `label`, `hint`, `disabled`, `order`, `onChange`, `transient`, and
`render: (get) => boolean`. Leva's transient rule holds: an input with `onChange` is left out of the
returned object unless you also pass `transient: false` — and a transient row genuinely costs no
render, which is the point of it.

`render`'s `get` only sees keys from the same call; there are no cross-call paths. `onChange` gets no
contextual type from the schema, so annotate it: `onChange: (value: number) => …`.

Not built, because the Inspector has no widget for them: image, joystick pad, `optional`,
`buttonGroup`, `monitor`.

## `controls`

The same schema with no React, so it works in a `lib/` module where a TSL graph is built. Each row
comes back as a **uniform node** rather than a value.

- `number → float`, `boolean → bool`, a colour string `→ color`, `{ x, y }` or `[a, b] → vec2`,
  `{ x, y, z } → vec3`. Nested `folder()` values flatten as usual.
- Text and dropdown rows have no node, so they come back as plain values, kept current in place.
  TypeScript can't tell `'#ff006e'` from `'hello'`, so a string row always *types* as a colour — if
  you want text, use `useControls`.
- The folder name is required, may be a path, and a second `controls('Shader', …)` **replaces** that
  registration rather than adding a second one. Module scope re-runs on every Fast Refresh and
  there's no unmount to tear down from, so it is keyed by the full name. It warns when it replaces
  one, since a real
  name clash looks identical.
- It's evaluated on the server too, so the module it lives in must not touch `window` or `document`.

## `useParameters`

**You probably don't need this.** `controls` and `useControls` cover everything you author yourself.

The escape hatch is for an object you *didn't* author defaults for — a material off a loaded GLTF,
a light, an `OrbitControls`. A row binds straight to it and mutates it in place, which is the one
thing `useControls` can't do, because it owns its own value map:

```ts
useParameters('Cube', (group) => {
  group.addColor(material.current, 'color');
  group.add(material.current, 'wireframe');
});
```

The difference that matters is the starting value. `useControls` makes you restate a default in the
schema, which drifts from whatever the object actually holds; these rows open at the object's live
value. `build` runs once — the Inspector owns the values from then on — so there is no reactivity
here and no `deps`.

`group.add` picks a widget from the current value and returns `null` when it has none, so a chained
`.name()` throws. Reach for the specific method (`addColor`, `addSlider`, `addBoolean`) when you
care about the widget.

## The two toggles

Both take `{ shortcut = 'h', open = true }`, both ignore the key while you're typing into a field,
and both are hooks — call one from any component, once.

```ts
useParametersToggle();               // your rows only
useInspectorToggle({ shortcut: 'i' }); // panel, mini-panel and FPS bar, all of it
```

`useParametersToggle` hides the **Parameters tab alone** — its rows, its tab button and its slice of
the mini-panel — and leaves the FPS bar and the other tabs up. That's what you want while working:
the profiler stays readable with your controls out of the way.

`useInspectorToggle` hides **everything**, by hiding the one shell element the whole inspector lives
in. That's the one for a screenshot, or for shipping the panel to production behind a key.

They share a default shortcut, so mount one or give the other its own key.

The subtlety in the parameters toggle is that `createParameters` re-shows the tab whenever it builds
a folder — so a Fast Refresh, or any component mounting with a `useControls` in it, would pop it
back open. It stays down instead. It also won't force an *empty* tab open on mount: with no folders
yet, it leaves the Inspector's own hidden-until-used behaviour alone.

## The one real cost: `args` vs props

A prop sets a value on an object that already exists — `color`, `intensity`, `position`. Cheap
however often it changes. `args` are **constructor** arguments: R3F shallow-compares them and
rebuilds the object when they differ, so `<boxGeometry args={[size, size, size]} />` genuinely
disposes and rebuilds the geometry on every `size` change.

So key expensive `useMemo`s on just the fields that affect them, and split a folder that mixes cheap
values with something expensive so the cheap rows can't invalidate the expensive memo. For something
read every frame, reading a store's `getState()` inside `useFrame` skips the subscription — but only
bother if the component is genuinely expensive.

## Three.js version

The peer range is `^0.184.0`, which for a `0.x` package means `>=0.184.0 <0.185.0` — an exact-minor
pin, on purpose. This rides undocumented internals of `three/examples/jsm/inspector/`, which have no
stability guarantee, so a three bump should force a version bump here and a re-verify rather than
silently installing against moved internals.

`AGENTS.md` documents how it works and every upstream bug it steers around. You shouldn't need it to
write a tweak.

## Development

```sh
npm test          # jsdom, no browser
npm run test:types
npm run build
```
