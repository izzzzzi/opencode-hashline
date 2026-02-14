/**
 * opencode-hashline — Hashline plugin for OpenCode
 *
 * Content-addressable line hashing for precise AI code editing.
 * When the AI reads a file, each line is annotated with a short hash tag.
 * When the AI edits a file, hash prefixes are automatically stripped.
 */

import type { Plugin } from "@opencode-ai/plugin";
import {
  createFileReadAfterHook,
  createFileEditBeforeHook,
  createSystemPromptHook,
} from "./hooks";
import { HashlineCache, resolveConfig, type HashlineConfig } from "./hashline";

/**
 * Create a Hashline plugin instance with optional user configuration.
 *
 * The plugin accepts user config via this factory function, and also
 * merges with any plugin-level config from the OpenCode context.
 *
 * Usage in opencode.json (default config):
 * ```json
 * { "plugin": ["opencode-hashline"] }
 * ```
 *
 * For custom config, use the factory:
 * ```ts
 * import { createHashlinePlugin } from "opencode-hashline";
 * export default createHashlinePlugin({ maxFileSize: 2_000_000 });
 * ```
 *
 * @param userConfig - optional Hashline configuration overrides
 * @returns an OpenCode Plugin function
 */
export function createHashlinePlugin(userConfig?: HashlineConfig): Plugin {
  return async (input) => {
    // Merge plugin-level config from opencode.json with user config
    const pluginConfig = (input as Record<string, unknown>).config as HashlineConfig | undefined;
    const config = resolveConfig(userConfig, pluginConfig);
    const cache = new HashlineCache(config.cacheSize);

    return {
      "tool.execute.after": createFileReadAfterHook(cache, config),
      "tool.execute.before": createFileEditBeforeHook(config),
      "experimental.chat.system.transform": createSystemPromptHook(config),
    };
  };
}

/**
 * Hashline plugin for OpenCode (default instance with default config).
 *
 * Named export following the OpenCode plugin convention:
 * @see https://opencode.ai/docs/plugins/
 */
export const HashlinePlugin: Plugin = createHashlinePlugin();

// Default export for backward compatibility
export default HashlinePlugin;

// Re-export core utilities for programmatic use
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

// Re-export types
export type {
  HashlineConfig,
  HashlineInstance,
  VerifyHashResult,
  ResolvedRange,
} from "./hashline";

// Re-export hooks for advanced usage
export {
  createFileReadAfterHook,
  createFileEditBeforeHook,
  createSystemPromptHook,
  isFileReadTool,
} from "./hooks";
