import type { Inspector } from 'three/addons/inspector/Inspector.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { button, buildControls, folder } from '../src/schema';
import { controlOf, groups, labelOf, makeInspector, rootList, rowFor, rows, set } from './helpers';

let inspector: Inspector;

beforeEach(() => {
  localStorage.clear();
  inspector = makeInspector();
});

const build = (schema: Record<string, unknown>, name: string | undefined = 'F', settings = {}) => {
  const onValues = vi.fn();
  const teardown = buildControls(inspector, name, schema, settings, onValues);

  return { onValues, teardown };
};

describe('widget dispatch', () => {
  it('builds the control the schema asks for', () => {
    build({
      drag: 4,
      slide: { value: 4, min: 0, max: 10, step: 1 },
      flag: true,
      tint: '#c98f5a',
      text: 'hello',
      mode: { options: ['a', 'b'] },
    });

    expect(controlOf(rowFor(inspector, 'drag'))).toHaveProperty('type', 'number');
    expect(controlOf(rowFor(inspector, 'slide'))).toHaveProperty('type', 'range');
    expect(controlOf(rowFor(inspector, 'flag'))).toHaveProperty('type', 'checkbox');
    expect(controlOf(rowFor(inspector, 'tint'))).toHaveProperty('type', 'color');
    expect(controlOf(rowFor(inspector, 'text'))).toHaveProperty('type', 'text');
    expect(controlOf(rowFor(inspector, 'mode'))).toBeInstanceOf(HTMLSelectElement);
  });

  it('lays a vector out as one row of numbers', () => {
    build({ pos: { x: 1, y: 2, z: 3 } });
    const row = rowFor(inspector, 'pos');

    expect(row.querySelector('.param-control-vector')).not.toBeNull();
    expect(row.querySelectorAll('input[type=number]')).toHaveLength(3);
    expect([...row.querySelectorAll('input')].map((input) => input.title)).toEqual(['x', 'y', 'z']);
  });

  it('builds a button whose label is the schema key', () => {
    const onClick = vi.fn();
    build({ Save: button(onClick) });

    expect(rowFor(inspector, 'Save').querySelector('button')).not.toBeNull();
  });

  it('renames a row with label', () => {
    build({ size: { value: 1, label: 'Radius' } });

    expect(() => rowFor(inspector, 'Radius')).not.toThrow();
  });

  it('nests a folder and flattens its values', () => {
    const { onValues } = build({ top: 1, group: folder({ inner: 2 }) });

    expect(onValues).toHaveBeenLastCalledWith({ top: 1, inner: 2 });
    expect(rows(inspector).map(labelOf)).toContain('inner');
  });
});

describe('change propagation', () => {
  it('reports a new value and fires onChange', async () => {
    const onChange = vi.fn();
    const { onValues } = build({ size: { value: 1, onChange, transient: false } });

    await set(rowFor(inspector, 'size'), 7);

    expect(onChange).toHaveBeenCalledWith(7);
    expect(onValues).toHaveBeenLastCalledWith({ size: 7 });
  });

  it('normalises a colour to #rrggbb before anyone reads it', () => {
    const { onValues } = build({ tint: 'royalblue' });

    expect(onValues).toHaveBeenLastCalledWith({ tint: '#4169e1' });
  });

  it('applies a bound the number input was deliberately never given', async () => {
    const { onValues } = build({ size: { value: 5, min: 0 } });

    await set(rowFor(inspector, 'size'), -20);

    expect(onValues).toHaveBeenLastCalledWith({ size: 0 });
  });

  it('holds the last value when a number input is emptied', async () => {
    const { onValues } = build({ size: { value: 5, min: 0 } });

    await set(rowFor(inspector, 'size'), '');

    expect(onValues).toHaveBeenLastCalledWith({ size: 5 });
  });

  it('pushes an interval rather than letting its ends cross', async () => {
    const { onValues } = build({ range: { value: [2, 8], min: 0, max: 10 } });

    await set(rowFor(inspector, 'range'), 9, 0);

    expect(onValues).toHaveBeenLastCalledWith({ range: [9, 9] });
  });

  it('keeps a vector in the shape it was given', async () => {
    const { onValues } = build({ pos: { x: 1, y: 2 } });

    await set(rowFor(inspector, 'pos'), 5, 1);

    expect(onValues).toHaveBeenLastCalledWith({ pos: { x: 1, y: 5 } });
  });
});

describe('row options', () => {
  it('puts a hint on the row title', () => {
    build({ size: { value: 1, hint: 'in metres' } });

    expect(rowFor(inspector, 'size').title).toBe('in metres');
  });

  it('disables every field in a row', () => {
    build({ pos: { value: { x: 1, y: 2 }, disabled: true } });

    const fields = rowFor(inspector, 'pos').querySelectorAll('input');

    expect([...fields].every((field) => field.disabled)).toBe(true);
  });

  it('hides a row whose render predicate is false, and reveals it on change', async () => {
    build({
      advanced: false,
      detail: { value: 1, render: (get: (key: string) => unknown) => get('advanced') === true },
    });

    expect(rowFor(inspector, 'detail').style.display).toBe('none');

    await set(rowFor(inspector, 'advanced'), true);

    expect(rowFor(inspector, 'detail').style.display).toBe('');
  });
});

describe('transient rows do not push a render', () => {
  it('reports nothing when only a transient row changed', async () => {
    const onChange = vi.fn();
    const { onValues } = build({ kept: 1, quiet: { value: 2, onChange } });

    onValues.mockClear();
    await set(rowFor(inspector, 'quiet'), 5);

    expect(onChange).toHaveBeenCalledWith(5);
    expect(onValues).not.toHaveBeenCalled();
  });

  it('still reports when a returned row changed', async () => {
    const { onValues } = build({ kept: 1, quiet: { value: 2, onChange: vi.fn() } });

    onValues.mockClear();
    await set(rowFor(inspector, 'kept'), 9);

    expect(onValues).toHaveBeenCalledOnce();
    expect(onValues).toHaveBeenLastCalledWith({ kept: 9 });
  });

  it('still re-runs conditionals, since a predicate can read a transient key', async () => {
    build({
      advanced: { value: false, onChange: vi.fn() },
      detail: { value: 1, render: (get: (key: string) => unknown) => get('advanced') === true },
    });

    await set(rowFor(inspector, 'advanced'), true);

    expect(rowFor(inspector, 'detail').style.display).toBe('');
  });
});

describe('ordering', () => {
  it('orders rows within a folder', () => {
    build({ c: { value: 1, order: 2 }, a: { value: 1, order: -1 }, b: 1 });

    expect(rows(inspector).map(labelOf)).toEqual(['a', 'b', 'c']);
  });

  it('orders folders against each other', () => {
    buildControls(inspector, 'Second', { a: 1 }, { order: 2 }, vi.fn());
    buildControls(inspector, 'First', { b: 1 }, { order: 1 }, vi.fn());

    const headers = [...rootList(inspector).children].map(
      (child) => child.querySelector('.list-item-cell')?.textContent?.trim()
    );

    expect(headers.indexOf('First')).toBeLessThan(headers.indexOf('Second'));
  });

  it('pins an unnamed schema below every folder', () => {
    buildControls(inspector, 'Folder', { a: 1 }, { order: 50 }, vi.fn());
    buildControls(inspector, undefined, { loose: 1 }, {}, vi.fn());

    const top = [...rootList(inspector).children].map(
      (child) => child.querySelector('.list-item-cell')?.textContent?.trim()
    );

    expect(top.indexOf('loose')).toBeGreaterThan(top.indexOf('Folder'));
  });
});

describe('teardown', () => {
  it('removes the rows it built', () => {
    const { teardown } = build({ a: 1, b: 2 });
    expect(rows(inspector)).toHaveLength(2);

    teardown();

    expect(rows(inspector)).toHaveLength(0);
  });

  it('removes loose rows built without a folder name', () => {
    const { teardown } = build({ a: 1, b: 2 }, undefined);
    expect(rows(inspector)).toHaveLength(2);

    teardown();

    expect(rows(inspector)).toHaveLength(0);
  });

  it('drops the group from the registry the addon never cleans', () => {
    const before = groups(inspector).length;
    const { teardown } = build({ a: 1 });

    expect(groups(inspector).length).toBe(before + 1);

    teardown();

    expect(groups(inspector).length).toBe(before);
  });

  it('leaks neither rows nor groups over many rebuilds', () => {
    const before = groups(inspector).length;

    for (let i = 0; i < 50; i++) {
      const { teardown } = build({ a: 1, group: folder({ b: 2 }) });
      teardown();
    }

    expect(groups(inspector).length).toBe(before);
    expect(rows(inspector)).toHaveLength(0);
  });
});
