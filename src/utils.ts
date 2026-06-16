/**
 * opencode-hashline/utils — Utility re-exports for programmatic use.
 *
 * Import from "opencode-hashline/utils" instead of the main entry point
 * when you need direct access to hashing utilities, constants, or hooks.
 *
 * The main "opencode-hashline" entry only exports Plugin-compatible functions
 * because OpenCode's plugin loader calls every export as a Plugin function.
 */

// Types
export type {
  CandidateLine,
  HashEditInput,
  HashEditOperation,
  HashEditResult,
  HashlineConfig,
  HashlineErrorCode,
  ResolvedRange,
  VerifyHashResult,
} from "./hashline";
// Core utilities
export {
  applyHashEdit,
  buildHashMap,
  computeFileRev,
  computeLineHash,
  DEFAULT_CONFIG,
  DEFAULT_EXCLUDE_PATTERNS,
  DEFAULT_PREFIX,
  extractFileRev,
  findCandidateLines,
  formatFileWithHashes,
  getAdaptiveHashLength,
  getByteLength,
  HashlineCache,
  HashlineError,
  matchesGlob,
  normalizeHashRef,
  parseHashRef,
  replaceRange,
  resolveConfig,
  resolveRange,
  shouldExclude,
  stripHashes,
  verifyFileRev,
  verifyHash,
} from "./hashline";

// Hooks
export {
  createFileEditBeforeHook,
  createFileReadAfterHook,
  createSystemPromptHook,
  isFileReadTool,
} from "./hooks";
