import { useEffect, useRef } from 'react';
import type { Inspector } from 'three/addons/inspector/Inspector.js';
import { onInspector } from './addon';

export type ToggleOptions = {
  /** Key that hides and reveals it. */
  shortcut?: string;
  /** Whether it is visible on mount. */
  open?: boolean;
};

/** What a toggle target hands back: how to apply a visibility, and how to let go of the target. */
export type Toggle = {
  apply: (visible: boolean) => void;
  release?: () => void;
};

/**
 * The machinery both toggles share: one key bound to one boolean, re-applied to whichever Inspector
 * is current. The renderer builds a new one on every Fast Refresh, so `bind` runs per Inspector and
 * the flag outlives all of them.
 *
 * `bind` must be module-level in the calling hook, so its identity is stable and it can sit in the
 * dependency array honestly rather than behind a lint suppression.
 */
export function useToggle(
  shortcut: string,
  open: boolean,
  bind: (inspector: Inspector) => Toggle
) {
  const visible = useRef(open);

  useEffect(() => {
    visible.current = open;

    let detach: (() => void) | undefined;

    const stop = onInspector((inspector) => {
      detach?.();
      detach = undefined;

      if (!inspector) return;

      const { apply, release } = bind(inspector);
      apply(visible.current);

      const onKeyDown = (e: KeyboardEvent) => {
        if (e.key.toLowerCase() !== shortcut) return;

        const target = e.target as HTMLElement;
        if (target.isContentEditable) return;
        if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;

        visible.current = !visible.current;
        apply(visible.current);
      };

      window.addEventListener('keydown', onKeyDown);

      detach = () => {
        window.removeEventListener('keydown', onKeyDown);
        release?.();
      };
    });

    return () => {
      stop();
      detach?.();
    };
  }, [shortcut, open, bind]);
}
