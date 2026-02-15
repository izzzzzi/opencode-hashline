import { readFileSync, realpathSync, writeFileSync } from "fs";
import { isAbsolute, relative, resolve, sep } from "path";
import { z } from "zod";
import type { ToolContext } from "@opencode-ai/plugin";
import { applyHashEdit, type HashlineCache, type HashlineConfig, type HashEditOperation } from "./hashline";

/**
 * Hash-aware edit tool.
 *
 * Applies edits by hash references (line+hash), avoiding fragile exact
 * old_string matching used by traditional str_replace flows.
 */
export function createHashlineEditTool(
  config: Required<HashlineConfig>,
  cache?: HashlineCache,
) {
  return {
    description:
      "Edit files using hashline references. Resolves refs like 5:a3f or '#HL 5:a3f|...' and applies replace/delete/insert without old_string matching.",
    args: {
      path: z.string().describe("Path to the file (absolute or relative to project directory)"),
      operation: z
        .enum(["replace", "delete", "insert_before", "insert_after"])
        .describe("Edit operation"),
      startRef: z
        .string()
        .describe('Start hash reference, e.g. "5:a3f" or "#HL 5:a3f|const x = 1;"'),
      endRef: z
        .string()
        .optional()
        .describe('End hash reference for range operations. Defaults to startRef when omitted.'),
      replacement: z
        .string()
        .optional()
        .describe("Replacement/inserted content. Required for replace/insert operations."),
    },
    async execute(args: Record<string, unknown>, context: ToolContext) {
      const { path, operation, startRef, endRef, replacement } = args as {
        path: string;
        operation: HashEditOperation;
        startRef: string;
        endRef?: string;
        replacement?: string;
      };
      const absPath = isAbsolute(path) ? path : resolve(context.directory, path);
      // Use realpathSync to resolve symlinks — prevents symlink-based traversal
      let realAbs: string;
      try {
        realAbs = realpathSync(absPath);
      } catch {
        // File doesn't exist yet (new file) — fall back to resolve()
        realAbs = resolve(absPath);
      }
      const realWorktree = realpathSync(resolve(context.worktree));
      if (realAbs !== realWorktree && !realAbs.startsWith(realWorktree + sep)) {
        throw new Error(`Access denied: "${path}" resolves outside the project directory`);
      }
      const normalizedAbs = resolve(absPath);
      const displayPath = relative(context.worktree, absPath) || path;

      let current: string;
      try {
        current = readFileSync(realAbs, "utf-8");
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        throw new Error(`Failed to read "${displayPath}": ${reason}`);
      }

      let nextContent: string;
      let startLine: number;
      let endLine: number;
      try {
        const result = applyHashEdit(
          {
            operation: operation,
            startRef: startRef,
            endRef: endRef,
            replacement: replacement,
          },
          current,
          config.hashLength || undefined,
        );
        nextContent = result.content;
        startLine = result.startLine;
        endLine = result.endLine;
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        throw new Error(`Hashline edit failed for "${displayPath}": ${reason}`);
      }

      try {
        writeFileSync(realAbs, nextContent, "utf-8");
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        throw new Error(`Failed to write "${displayPath}": ${reason}`);
      }

      if (cache) {
        // Invalidate all possible path variants the file could be cached under
        cache.invalidate(realAbs);
        cache.invalidate(normalizedAbs);
        cache.invalidate(absPath);
        if (path !== absPath) cache.invalidate(path);
        if (displayPath !== absPath) cache.invalidate(displayPath);
      }

      context.metadata({
        title: `hashline_edit: ${operation} ${displayPath}`,
        metadata: {
          path: displayPath,
          operation: operation,
          startLine,
          endLine,
        },
      });

      return [
        `Applied ${operation} to ${displayPath}.`,
        `Resolved range: ${startLine}-${endLine}.`,
        "Re-read the file to get fresh hash references before the next edit.",
      ].join("\n");
    },
  };
}
