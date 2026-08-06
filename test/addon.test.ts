import type { Inspector } from 'three/addons/inspector/Inspector.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { hex, onInspector, releaseInspector, setInspector } from '../src/addon';

/** Only identity matters to the singleton, so a token stands in for a real Inspector. */
const fake = (name: string) => ({ name }) as unknown as Inspector;

afterEach(() => setInspector(null));

describe('hex', () => {
  it('pads a packed int to six digits — the addon reports one and skips padStart', () => {
    expect(hex(0x0000ff)).toBe('#0000ff');
    expect(hex(0x0a0b0c)).toBe('#0a0b0c');
    expect(hex(0x000000)).toBe('#000000');
    expect(hex(0xffffff)).toBe('#ffffff');
  });

  it('passes a string through, adding the # when it is missing', () => {
    expect(hex('#c98f5a')).toBe('#c98f5a');
    expect(hex('c98f5a')).toBe('#c98f5a');
  });

  it('falls back to black for anything else', () => {
    expect(hex(undefined)).toBe('#000000');
    expect(hex(null)).toBe('#000000');
  });
});

describe('the inspector singleton', () => {
  it('fires a new listener immediately with whatever exists now', () => {
    const listener = vi.fn();
    const stop = onInspector(listener);

    expect(listener).toHaveBeenCalledExactlyOnceWith(null);
    stop();
  });

  it('fires again each time the renderer builds one', () => {
    const listener = vi.fn();
    const stop = onInspector(listener);
    const a = fake('a');

    setInspector(a);

    expect(listener).toHaveBeenLastCalledWith(a);
    expect(listener).toHaveBeenCalledTimes(2);
    stop();
  });

  it('fires with null on teardown, which is what lets a hook drop its rows', () => {
    const listener = vi.fn();
    setInspector(fake('a'));
    const stop = onInspector(listener);

    setInspector(null);

    expect(listener).toHaveBeenLastCalledWith(null);
    stop();
  });

  it('stops calling an unsubscribed listener', () => {
    const listener = vi.fn();
    onInspector(listener)();

    setInspector(fake('a'));

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('gives a late subscriber the inspector that already exists', () => {
    const a = fake('a');
    setInspector(a);

    const listener = vi.fn();
    const stop = onInspector(listener);

    expect(listener).toHaveBeenCalledExactlyOnceWith(a);
    stop();
  });
});

describe('releaseInspector', () => {
  it('clears the singleton when the disposed renderer owned it', () => {
    const listener = vi.fn();
    const a = fake('a');
    setInspector(a);
    const stop = onInspector(listener);

    releaseInspector(a);

    expect(listener).toHaveBeenLastCalledWith(null);
    stop();
  });

  it('is a no-op when a newer renderer has already taken over', () => {
    const a = fake('a');
    const b = fake('b');
    setInspector(a);
    setInspector(b);

    const listener = vi.fn();
    const stop = onInspector(listener);
    releaseInspector(a);

    expect(listener).toHaveBeenCalledExactlyOnceWith(b);
    stop();
  });
});
