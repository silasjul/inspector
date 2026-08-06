import { describe, expect, it } from 'vitest';
import {
  axisValues,
  button,
  clampInterval,
  clampNumber,
  folder,
  initialValues,
  isTransient,
  kindOf,
  ordered,
  parseArgs,
  toHex,
} from '../src/schema';

describe('parseArgs', () => {
  const schema = { a: 1 };
  const settings = { collapsed: true };
  const deps = ['x'];

  it('reads the four Leva overloads', () => {
    expect(parseArgs([schema])).toMatchObject({ name: undefined, schema, settings: {} });
    expect(parseArgs([schema, settings])).toMatchObject({ name: undefined, schema, settings });
    expect(parseArgs(['N', schema])).toMatchObject({ name: 'N', schema, settings: {} });
    expect(parseArgs(['N', schema, settings])).toMatchObject({ name: 'N', schema, settings });
  });

  it('takes a trailing deps array in place of settings', () => {
    expect(parseArgs([schema, deps])).toMatchObject({ settings: {}, deps });
    expect(parseArgs(['N', schema, deps])).toMatchObject({ name: 'N', settings: {}, deps });
  });

  it('takes deps after settings', () => {
    expect(parseArgs([schema, settings, deps])).toMatchObject({ settings, deps });
    expect(parseArgs(['N', schema, settings, deps])).toMatchObject({ name: 'N', settings, deps });
  });
});

describe('initialValues', () => {
  it('is what a hook returns before any row exists', () => {
    expect(initialValues({ size: 4, on: true, tint: '#ff0000' })).toEqual({
      size: 4,
      on: true,
      tint: '#ff0000',
    });
  });

  it('unwraps a spec to its value', () => {
    expect(initialValues({ size: { value: 4, min: 0, max: 10 } })).toEqual({ size: 4 });
  });

  it('flattens nested folders, however deep', () => {
    const schema = {
      top: 1,
      group: folder({ inner: 2, deeper: folder({ bottom: 3 }) }),
    };

    expect(initialValues(schema)).toEqual({ top: 1, inner: 2, bottom: 3 });
  });

  it('leaves buttons out', () => {
    expect(initialValues({ a: 1, go: button(() => {}) })).toEqual({ a: 1 });
  });

  it('leaves transient inputs out', () => {
    expect(initialValues({ a: 1, b: { value: 2, onChange: () => {} } })).toEqual({ a: 1 });
  });

  it('keeps an onChange input when transient is explicitly false', () => {
    const schema = { a: 1, b: { value: 2, onChange: () => {}, transient: false } };

    expect(initialValues(schema)).toEqual({ a: 1, b: 2 });
  });

  it('defaults a dropdown to its first option', () => {
    expect(initialValues({ mode: { options: ['a', 'b'] } })).toEqual({ mode: 'a' });
    expect(initialValues({ lvl: { options: { Low: 1, High: 2 } } })).toEqual({ lvl: 1 });
  });

  it('prefers an explicit dropdown value over the first option', () => {
    expect(initialValues({ mode: { value: 'b', options: ['a', 'b'] } })).toEqual({ mode: 'b' });
  });
});

describe('kindOf', () => {
  it('maps every row in the documented schema table', () => {
    expect(kindOf({ value: 4 })).toBe('number');
    expect(kindOf({ value: 4, min: 0, max: 10, step: 1 })).toBe('range');
    expect(kindOf({ value: true })).toBe('boolean');
    expect(kindOf({ value: '#c98f5a' })).toBe('color');
    expect(kindOf({ value: 'royalblue' })).toBe('color');
    expect(kindOf({ value: 'hello' })).toBe('string');
    expect(kindOf({ options: ['a', 'b'] })).toBe('select');
    expect(kindOf({ value: { x: 0, y: 0 } })).toBe('vector');
    expect(kindOf({ value: { x: 0, y: 0, z: 0 } })).toBe('vector');
    expect(kindOf({ value: [0, 0] })).toBe('vector');
    expect(kindOf({ value: [0, 0, 0] })).toBe('vector');
    expect(kindOf({ value: [1, 5], min: 0, max: 10 })).toBe('interval');
  });

  it('needs both bounds to become a slider — one alone stays a drag-input', () => {
    expect(kindOf({ value: 4, min: 0 })).toBe('number');
    expect(kindOf({ value: 4, max: 10 })).toBe('number');
  });

  it('lets options win over the value type', () => {
    expect(kindOf({ value: 2, options: [1, 2] })).toBe('select');
  });
});

describe('toHex', () => {
  it('normalises to #rrggbb', () => {
    expect(toHex('#C98F5A')).toBe('#c98f5a');
    expect(toHex('#fff')).toBe('#ffffff');
    expect(toHex('royalblue')).toBe('#4169e1');
  });

  it('returns null for a string that is not a colour', () => {
    expect(toHex('hello')).toBeNull();
    expect(toHex('')).toBeNull();
  });

  it('pads a dark colour to six digits, which is what the addon fails to do', () => {
    expect(toHex('#0a0b0c')).toBe('#0a0b0c');
    expect(toHex('black')).toBe('#000000');
  });
});

describe('clampNumber', () => {
  it('applies a bound the input was deliberately not given', () => {
    expect(clampNumber(5, 1, { min: 0 })).toBe(5);
    expect(clampNumber(-3, 1, { min: 0 })).toBe(0);
    expect(clampNumber(99, 1, { max: 10 })).toBe(10);
  });

  it('holds the previous value when the input reads back NaN', () => {
    expect(clampNumber(NaN, 7, { min: 0 })).toBe(7);
    expect(clampNumber(NaN, 7, {})).toBe(7);
  });

  it('never lets Infinity through a both-bounded row', () => {
    expect(clampNumber(Infinity, 1, { min: 0, max: 10 })).toBe(10);
    expect(clampNumber(-Infinity, 1, { min: 0, max: 10 })).toBe(0);
  });
});

describe('clampInterval', () => {
  const inputs = () => [document.createElement('input'), document.createElement('input')];

  it('leaves an ordered pair alone', () => {
    const next = [1, 5];
    clampInterval(next, 0, inputs());

    expect(next).toEqual([1, 5]);
  });

  it('pushes the other end rather than letting them cross', () => {
    const fields = inputs();
    const next = [7, 5];
    clampInterval(next, 0, fields);

    expect(next).toEqual([7, 7]);
    expect(fields[1].value).toBe('7');
  });

  it('pushes in the other direction too', () => {
    const fields = inputs();
    const next = [3, 1];
    clampInterval(next, 1, fields);

    expect(next).toEqual([1, 1]);
    expect(fields[0].value).toBe('1');
  });
});

describe('ordered', () => {
  it('sorts rows by order and leaves equals in declaration order', () => {
    const keys = ordered({
      c: { value: 1, order: 2 },
      a: { value: 1, order: -1 },
      b: 1,
      d: folder({}, { order: 5 }),
    }).map(([key]) => key);

    expect(keys).toEqual(['a', 'b', 'c', 'd']);
  });
});

describe('isTransient', () => {
  it('follows Leva: onChange makes a row transient unless told otherwise', () => {
    expect(isTransient({ value: 1 })).toBe(false);
    expect(isTransient({ value: 1, onChange: () => {} })).toBe(true);
    expect(isTransient({ value: 1, onChange: () => {}, transient: false })).toBe(false);
    expect(isTransient({ value: 1, transient: true })).toBe(true);
  });
});

describe('axisValues', () => {
  it('reads an array or an xyz record, in axis order', () => {
    expect(axisValues([1, 2, 3])).toEqual([1, 2, 3]);
    expect(axisValues({ x: 1, y: 2 })).toEqual([1, 2]);
    expect(axisValues({ z: 3, x: 1, y: 2 })).toEqual([1, 2, 3]);
  });
});
