import { act, cleanup, renderHook } from '@testing-library/react';
import type { Inspector } from 'three/addons/inspector/Inspector.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setInspector } from '../src/addon';
import { useControls } from '../src/useControls';
import { useParameters } from '../src/useParameters';
import { useParametersToggle } from '../src/useParametersToggle';
import { useInspectorToggle } from '../src/useInspectorToggle';
import { flush, labelOf, makeInspector, parametersTab, rowFor, rows, set } from './helpers';

let inspector: Inspector;

beforeEach(() => {
  localStorage.clear();
  inspector = makeInspector();
});

afterEach(() => {
  cleanup();
  setInspector(null);
});

/** Panel changes land in a deferred callback, so React has to be told the frame counts as an act. */
const change = (label: string, value: unknown, axis = 0) =>
  act(async () => {
    await set(rowFor(inspector, label), value, axis);
  });

describe('useControls', () => {
  it('returns the schema values before any inspector exists', () => {
    const { result } = renderHook(() => useControls('F', { size: 4, tint: '#ff0000' }));

    expect(result.current).toEqual({ size: 4, tint: '#ff0000' });
  });

  it('builds its folder when a renderer finally attaches', async () => {
    renderHook(() => useControls('F', { size: 4 }));
    expect(rows(inspector)).toHaveLength(0);

    await act(async () => setInspector(inspector));

    expect(rows(inspector).map(labelOf)).toEqual(['size']);
  });

  it('re-renders with the new value when the panel changes', async () => {
    const { result } = renderHook(() => useControls('F', { size: 4 }));
    await act(async () => setInspector(inspector));

    await change('size', 9);

    expect(result.current).toEqual({ size: 9 });
  });

  it('normalises a colour on build, so React sees what the panel holds', async () => {
    const { result } = renderHook(() => useControls('F', { tint: 'royalblue' }));

    await act(async () => setInspector(inspector));

    expect(result.current).toEqual({ tint: '#4169e1' });
  });

  it('flattens a nested folder into one object', async () => {
    const { result } = renderHook(() =>
      useControls('F', { top: 1, group: { __control: 'folder', schema: { inner: 2 }, settings: {} } })
    );

    await act(async () => setInspector(inspector));

    expect(result.current).toEqual({ top: 1, inner: 2 });
  });

  it('drops its rows when the renderer goes away', async () => {
    renderHook(() => useControls('F', { size: 4 }));
    await act(async () => setInspector(inspector));
    expect(rows(inspector)).toHaveLength(1);

    await act(async () => setInspector(null));

    expect(rows(inspector)).toHaveLength(0);
  });

  it('removes its folder on unmount', async () => {
    const { unmount } = renderHook(() => useControls('F', { size: 4 }));
    await act(async () => setInspector(inspector));

    unmount();

    expect(rows(inspector)).toHaveLength(0);
  });

  it('keeps two components in separate folders', async () => {
    renderHook(() => useControls('A', { one: 1 }));
    renderHook(() => useControls('B', { two: 2 }));

    await act(async () => setInspector(inspector));

    expect(rows(inspector).map(labelOf).sort()).toEqual(['one', 'two']);
  });
});

describe('re-render cost', () => {
  const counted = (schema: Record<string, unknown>) => {
    let renders = 0;
    const hook = renderHook(() => {
      renders++;

      return useControls('F', schema);
    });

    return { ...hook, count: () => renders };
  };

  it('does not re-render when a transient row changes', async () => {
    const onChange = vi.fn();
    const { count } = counted({ kept: 1, quiet: { value: 2, onChange } });
    await act(async () => setInspector(inspector));

    const before = count();
    await change('quiet', 5);

    expect(onChange).toHaveBeenCalledWith(5);
    expect(count()).toBe(before);
  });

  it('re-renders exactly once when a returned row changes', async () => {
    const { count } = counted({ kept: 1 });
    await act(async () => setInspector(inspector));

    const before = count();
    await change('kept', 9);

    expect(count()).toBe(before + 1);
  });
});

describe('rebuilding', () => {
  it('ignores a changed schema without deps, exactly as Leva does', async () => {
    const { rerender } = renderHook(({ size }) => useControls('F', { size }), {
      initialProps: { size: 1 },
    });
    await act(async () => setInspector(inspector));

    await act(async () => rerender({ size: 99 }));

    expect((rowFor(inspector, 'size').querySelector('input') as HTMLInputElement).value).toBe('1');
  });

  it('rebuilds the folder when deps change', async () => {
    const { result, rerender } = renderHook(({ size }) => useControls('F', { size }, [size]), {
      initialProps: { size: 1 },
    });
    await act(async () => setInspector(inspector));

    await act(async () => rerender({ size: 99 }));

    expect(result.current).toEqual({ size: 99 });
    expect(rows(inspector)).toHaveLength(1);
  });
});

describe('useParameters', () => {
  it('binds a row straight to a live object and mutates it in place', async () => {
    const material = { wireframe: false };

    renderHook(() =>
      useParameters('Cube', (group) => {
        (group as unknown as { addBoolean: (t: object, k: string) => void }).addBoolean(
          material,
          'wireframe'
        );
      })
    );
    await act(async () => setInspector(inspector));

    await change('wireframe', true);

    expect(material.wireframe).toBe(true);
  });
});

const press = (key: string, target: EventTarget = window) =>
  act(() => {
    target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
  });

describe('useInspectorToggle', () => {
  it('hides and reveals the whole shell on its shortcut', async () => {
    renderHook(() => useInspectorToggle());
    await act(async () => setInspector(inspector));

    expect(inspector.domElement.style.display).toBe('');

    await press('h');
    expect(inspector.domElement.style.display).toBe('none');

    await press('H');
    expect(inspector.domElement.style.display).toBe('');
  });

  it('starts hidden when asked to', async () => {
    renderHook(() => useInspectorToggle({ open: false }));

    await act(async () => setInspector(inspector));

    expect(inspector.domElement.style.display).toBe('none');
  });

  it('takes a different key', async () => {
    renderHook(() => useInspectorToggle({ shortcut: 'i' }));
    await act(async () => setInspector(inspector));

    await press('h');
    expect(inspector.domElement.style.display).toBe('');

    await press('i');
    expect(inspector.domElement.style.display).toBe('none');
  });

  it('ignores the shortcut while typing into a field', async () => {
    renderHook(() => useInspectorToggle());
    await act(async () => setInspector(inspector));

    const field = document.createElement('input');
    document.body.appendChild(field);

    await press('h', field);

    expect(inspector.domElement.style.display).toBe('');
    field.remove();
  });
});

describe('useParametersToggle', () => {
  const tab = () => parametersTab(inspector);

  it('hides the Parameters tab alone, leaving the shell up', async () => {
    renderHook(() => useControls('F', { a: 1 }));
    renderHook(() => useParametersToggle());
    await act(async () => setInspector(inspector));

    expect(tab().isVisible).toBe(true);

    await press('h');
    expect(tab().isVisible).toBe(false);
    expect(tab().content.style.display).toBe('none');
    // The whole-inspector toggle's job, not this one's.
    expect(inspector.domElement.style.display).toBe('');

    await press('H');
    expect(tab().isVisible).toBe(true);
    expect(tab().content.style.display).toBe('');
  });

  it('stays hidden when a folder is built, which force-shows the tab', async () => {
    renderHook(() => useControls('F', { a: 1 }));
    renderHook(() => useParametersToggle());
    await act(async () => setInspector(inspector));

    await press('h');
    expect(tab().isVisible).toBe(false);

    // `createParameters` calls `show()` whenever `isVisible` is false — this is the pop-open.
    const { unmount } = renderHook(() => useControls('Later', { b: 2 }));
    await act(async () => flush());

    expect(tab().isVisible).toBe(false);
    expect(tab().content.style.display).toBe('none');

    unmount();
  });

  it('does not force an empty tab open before any folder exists', async () => {
    renderHook(() => useParametersToggle());
    await act(async () => setInspector(inspector));

    // The Inspector builds this tab hidden; revealing it with no rows shows an empty pane.
    expect(tab().isVisible).toBe(false);
  });

  it('restores the tab and its own show() on unmount', async () => {
    renderHook(() => useControls('F', { a: 1 }));
    const { unmount } = renderHook(() => useParametersToggle());
    await act(async () => setInspector(inspector));

    await press('h');
    expect(tab().isVisible).toBe(false);

    unmount();

    expect(tab().isVisible).toBe(true);
    // Left overridden, it would hold the tab down for every later folder.
    expect(Object.hasOwn(tab(), 'show')).toBe(false);
  });
});

describe('teardown is complete', () => {
  it('leaves nothing behind after many mount/unmount cycles', async () => {
    await act(async () => setInspector(inspector));

    for (let i = 0; i < 25; i++) {
      const { unmount } = renderHook(() => useControls('F', { a: 1, b: 2 }));
      await act(async () => flush());
      unmount();
    }

    expect(rows(inspector)).toHaveLength(0);
  });
});
