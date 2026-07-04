/**
 * DemoForge site generator package — static demo site generation.
 *
 * Exports:
 * - SiteGenerator: compiles flows into static HTML/CSS/JS site
 * - FlowConfig, SiteConfig, ThemeConfig: configuration types
 * - AssetValidationResult, FlowInfo: result types
 */

export { SiteGenerator } from "./site-generator.js";
export type {
  FlowConfig,
  SiteConfig,
  ThemeConfig,
  FlowInfo,
  AssetValidationResult,
} from "./site-generator.js";
