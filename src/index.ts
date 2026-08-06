/**
 * Leva's `useControls` over the Parameters tab of three.js's built-in WebGPU Inspector, for React
 * Three Fiber. `controls` is the same schema with no React around it, returning TSL uniforms.
 *
 * One entry point on purpose: this targets R3F + WebGPU and nothing else, so importing it always
 * brings the `ThreeElements` augmentation that makes `<meshStandardNodeMaterial />` typecheck.
 */

export { controls } from './controls';
export { useControls } from './useControls';
export { useParameters } from './useParameters';
export { useParametersToggle } from './useParametersToggle';
export { useInspectorToggle } from './useInspectorToggle';
export { createWebGPURenderer } from './renderer';
export { button, folder } from './schema';

export type { Nodes } from './controls';
export type { FolderSettings, Schema, Values } from './schema';
export type { ParametersGroup } from './addon';
export type { RendererOptions } from './renderer';
export type { ToggleOptions } from './toggle';
