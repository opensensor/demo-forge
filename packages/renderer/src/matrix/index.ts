/**
 * DemoForge renderer — matrix rendering module.
 *
 * Exports: RenderMatrix class, type definitions, and utility functions.
 */

export { RenderMatrix, generateCellId, computeMatrixCombinations, generateOutputFilename } from './matrix.js';
export type {
  MatrixCellConfig,
  MatrixConfig,
  MatrixCellResult,
  MatrixRenderResult,
  CellDiff,
  StepDiff,
  DiffReport,
  MatrixRenderOptions,
} from './types.js';
export { calculateSSIM } from './ssim.js';
