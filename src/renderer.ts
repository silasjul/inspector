import * as THREE from 'three/webgpu';
import { extend, type ThreeToJSXElements } from '@react-three/fiber';
import { releaseInspector, setInspector } from './addon';

/**
 * R3F's own `ThreeElements` is built from `three`, and a merged interface may not redeclare one of
 * its keys with a different type. `three/webgpu` exports its own `PMREMGenerator`, so that key is
 * left to R3F — it is a renderer utility, never a JSX element. TypeScript 7 enforces this; 5.x let
 * the clash through.
 */
declare module '@react-three/fiber' {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface ThreeElements extends Omit<ThreeToJSXElements<typeof THREE>, 'pMREMGenerator'> {}
}

extend(THREE as unknown as Parameters<typeof extend>[0]);

type GLDefaults = {
  canvas: unknown;
  antialias?: boolean;
  alpha?: boolean;
};

export type RendererOptions = {
  /**
   * Whether to attach the Inspector. Defaults to development only. Set it true to ship the panel to
   * production — the Inspector is a dynamic `import()`, so the chunk is only fetched when this is
   * on, and leaving it off costs a bundled module nothing.
   */
  inspector?: boolean;
};

const DEV = process.env.NODE_ENV === 'development';

/**
 * R3F guards renderer creation with `if (!state.gl)`, but only assigns it *after* awaiting this
 * factory — and its Canvas layout effect has no dependency array, so it re-runs on every render. A
 * re-render inside the await window (a late `ResizeObserver` fire, a font landing) starts a second
 * call that still sees no renderer, and two WebGPURenderers on one canvas means two Inspectors,
 * two panels, and two `setInspector` calls. Keyed by canvas, so a real remount still gets its own.
 */
const renderers = new WeakMap<HTMLCanvasElement, Promise<THREE.WebGPURenderer>>();

/**
 * The R3F factory: `<Canvas gl={createWebGPURenderer}>`. Falls back to WebGL2 on its own when the
 * browser has no WebGPU adapter.
 */
export function createWebGPURenderer(props: GLDefaults): Promise<THREE.WebGPURenderer>;

/**
 * Configured, returning the factory: `<Canvas gl={createWebGPURenderer({ inspector: true })}>`.
 * Use this to keep the panel in production, or to drop it from a development build.
 */
export function createWebGPURenderer(
  options?: RendererOptions
): (props: GLDefaults) => Promise<THREE.WebGPURenderer>;

/**
 * R3F calls the factory with the canvas it just made, so a `canvas` key is what tells the two forms
 * apart — nothing else reaches this with one.
 */
export function createWebGPURenderer(arg: GLDefaults | RendererOptions = {}) {
  if ('canvas' in arg) return build(arg, DEV);

  const { inspector = DEV } = arg;

  return (props: GLDefaults) => build(props, inspector);
}

/**
 * Memoised per canvas, which is also where the `inspector` flag is settled: a second call on a live
 * canvas gets the first call's renderer and therefore the first call's flag. Only a remount, which
 * disposes and drops the entry, can change it.
 */
function build(props: GLDefaults, inspector: boolean) {
  const canvas = props.canvas as HTMLCanvasElement;

  let renderer = renderers.get(canvas);

  if (!renderer) {
    renderer = buildRenderer(props, inspector);
    renderers.set(canvas, renderer);
  }

  return renderer;
}

async function buildRenderer(props: GLDefaults, withInspector: boolean) {
  const canvas = props.canvas as HTMLCanvasElement;

  const renderer = new THREE.WebGPURenderer({
    canvas,
    antialias: props.antialias ?? true,
    alpha: props.alpha,
  });

  // Assigning the inspector is what mounts it: `Inspector.setRenderer` starts the (memoised)
  // `renderer.init()` itself and appends the panel beside the canvas, or waits on a
  // MutationObserver until the canvas has a parent. So the order relative to the init() below
  // doesn't matter.
  if (withInspector) {
    // Must load before Inspector.js, or Turbopack throws "reading 'REVISION'". Inspector.js imports
    // tabs/Settings.js ahead of `three/webgpu`, and Settings.js calls Inspector's `getItem` at module
    // load — a cycle. Native ESM bindings are live, so `getItem` still sees REVISION; Turbopack
    // assigns each import in order, so it reads one Inspector.js has not bound yet. Entering the
    // cycle at Settings.js lets Inspector.js finish first. The second import is then a cache hit.
    await import('three/addons/inspector/tabs/Settings.js');
    const { Inspector } = await import('three/addons/inspector/Inspector.js');
    const inspector = new Inspector();

    // The panel mounts as a sibling of the canvas inside R3F's event container, so
    // without this every drag inside it also reaches the scene. The panel's own
    // drag handlers sit on inner elements and still run first.
    for (const type of ['pointerdown', 'pointermove', 'pointerup', 'wheel', 'contextmenu']) {
      inspector.domElement.addEventListener(type, (e) => e.stopPropagation());
    }

    renderer.inspector = inspector;
    setInspector(inspector);

    // Without this the singleton outlives the Canvas: after an unmount it still points at a dead
    // Inspector, so anything mounting afterwards builds rows into a detached panel and never
    // updates. Dropping the cache entry matters too, or a remount on this canvas would reuse a
    // disposed renderer — the very failure the cache exists to prevent. `dispose()` is async and
    // tears the Inspector down itself, so the singleton is released before it starts.
    const dispose = renderer.dispose.bind(renderer);

    renderer.dispose = () => {
      releaseInspector(inspector);
      renderers.delete(canvas);

      return dispose();
    };
  }

  await renderer.init();

  return renderer;
}
