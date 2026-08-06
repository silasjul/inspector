import type { Inspector } from 'three/addons/inspector/Inspector.js';
import { useToggle, type Toggle, type ToggleOptions } from './toggle';

/**
 * Panel, mini-panel and FPS bar are all children of one shell element, so the whole inspector is a
 * display toggle on that shell. `Inspector.show()` throws and `Tab.hide()` only reaches one tab, so
 * neither is usable here; nothing reads `Inspector.getSize()`, so a hidden shell never reaches the
 * renderer.
 *
 * Module-level, so `useToggle` can depend on it honestly.
 */
function bindShell(inspector: Inspector): Toggle {
  const shell = inspector.domElement;

  return {
    apply: (visible) => {
      shell.style.display = visible ? '' : 'none';
    },
  };
}

/**
 * Hides and reveals the entire inspector — every tab, the mini-panel and the FPS bar. For hiding
 * only your own rows and leaving the profiler up, use `useParametersToggle`.
 *
 * Because it acts on the shell rather than on a tab, it survives a folder being built, so hook call
 * order doesn't matter.
 */
export function useInspectorToggle({ shortcut = 'h', open = true }: ToggleOptions = {}) {
  useToggle(shortcut, open, bindShell);
}
