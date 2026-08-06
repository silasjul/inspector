// @vitest-environment node

import { describe, expect, it, vi } from 'vitest';

/**
 * `controls()` is called at module scope from shader modules, and Next evaluates those on the
 * server. One entry point means that import also pulls in the renderer and its module-scope
 * `extend(THREE)`, so the whole barrel has to survive with no DOM at all.
 */

describe('the package on the server', () => {
  it('imports with no window and no document', async () => {
    expect(globalThis.document).toBeUndefined();

    await expect(import('../src/index')).resolves.toBeDefined();
  });

  it('still seeds every uniform from the schema', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { controls } = await import('../src/index');

    const { size, tint, pos } = controls('Server', {
      size: 4,
      tint: '#ff006e',
      pos: { x: 1, y: 2, z: 3 },
    });

    expect(size.value).toBe(4);
    expect(pos.value).toMatchObject({ x: 1, y: 2, z: 3 });
    // Resolved without a canvas — the hex and CSS-name fallback is the whole point.
    expect(tint.value).toMatchObject({ isColor: true });
  });

  it('resolves a CSS colour name without a canvas to parse it', async () => {
    const { toHex } = await import('../src/schema');

    expect(toHex('royalblue')).toBe('#4169e1');
    expect(toHex('hello')).toBeNull();
  });
});
