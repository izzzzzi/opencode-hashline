/**
 * opencode-hashline/utils — Utility re-exports for programmatic use.
 *
 * Import from "opencode-hashline/utils" instead of the main entry point
 * when you need direct access to hashing utilities, constants, or hooks.
 *
 * The main "opencode-hashline" entry only exports Plugin-compatible functions
 * because OpenCode's plugin loader calls every export as a Plugin function.
 */

// Core utilities
export {
  computeLineHash,
  formatFileWithHashes,
  stripHashes,
  parseHashRef,
  buildHashMap,
  getAdaptiveHashLength,
  verifyHash,
  resolveRange,
  replaceRange,
  applyHashEdit,
  normalizeHashRef,
  HashlineCache,
  createHashline,
  shouldExclude,
  matchesGlob,
  resolveConfig,
  getByteLength,
  DEFAULT_CONFIG,
  DEFAULT_EXCLUDE_PATTERNS,
  DEFAULT_PREFIX,
} from "./hashline";

// Types
export type {
  HashlineConfig,
  HashlineInstance,
  VerifyHashResult,
  ResolvedRange,
  HashEditInput,
  HashEditOperation,
  HashEditResult,
} from "./hashline";

// Hooks
export {
  createFileReadAfterHook,
  createFileEditBeforeHook,
  createSystemPromptHook,
  isFileReadTool,
} from "./hooks";
