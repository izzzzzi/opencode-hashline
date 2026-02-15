/**
 * opencode-hashline — Hashline plugin for OpenCode
 *
 * Content-addressable line hashing for precise AI code editing.
 * When the AI reads a file, each line is annotated with a short hash tag.
 * When the AI edits a file, hash prefixes are automatically stripped.
 *
 * IMPORTANT: OpenCode's plugin loader calls every export as a Plugin function.
 * Only Plugin-compatible exports belong here. For utility functions and
 * constants, import from "opencode-hashline/utils".
 */

import { readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { homedir, tmpdir } from "os";
import { fileURLToPath } from "url";
import type { Plugin } from "@opencode-ai/plugin";
import {
  createFileReadAfterHook,
  createFileEditBeforeHook,
  createSystemPromptHook,
} from "./hooks";
import { HashlineCache, resolveConfig, type HashlineConfig } from "./hashline";
import { createHashlineEditTool } from "./hashline-tool";

const CONFIG_FILENAME = "opencode-hashline.json";

/**
 * Try to read and parse a JSON config file. Returns undefined if not found.
 */
function loadConfigFile(filePath: string): HashlineConfig | undefined {
  try {
    const raw = readFileSync(filePath, "utf-8");
    return JSON.parse(raw) as HashlineConfig;
  } catch {
    return undefined;
  }
}

/**
 * Load config from known locations.
 *
 * Priority (later overrides earlier):
 *   1. ~/.config/opencode/opencode-hashline.json  (global)
 *   2. <project>/opencode-hashline.json           (project-local)
 *   3. programmatic userConfig                     (factory arg)
 */
function loadConfig(
  projectDir?: string,
  userConfig?: HashlineConfig,
): HashlineConfig {
  const globalPath = join(homedir(), ".config", "opencode", CONFIG_FILENAME);
  const globalConfig = loadConfigFile(globalPath);

  let projectConfig: HashlineConfig | undefined;
  if (projectDir) {
    projectConfig = loadConfigFile(join(projectDir, CONFIG_FILENAME));
  }

  return {
    ...globalConfig,
    ...projectConfig,
    ...userConfig,
  };
}

/**
 * Create a Hashline plugin instance with optional user configuration.
 *
 * Config is loaded from (in priority order):
 *   1. ~/.config/opencode/opencode-hashline.json  (global)
 *   2. <project>/opencode-hashline.json           (project-local)
 *   3. Programmatic config passed to this factory
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
    const projectDir = (input as Record<string, unknown>).directory as string | undefined;
    const fileConfig = loadConfig(projectDir, userConfig);
    const config = resolveConfig(fileConfig);
    const cache = new HashlineCache(config.cacheSize);

    const { appendFileSync: writeLog } = await import("fs");
    const debugLog = join(homedir(), ".config", "opencode", "hashline-debug.log");
    try { writeLog(debugLog, `[${new Date().toISOString()}] plugin loaded, prefix: ${JSON.stringify(config.prefix)}, maxFileSize: ${config.maxFileSize}, projectDir: ${projectDir}\n`); } catch {}

    return {
      tool: {
        hashline_edit: createHashlineEditTool(config, cache),
      },
      "tool.execute.after": createFileReadAfterHook(cache, config),
      "tool.execute.before": createFileEditBeforeHook(config),
      "experimental.chat.system.transform": createSystemPromptHook(config),
      "chat.message": async (_input: unknown, output: unknown) => {
        try {
          const out = output as { message?: unknown; parts?: any[] };
          const hashLen = config.hashLength || 0;
          const prefix = config.prefix;
          const { formatFileWithHashes, shouldExclude, getByteLength } = await import("./hashline");

          for (const p of out.parts ?? []) {
            if (p.type !== "file") continue;
            if (!p.url || !p.mime?.startsWith("text/")) continue;

            // Get file path from url (file:///...) or source.path
            let filePath: string | undefined;
            if (typeof p.url === "string" && p.url.startsWith("file://")) {
              filePath = fileURLToPath(p.url);
            }
            if (!filePath) continue;

            // Check exclusions
            if (shouldExclude(filePath, config.exclude)) continue;

            // Read and check size
            let content: string;
            try {
              content = readFileSync(filePath, "utf-8");
            } catch { continue; }

            if (config.maxFileSize > 0 && getByteLength(content) > config.maxFileSize) continue;

            // Check cache
            const cached = cache.get(filePath, content);
            if (cached) {
              // Write annotated content to temp file and swap URL
              const tmpPath = join(tmpdir(), `hashline-${p.id}.txt`);
              writeFileSync(tmpPath, cached, "utf-8");
              p.url = `file://${tmpPath}`;
              writeLog(debugLog, `[${new Date().toISOString()}] chat.message annotated (cached): ${filePath}\n`);
              continue;
            }

            // Annotate
            const annotated = formatFileWithHashes(content, hashLen || undefined, prefix);
            cache.set(filePath, content, annotated);

            // Write to temp file and swap URL
            const tmpPath = join(tmpdir(), `hashline-${p.id}.txt`);
            writeFileSync(tmpPath, annotated, "utf-8");
            p.url = `file://${tmpPath}`;

            writeLog(debugLog, `[${new Date().toISOString()}] chat.message annotated: ${filePath} lines=${content.split("\n").length}\n`);
          }
        } catch (e) {
          try { writeLog(debugLog, `[${new Date().toISOString()}] chat.message error: ${e}\n`); } catch {}
        }
      },
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

// Re-export types only (types are erased at runtime, so they don't
// create callable exports that would confuse OpenCode's plugin loader)
export type {
  HashlineConfig,
  HashlineInstance,
  VerifyHashResult,
  ResolvedRange,
  HashEditInput,
  HashEditOperation,
  HashEditResult,
} from "./hashline";
