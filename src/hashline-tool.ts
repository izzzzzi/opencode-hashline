import { readFileSync, writeFileSync } from "fs";
import { isAbsolute, relative, resolve, sep } from "path";
import { tool } from "@opencode-ai/plugin/tool";
import { applyHashEdit, type HashlineCache, type HashlineConfig } from "./hashline";

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
  return tool({
    description:
      "Edit files using hashline references. Resolves refs like 5:a3f or '#HL 5:a3f|...' and applies replace/delete/insert without old_string matching.",
    args: {
      path: tool.schema.string().describe("Path to the file (absolute or relative to project directory)"),
      operation: tool.schema
        .enum(["replace", "delete", "insert_before", "insert_after"])
        .describe("Edit operation"),
      startRef: tool.schema
        .string()
        .describe('Start hash reference, e.g. "5:a3f" or "#HL 5:a3f|const x = 1;"'),
      endRef: tool.schema
        .string()
        .optional()
        .describe('End hash reference for range operations. Defaults to startRef when omitted.'),
      replacement: tool.schema
        .string()
        .optional()
        .describe("Replacement/inserted content. Required for replace/insert operations."),
    },
    async execute(args, context) {
      const absPath = isAbsolute(args.path) ? args.path : resolve(context.directory, args.path);
      const normalizedAbs = resolve(absPath);
      const normalizedWorktree = resolve(context.worktree);
      if (normalizedAbs !== normalizedWorktree && !normalizedAbs.startsWith(normalizedWorktree + sep)) {
        throw new Error(`Access denied: "${args.path}" resolves outside the project directory`);
      }
      const displayPath = relative(context.worktree, absPath) || args.path;

      let current: string;
      try {
        current = readFileSync(absPath, "utf-8");
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
            operation: args.operation,
            startRef: args.startRef,
            endRef: args.endRef,
            replacement: args.replacement,
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
        writeFileSync(absPath, nextContent, "utf-8");
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        throw new Error(`Failed to write "${displayPath}": ${reason}`);
      }

      if (cache) {
        // Invalidate all possible path variants the file could be cached under
        cache.invalidate(absPath);
        cache.invalidate(normalizedAbs);
        if (args.path !== absPath) cache.invalidate(args.path);
        if (displayPath !== absPath) cache.invalidate(displayPath);
      }

      context.metadata({
        title: `hashline_edit: ${args.operation} ${displayPath}`,
        metadata: {
          path: displayPath,
          operation: args.operation,
          startLine,
          endLine,
        },
      });

      return [
        `Applied ${args.operation} to ${displayPath}.`,
        `Resolved range: ${startLine}-${endLine}.`,
        "Re-read the file to get fresh hash references before the next edit.",
      ].join("\n");
    },
  });
}
