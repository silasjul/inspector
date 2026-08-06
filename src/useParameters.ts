import { useEffect } from 'react';
import { addFolder, onInspector, type ParametersGroup } from './addon';

/**
 * The escape hatch under `useControls`: one folder built straight against the addon, so a row can
 * bind to a live object and mutate it in place — `group.addColor(material.current, 'color')`.
 * `useControls` can't do that, because it owns its own value map.
 *
 * `build` runs once, since the Inspector owns the values from then on. In production the Inspector
 * is never attached, so this no-ops.
 */
export function useParameters(name: string, build: (group: ParametersGroup) => void) {
  useEffect(() => {
    let teardown: (() => void) | undefined;

    const stop = onInspector((inspector) => {
      teardown?.();
      teardown = inspector ? addFolder(inspector, name, build) : undefined;
    });

    return () => {
      stop();
      teardown?.();
    };
    // `build` runs once by design, so it is deliberately not a dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name]);
}
