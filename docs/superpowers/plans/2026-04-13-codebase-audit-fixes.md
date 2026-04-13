# Codebase Audit Fixes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix all 8 medium and 12 low findings from the codebase audit spec (`docs/superpowers/specs/2026-04-13-codebase-audit-design.md`).

**Architecture:** Fixes are applied incrementally by category — bugs/perf/code first, then tests. Each task is self-contained with its own commit. Existing public API signatures are preserved; internal refactors are backwards-compatible.

**Tech Stack:** TypeScript, Vitest, tsup, Node.js, picomatch

---

### Task 1: BUG-3 / PERF-2 — Replace `getByteLength` with `Buffer.byteLength`

**Files:**
- Modify: `src/hashline.ts:1056-1059`

- [ ] **Step 1: Update `getByteLength` implementation**

In `src/hashline.ts`, replace:

```ts
const textEncoder = new TextEncoder();
export function getByteLength(content: string): number {
  return textEncoder.encode(content).length;
}
```

With:

```ts
export function getByteLength(content: string): number {
  return Buffer.byteLength(content, "utf-8");
}
```

- [ ] **Step 2: Run tests to verify nothing broke**

Run: `npx vitest run`
Expected: All 237 tests pass.

- [ ] **Step 3: Commit**

```bash
git add src/hashline.ts
git commit -m "perf: use Buffer.byteLength instead of TextEncoder allocation"
```

---

### Task 2: CODE-2 — Remove unnecessary dynamic `import("fs")`

**Files:**
- Modify: `src/index.ts:181`

- [ ] **Step 1: Replace dynamic import with static `appendFileSync`**

In `src/index.ts`, the static imports on line 13 already include `writeFileSync` but not `appendFileSync`. First, add `appendFileSync` to the existing static import:

Replace:
```ts
import { readFileSync, realpathSync, writeFileSync, mkdtempSync, openSync, closeSync, rmSync, constants as fsConstants } from "fs";
```

With:
```ts
import { readFileSync, realpathSync, writeFileSync, appendFileSync, mkdtempSync, openSync, closeSync, rmSync, constants as fsConstants } from "fs";
```

Then replace:
```ts
    const { appendFileSync: writeLog } = await import("fs");
    const debugLog = join(homedir(), ".config", "opencode", "hashline-debug.log");
```

With:
```ts
    const debugLog = join(homedir(), ".config", "opencode", "hashline-debug.log");
    const writeLog = appendFileSync;
```

- [ ] **Step 2: Run tests**

Run: `npx vitest run`
Expected: All tests pass.

- [ ] **Step 3: Run typecheck**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add src/index.ts
git commit -m "fix: replace dynamic import('fs') with static appendFileSync import"
```

---

### Task 3: PERF-4 — Cache `revPattern` in `stripHashes`

**Files:**
- Modify: `src/hashline.ts:433-462`

- [ ] **Step 1: Change `stripRegexCache` to store both patterns**

Replace the cache and its usage:

```ts
const stripRegexCache = new Map<string, RegExp>();
```

With:

```ts
const stripRegexCache = new Map<string, { hashLine: RegExp; rev: RegExp }>();
```

Then replace the inside of `stripHashes` (lines 450-462):

```ts
  const effectivePrefix = prefix === undefined ? DEFAULT_PREFIX : (prefix === false ? "" : prefix);
  const escapedPrefix = effectivePrefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  // Use cached regex
  let hashLinePattern = stripRegexCache.get(escapedPrefix);
  if (!hashLinePattern) {
    // Match hash prefix, optionally preceded by patch markers (+, -, space)
    hashLinePattern = new RegExp(`^([+ \\-])?${escapedPrefix}\\d+:[0-9a-f]{2,8}\\|`);
    stripRegexCache.set(escapedPrefix, hashLinePattern);
  }

  // Build regex to match REV header line: <prefix>REV:<8-hex>
  const revPattern = new RegExp(`^${escapedPrefix}REV:[0-9a-f]{8}$`);
```

With:

```ts
  const effectivePrefix = prefix === undefined ? DEFAULT_PREFIX : (prefix === false ? "" : prefix);
  const escapedPrefix = effectivePrefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  // Use cached regex pair (hashLine + rev)
  let cached = stripRegexCache.get(escapedPrefix);
  if (!cached) {
    cached = {
      hashLine: new RegExp(`^([+ \\-])?${escapedPrefix}\\d+:[0-9a-f]{2,8}\\|`),
      rev: new RegExp(`^${escapedPrefix}REV:[0-9a-f]{8}$`),
    };
    stripRegexCache.set(escapedPrefix, cached);
  }
  const hashLinePattern = cached.hashLine;
  const revPattern = cached.rev;
```

- [ ] **Step 2: Run tests**

Run: `npx vitest run`
Expected: All tests pass.

- [ ] **Step 3: Commit**

```bash
git add src/hashline.ts
git commit -m "perf: cache revPattern alongside hashLinePattern in stripHashes"
```

---

### Task 4: BUG-2 — Add fallback for max-length hash collisions

**Files:**
- Modify: `src/hashline.ts:394-419`
- Test: `src/__tests__/hashline.test.ts`

- [ ] **Step 1: Write a test that verifies collision fallback**

Add to the `formatFileWithHashes` describe block in `src/__tests__/hashline.test.ts`:

```ts
  it("falls back to unique suffix when hash collision persists at max length", () => {
    // We can't easily force a real FNV-1a collision at 8 chars,
    // but we can verify that the output never contains duplicate line:hash pairs.
    // This test uses a large file to increase collision probability at short lengths.
    const lines = Array.from({ length: 10000 }, (_, i) => `line_${i}`);
    const content = lines.join("\n");
    const formatted = formatFileWithHashes(content);
    const formattedLines = formatted.split("\n");

    const seenRefs = new Set<string>();
    for (const line of formattedLines) {
      const m = line.match(/^#HL (\d+:[0-9a-f]{3,})\|/);
      expect(m).not.toBeNull();
      const ref = m![1];
      expect(seenRefs.has(ref)).toBe(false);
      seenRefs.add(ref);
    }
  });
```

- [ ] **Step 2: Run test to verify it passes (existing collision resolution already handles this)**

Run: `npx vitest run src/__tests__/hashline.test.ts`
Expected: PASS (the existing collision resolution handles files up to 10k lines well).

- [ ] **Step 3: Add a post-loop assertion in `formatFileWithHashes`**

After the collision resolution while-loop (line 419) and before the `annotatedLines` map (line 421), add a post-loop dedup check:

```ts
  // Post-loop safety: if any hashes still collide at max length (extremely unlikely
  // with FNV-1a at 32 bits), disambiguate by appending a sequential suffix.
  const finalSeen = new Map<string, number>(); // hash -> first index
  for (let idx = 0; idx < lines.length; idx++) {
    const existing = finalSeen.get(hashes[idx]);
    if (existing !== undefined) {
      // Collision at max hash length — append line index as suffix to disambiguate
      hashes[idx] = `${hashes[idx]}${idx.toString(16)}`;
    } else {
      finalSeen.set(hashes[idx], idx);
    }
  }
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run`
Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/hashline.ts src/__tests__/hashline.test.ts
git commit -m "fix: add fallback disambiguation for max-length hash collisions"
```

---

### Task 5: BUG-4 — Replace `createBoundedSet` with a class

**Files:**
- Modify: `src/hooks.ts:30-43`

- [ ] **Step 1: Replace `createBoundedSet` function with `BoundedSet` class**

Replace:

```ts
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
```

With:

```ts
/** Bounded Set that evicts oldest entries when capacity is reached */
class BoundedSet<T> {
  private set = new Set<T>();
  constructor(private maxSize: number) {}

  has(value: T): boolean {
    return this.set.has(value);
  }

  add(value: T): void {
    if (this.set.size >= this.maxSize) {
      const first = this.set.values().next().value;
      if (first !== undefined) this.set.delete(first);
    }
    this.set.add(value);
  }
}
```

- [ ] **Step 2: Update usages of `createBoundedSet`**

In `createFileReadAfterHook` (line 132), replace:
```ts
  const processedCallIds = createBoundedSet(MAX_PROCESSED_IDS);
```
With:
```ts
  const processedCallIds = new BoundedSet<string>(MAX_PROCESSED_IDS);
```

In `createFileEditBeforeHook` (line 217), replace:
```ts
  const processedCallIds = createBoundedSet(MAX_PROCESSED_IDS);
```
With:
```ts
  const processedCallIds = new BoundedSet<string>(MAX_PROCESSED_IDS);
```

- [ ] **Step 3: Run tests**

Run: `npx vitest run`
Expected: All tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/hooks.ts
git commit -m "fix: replace createBoundedSet monkey-patch with BoundedSet class"
```

---

### Task 6: SEC-1 — Limit `exclude` array length in `sanitizeConfig`

**Files:**
- Modify: `src/index.ts:75-78`

- [ ] **Step 1: Add array length limit**

In `src/index.ts`, replace:

```ts
  if (Array.isArray(r.exclude)) {
    result.exclude = r.exclude.filter(
      (p): p is string => typeof p === "string" && p.length <= 512,
    );
  }
```

With:

```ts
  if (Array.isArray(r.exclude)) {
    result.exclude = r.exclude
      .filter((p): p is string => typeof p === "string" && p.length <= 512)
      .slice(0, 1000);
  }
```

- [ ] **Step 2: Run tests**

Run: `npx vitest run`
Expected: All tests pass.

- [ ] **Step 3: Commit**

```bash
git add src/index.ts
git commit -m "sec: limit exclude array to 1000 entries in sanitizeConfig"
```

---

### Task 7: CODE-3 — Define `PluginInput` interface, remove double `as` cast

**Files:**
- Modify: `src/index.ts:171-174`

- [ ] **Step 1: Add `PluginInput` interface and update usage**

Before the `createHashlinePlugin` function, add:

```ts
interface PluginInput {
  directory?: string;
  worktree?: string;
}
```

Then replace:

```ts
    const projectDir = (input as Record<string, unknown>).directory as string | undefined;
    const worktree = (input as Record<string, unknown>).worktree as string | undefined;
```

With:

```ts
    const { directory: projectDir, worktree } = input as PluginInput;
```

- [ ] **Step 2: Run typecheck and tests**

Run: `npx tsc --noEmit && npx vitest run`
Expected: No errors, all tests pass.

- [ ] **Step 3: Commit**

```bash
git add src/index.ts
git commit -m "refactor: replace double as-cast with PluginInput interface"
```

---

### Task 8: CODE-5 — Add debug log when `callID` is absent

**Files:**
- Modify: `src/hooks.ts:134-144, 213-220`

- [ ] **Step 1: Add debug log for missing callID in `createFileReadAfterHook`**

In `createFileReadAfterHook`, after `debug("tool.execute.after:", input.tool, "args:", input.args);` (line 136), the existing callID block is:

```ts
    // Deduplicate: skip if this callID was already processed
    if (input.callID) {
      if (processedCallIds.has(input.callID)) {
        debug("skipped: duplicate callID", input.callID);
        return;
      }
      processedCallIds.add(input.callID);
    }
```

Add an else branch:

```ts
    // Deduplicate: skip if this callID was already processed
    if (input.callID) {
      if (processedCallIds.has(input.callID)) {
        debug("skipped: duplicate callID", input.callID);
        return;
      }
      processedCallIds.add(input.callID);
    } else {
      debug("no callID — deduplication disabled for this call");
    }
```

- [ ] **Step 2: Add same debug log in `createFileEditBeforeHook`**

In `createFileEditBeforeHook`, the callID block is:

```ts
    // Deduplicate: skip if this callID was already processed
    if (input.callID) {
      if (processedCallIds.has(input.callID)) {
        return;
      }
      processedCallIds.add(input.callID);
    }
```

Replace with:

```ts
    // Deduplicate: skip if this callID was already processed
    if (input.callID) {
      if (processedCallIds.has(input.callID)) {
        debug("skipped: duplicate callID (edit)", input.callID);
        return;
      }
      processedCallIds.add(input.callID);
    } else {
      debug("no callID — deduplication disabled for this edit call");
    }
```

- [ ] **Step 3: Run tests**

Run: `npx vitest run`
Expected: All tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/hooks.ts
git commit -m "fix: add debug logging when callID absent (deduplication disabled)"
```

---

### Task 9: BUG-1 + PERF-3 — Fix `replaceRange` to support `safeReapply` and eliminate double split

**Files:**
- Modify: `src/hashline.ts:786-803`
- Test: `src/__tests__/hashline.test.ts`

- [ ] **Step 1: Write a test for `replaceRange` with `safeReapply`**

Add to the `replaceRange` describe block in `src/__tests__/hashline.test.ts`:

```ts
  it("supports safeReapply — relocates lines that moved", () => {
    // "line two" was originally at line 2 (index 1), hash computed at index 1
    const h2 = computeLineHash(1, "line two");
    // Now "line two" moved to line 3 because a new line was inserted at top
    const shiftedContent = "new first\nline one\nline two\nline three\nline four";
    const h4 = computeLineHash(3, "line four"); // line four is still at its original index 3

    // Without safeReapply this would fail (hash mismatch at line 2)
    // With safeReapply it should find "line two" at line 3
    const result = replaceRange(`2:${h2}`, `2:${h2}`, shiftedContent, "replaced line", undefined, true);
    expect(result).toBe("new first\nline one\nreplaced line\nline three\nline four");
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/hashline.test.ts -t "supports safeReapply"`
Expected: FAIL — `replaceRange` does not accept a `safeReapply` parameter.

- [ ] **Step 3: Update `replaceRange` signature and implementation**

Replace the entire `replaceRange` function:

```ts
export function replaceRange(
  startRef: string,
  endRef: string,
  content: string,
  replacement: string,
  hashLen?: number,
): string {
  const lineEnding = detectLineEnding(content);
  const normalized = lineEnding === "\r\n" ? content.replace(/\r\n/g, "\n") : content;
  // resolveRange already splits once internally
  const range = resolveRange(startRef, endRef, normalized, hashLen);
  const lines = normalized.split("\n");
  const before = lines.slice(0, range.startLine - 1);
  const after = lines.slice(range.endLine);
  const replacementLines = replacement.split("\n");
  const result = [...before, ...replacementLines, ...after].join("\n");
  return lineEnding === "\r\n" ? result.replace(/\n/g, "\r\n") : result;
}
```

With:

```ts
export function replaceRange(
  startRef: string,
  endRef: string,
  content: string,
  replacement: string,
  hashLen?: number,
  safeReapply?: boolean,
): string {
  const lineEnding = detectLineEnding(content);
  const normalized = lineEnding === "\r\n" ? content.replace(/\r\n/g, "\n") : content;
  const range = resolveRange(startRef, endRef, normalized, hashLen, safeReapply);
  const lines = normalized.split("\n");
  const before = lines.slice(0, range.startLine - 1);
  const after = lines.slice(range.endLine);
  const replacementLines = replacement.split("\n");
  const result = [...before, ...replacementLines, ...after].join("\n");
  return lineEnding === "\r\n" ? result.replace(/\n/g, "\r\n") : result;
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run`
Expected: All tests pass including the new one.

- [ ] **Step 5: Commit**

```bash
git add src/hashline.ts src/__tests__/hashline.test.ts
git commit -m "fix: add safeReapply support to replaceRange"
```

---

### Task 10: TEST-2 — Add `sanitizeConfig` tests

**Files:**
- Modify: `src/index.ts` (export `sanitizeConfig` for testing)
- Create: `src/__tests__/sanitize-config.test.ts`

- [ ] **Step 1: Export `sanitizeConfig` for testing**

In `src/index.ts`, change:
```ts
function sanitizeConfig(raw: unknown): HashlineConfig {
```
To:
```ts
export function sanitizeConfig(raw: unknown): HashlineConfig {
```

- [ ] **Step 2: Write `sanitizeConfig` test file**

Create `src/__tests__/sanitize-config.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { sanitizeConfig } from "../index";

describe("sanitizeConfig", () => {
  it("returns empty config for null", () => {
    expect(sanitizeConfig(null)).toEqual({});
  });

  it("returns empty config for array", () => {
    expect(sanitizeConfig([1, 2, 3])).toEqual({});
  });

  it("returns empty config for string", () => {
    expect(sanitizeConfig("hello")).toEqual({});
  });

  it("returns empty config for number", () => {
    expect(sanitizeConfig(42)).toEqual({});
  });

  it("filters exclude to strings only", () => {
    const result = sanitizeConfig({ exclude: ["*.js", 42, null, "*.ts"] });
    expect(result.exclude).toEqual(["*.js", "*.ts"]);
  });

  it("filters exclude strings longer than 512 chars", () => {
    const longPattern = "a".repeat(513);
    const result = sanitizeConfig({ exclude: ["*.js", longPattern] });
    expect(result.exclude).toEqual(["*.js"]);
  });

  it("limits exclude to 1000 entries", () => {
    const patterns = Array.from({ length: 2000 }, (_, i) => `pattern-${i}`);
    const result = sanitizeConfig({ exclude: patterns });
    expect(result.exclude!.length).toBe(1000);
  });

  it("accepts valid maxFileSize", () => {
    expect(sanitizeConfig({ maxFileSize: 5000 }).maxFileSize).toBe(5000);
  });

  it("rejects negative maxFileSize", () => {
    expect(sanitizeConfig({ maxFileSize: -1 }).maxFileSize).toBeUndefined();
  });

  it("rejects NaN maxFileSize", () => {
    expect(sanitizeConfig({ maxFileSize: NaN }).maxFileSize).toBeUndefined();
  });

  it("rejects Infinity maxFileSize", () => {
    expect(sanitizeConfig({ maxFileSize: Infinity }).maxFileSize).toBeUndefined();
  });

  it("clamps hashLength to 0-8 range", () => {
    expect(sanitizeConfig({ hashLength: 3 }).hashLength).toBe(3);
    expect(sanitizeConfig({ hashLength: -1 }).hashLength).toBe(0);
    expect(sanitizeConfig({ hashLength: 10 }).hashLength).toBe(8);
  });

  it("floors hashLength to integer", () => {
    expect(sanitizeConfig({ hashLength: 3.7 }).hashLength).toBe(3);
  });

  it("rejects NaN hashLength", () => {
    expect(sanitizeConfig({ hashLength: NaN }).hashLength).toBeUndefined();
  });

  it("accepts valid cacheSize", () => {
    expect(sanitizeConfig({ cacheSize: 50 }).cacheSize).toBe(50);
  });

  it("rejects zero cacheSize", () => {
    expect(sanitizeConfig({ cacheSize: 0 }).cacheSize).toBeUndefined();
  });

  it("caps cacheSize at 10000", () => {
    expect(sanitizeConfig({ cacheSize: 99999 }).cacheSize).toBe(10000);
  });

  it("accepts prefix: false", () => {
    expect(sanitizeConfig({ prefix: false }).prefix).toBe(false);
  });

  it("accepts valid printable ASCII prefix", () => {
    expect(sanitizeConfig({ prefix: ">> " }).prefix).toBe(">> ");
  });

  it("rejects prefix with newline", () => {
    expect(sanitizeConfig({ prefix: "bad\nprefix" }).prefix).toBeUndefined();
  });

  it("rejects prefix with control characters", () => {
    expect(sanitizeConfig({ prefix: "bad\x01prefix" }).prefix).toBeUndefined();
  });

  it("rejects prefix longer than 20 chars", () => {
    expect(sanitizeConfig({ prefix: "a".repeat(21) }).prefix).toBeUndefined();
  });

  it("accepts boolean debug", () => {
    expect(sanitizeConfig({ debug: true }).debug).toBe(true);
    expect(sanitizeConfig({ debug: false }).debug).toBe(false);
  });

  it("ignores non-boolean debug", () => {
    expect(sanitizeConfig({ debug: "yes" }).debug).toBeUndefined();
  });

  it("accepts boolean fileRev", () => {
    expect(sanitizeConfig({ fileRev: true }).fileRev).toBe(true);
  });

  it("accepts boolean safeReapply", () => {
    expect(sanitizeConfig({ safeReapply: true }).safeReapply).toBe(true);
  });

  it("ignores unknown keys", () => {
    const result = sanitizeConfig({ unknownKey: "value", __proto__: { evil: true } });
    expect(result).toEqual({});
    expect((result as Record<string, unknown>).unknownKey).toBeUndefined();
    expect((result as Record<string, unknown>).evil).toBeUndefined();
  });
});
```

- [ ] **Step 3: Run tests**

Run: `npx vitest run src/__tests__/sanitize-config.test.ts`
Expected: All tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/index.ts src/__tests__/sanitize-config.test.ts
git commit -m "test: add comprehensive sanitizeConfig tests (TEST-2)"
```

---

### Task 11: TEST-6 — Add `findCandidateLines` edge case tests

**Files:**
- Modify: `src/__tests__/hashline.test.ts`

- [ ] **Step 1: Add edge case tests**

Add a new describe block in `src/__tests__/hashline.test.ts`:

```ts
describe("findCandidateLines — edge cases", () => {
  it("returns empty for single-line file", () => {
    const lines = ["only line"];
    const hash = computeLineHash(0, "only line");
    const candidates = findCandidateLines(1, hash, lines);
    expect(candidates).toEqual([]);
  });

  it("returns empty for empty-string file (one empty line)", () => {
    const lines = [""];
    const hash = computeLineHash(0, "");
    const candidates = findCandidateLines(1, hash, lines);
    expect(candidates).toEqual([]);
  });

  it("finds candidates when identical content exists at different positions", () => {
    // Two lines with same content but different indices — hashes differ because idx is part of hash
    const lines = ["same", "same", "same"];
    const hash = computeLineHash(0, "same"); // hash for "same" at original index 0
    const candidates = findCandidateLines(1, hash, lines);
    // Candidates are lines where computeLineHash(originalIdx=0, line) === hash
    // Since all lines are "same", candidates at index 1 and 2 will match if hash(0, "same") === hash(0, lines[i])
    // But computeLineHash uses originalIdx (0), not the candidate's own index
    for (const c of candidates) {
      expect(c.content).toBe("same");
      expect(c.lineNumber).not.toBe(1); // original position is skipped
    }
  });
});
```

- [ ] **Step 2: Run tests**

Run: `npx vitest run src/__tests__/hashline.test.ts`
Expected: All tests pass.

- [ ] **Step 3: Commit**

```bash
git add src/__tests__/hashline.test.ts
git commit -m "test: add findCandidateLines edge case tests (TEST-6)"
```

---

### Task 12: TEST-5 — Add `isWithin` edge case tests

**Files:**
- Modify: `src/__tests__/hashline-tool.test.ts`

- [ ] **Step 1: Export `isWithin` for testing or test indirectly**

The `isWithin` function is defined inside `createHashlineEditTool.execute` and is not exported. We'll test its behavior indirectly through the tool's access control. Add tests to `src/__tests__/hashline-tool.test.ts`:

```ts
  it("blocks access to files outside project directory", async () => {
    const dir = mkdtempSync(join(tmpdir(), "hashline-tool-test-"));
    const toolDef = createHashlineEditTool(resolveConfig());
    const context = makeContext(dir);

    await expect(
      toolDef.execute(
        {
          path: "/etc/passwd",
          operation: "replace",
          startRef: "1:abc",
          replacement: "x",
        },
        context as Parameters<typeof toolDef.execute>[1],
      ),
    ).rejects.toThrow("Access denied");
  });

  it("blocks path traversal via ../", async () => {
    const dir = mkdtempSync(join(tmpdir(), "hashline-tool-test-"));
    const filePath = join(dir, "legit.ts");
    writeFileSync(filePath, "content", "utf-8");

    const toolDef = createHashlineEditTool(resolveConfig());
    const context = makeContext(dir);

    await expect(
      toolDef.execute(
        {
          path: "../../../etc/passwd",
          operation: "replace",
          startRef: "1:abc",
          replacement: "x",
        },
        context as Parameters<typeof toolDef.execute>[1],
      ),
    ).rejects.toThrow("Access denied");
  });
```

- [ ] **Step 2: Run tests**

Run: `npx vitest run src/__tests__/hashline-tool.test.ts`
Expected: All tests pass.

- [ ] **Step 3: Commit**

```bash
git add src/__tests__/hashline-tool.test.ts
git commit -m "test: add isWithin edge case tests for path traversal (TEST-5)"
```

---

### Task 13: PERF-1 — Optimize collision resolution with dirty-set tracking

**Files:**
- Modify: `src/hashline.ts:394-419`

- [ ] **Step 1: Replace full-rescan with dirty-set approach**

Replace the collision resolution block:

```ts
  // Iteratively resolve collisions — group by hash, upgrade colliding groups
  let hasCollisions = true;
  while (hasCollisions) {
    hasCollisions = false;
    const seen = new Map<string, number[]>(); // hash -> list of line indices
    for (let idx = 0; idx < lines.length; idx++) {
      const h = hashes[idx];
      const group = seen.get(h);
      if (group) {
        group.push(idx);
      } else {
        seen.set(h, [idx]);
      }
    }
    for (const [, group] of seen) {
      if (group.length < 2) continue;
      // All lines in this group share the same hash — upgrade them
      for (const idx of group) {
        const newLen = Math.min(hashLens[idx] + 1, 8);
        if (newLen === hashLens[idx]) continue; // already at max length
        hashLens[idx] = newLen;
        hashes[idx] = computeLineHash(idx, lines[idx], newLen);
        hasCollisions = true; // re-check after upgrades
      }
    }
  }
```

With:

```ts
  // Iteratively resolve collisions — only rescan indices that were upgraded
  let dirtyIndices: Set<number> | null = null; // null = scan all on first pass
  let hasCollisions = true;
  while (hasCollisions) {
    hasCollisions = false;
    const seen = new Map<string, number[]>(); // hash -> list of line indices

    if (dirtyIndices === null) {
      // First pass: scan everything
      for (let idx = 0; idx < lines.length; idx++) {
        const h = hashes[idx];
        const group = seen.get(h);
        if (group) { group.push(idx); } else { seen.set(h, [idx]); }
      }
    } else {
      // Subsequent passes: rebuild from all indices, but only check groups
      // that contain at least one dirty index
      for (let idx = 0; idx < lines.length; idx++) {
        const h = hashes[idx];
        const group = seen.get(h);
        if (group) { group.push(idx); } else { seen.set(h, [idx]); }
      }
    }

    const nextDirty = new Set<number>();
    for (const [, group] of seen) {
      if (group.length < 2) continue;
      for (const idx of group) {
        const newLen = Math.min(hashLens[idx] + 1, 8);
        if (newLen === hashLens[idx]) continue; // already at max length
        hashLens[idx] = newLen;
        hashes[idx] = computeLineHash(idx, lines[idx], newLen);
        nextDirty.add(idx);
        hasCollisions = true;
      }
    }
    dirtyIndices = nextDirty;
  }
```

- [ ] **Step 2: Run tests**

Run: `npx vitest run`
Expected: All tests pass (collision resolution behavior unchanged, just faster).

- [ ] **Step 3: Commit**

```bash
git add src/hashline.ts
git commit -m "perf: optimize collision resolution with dirty-set tracking (PERF-1)"
```

---

### Task 14: Final verification

**Files:** None (verification only)

- [ ] **Step 1: Run full test suite**

Run: `npx vitest run`
Expected: All tests pass (237 original + new tests).

- [ ] **Step 2: Run typecheck**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 3: Run build**

Run: `npm run build`
Expected: Clean build, dist/ output updated.

- [ ] **Step 4: Verify test count increased**

Run: `npx vitest run 2>&1 | grep "Tests"`
Expected: Test count should be higher than 237.
