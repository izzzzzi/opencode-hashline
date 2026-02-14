import { describe, it, expect } from "vitest";
import {
  createFileReadAfterHook,
  createFileEditBeforeHook,
  createSystemPromptHook,
  isFileReadTool,
} from "../hooks";
import {
  formatFileWithHashes,
  stripHashes,
  HashlineCache,
  resolveConfig,
  computeLineHash,
  verifyHash,
  DEFAULT_PREFIX,
} from "../hashline";

// ---------------------------------------------------------------------------
// Typed mock factories (issue #11 — remove `as any`)
// ---------------------------------------------------------------------------

/**
 * Hook input for tool.execute.after / tool.execute.before
 */
interface MockHookInput {
  tool: string;
  args?: Record<string, unknown>;
}

/**
 * Hook output for tool.execute.after
 */
interface MockReadOutput {
  output?: string | null;
}

/**
 * Hook output for tool.execute.before
 */
interface MockEditOutput {
  args?: Record<string, unknown>;
}

/**
 * Hook output for system prompt transform
 */
interface MockSystemOutput {
  system: string[];
}

function createReadInput(tool: string, args?: Record<string, unknown>): MockHookInput {
  return { tool, ...(args !== undefined ? { args } : {}) };
}

function createReadOutput(output?: string | null): MockReadOutput {
  if (output === undefined) return {};
  return { output };
}

function createEditInput(tool: string): MockHookInput {
  return { tool };
}

function createEditOutput(args?: Record<string, unknown>): MockEditOutput {
  if (args === undefined) return {};
  return { args };
}

function createSystemOutput(system: string[] = []): MockSystemOutput {
  return { system };
}

// ---------------------------------------------------------------------------
// isFileReadTool (exported for testing)
// ---------------------------------------------------------------------------

describe("isFileReadTool", () => {
  it("matches known read tool names", () => {
    expect(isFileReadTool("read_file")).toBe(true);
    expect(isFileReadTool("read")).toBe(true);
    expect(isFileReadTool("file_read")).toBe(true);
    expect(isFileReadTool("cat")).toBe(true);
    expect(isFileReadTool("view")).toBe(true);
  });

  it("matches dotted tool names (e.g. mcp.read)", () => {
    expect(isFileReadTool("mcp.read")).toBe(true);
    expect(isFileReadTool("custom.file_read")).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(isFileReadTool("READ_FILE")).toBe(true);
    expect(isFileReadTool("Cat")).toBe(true);
  });

  it("does not match write tools", () => {
    expect(isFileReadTool("write")).toBe(false);
    expect(isFileReadTool("file_write")).toBe(false);
    expect(isFileReadTool("edit_file")).toBe(false);
  });

  it("matches tools with path args via heuristic", () => {
    expect(isFileReadTool("custom_reader", { path: "src/app.ts" })).toBe(true);
    expect(isFileReadTool("my_tool", { filePath: "src/app.ts" })).toBe(true);
    expect(isFileReadTool("my_tool", { file: "src/app.ts" })).toBe(true);
  });

  it("does not match write-like tools even with path args", () => {
    expect(isFileReadTool("file_write_custom", { path: "src/app.ts" })).toBe(false);
    expect(isFileReadTool("execute_command", { path: "src/app.ts" })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// createFileReadAfterHook
// ---------------------------------------------------------------------------

describe("createFileReadAfterHook", () => {
  const config = resolveConfig();
  const hook = createFileReadAfterHook(undefined, config);

  it("annotates output for file-read tools", async () => {
    const input = createReadInput("read_file", { path: "test.ts" });
    const output = createReadOutput("line one\nline two");

    await hook(input as Parameters<typeof hook>[0], output as Parameters<typeof hook>[1]);

    const expected = formatFileWithHashes("line one\nline two");
    expect(output.output).toBe(expected);
  });

  it("works with tool names that have a prefix (e.g. 'mcp.read')", async () => {
    const input = createReadInput("mcp.read", { path: "test.ts" });
    const output = createReadOutput("hello");

    await hook(input as Parameters<typeof hook>[0], output as Parameters<typeof hook>[1]);

    const expected = formatFileWithHashes("hello");
    expect(output.output).toBe(expected);
  });

  it("handles all recognized file-read tool names", async () => {
    const toolNames = ["read", "file_read", "read_file", "cat", "view"];

    for (const tool of toolNames) {
      const input = createReadInput(tool, { path: "test.ts" });
      const output = createReadOutput("content");
      await hook(input as Parameters<typeof hook>[0], output as Parameters<typeof hook>[1]);
      expect(output.output).toMatch(/^#HL \d+:[0-9a-f]{3}\|/);
    }
  });

  it("does not modify output for non-file-read tools", async () => {
    const input = createReadInput("execute_command");
    const output = createReadOutput("some output");

    await hook(input as Parameters<typeof hook>[0], output as Parameters<typeof hook>[1]);

    expect(output.output).toBe("some output");
  });

  it("does not modify output for tools without file path args", async () => {
    const input = createReadInput("list_files");
    const output = createReadOutput("file1.ts\nfile2.ts");

    await hook(input as Parameters<typeof hook>[0], output as Parameters<typeof hook>[1]);

    expect(output.output).toBe("file1.ts\nfile2.ts");
  });

  it("does not modify output when output is not a string", async () => {
    const input = createReadInput("read_file", { path: "test.ts" });
    const output = createReadOutput(null);

    await hook(input as Parameters<typeof hook>[0], output as Parameters<typeof hook>[1]);

    expect(output.output).toBeNull();
  });

  it("does not modify output when output is undefined", async () => {
    const input = createReadInput("read_file", { path: "test.ts" });
    const output = createReadOutput();

    await hook(input as Parameters<typeof hook>[0], output as Parameters<typeof hook>[1]);

    expect(output.output).toBeUndefined();
  });

  it("is case-insensitive for tool names", async () => {
    const input = createReadInput("READ_FILE", { path: "test.ts" });
    const output = createReadOutput("hello");

    await hook(input as Parameters<typeof hook>[0], output as Parameters<typeof hook>[1]);

    const expected = formatFileWithHashes("hello");
    expect(output.output).toBe(expected);
  });

  it("uses cache when provided", async () => {
    const cache = new HashlineCache(10);
    const hookWithCache = createFileReadAfterHook(cache, config);

    const input = createReadInput("read_file", { path: "test.ts" });
    const output1 = createReadOutput("hello");
    await hookWithCache(input as Parameters<typeof hook>[0], output1 as Parameters<typeof hook>[1]);

    expect(cache.size).toBe(1);

    // Second call should use cache
    const output2 = createReadOutput("hello");
    await hookWithCache(input as Parameters<typeof hook>[0], output2 as Parameters<typeof hook>[1]);
    expect(output2.output).toBe(output1.output);
  });

  it("skips excluded files", async () => {
    const customConfig = resolveConfig({ exclude: ["**/*.lock"] });
    const hookWithExclude = createFileReadAfterHook(undefined, customConfig);

    const input = createReadInput("read_file", { path: "package.lock" });
    const output = createReadOutput("lock content");

    await hookWithExclude(input as Parameters<typeof hook>[0], output as Parameters<typeof hook>[1]);

    expect(output.output).toBe("lock content"); // unchanged
  });

  it("skips files exceeding maxFileSize", async () => {
    const customConfig = resolveConfig({ maxFileSize: 10 }); // 10 bytes
    const hookWithSize = createFileReadAfterHook(undefined, customConfig);

    const input = createReadInput("read_file", { path: "big.ts" });
    const output = createReadOutput("this content is longer than 10 bytes");

    await hookWithSize(input as Parameters<typeof hook>[0], output as Parameters<typeof hook>[1]);

    expect(output.output).toBe("this content is longer than 10 bytes"); // unchanged
  });

  it("uses UTF-8 byte length for maxFileSize check, not string length", async () => {
    // "Привет" is 6 chars but 12 bytes in UTF-8 (each Cyrillic char = 2 bytes)
    const customConfig = resolveConfig({ maxFileSize: 11 });
    const hookWithSize = createFileReadAfterHook(undefined, customConfig);

    const input = createReadInput("read_file", { path: "utf8.ts" });
    const output = createReadOutput("Привет"); // 6 chars, 12 bytes

    await hookWithSize(input as Parameters<typeof hook>[0], output as Parameters<typeof hook>[1]);

    // Should be unchanged because 12 bytes > 11 byte limit
    expect(output.output).toBe("Привет");
  });

  it("processes file when UTF-8 byte length is within maxFileSize", async () => {
    // "Привет" is 6 chars but 12 bytes in UTF-8
    const customConfig = resolveConfig({ maxFileSize: 12 });
    const hookWithSize = createFileReadAfterHook(undefined, customConfig);

    const input = createReadInput("read_file", { path: "utf8.ts" });
    const output = createReadOutput("Привет");

    await hookWithSize(input as Parameters<typeof hook>[0], output as Parameters<typeof hook>[1]);

    // Should be annotated because 12 bytes <= 12 byte limit
    expect(output.output).toMatch(/^#HL \d+:[0-9a-f]{3}\|Привет$/);
  });

  it("uses configured hashLength", async () => {
    const customConfig = resolveConfig({ hashLength: 3 });
    const hookWithLen = createFileReadAfterHook(undefined, customConfig);

    const input = createReadInput("read_file", { path: "test.ts" });
    const output = createReadOutput("hello");

    await hookWithLen(input as Parameters<typeof hook>[0], output as Parameters<typeof hook>[1]);

    expect(output.output).toMatch(/^#HL 1:[0-9a-f]{3}\|hello$/);
  });

  it("filters by tool name — does not annotate non-read tools", async () => {
    const input = createReadInput("execute_command", { command: "ls" });
    const output = createReadOutput("file1.ts\nfile2.ts");

    await hook(input as Parameters<typeof hook>[0], output as Parameters<typeof hook>[1]);

    expect(output.output).toBe("file1.ts\nfile2.ts");
  });

  it("annotates tools with path args even if not in read list", async () => {
    const input = createReadInput("custom_reader", { path: "src/app.ts" });
    const output = createReadOutput("hello");

    await hook(input as Parameters<typeof hook>[0], output as Parameters<typeof hook>[1]);

    const expected = formatFileWithHashes("hello");
    expect(output.output).toBe(expected);
  });

  it("does not annotate write-like tools even with path args", async () => {
    const input = createReadInput("file_write_custom", { path: "src/app.ts" });
    const output = createReadOutput("hello");

    await hook(input as Parameters<typeof hook>[0], output as Parameters<typeof hook>[1]);

    expect(output.output).toBe("hello");
  });

  it("uses configured prefix", async () => {
    const customConfig = resolveConfig({ prefix: ">> " });
    const hookWithPrefix = createFileReadAfterHook(undefined, customConfig);

    const input = createReadInput("read_file", { path: "test.ts" });
    const output = createReadOutput("hello");

    await hookWithPrefix(input as Parameters<typeof hook>[0], output as Parameters<typeof hook>[1]);

    expect(output.output).toMatch(/^>> 1:[0-9a-f]{3}\|hello$/);
  });
});

// ---------------------------------------------------------------------------
// createFileEditBeforeHook
// ---------------------------------------------------------------------------

describe("createFileEditBeforeHook", () => {
  const config = resolveConfig();
  const hook = createFileEditBeforeHook(config);

  it("strips hashes from content fields in file-edit tools", async () => {
    const original = "hello world";
    const hashed = formatFileWithHashes(original);

    const input = createEditInput("edit_file");
    const output = createEditOutput({ content: hashed });

    await hook(input as Parameters<typeof hook>[0], output as Parameters<typeof hook>[1]);

    expect(output.args!.content).toBe(original);
  });

  it("strips hashes from multiple content fields", async () => {
    const original = "line one\nline two";
    const hashed = formatFileWithHashes(original);

    const input = createEditInput("file_write");
    const output = createEditOutput({
      old_string: hashed,
      new_string: hashed,
    });

    await hook(input as Parameters<typeof hook>[0], output as Parameters<typeof hook>[1]);

    expect(output.args!.old_string).toBe(original);
    expect(output.args!.new_string).toBe(original);
  });

  it("handles all recognized file-edit tool names", async () => {
    const toolNames = ["write", "file_write", "file_edit", "edit", "edit_file", "patch"];
    const hashed = formatFileWithHashes("test");

    for (const tool of toolNames) {
      const input = createEditInput(tool);
      const output = createEditOutput({ content: hashed });
      await hook(input as Parameters<typeof hook>[0], output as Parameters<typeof hook>[1]);
      expect(output.args!.content).toBe("test");
    }
  });

  it("does not modify args for non-file-edit tools", async () => {
    const hashed = formatFileWithHashes("test");
    const input = createEditInput("read_file");
    const output = createEditOutput({ content: hashed });

    await hook(input as Parameters<typeof hook>[0], output as Parameters<typeof hook>[1]);

    expect(output.args!.content).toBe(hashed);
  });

  it("does not crash when args is undefined", async () => {
    const input = createEditInput("edit_file");
    const output = createEditOutput();

    await expect(
      hook(input as Parameters<typeof hook>[0], output as Parameters<typeof hook>[1])
    ).resolves.toBeUndefined();
  });

  it("does not crash when args is not an object", async () => {
    const input = createEditInput("edit_file");
    const output = { args: "not an object" } as unknown as MockEditOutput;

    await expect(
      hook(input as Parameters<typeof hook>[0], output as Parameters<typeof hook>[1])
    ).resolves.toBeUndefined();
  });

  it("leaves non-string fields in args untouched", async () => {
    const input = createEditInput("edit_file");
    const output = createEditOutput({ content: 42 as unknown as string, path: "/some/file" });

    await hook(input as Parameters<typeof hook>[0], output as Parameters<typeof hook>[1]);

    expect(output.args!.content).toBe(42);
    expect(output.args!.path).toBe("/some/file");
  });

  it("strips hashes with configured prefix", async () => {
    const customConfig = resolveConfig({ prefix: ">> " });
    const customHook = createFileEditBeforeHook(customConfig);

    const original = "hello";
    const hashed = formatFileWithHashes(original, undefined, ">> ");

    const input = createEditInput("edit_file");
    const output = createEditOutput({ content: hashed });

    await customHook(input as Parameters<typeof hook>[0], output as Parameters<typeof hook>[1]);

    expect(output.args!.content).toBe(original);
  });
});

// ---------------------------------------------------------------------------
// createSystemPromptHook
// ---------------------------------------------------------------------------

describe("createSystemPromptHook", () => {
  const config = resolveConfig();
  const hook = createSystemPromptHook(config);

  it("appends hashline instructions to the system prompt", async () => {
    const input = {};
    const output = createSystemOutput();

    await hook(input as Parameters<typeof hook>[0], output as Parameters<typeof hook>[1]);

    expect(output.system).toHaveLength(1);
    expect(output.system[0]).toContain("Hashline");
    expect(output.system[0]).toContain("Line Reference System");
  });

  it("includes format explanation and examples with prefix", async () => {
    const input = {};
    const output = createSystemOutput();

    await hook(input as Parameters<typeof hook>[0], output as Parameters<typeof hook>[1]);

    const prompt = output.system[0];
    expect(prompt).toContain("#HL <line>:<hash>|<content>");
    expect(prompt).toContain("#HL 1:a3f|function hello()");
  });

  it("includes hash verification rules", async () => {
    const input = {};
    const output = createSystemOutput();

    await hook(input as Parameters<typeof hook>[0], output as Parameters<typeof hook>[1]);

    const prompt = output.system[0];
    expect(prompt).toContain("Hash verification rules");
    expect(prompt).toContain("Always verify");
    expect(prompt).toContain("re-read the file");
  });

  it("includes adaptive hash length explanation", async () => {
    const input = {};
    const output = createSystemOutput();

    await hook(input as Parameters<typeof hook>[0], output as Parameters<typeof hook>[1]);

    const prompt = output.system[0];
    expect(prompt).toContain("adapts to file size");
    expect(prompt).toContain("3 chars");
  });

  it("includes edit operation examples", async () => {
    const input = {};
    const output = createSystemOutput();

    await hook(input as Parameters<typeof hook>[0], output as Parameters<typeof hook>[1]);

    const prompt = output.system[0];
    expect(prompt).toContain("Replace a single line");
    expect(prompt).toContain("Replace a block");
    expect(prompt).toContain("Insert");
    expect(prompt).toContain("Delete");
  });

  it("preserves existing system prompt entries", async () => {
    const input = {};
    const output = createSystemOutput(["existing instruction"]);

    await hook(input as Parameters<typeof hook>[0], output as Parameters<typeof hook>[1]);

    expect(output.system).toHaveLength(2);
    expect(output.system[0]).toBe("existing instruction");
    expect(output.system[1]).toContain("Hashline");
  });

  it("uses custom prefix in system prompt", async () => {
    const customConfig = resolveConfig({ prefix: ">> " });
    const customHook = createSystemPromptHook(customConfig);

    const input = {};
    const output = createSystemOutput();

    await customHook(input as Parameters<typeof hook>[0], output as Parameters<typeof hook>[1]);

    const prompt = output.system[0];
    expect(prompt).toContain(">> <line>:<hash>|<content>");
    expect(prompt).toContain(">> 1:a3f|function hello()");
  });
});

// ---------------------------------------------------------------------------
// Integration tests (issue #10) — full cycle: read → hash → edit → verify
// ---------------------------------------------------------------------------

describe("Integration: full plugin cycle", () => {
  it("read → hash → edit → verify cycle", async () => {
    const config = resolveConfig();
    const cache = new HashlineCache(10);
    const readHook = createFileReadAfterHook(cache, config);
    const editHook = createFileEditBeforeHook(config);

    // Step 1: Simulate file read
    const originalContent = "function hello() {\n  return 'world';\n}";
    const readInput = createReadInput("read_file", { path: "src/hello.ts" });
    const readOutput = createReadOutput(originalContent);

    await readHook(
      readInput as Parameters<typeof readHook>[0],
      readOutput as Parameters<typeof readHook>[1],
    );

    // Output should be annotated
    expect(readOutput.output).toMatch(/^#HL 1:[0-9a-f]{3}\|/);
    expect(readOutput.output).toContain("function hello()");

    // Step 2: AI decides to edit — includes hash prefixes in its edit
    const annotatedContent = readOutput.output!;
    const editInput = createEditInput("edit_file");
    const editOutput = createEditOutput({
      path: "src/hello.ts",
      new_string: annotatedContent,
    });

    await editHook(
      editInput as Parameters<typeof editHook>[0],
      editOutput as Parameters<typeof editHook>[1],
    );

    // Hash prefixes should be stripped
    expect(editOutput.args!.new_string).toBe(originalContent);

    // Step 3: Verify hashes still match original content
    const lines = originalContent.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const hash = computeLineHash(i, lines[i]);
      const result = verifyHash(i + 1, hash, originalContent);
      expect(result.valid).toBe(true);
    }
  });

  it("detects stale content after modification", async () => {
    const config = resolveConfig();
    const readHook = createFileReadAfterHook(undefined, config);

    // Step 1: Read original file
    const originalContent = "line one\nline two\nline three";
    const readInput = createReadInput("read_file", { path: "src/test.ts" });
    const readOutput = createReadOutput(originalContent);

    await readHook(
      readInput as Parameters<typeof readHook>[0],
      readOutput as Parameters<typeof readHook>[1],
    );

    // Step 2: Extract hash for line 2
    const hash = computeLineHash(1, "line two");

    // Step 3: Content changes externally
    const modifiedContent = "line one\nmodified line\nline three";

    // Step 4: Verify hash — should fail
    const result = verifyHash(2, hash, modifiedContent);
    expect(result.valid).toBe(false);
    expect(result.message).toContain("Hash mismatch");
  });

  it("cache returns same result for unchanged content", async () => {
    const config = resolveConfig();
    const cache = new HashlineCache(10);
    const readHook = createFileReadAfterHook(cache, config);

    const content = "hello world";
    const input = createReadInput("read_file", { path: "cached.ts" });

    // First read
    const output1 = createReadOutput(content);
    await readHook(
      input as Parameters<typeof readHook>[0],
      output1 as Parameters<typeof readHook>[1],
    );
    const firstResult = output1.output;

    // Second read — should come from cache
    const output2 = createReadOutput(content);
    await readHook(
      input as Parameters<typeof readHook>[0],
      output2 as Parameters<typeof readHook>[1],
    );

    expect(output2.output).toBe(firstResult);
    expect(cache.size).toBe(1);
  });

  it("system prompt is injected with correct format", async () => {
    const config = resolveConfig();
    const systemHook = createSystemPromptHook(config);

    const output = createSystemOutput();
    await systemHook(
      {} as Parameters<typeof systemHook>[0],
      output as Parameters<typeof systemHook>[1],
    );

    expect(output.system.length).toBe(1);
    expect(output.system[0]).toContain("Hashline");
    expect(output.system[0]).toContain("#HL");
  });

  it("full cycle with Unicode content", async () => {
    const config = resolveConfig();
    const readHook = createFileReadAfterHook(undefined, config);
    const editHook = createFileEditBeforeHook(config);

    const originalContent = "Привет мир\n中文测试\n🎉🚀";
    const readInput = createReadInput("read_file", { path: "unicode.ts" });
    const readOutput = createReadOutput(originalContent);

    await readHook(
      readInput as Parameters<typeof readHook>[0],
      readOutput as Parameters<typeof readHook>[1],
    );

    // Should be annotated
    expect(readOutput.output).toMatch(/^#HL 1:/);

    // Strip should recover original
    const editInput = createEditInput("edit_file");
    const editOutput = createEditOutput({ content: readOutput.output! });

    await editHook(
      editInput as Parameters<typeof editHook>[0],
      editOutput as Parameters<typeof editHook>[1],
    );

    expect(editOutput.args!.content).toBe(originalContent);
  });
});
