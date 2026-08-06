import { Color, Vector2, Vector3 } from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setInspector } from '../src/addon';
import { button, controls, folder } from '../src/controls';

/**
 * With no Inspector attached — production, and the server — every row must still come back as a
 * uniform seeded from the schema, because the TSL graph is built from these nodes either way.
 */

let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  warn.mockRestore();
  setInspector(null);
});

describe('uniform bindings', () => {
  it('binds a number to a float uniform', () => {
    const { size } = controls('N1', { size: 4 });

    expect(size.value).toBe(4);
    expect(size.isUniformNode).toBe(true);
  });

  it('binds a bounded number the same way', () => {
    const { size } = controls('N2', { size: { value: 4, min: 0, max: 10, step: 0.5 } });

    expect(size.value).toBe(4);
  });

  it('binds a boolean to a bool uniform', () => {
    const { on } = controls('N3', { on: true });

    expect(on.value).toBe(true);
    expect(on.isUniformNode).toBe(true);
  });

  it('binds a colour string to a Color uniform', () => {
    const { tint } = controls('N4', { tint: '#ff006e' });

    expect(tint.value).toBeInstanceOf(Color);
    expect((tint.value as unknown as Color).getHexString()).toBe('ff006e');
  });

  it('binds a CSS colour name too, since toHex resolves it without a canvas', () => {
    const { tint } = controls('N5', { tint: 'royalblue' });

    expect((tint.value as unknown as Color).getHexString()).toBe('4169e1');
  });

  it('binds a two-axis value to a vec2, from a record or a pair', () => {
    const { a, b } = controls('N6', { a: { x: 1, y: 2 }, b: [3, 4] });

    expect(a.value).toBeInstanceOf(Vector2);
    expect(a.value).toMatchObject({ x: 1, y: 2 });
    expect(b.value).toBeInstanceOf(Vector2);
    expect(b.value).toMatchObject({ x: 3, y: 4 });
  });

  it('binds a three-axis value to a vec3, from a record or a triple', () => {
    const { a, b } = controls('N7', { a: { x: 1, y: 2, z: 3 }, b: [4, 5, 6] });

    expect(a.value).toBeInstanceOf(Vector3);
    expect(a.value).toMatchObject({ x: 1, y: 2, z: 3 });
    expect(b.value).toMatchObject({ x: 4, y: 5, z: 6 });
  });

  it('binds an interval to a vec2', () => {
    const { range } = controls('N8', { range: { value: [1, 5], min: 0, max: 10 } });

    expect(range.value).toBeInstanceOf(Vector2);
    expect(range.value).toMatchObject({ x: 1, y: 5 });
  });

  it('flattens a nested folder, exactly as useControls does', () => {
    const { top, inner } = controls('N9', { top: 1, group: folder({ inner: 2 }) });

    expect(top.value).toBe(1);
    expect(inner.value).toBe(2);
  });
});

describe('rows TSL has no node for', () => {
  it('returns text as a plain value, not a node', () => {
    const { label } = controls('P1', { label: 'hello' });

    expect(label).toBe('hello');
  });

  it('returns a dropdown as a plain value', () => {
    const { mode } = controls('P2', { mode: { options: ['low', 'high'] } });

    expect(mode).toBe('low');
  });

  it('leaves buttons and transient rows out entirely', () => {
    const result = controls('P3', {
      keep: 1,
      go: button(() => {}),
      quiet: { value: 2, onChange: () => {} },
    });

    expect(Object.keys(result)).toEqual(['keep']);
  });
});

describe('folder registration', () => {
  it('replaces a folder of the same name rather than stacking a second one', () => {
    controls('Dup', { a: 1 });
    const second = controls('Dup', { a: 2 });

    expect(second.a.value).toBe(2);
  });

  it('warns on replacement, because Fast Refresh and a name clash look identical', () => {
    controls('Dup2', { a: 1 });
    expect(warn).not.toHaveBeenCalled();

    controls('Dup2', { a: 2 });

    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0][0]).toContain("controls('Dup2')");
  });

  it('keeps differently named folders independent', () => {
    const a = controls('A', { v: 1 });
    const b = controls('B', { v: 2 });

    controls('A', { v: 3 });

    expect(b.v.value).toBe(2);
    expect(a.v.value).toBe(1);
  });
});
