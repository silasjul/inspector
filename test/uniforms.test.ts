import { Color } from 'three';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setInspector } from '../src/addon';
import { controls } from '../src/controls';
import { makeInspector, rowFor, set } from './helpers';

/**
 * The point of the whole module: a panel drag reaches a shader by writing `node.value`, with no
 * React, no re-render and no recompile.
 *
 * `controls()` registrations live for the lifetime of the module, so every folder built in this file
 * rebuilds into each new Inspector. Row keys are therefore unique per test, or `rowFor` would match
 * an earlier test's row.
 */

let inspector: ReturnType<typeof makeInspector>;

beforeEach(() => {
  localStorage.clear();
  inspector = makeInspector();
});

afterEach(() => setInspector(null));

describe('panel writes reach the uniform', () => {
  it('writes node.value, and never swaps the node', async () => {
    const { alpha } = controls('U1', { alpha: 4 });
    const node = alpha;

    setInspector(inspector);
    await set(rowFor(inspector, 'alpha'), 9);

    expect(alpha.value).toBe(9);
    expect(alpha).toBe(node);
  });

  it('holds the last value rather than writing NaN into the shader', async () => {
    const { beta } = controls('U2', { beta: 4 });

    setInspector(inspector);
    await set(rowFor(inspector, 'beta'), '');

    expect(beta.value).toBe(4);
  });

  it('clamps to a declared bound the input was never given', async () => {
    const { gamma } = controls('U3', { gamma: { value: 5, min: 0 } });

    setInspector(inspector);
    await set(rowFor(inspector, 'gamma'), -20);

    expect(gamma.value).toBe(0);
  });

  it('mutates the Color in place instead of replacing it', async () => {
    const { delta } = controls('U4', { delta: '#ff0000' });
    const instance = delta.value;

    setInspector(inspector);
    await set(rowFor(inspector, 'delta'), '#00ff00');

    expect((delta.value as unknown as Color).getHexString()).toBe('00ff00');
    expect(delta.value).toBe(instance);
  });

  it('mutates a vector in place across all its axes', async () => {
    const { epsilon } = controls('U5', { epsilon: { x: 1, y: 2 } });
    const instance = epsilon.value;

    setInspector(inspector);
    await set(rowFor(inspector, 'epsilon'), 7, 1);

    expect(epsilon.value).toMatchObject({ x: 1, y: 7 });
    expect(epsilon.value).toBe(instance);
  });

  it('keeps a dropdown current as a plain value', async () => {
    const result = controls('U6', { zeta: { options: ['low', 'high'] } });

    setInspector(inspector);
    await set(rowFor(inspector, 'zeta'), 'high');

    expect(result.zeta).toBe('high');
  });
});
