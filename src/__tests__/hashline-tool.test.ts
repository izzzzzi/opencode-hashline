import { mkdtempSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { describe, it, expect, vi } from "vitest";
import { createHashlineEditTool } from "../hashline-tool";
import { computeLineHash, HashlineCache, resolveConfig } from "../hashline";

describe("createHashlineEditTool", () => {
  function makeContext(directory: string) {
    return {
      sessionID: "s1",
      messageID: "m1",
      agent: "agent",
      directory,
      worktree: directory,
      abort: new AbortController().signal,
      metadata: vi.fn(),
      ask: vi.fn(async () => {}),
    };
  }

  it("applies replace operation by hash refs", async () => {
    const dir = mkdtempSync(join(tmpdir(), "hashline-tool-test-"));
    const filePath = join(dir, "test.ts");
    const original = "line one\nline two\nline three";
    writeFileSync(filePath, original, "utf-8");

    const h2 = computeLineHash(1, "line two");
    const toolDef = createHashlineEditTool(resolveConfig());
    const context = makeContext(dir);

    const output = await toolDef.execute(
      {
        path: "test.ts",
        operation: "replace",
        startRef: `2:${h2}`,
        replacement: "updated line",
      },
      context as Parameters<typeof toolDef.execute>[1],
    );

    expect(output).toContain("Applied replace");
    expect(readFileSync(filePath, "utf-8")).toBe("line one\nupdated line\nline three");
    expect(context.metadata).toHaveBeenCalledTimes(1);
  });

  it("invalidates cache entries for path variants", async () => {
    const dir = mkdtempSync(join(tmpdir(), "hashline-tool-test-"));
    const filePath = join(dir, "cache.ts");
    const original = "a\nb\nc";
    writeFileSync(filePath, original, "utf-8");

    const cache = new HashlineCache(10);
    cache.set("cache.ts", original, "annotated-1");
    cache.set(filePath, original, "annotated-2");

    const h2 = computeLineHash(1, "b");
    const toolDef = createHashlineEditTool(resolveConfig(), cache);
    const context = makeContext(dir);

    await toolDef.execute(
      {
        path: "cache.ts",
        operation: "replace",
        startRef: `2:${h2}`,
        replacement: "x",
      },
      context as Parameters<typeof toolDef.execute>[1],
    );

    expect(cache.size).toBe(0);
  });

  it("fails on stale hash ref", async () => {
    const dir = mkdtempSync(join(tmpdir(), "hashline-tool-test-"));
    const filePath = join(dir, "stale.ts");
    writeFileSync(filePath, "line one\nline two", "utf-8");

    const toolDef = createHashlineEditTool(resolveConfig());
    const context = makeContext(dir);

    await expect(
      toolDef.execute(
        {
          path: "stale.ts",
          operation: "replace",
          startRef: "2:aaa",
          replacement: "x",
        },
        context as Parameters<typeof toolDef.execute>[1],
      ),
    ).rejects.toThrow("Hashline edit failed");
  });
});
