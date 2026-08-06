import { useEffect, useRef, useState } from 'react';
import { onInspector } from './addon';
import {
  buildControls,
  initialValues,
  parseArgs,
  type FolderSettings,
  type Schema,
  type Values,
} from './schema';

export { button, folder } from './schema';
export type { FolderSettings, Schema, Values };

/**
 * Leva's `useControls`, backed by the Inspector's Parameters tab. Callable from any component,
 * inside or outside the Canvas — it reaches the Inspector through the module singleton, not R3F.
 *
 * In production no Inspector is ever attached, so the schema's own values are what comes back.
 */
export function useControls<const S extends Schema>(schema: S, deps?: unknown[]): Values<S>;
export function useControls<const S extends Schema>(
  schema: S,
  settings?: FolderSettings,
  deps?: unknown[]
): Values<S>;
export function useControls<const S extends Schema>(
  name: string,
  schema: S,
  deps?: unknown[]
): Values<S>;
export function useControls<const S extends Schema>(
  name: string,
  schema: S,
  settings?: FolderSettings,
  deps?: unknown[]
): Values<S>;

export function useControls(...args: unknown[]) {
  const { name, schema, settings, deps } = parseArgs(args);

  const [values, setValues] = useState(() => initialValues(schema));

  // Leva's contract: the schema is read once at build time, and only `deps` rebuilds the folder.
  // Effects run in declaration order, so this lands before the rebuild below reads it.
  const latest = useRef({ schema, settings });

  useEffect(() => {
    latest.current = { schema, settings };
  });

  useEffect(() => {
    let teardown: (() => void) | undefined;

    const stop = onInspector((inspector) => {
      teardown?.();
      teardown = inspector
        ? buildControls(inspector, name, latest.current.schema, latest.current.settings, setValues)
        : undefined;
    });

    return () => {
      stop();
      teardown?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name, ...(deps ?? [])]);

  return values;
}
