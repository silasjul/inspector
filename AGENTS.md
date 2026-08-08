# tsl-inspector — internals

Leva's `useControls` API, reimplemented over the **Parameters** tab of three.js's built-in WebGPU
Inspector. Leva itself is not a dependency. This package targets **React Three Fiber + WebGPU** and
nothing else, which is what lets it be a single entry point.

## Shape

- `addon.ts` — the Inspector singleton (`setInspector` / `releaseInspector` / `onInspector`), the
  `Addon` type that matches the shipped JS, the folder tree behind path names, root-row plumbing, the
  compound vector row, and small DOM helpers. **Every cast in the package lives here.** Don't put one
  anywhere else.
- `schema.ts` — the Leva schema layer: type inference, `button`, `folder`, `initialValues`,
  `parseArgs`, colour parsing, and the schema→row dispatch. Framework-free; no React. Both entry
  points are wrappers around its `buildControls`, so a widget or a trap is fixed once.
- `controls.ts` — `controls()`. Binds each row to a TSL uniform and writes `node.value` on change,
  so a tweak reaches a shader with no re-render. Callable at module scope, which means it is also
  evaluated on the server — nothing in its module body may touch the DOM.
- `renderer.ts` — `createWebGPURenderer`, plus the R3F `ThreeElements` module augmentation that
  makes `<meshStandardNodeMaterial />` and friends typecheck. Deleting that `declare module` block
  breaks every node-material element in a consuming app.
- `useControls.ts` / `useParameters.ts` — the React layer.
- `toggle.ts` — the machinery both toggles share: one key bound to one boolean, re-applied to
  whichever Inspector is current. Its `bind` argument must be a module-level function in the calling
  hook, so it sits in the dependency array honestly instead of behind a lint suppression.
- `useParametersToggle.ts` — the Parameters tab alone. `useInspectorToggle.ts` — the whole shell.
  They default to the same shortcut (`h`) on the assumption that only one is mounted.
- `index.ts` — the only public entry. Everything else is internal, even though `schema.ts` and
  `addon.ts` export more than it re-exports (the tests import those directly).

Imports inside `src/` are relative, never aliased.

## Why this is fragile

It is pinned to the internals of `three/examples/jsm/inspector/`, which is new, undocumented, and
has no stability guarantee. It will break on a three.js upgrade — hence the exact-minor peer range
`three: "^0.184.0"`, which is `>=0.184.0 <0.185.0`.

**`@types/three` is not the source of truth here.** `tabs/Parameters.d.ts` declares only
`add`/`addFolder`/`addColor` — `addNumber`, `addSlider`, `addBoolean`, `addString`, `addSelect`,
`addButton`, `close()` and `objects` all ship but are undeclared — and it invents an
`addColor(…, rgbScale)` parameter that does not exist in the JS. `ui/Item.d.ts` declares a
constructor and `domElement` and nothing else. `ui/List.js` has no declaration at all.

So: **read the JavaScript in `node_modules/three/examples/jsm/inspector/`.** Never the `.d.ts`, and
never from memory.

## Traps, verified against source and covered by tests

- **Every `Value` callback is deferred by one `requestAnimationFrame`** (`ui/Values.js`, the base
  class's own `change` listener). Nothing propagates within the tick that caused it. Tests must
  await a frame; `test/helpers.ts` `set()` returns that promise.
- **`addNumber` writes `object[property]` synchronously** from its own `change` listener, *before*
  the deferred callback runs. So the bound map can never be read for the previous value — the number
  row keeps its own `last`. Without that, `clampNumber`'s NaN guard compares NaN against NaN and an
  emptied input writes NaN onward, which in a uniform blanks whatever the shader draws.
- **`addNumber` fills an unset bound with ±Infinity**, and `ValueNumber`'s drag handler sizes its
  step as `(max - min) / 100` whenever `max` is a number and `min` is finite. Pass `min` alone and
  that step is Infinity, so one drag writes Infinity — or NaN when the drag is flat. So bounds never
  reach `addNumber`; `clampNumber` applies them after the fact. A both-bounded number is a slider,
  where the same arithmetic is what's wanted.
- **A colour editor reports a packed int** whatever you passed in, and `_getColorHex` skips
  `padStart`, so a colour below `0x100000` renders as an invalid swatch. Both are dodged by seeding
  the row with a normalised `'#rrggbb'` string and writing one back on change. Never hand `addColor`
  a number.
- **`toHex` needs a canvas** to parse arbitrary CSS colours, and falls back to hex plus the 148
  `Color.NAMES` when there is none — the server, a hardened context, jsdom. Narrower (no `rgb()`,
  `hsl()`, `color()`) but far better than classifying every colour as text.
- **`uniform()` is what `bind` returns, not `float()`/`vec3()`.** Those build a converted node with
  no `.value`. The node types in `controls.ts` are read back off real `uniform()` calls through a
  never-invoked `nodeTypes()`, because `ReturnType` on an overloaded signature only picks the last
  overload.
- **`.listen()` never stops.** It rAF-polls the bound object with no cancellation. Nothing uses it,
  and on a select or colour row it is an infinite dispatch loop, since neither overrides `setValue`.
- **`ValueNumber` leaks two `document` listeners per control**, permanently, and a slider composes a
  `ValueNumber` so it leaks two. Upstream's bug; every folder rebuild adds more. Accepted — this is
  dev-only and shadowing the class to fix it isn't worth it.
- **`createGroup` pushes into a registry it never cleans**, so a removed folder leaks unless
  `dropGroup` splices it out. `test/panel.test.ts` rebuilds 50× and asserts the registry stays flat.
- **R3F creates the renderer twice under an async factory.** Its `configure` guards on `state.gl`
  but assigns it only after awaiting, and the Canvas layout effect has no dependency array — so a
  re-render inside the await window builds a second renderer and a second Inspector. Hence the
  per-canvas `WeakMap` in `renderer.ts`; it must stay keyed by canvas, not module-global, or a real
  remount would reuse a dead renderer. Disposal clears the entry for the same reason. That cache is
  also where the `inspector` flag settles — a second call on a live canvas gets the first call's
  renderer and therefore the first call's flag.
- **`createWebGPURenderer` is both the R3F factory and its own configurator.** `gl={createWebGPURenderer}`
  hands it the canvas; `gl={createWebGPURenderer({ inspector: true })}` returns the factory. A
  `canvas` key is what tells the two apart, because only R3F calls it with one. Writing the
  configured form inline makes a new function identity per render, which is harmless: R3F's
  `configure` guards on `state.gl` and the `WeakMap` catches the rest.
- **`Inspector.show()` throws** (it calls `Profiler.show()` with no tab), so it is never a usable
  visibility switch. `useInspectorToggle` hides `inspector.domElement` instead — the one shell that
  holds the panel, the mini-panel and the FPS bar. Nothing reads `Inspector.getSize()`, so that
  never reaches the renderer.
- **`Tab.hide()` takes the tab's toolbar icon with it**, leaving nothing to click. That is fine for
  `useParametersToggle`, where a keyboard shortcut is the way back, and it is the Inspector's own
  mechanism — it builds the Parameters tab with `hide()` and `createParameters` calls `show()`.
- **`createParameters` force-shows the Parameters tab** whenever `isVisible` is false, so every
  folder built while the tab is toggled off would pop it back open. `useParametersToggle` overrides
  `tab.show` for as long as it holds the tab closed, and restores it with `Reflect.deleteProperty`
  on teardown. Do **not** hold the tab down by lying about `isVisible` instead: the profiler reads
  it in ~10 places to pick an active tab, to size the panel and to save its layout, so a hidden tab
  claiming to be visible gets activated with nothing in it.
- **`Parameters` is a `builtin: true` tab**, so it also renders into the mini-panel through
  `miniContent`, and `show()`/`hide()` move those children between the two panels. Going through
  those methods rather than setting `display` by hand is what keeps that state consistent.
- **The Parameters tab starts empty and hidden.** Revealing it before any folder exists shows a
  blank pane, so the toggle only re-shows when `tab.groups` is non-empty and otherwise lets the next
  `createParameters` do it.
- **Hiding the shell outranks a folder build**, so hook call order doesn't matter for
  `useInspectorToggle` — but `onInspector` still fires its listeners in subscription order if
  anything ever needs it to.
- **The addon only appends.** `Item.add(item, index)` takes an index, but `List.add(item)` does not —
  root-level ordering is done by re-sorting the whole list on a stamped `userData.order`. `List.add`
  also stamps `header-wrapper` on whatever it is given, which is how a folder's title row is marked;
  `addRootRows` strips it back off the loose rows it reparents.
- **A text row fires on every keystroke**, so a string input re-renders per character. Fine for a dev
  panel; don't debounce it.
- **`controls()` replaces a registration of the same name** rather than adding a second one, unlike
  `useControls`. Module scope re-runs on every Fast Refresh and has no unmount to tear down from, so
  it is keyed by the full folder name — and the name is required, because an unnamed one would put
  every module in the same slot. Replacement warns outside production, since Fast Refresh and a
  genuine clash are indistinguishable at runtime. This is its own map, not the folder tree: two
  *different* names sharing a folder is normal and does not warn.
- **`add()` returns `null`** for a value it has no widget for, so a chained `.name()` throws. The
  schema layer never relies on `add()`'s dispatch — it calls the specific `addX` method.
- **`createGroup` never looks a name up**, so two registrations naming one folder would build two.
  That is what the folder tree in `addon.ts` exists for — see below.

## The folder tree

`addFolder(inspector, name, …)` takes a **path**: `'Cube/Pattern'` nests. It exists because a folder
is per registration and a registration is either React (`useControls`) or module scope (`controls`),
never both — so a shader's rows could not otherwise sit inside the object's own folder. `folder()`
nests within one schema; a path nests across calls.

- **Keyed by Inspector, in a `WeakMap`.** A Fast Refresh builds a new Inspector and every folder went
  with the old one, so a module-global tree would hand back nodes whose DOM is gone. Weak, so the
  tree is collectable with the Inspector it describes.
- **`refs` counts registrations whose path runs through a node, not rows in it.** `controls('Cube/Pattern')`
  holds a reference on `Cube` as well as on `Pattern`. A parent's count therefore includes every
  child's, which is why `release` walks deepest-first and why a parent can only reach zero after its
  children have. Teardown order between the two calls doesn't matter.
- **Only root nodes are in `tab.groups`.** `createParameters` pushes; the nested
  `ParametersGroup.addFolder` does not. So `dropGroup` runs for a root node and would be wrong for a
  nested one.
- **A teardown removes the rows its own `build` added, not the folder.** The folder may still be
  someone else's. The set is diffed off `paramList.children` around the `build` call, which also
  catches the sub-groups an inline `folder()` adds.
- **`group.objects` has to be trimmed with them.** It is push-only — nothing in the Inspector ever
  reads it — so a folder that outlives a registration would retain that registration's editors, rows
  and value map for as long as it stands. `dropGroup` was the same bug one level up.
- **A path folder is stamped `SUBFOLDER` so it sorts below its parent's own rows**, which carry no
  stamp and read as 0. Without the re-sort after `build`, a sub-folder that arrived first (module
  scope beats a mount) would sit above rows declared before it — and which arrives first is genuinely
  not deterministic, since the renderer is built asynchronously.
- **An ancestor built on the way to a leaf gets order 0**, because it is a container someone else may
  own; it is restamped when its real owner registers with an order of its own.
- **Nothing here touches the render loop.** A path is resolved once per build and once per teardown,
  at a `Map` lookup per segment. `test/folders.test.ts` asserts no `requestAnimationFrame` is
  scheduled across a build/teardown cycle, and that a second registration reuses a folder rather than
  calling `createParameters` again.

## Types

`useControls` and `controls` infer their schema with a `const` type parameter. Without it the literal
in `transient: false` widens to `boolean`, `boolean extends false` is false, and the row is dropped
from the return type while still being present at runtime. `Widen` in `schema.ts` then puts values
back to their base types so `[0, 0, 0]` is `number[]` rather than `readonly [0, 0, 0]`. It is applied
to values only — an `options` union keeps its literals, where `'a' | 'b'` beats `string`.

`test/types.test-d.ts` covers this under `vitest --typecheck`; changing anything in that type layer
without running it is how the widening bug came back the first time.

## Testing

`npm test` — jsdom, no browser. `new Inspector()` constructs fine there and needs no renderer:
`createParameters` delegates straight to `parameters.createGroup`. `test/ssr.test.ts` runs in the
node environment to prove the barrel imports with no DOM at all, which Next needs for the
module-scope `controls()` call in a shader file.
