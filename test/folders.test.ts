import { act, cleanup, renderHook } from '@testing-library/react';
import type { Inspector } from 'three/addons/inspector/Inspector.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { pathOf, setInspector } from '../src/addon';
import { controls } from '../src/controls';
import { buildControls } from '../src/schema';
import { useControls } from '../src/useControls';
import {
  childrenOf,
  folderAt,
  groups,
  labelsIn,
  makeInspector,
  rootList,
  rowFor,
  set,
  titleOf,
} from './helpers';

/**
 * A folder name may be a path — `'Cube/Pattern'` puts the shader's rows inside the object's own
 * folder. The point is that the two ends are different entry points: a component's `useControls`
 * and a shader module's `controls`, which can never be one call. So a folder is shared, and a
 * registration owns only the rows it added.
 */

let inspector: Inspector;

beforeEach(() => {
  localStorage.clear();
  inspector = makeInspector();
});

afterEach(() => {
  cleanup();
  setInspector(null);
});

const build = (name: string, schema: Record<string, unknown> = {}, settings = {}) =>
  buildControls(inspector, name, schema, settings, vi.fn());

const rootTitles = () => childrenOf(rootList(inspector)).map(titleOf);

describe('pathOf', () => {
  it('reads a plain name as a single segment, exactly as before', () => {
    expect(pathOf('Cube')).toEqual(['Cube']);
  });

  it('splits on the separator and trims each segment', () => {
    expect(pathOf(' Cube / Pattern ')).toEqual(['Cube', 'Pattern']);
  });

  it('ignores an empty segment rather than building a nameless folder', () => {
    expect(pathOf('Cube//Pattern/')).toEqual(['Cube', 'Pattern']);
  });

  it('keeps a name with no usable segment whole', () => {
    expect(pathOf('')).toEqual(['']);
    expect(pathOf('/')).toEqual(['/']);
  });
});

describe('nesting', () => {
  it('puts a path folder inside the folder it names', () => {
    build('Cube', { size: 1 });
    build('Cube/Pattern', { speed: 2 });

    expect(rootTitles()).toEqual(['Cube']);
    expect(labelsIn(folderAt(inspector, 'Cube'))).toEqual(['size', 'Pattern']);
    expect(labelsIn(folderAt(inspector, 'Cube/Pattern'))).toEqual(['speed']);
  });

  it('builds a missing parent, so the child can arrive first', () => {
    build('Cube/Pattern', { speed: 2 });
    build('Cube', { size: 1 });

    expect(rootTitles()).toEqual(['Cube']);
    expect(labelsIn(folderAt(inspector, 'Cube/Pattern'))).toEqual(['speed']);
  });

  it('nests to any depth', () => {
    build('Cube/Pattern/Shape', { sides: 6 });
    build('Cube/Pattern', { speed: 2 });
    build('Cube', { size: 1 });

    expect(labelsIn(folderAt(inspector, 'Cube'))).toEqual(['size', 'Pattern']);
    expect(labelsIn(folderAt(inspector, 'Cube/Pattern'))).toEqual(['speed', 'Shape']);
    expect(labelsIn(folderAt(inspector, 'Cube/Pattern/Shape'))).toEqual(['sides']);
  });

  it('registers only the root folder as a group, whatever the depth', () => {
    build('Cube/Pattern/Shape', { sides: 6 });

    expect(groups(inspector)).toHaveLength(1);
  });

  it('drives a nested row like any other', async () => {
    const onValues = vi.fn();
    buildControls(inspector, 'Cube/Pattern', { speed: 2 }, {}, onValues);

    await set(rowFor(inspector, 'speed'), 9);

    expect(onValues).toHaveBeenLastCalledWith({ speed: 9 });
  });
});

describe('a shared folder', () => {
  it('survives the teardown of the registration that named it', () => {
    const cube = build('Cube', { size: 1 });
    build('Cube/Pattern', { speed: 2 });

    cube();

    expect(labelsIn(folderAt(inspector, 'Cube'))).toEqual(['Pattern']);
    expect(labelsIn(folderAt(inspector, 'Cube/Pattern'))).toEqual(['speed']);
  });

  it('survives the teardown of the child that built it', () => {
    build('Cube', { size: 1 });
    const pattern = build('Cube/Pattern', { speed: 2 });

    pattern();

    expect(labelsIn(folderAt(inspector, 'Cube'))).toEqual(['size']);
  });

  it('goes once the last registration through it does, parent last', () => {
    const cube = build('Cube', { size: 1 });
    const pattern = build('Cube/Pattern', { speed: 2 });

    pattern();
    cube();

    expect(rootTitles()).toEqual([]);
    expect(groups(inspector)).toHaveLength(0);
  });

  it('goes once the last registration through it does, parent first', () => {
    const cube = build('Cube', { size: 1 });
    const pattern = build('Cube/Pattern', { speed: 2 });

    cube();
    pattern();

    expect(rootTitles()).toEqual([]);
    expect(groups(inspector)).toHaveLength(0);
  });

  it('takes a container with it when its only child goes', () => {
    const pattern = build('Cube/Pattern', { speed: 2 });

    pattern();

    expect(rootTitles()).toEqual([]);
    expect(groups(inspector)).toHaveLength(0);
  });

  it('keeps a container alive for a sibling', () => {
    const pattern = build('Cube/Pattern', { speed: 2 });
    build('Cube/Shape', { sides: 6 });

    pattern();

    expect(labelsIn(folderAt(inspector, 'Cube'))).toEqual(['Shape']);
  });

  it('merges two registrations that name the same folder', () => {
    const first = build('Cube', { size: 1 });
    build('Cube', { spin: 2 });

    expect(rootTitles()).toEqual(['Cube']);
    expect(labelsIn(folderAt(inspector, 'Cube'))).toEqual(['size', 'spin']);

    first();

    expect(labelsIn(folderAt(inspector, 'Cube'))).toEqual(['spin']);
  });

  it('takes back only its own rows, never a sibling registration’s', () => {
    build('Cube', { size: 1 });
    const second = build('Cube', { spin: 2, tilt: 3 });

    second();

    expect(labelsIn(folderAt(inspector, 'Cube'))).toEqual(['size']);
  });
});

describe('ordering', () => {
  it('sorts a path folder below the rows its parent declared, whoever arrived first', () => {
    build('Cube/Pattern', { speed: 2 });
    build('Cube', { size: 1, spin: 3 });

    expect(labelsIn(folderAt(inspector, 'Cube'))).toEqual(['size', 'spin', 'Pattern']);
  });

  it('sorts path folders against each other by order', () => {
    build('Cube', { size: 1 });
    build('Cube/Second', { x: 1 }, { order: 2 });
    build('Cube/First', { x: 1 }, { order: 1 });

    expect(labelsIn(folderAt(inspector, 'Cube'))).toEqual(['size', 'First', 'Second']);
  });

  it('leaves an inline folder() where the schema declared it', () => {
    build('Cube', { size: 1, Inline: { __control: 'folder', schema: { x: 1 }, settings: {} } });

    expect(labelsIn(folderAt(inspector, 'Cube'))).toEqual(['size', 'Inline']);
  });

  // A container is built at order 0, so the sibling has to sit above a 0 for the restamp to be the
  // only thing that can put the owner back on top.
  it('gives a root container its real order when its owner arrives', () => {
    build('Zulu/Sub', { x: 1 });
    build('Alpha', { x: 1 }, { order: -1 });
    build('Zulu', { x: 1 }, { order: -5 });

    expect(rootTitles()).toEqual(['Zulu', 'Alpha']);
  });

  it('gives a nested container its real order when its owner arrives', () => {
    build('Cube/Beta/Deep', { x: 1 });
    build('Cube/Alpha', { x: 1 }, { order: -1 });
    build('Cube/Beta', { x: 1 }, { order: -5 });

    expect(labelsIn(folderAt(inspector, 'Cube'))).toEqual(['Beta', 'Alpha']);
  });
});

describe('leaks', () => {
  it('leaves no folder, group or row behind over many rebuilds', () => {
    for (let i = 0; i < 50; i++) {
      const teardown = build('Cube/Pattern/Shape', { a: 1 });
      teardown();
    }

    expect(rootTitles()).toEqual([]);
    expect(groups(inspector)).toHaveLength(0);
  });

  it('does not retain rows in a folder that outlives them', () => {
    const keep = build('Cube/Pattern', { a: 1 });
    const cube = groups(inspector)[0] as { objects: unknown[] };

    for (let i = 0; i < 50; i++) build('Cube', { b: 2 })();

    expect(cube.objects).toHaveLength(0);
    expect(labelsIn(folderAt(inspector, 'Cube'))).toEqual(['Pattern']);

    keep();

    expect(groups(inspector)).toHaveLength(0);
  });

  it('starts a fresh tree for a new inspector, since the old folders went with the old one', () => {
    build('Cube/Pattern', { a: 1 });

    const next = makeInspector();
    buildControls(next, 'Cube/Pattern', { a: 1 }, {}, vi.fn());

    expect(labelsIn(folderAt(next, 'Cube'))).toEqual(['Pattern']);
    expect(groups(next)).toHaveLength(1);
  });

  it('ignores a release for a path that is already gone', () => {
    const teardown = build('Cube/Pattern', { a: 1 });

    teardown();

    expect(() => teardown()).not.toThrow();
    expect(rootTitles()).toEqual([]);
  });
});

describe('cost', () => {
  it('schedules no animation frame while resolving, building or tearing down a path', () => {
    const raf = vi.spyOn(globalThis, 'requestAnimationFrame');

    const deep = build('Cube/Pattern/Shape', { a: 1 });
    const cube = build('Cube', { b: 2 });
    cube();
    deep();

    expect(raf).not.toHaveBeenCalled();

    raf.mockRestore();
  });

  it('reuses a folder instead of rebuilding it', () => {
    const create = vi.spyOn(inspector, 'createParameters');

    build('Cube/Pattern', { a: 1 });
    build('Cube/Shape', { b: 2 });
    build('Cube', { c: 3 });

    expect(create).toHaveBeenCalledOnce();
    expect(create).toHaveBeenCalledWith('Cube');

    create.mockRestore();
  });
});

/** `Item.toggle` marks the open state on the row and the closed state on the children container. */
const isClosed = (folder: HTMLElement) =>
  folder.querySelector(':scope > .list-children-container')?.classList.contains('closed') ?? false;

describe('collapsed on a merged folder', () => {
  it('opens when no registration asks otherwise', () => {
    build('Cube', { size: 1 });
    build('Cube', { spin: 2 });

    expect(isClosed(folderAt(inspector, 'Cube'))).toBe(false);
  });

  it('closes when the first registration asks, and the second does not reopen it', () => {
    build('Cube', { size: 1 }, { collapsed: true });
    build('Cube', { spin: 2 });

    expect(isClosed(folderAt(inspector, 'Cube'))).toBe(true);
  });

  it('closes when the second registration asks, having been left open by the first', () => {
    build('Cube', { size: 1 });
    build('Cube', { spin: 2 }, { collapsed: true });

    expect(isClosed(folderAt(inspector, 'Cube'))).toBe(true);
  });

  it('collapses a path folder without collapsing its parent', () => {
    build('Cube', { size: 1 });
    build('Cube/Pattern', { speed: 2 }, { collapsed: true });

    expect(isClosed(folderAt(inspector, 'Cube'))).toBe(false);
    expect(isClosed(folderAt(inspector, 'Cube/Pattern'))).toBe(true);
  });
});

describe('isolation inside a shared folder', () => {
  it('does not re-render the component when a nested shader row changes', async () => {
    const { isoSpeed } = controls('Iso/Shader', { isoSpeed: 2 });

    let renders = 0;
    renderHook(() => {
      renders++;

      return useControls('Iso', { size: 4 });
    });

    await act(async () => setInspector(inspector));
    const settled = renders;

    await act(async () => {
      await set(rowFor(inspector, 'isoSpeed'), 9);
    });

    expect(isoSpeed.value).toBe(9);
    expect(renders).toBe(settled);
  });

  it('does not touch the shader uniform when the component row changes', async () => {
    const { bothSpeed } = controls('Both/Shader', { bothSpeed: 2 });
    const { result } = renderHook(() => useControls('Both', { size: 4 }));

    await act(async () => setInspector(inspector));
    await act(async () => {
      await set(rowFor(inspector, 'size'), 7);
    });

    expect(result.current).toEqual({ size: 7 });
    expect(bothSpeed.value).toBe(2);
  });
});

describe('across the two entry points', () => {
  it('nests a module-scope shader folder under a component folder', async () => {
    // `controls` subscribes at module scope and so builds first, before the hook's effect — which
    // is the arrival order the sort has to survive.
    const { objSpeed } = controls('Obj/Shader', { objSpeed: 2 });
    renderHook(() => useControls('Obj', { size: 4 }));

    await act(async () => setInspector(inspector));

    expect(labelsIn(folderAt(inspector, 'Obj'))).toEqual(['size', 'Shader']);

    await act(async () => {
      await set(rowFor(inspector, 'objSpeed'), 9);
    });

    expect(objSpeed.value).toBe(9);
  });

  it('leaves the shader folder standing when the component unmounts', async () => {
    controls('Kept/Shader', { keptSpeed: 2 });
    const view = renderHook(() => useControls('Kept', { size: 4 }));

    await act(async () => setInspector(inspector));
    await act(async () => view.unmount());

    expect(labelsIn(folderAt(inspector, 'Kept'))).toEqual(['Shader']);
  });

  it('still re-renders the component through a shared folder', async () => {
    controls('Live/Shader', { liveSpeed: 2 });
    const { result } = renderHook(() => useControls('Live', { size: 4 }));

    await act(async () => setInspector(inspector));
    await act(async () => {
      await set(rowFor(inspector, 'size'), 7);
    });

    expect(result.current).toEqual({ size: 7 });
  });
});
