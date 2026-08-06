import type { Inspector } from 'three/addons/inspector/Inspector.js';
import { getParametersTab } from './addon';
import { useToggle, type Toggle, type ToggleOptions } from './toggle';

/**
 * Hides the Parameters tab alone — its rows, its tab button and its slice of the mini-panel — and
 * leaves the rest of the profiler up. `Tab.hide()` is the Inspector's own mechanism for this; it
 * builds the tab hidden and calls exactly this.
 *
 * The catch is `createParameters`, which calls `show()` whenever `isVisible` is false. Every folder
 * built while the tab is toggled off would pop it back open — a Fast Refresh, or any component
 * mounting with a `useControls` in it. Intercepting `show()` is what makes the toggle stick, and it
 * keeps `isVisible` honest: the profiler reads it to choose an active tab and to size the panel, so
 * lying to hold the tab down would leave it activating a tab with nothing in it.
 *
 * Module-level, so `useToggle` can depend on it honestly.
 */
function bindParameters(inspector: Inspector): Toggle {
  const tab = getParametersTab(inspector);
  const show = tab.show;
  let closed = false;

  const reveal = () => show.call(tab);

  tab.show = () => {
    if (closed) return;

    reveal();
  };

  return {
    apply: (visible) => {
      closed = !visible;

      if (!visible) {
        tab.hide();

        return;
      }

      // Nothing to reveal until a folder exists, and forcing it open would show the empty tab the
      // Inspector deliberately starts hidden. The next `createParameters` passes through instead.
      if (tab.groups.length > 0) reveal();
    },

    // Leaving the override in place would outlive the hook and hold the tab down permanently.
    // Deleting the own property restores the prototype's `show` rather than shadowing it with a
    // copy, so nothing here is observable afterwards.
    release: () => {
      Reflect.deleteProperty(tab, 'show');

      if (closed && tab.groups.length > 0) reveal();
    },
  };
}

/**
 * Hides and reveals the Parameters tab — your rows — leaving the FPS bar and the other tabs alone.
 * For the whole inspector at once, use `useInspectorToggle`.
 *
 * In production no Inspector is attached unless you asked for one, so this no-ops.
 */
export function useParametersToggle({ shortcut = 'h', open = true }: ToggleOptions = {}) {
  useToggle(shortcut, open, bindParameters);
}
