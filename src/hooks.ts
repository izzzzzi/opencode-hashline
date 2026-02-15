/**
 * OpenCode plugin hooks for Hashline.
 *
 * - `onFileReadAfter`: Injects hashline annotations into file-read tool output
 *   so the AI model sees content-addressable line references.
 * - `onFileEditBefore`: Strips hashline prefixes from the AI's edit arguments
 *   before they are applied to the actual file.
 */

import { appendFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import type { Hooks } from "@opencode-ai/plugin";
import {
  formatFileWithHashes,
  stripHashes,
  HashlineCache,
  shouldExclude,
  getByteLength,
  DEFAULT_PREFIX,
  type HashlineConfig,
  resolveConfig,
} from "./hashline";

const DEBUG_LOG = join(homedir(), ".config", "opencode", "hashline-debug.log");

/** Max number of callIDs to track for deduplication before evicting old entries */
const MAX_PROCESSED_IDS = 10_000;

/** Bounded Set that evicts oldest entries when capacity is reached */
function createBoundedSet(maxSize: number): Set<string> {
  const set = new Set<string>();
  const originalAdd = set.add.bind(set);
  set.add = (value: string) => {
    if (set.size >= maxSize) {
      // Delete the oldest entry (first inserted)
      const first = set.values().next().value;
      if (first !== undefined) set.delete(first);
    }
    return originalAdd(value);
  };
  return set;
}

function debug(...args: unknown[]) {
  const line = `[${new Date().toISOString()}] ${args.map(a => typeof a === "string" ? a : JSON.stringify(a)).join(" ")}\n`;
  try { appendFileSync(DEBUG_LOG, line); } catch {}
}

/** Tool names used by OpenCode for file operations */
const FILE_READ_TOOLS = ["read", "file_read", "read_file", "cat", "view"];
const FILE_EDIT_TOOLS = ["write", "file_write", "file_edit", "edit", "edit_file", "patch", "apply_patch", "multiedit", "batch"];

/**
 * Check if a tool input looks like a file-reading tool.
 * Matches by tool name OR by presence of path-like args.
 *
 * NOTE: This is a fallback heuristic. The OpenCode plugin API (as of v1.2.2)
 * does not expose a semantic tool category (e.g. "read" vs "write") in the
 * hook input. If a future API version provides an explicit tool type or
 * category field, prefer that over this name-based detection.
 *
 * ### How tool name matching works:
 *
 * 1. **Exact match** — tool name (lowercased) is compared against the allow-list:
 *    `read`, `file_read`, `read_file`, `cat`, `view`.
 *
 * 2. **Dotted suffix match** — for namespaced tools like `mcp.read` or
 *    `custom_provider.file_read`, the part after the last `.` is matched.
 *
 * 3. **Fallback heuristic** — if the tool has `path`, `filePath`, or `file`
 *    arguments AND the tool name does NOT contain write/edit/execute indicators
 *    (`write`, `edit`, `patch`, `execute`, `run`, `command`, `shell`, `bash`),
 *    it is treated as a file-read tool.
 *
 * ### How to customize:
 *
 * If your custom tool is not detected, you can either:
 * - Name it to match one of the patterns above (e.g. `my_read_file`)
 * - Include `path`/`filePath`/`file` in its arguments
 * - Or extend the FILE_READ_TOOLS list in a fork
 */
export function isFileReadTool(toolName: string, args?: Record<string, unknown>): boolean {
  const lower = toolName.toLowerCase();
  const nameMatch = FILE_READ_TOOLS.some(
    (name) => lower === name || lower.endsWith(`.${name}`),
  );
  if (nameMatch) return true;

  // Fallback heuristic: match tools that have path/filePath args but don't
  // look like write/execute tools. This covers custom MCP tools that read
  // files but aren't in our explicit allow-list.
  if (args && typeof args === "object") {
    if (typeof args.path === "string" || typeof args.filePath === "string" || typeof args.file === "string") {
      // Only if the tool name suggests reading (not writing/executing)
      const writeIndicators = ["write", "edit", "patch", "execute", "run", "command", "shell", "bash"];
      const isWrite = writeIndicators.some((w) => lower.includes(w));
      if (!isWrite) return true;
    }
  }

  return false;
}

/**
 * Create the `tool.execute.after` hook.
 *
 * When a file-read tool completes, this hook annotates the output
 * with hashline prefixes so the AI can reference lines precisely.
 *
 * @param cache - optional LRU cache for annotated content
 * @param config - resolved hashline configuration
 */
export function createFileReadAfterHook(
  cache?: HashlineCache,
  config?: Required<HashlineConfig>,
): NonNullable<Hooks["tool.execute.after"]> {
  const resolved = config ?? resolveConfig();
  const hashLen = resolved.hashLength || 0;
  const prefix = resolved.prefix;

  // Deduplicate by callID — batch tool may fire the hook multiple times
  // for the same child operation (see opencode-wakatime for reference)
  const processedCallIds = createBoundedSet(MAX_PROCESSED_IDS);

  return async (input, output) => {
    debug("tool.execute.after:", input.tool, "args:", input.args);

    // Deduplicate: skip if this callID was already processed
    if (input.callID) {
      if (processedCallIds.has(input.callID)) {
        debug("skipped: duplicate callID", input.callID);
        return;
      }
      processedCallIds.add(input.callID);
    }

    // Only process file-read tools (fix #5: filter by tool name)
    if (!isFileReadTool(input.tool, input.args as Record<string, unknown> | undefined)) {
      debug("skipped: not a file-read tool");
      return;
    }

    // Only process if there's text output
    if (!output.output || typeof output.output !== "string") {
      debug("skipped: no string output, type:", typeof output.output, "keys:", Object.keys(output));
      return;
    }

    const content = output.output;

    // Check maxFileSize — use Buffer.byteLength for accurate UTF-8 byte length
    if (resolved.maxFileSize > 0) {
      const byteLength = getByteLength(content);
      if (byteLength > resolved.maxFileSize) {
        return;
      }
    }

    // Check exclude patterns (fix #3)
    const filePath = input.args?.path || input.args?.file || input.args?.filePath;
    if (typeof filePath === "string" && shouldExclude(filePath, resolved.exclude)) {
      return;
    }

    // Try cache first if available and we have a file path
    if (cache && typeof filePath === "string") {
      const cached = cache.get(filePath, content);
      if (cached) {
        output.output = cached;
        return;
      }
    }

    // Annotate the file content with hashline prefixes
    const annotated = formatFileWithHashes(content, hashLen || undefined, prefix);
    output.output = annotated;
    debug("annotated", typeof filePath === "string" ? filePath : input.tool, "lines:", content.split("\n").length);

    // Store in cache if available
    if (cache && typeof filePath === "string") {
      cache.set(filePath, content, annotated);
    }
  };
}

/**
 * Create the `tool.execute.before` hook.
 *
 * When a file-edit tool is about to execute, this hook strips any
 * hashline prefixes from the content arguments so the edits apply
 * cleanly to the original file.
 *
 * @param config - resolved hashline configuration
 */
export function createFileEditBeforeHook(
  config?: Required<HashlineConfig>,
): NonNullable<Hooks["tool.execute.before"]> {
  const resolved = config ?? resolveConfig();
  const prefix = resolved.prefix;

  // Deduplicate by callID — batch tool may fire the hook multiple times
  const processedCallIds = createBoundedSet(MAX_PROCESSED_IDS);

  return async (input, output) => {
    // Deduplicate: skip if this callID was already processed
    if (input.callID) {
      if (processedCallIds.has(input.callID)) {
        return;
      }
      processedCallIds.add(input.callID);
    }

    const toolName = input.tool.toLowerCase();

    // Only process file-edit tools
    const isFileEdit = FILE_EDIT_TOOLS.some(
      (name) => toolName === name || toolName.endsWith(`.${name}`)
    );
    if (!isFileEdit) return;

    if (!output.args || typeof output.args !== "object") return;

    // Strip hashes from common content fields
    const contentFields = new Set([
      "content",
      "new_content",
      "old_content",
      "old_string",
      "new_string",
      "replacement",
      "text",
      "diff",
      "patch",
      "patchText",
      "body",
    ]);

    // Recursively strip hashes from nested objects/arrays (batch/multiedit support)
    function stripDeep(obj: Record<string, unknown>): void {
      for (const key of Object.keys(obj)) {
        const val = obj[key];
        if (typeof val === "string" && contentFields.has(key)) {
          obj[key] = stripHashes(val, prefix);
        } else if (Array.isArray(val)) {
          for (const item of val) {
            if (item && typeof item === "object" && !Array.isArray(item)) {
              stripDeep(item as Record<string, unknown>);
            }
          }
        } else if (val && typeof val === "object" && !Array.isArray(val)) {
          stripDeep(val as Record<string, unknown>);
        }
      }
    }

    stripDeep(output.args as Record<string, unknown>);
  };
}

/**
 * Create the system prompt injection hook.
 *
 * Adds detailed instructions to the system prompt explaining the hashline format,
 * edit operations, and hash verification rules so the AI model can use them precisely.
 *
 * @param config - resolved hashline configuration
 */
export function createSystemPromptHook(
  config?: Required<HashlineConfig>,
): NonNullable<Hooks["experimental.chat.system.transform"]> {
  const resolved = config ?? resolveConfig();
  const prefix = resolved.prefix === false ? "" : resolved.prefix;

  return async (_input, output) => {
    output.system.push(
      [
        "## Hashline — Line Reference System",
        "",
        `File contents are annotated with hashline prefixes in the format \`${prefix}<line>:<hash>|<content>\`.`,
        "The hash length adapts to file size: 3 chars for files ≤4096 lines, 4 chars for larger files.",
        "",
        "### Example (small file, 3-char hashes):",
        "```",
        `${prefix}1:a3f|function hello() {`,
        `${prefix}2:f1c|  return "world";`,
        `${prefix}3:0e7|}`,
        "```",
        "",
        "### Example (large file, 4-char hashes):",
        "```",
        `${prefix}1:a3f2|import { useState } from 'react';`,
        `${prefix}2:f12c|`,
        `${prefix}3:0e7a|export function App() {`,
        "```",
        "",
        "### How to reference lines:",
        "You can reference specific lines using their hash tags (e.g., `2:f1c` or `2:f12c`).",
        "When editing files, you may include or omit the hash prefixes — they will be stripped automatically.",
        "",
        "### Edit operations using hash references:",
        "",
        "**Preferred tool-based edit (hash-aware):**",
        '- Use the `hashline_edit` tool with refs like `startRef: "2:f1c"` and optional `endRef`.',
        "- This avoids fragile old_string matching because edits are resolved by hash references.",
        "",
        "**Replace a single line:**",
        '- \"Replace line 2:f1c\" — target a specific line unambiguously',
        "",
        "**Replace a block of lines:**",
        '- \"Replace block from 1:a3f to 3:0e7\" — replace a range of lines',
        "- Example: replace lines 1:a3f through 3:0e7 with new content",
        "",
        "**Insert content:**",
        '- \"Insert after 3:0e7\" — insert new lines after a specific line',
        '- \"Insert before 1:a3f\" — insert new lines before a specific line',
        "",
        "**Delete lines:**",
        '- \"Delete lines from 2:f1c to 3:0e7\" — remove a range of lines',
        "",
        "### Hash verification rules:",
        "- **Always verify** that the hash reference matches the current line content before editing.",
        "- If a hash doesn't match, the file may have changed since you last read it — re-read the file first.",
        "- Hash references include both the line number AND the content hash, so `2:f1c` means \"line 2 with hash f1c\".",
        "- If you see a mismatch, do NOT proceed with the edit — re-read the file to get fresh references.",
        "",
        "### Best practices:",
        "- Use hash references for all edit operations to ensure precision.",
        "- When making multiple edits, work from bottom to top to avoid line number shifts.",
        "- For large replacements, use range references (e.g., `1:a3f to 10:b2c`) instead of individual lines.",
      ].join("\n")
    );
  };
}
