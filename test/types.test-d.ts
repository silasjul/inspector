import { describe, expectTypeOf, it } from 'vitest';
import { controls } from '../src/controls';
import { button, folder } from '../src/schema';
import { useControls } from '../src/useControls';

describe('useControls return type', () => {
  it('unwraps a spec to its value type', () => {
    const values = useControls('F', { size: { value: 4, min: 0, max: 10, step: 1 } });

    expectTypeOf(values.size).toEqualTypeOf<number>();
  });

  it('widens a bare literal, so a value stays assignable to its base type', () => {
    const values = useControls('F', { size: 4, on: true, name: 'hello' });

    expectTypeOf(values.size).toEqualTypeOf<number>();
    expectTypeOf(values.on).toEqualTypeOf<boolean>();
    expectTypeOf(values.name).toEqualTypeOf<string>();
  });

  it('keeps a vector mutable rather than a readonly tuple', () => {
    const values = useControls('F', { pos: [0, 0, 0], uv: { x: 0, y: 0 } });

    expectTypeOf(values.pos).toEqualTypeOf<number[]>();
    expectTypeOf(values.uv).toEqualTypeOf<{ x: number; y: number }>();
  });

  it('narrows a dropdown to its options', () => {
    const values = useControls('F', {
      mode: { options: ['a', 'b'] },
      level: { options: { Low: 1, High: 2 } },
    });

    expectTypeOf(values.mode).toEqualTypeOf<'a' | 'b'>();
    // A label map narrows to its values too — `options` is deliberately left un-widened.
    expectTypeOf(values.level).toEqualTypeOf<1 | 2>();
  });

  it('leaves buttons out', () => {
    const values = useControls('F', { size: 4, Save: button(() => {}) });

    expectTypeOf(values).not.toHaveProperty('Save');
    expectTypeOf(values).toHaveProperty('size');
  });

  it('leaves a transient input out', () => {
    const values = useControls('F', { size: 4, quiet: { value: 2, onChange: () => {} } });

    expectTypeOf(values).not.toHaveProperty('quiet');
  });

  it('keeps an onChange input when transient is explicitly false', () => {
    const values = useControls('F', {
      size: 4,
      loud: { value: 2, onChange: (v: number) => v, transient: false },
    });

    expectTypeOf(values.loud).toEqualTypeOf<number>();
  });

  it('flattens folder values, however deep', () => {
    const values = useControls('F', {
      top: 1,
      group: folder({ inner: 'hello', deeper: folder({ bottom: true }) }),
    });

    expectTypeOf(values.top).toEqualTypeOf<number>();
    expectTypeOf(values.inner).toEqualTypeOf<string>();
    expectTypeOf(values.bottom).toEqualTypeOf<boolean>();
    expectTypeOf(values).not.toHaveProperty('group');
  });
});

describe('controls return type', () => {
  it('hands back a node, not a value', () => {
    const nodes = controls('F', { size: 4 });

    expectTypeOf(nodes.size).not.toBeNumber();
    expectTypeOf(nodes.size).toHaveProperty('value');
  });

  it('follows the same transient and button rules', () => {
    const nodes = controls('F', {
      size: 4,
      Save: button(() => {}),
      quiet: { value: 2, onChange: () => {} },
    });

    expectTypeOf(nodes).not.toHaveProperty('Save');
    expectTypeOf(nodes).not.toHaveProperty('quiet');
    expectTypeOf(nodes).toHaveProperty('size');
  });

  it('flattens folders too', () => {
    const nodes = controls('F', { top: 1, group: folder({ inner: true }) });

    expectTypeOf(nodes).toHaveProperty('inner');
    expectTypeOf(nodes).not.toHaveProperty('group');
  });

  it('requires a folder name, since an unnamed one would collide with every other', () => {
    // @ts-expect-error the schema alone is not a valid call
    controls({ size: 4 });
  });
});
