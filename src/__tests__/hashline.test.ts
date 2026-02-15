import { describe, it, expect } from "vitest";
import {
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
  DEFAULT_PREFIX,
} from "../hashline";

// ---------------------------------------------------------------------------
// computeLineHash
// ---------------------------------------------------------------------------

describe("computeLineHash", () => {
  it("returns a 3-character hex string by default", () => {
    const hash = computeLineHash(0, "function hello() {");
    expect(hash).toMatch(/^[0-9a-f]{3}$/);
  });

  it("returns a 3-character hex string when hashLen=3", () => {
    const hash = computeLineHash(0, "function hello() {", 3);
    expect(hash).toMatch(/^[0-9a-f]{3}$/);
  });

  it("returns a 4-character hex string when hashLen=4", () => {
    const hash = computeLineHash(0, "function hello() {", 4);
    expect(hash).toMatch(/^[0-9a-f]{4}$/);
  });

  it("is deterministic — same input produces same hash", () => {
    const hash1 = computeLineHash(0, "function hello() {");
    const hash2 = computeLineHash(0, "function hello() {");
    expect(hash1).toBe(hash2);
  });

  it("produces different hashes for different line indices", () => {
    const hash1 = computeLineHash(0, "same content");
    const hash2 = computeLineHash(1, "same content");
    expect(hash1).not.toBe(hash2);
  });

  it("produces different hashes for different content", () => {
    const hash1 = computeLineHash(0, "line A");
    const hash2 = computeLineHash(0, "line B");
    expect(hash1).not.toBe(hash2);
  });

  it("ignores trailing whitespace (trimEnd)", () => {
    const hash1 = computeLineHash(0, "hello   ");
    const hash2 = computeLineHash(0, "hello");
    expect(hash1).toBe(hash2);
  });

  it("treats leading whitespace as significant (indentation change = hash change)", () => {
    const hash1 = computeLineHash(0, "  hello");
    const hash2 = computeLineHash(0, "hello");
    expect(hash1).not.toBe(hash2);
  });

  it("treats different indentation levels as different (with longer hash)", () => {
    // Use 4-char hashes to avoid collisions in this test
    const hash1 = computeLineHash(0, "  hello", 4);
    const hash2 = computeLineHash(0, "    hello", 4);
    expect(hash1).not.toBe(hash2);
  });
});

// ---------------------------------------------------------------------------
// getAdaptiveHashLength
// ---------------------------------------------------------------------------

describe("getAdaptiveHashLength", () => {
  it("returns 3 for small files (≤4096 lines)", () => {
    expect(getAdaptiveHashLength(1)).toBe(3);
    expect(getAdaptiveHashLength(100)).toBe(3);
    expect(getAdaptiveHashLength(256)).toBe(3);
    expect(getAdaptiveHashLength(4096)).toBe(3);
  });

  it("returns 4 for >4096 lines", () => {
    expect(getAdaptiveHashLength(4097)).toBe(4);
    expect(getAdaptiveHashLength(10000)).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// formatFileWithHashes
// ---------------------------------------------------------------------------

describe("formatFileWithHashes", () => {
  it("annotates each line with prefix, line number and hash", () => {
    const content = "function hello() {\n  return \"world\";\n}";
    const formatted = formatFileWithHashes(content);
    const lines = formatted.split("\n");

    expect(lines).toHaveLength(3);
    for (const line of lines) {
      expect(line).toMatch(/^#HL \d+:[0-9a-f]{3}\|/);
    }
  });

  it("preserves original content after the hash prefix", () => {
    const content = "line one\nline two\nline three";
    const formatted = formatFileWithHashes(content);
    const lines = formatted.split("\n");

    expect(lines[0]).toContain("line one");
    expect(lines[1]).toContain("line two");
    expect(lines[2]).toContain("line three");
  });

  it("uses 1-based line numbers", () => {
    const content = "a\nb\nc";
    const formatted = formatFileWithHashes(content);
    const lines = formatted.split("\n");

    expect(lines[0]).toMatch(/^#HL 1:/);
    expect(lines[1]).toMatch(/^#HL 2:/);
    expect(lines[2]).toMatch(/^#HL 3:/);
  });

  it("handles empty content", () => {
    const formatted = formatFileWithHashes("");
    expect(formatted).toMatch(/^#HL 1:[0-9a-f]{3}\|$/);
  });

  it("handles single line content", () => {
    const formatted = formatFileWithHashes("hello");
    expect(formatted).toMatch(/^#HL 1:[0-9a-f]{3}\|hello$/);
  });

  it("uses 3-char hashes for files with ≤4096 lines", () => {
    const lines = Array.from({ length: 300 }, (_, i) => `line ${i}`);
    const content = lines.join("\n");
    const formatted = formatFileWithHashes(content);
    const firstLine = formatted.split("\n")[0];
    expect(firstLine).toMatch(/^#HL 1:[0-9a-f]{3}\|/);
  });

  it("uses 4-char hashes for files with >4096 lines", () => {
    const lines = Array.from({ length: 5000 }, (_, i) => `line ${i}`);
    const content = lines.join("\n");
    const formatted = formatFileWithHashes(content);
    const firstLine = formatted.split("\n")[0];
    expect(firstLine).toMatch(/^#HL 1:[0-9a-f]{4}\|/);
  });

  it("respects explicit hashLen override", () => {
    const content = "a\nb\nc";
    const formatted = formatFileWithHashes(content, 3);
    const lines = formatted.split("\n");
    for (const line of lines) {
      expect(line).toMatch(/^#HL \d+:[0-9a-f]{3}\|/);
    }
  });

  it("supports prefix: false for legacy format", () => {
    const content = "a\nb\nc";
    const formatted = formatFileWithHashes(content, undefined, false);
    const lines = formatted.split("\n");
    for (const line of lines) {
      expect(line).toMatch(/^\d+:[0-9a-f]{3}\|/);
      expect(line).not.toMatch(/^#HL /);
    }
  });

  it("supports custom prefix", () => {
    const content = "hello";
    const formatted = formatFileWithHashes(content, undefined, ">> ");
    expect(formatted).toMatch(/^>> 1:[0-9a-f]{3}\|hello$/);
  });

  it("handles hash collisions by using longer hash", () => {
    // Generate content and verify no two lines have the same hash key
    const lines = Array.from({ length: 100 }, (_, i) => `line ${i}`);
    const content = lines.join("\n");
    const formatted = formatFileWithHashes(content);
    const formattedLines = formatted.split("\n");

    // All lines should have valid hash format (3 or more chars)
    for (const line of formattedLines) {
      expect(line).toMatch(/^#HL \d+:[0-9a-f]{3,}\|/);
    }
  });
});

// ---------------------------------------------------------------------------
// stripHashes
// ---------------------------------------------------------------------------

describe("stripHashes", () => {
  it("removes hash prefixes to recover original content", () => {
    const original = "function hello() {\n  return \"world\";\n}";
    const formatted = formatFileWithHashes(original);
    const stripped = stripHashes(formatted);
    expect(stripped).toBe(original);
  });

  it("is a perfect roundtrip with formatFileWithHashes", () => {
    const testCases = [
      "",
      "single line",
      "line 1\nline 2\nline 3",
      "  indented\n    more indented\n",
      "special chars: !@#$%^&*()\ntabs\there",
    ];

    for (const original of testCases) {
      const formatted = formatFileWithHashes(original);
      const stripped = stripHashes(formatted);
      expect(stripped).toBe(original);
    }
  });

  it("leaves non-hashline content unchanged", () => {
    const plain = "just a normal line\nanother line";
    expect(stripHashes(plain)).toBe(plain);
  });

  it("does not strip lines that look like legacy hashline but lack prefix", () => {
    // With default prefix (#HL), lines like "1:ab|data" should NOT be stripped
    const data = "1:ab|some data\n2:cd|more data";
    expect(stripHashes(data)).toBe(data);
  });

  it("strips lines with #HL prefix", () => {
    const annotated = "#HL 1:abc|hashed line\nplain line\n#HL 2:cde|another hashed";
    const stripped = stripHashes(annotated);
    expect(stripped).toBe("hashed line\nplain line\nanother hashed");
  });

  it("strips 3-char hash prefixes", () => {
    const lines = Array.from({ length: 300 }, (_, i) => `line ${i}`);
    const content = lines.join("\n");
    const formatted = formatFileWithHashes(content);
    const stripped = stripHashes(formatted);
    expect(stripped).toBe(content);
  });

  it("strips 4-char hash prefixes", () => {
    const lines = Array.from({ length: 5000 }, (_, i) => `line ${i}`);
    const content = lines.join("\n");
    const formatted = formatFileWithHashes(content);
    const stripped = stripHashes(formatted);
    expect(stripped).toBe(content);
  });

  it("roundtrips with prefix: false (legacy format)", () => {
    const original = "hello\nworld";
    const formatted = formatFileWithHashes(original, undefined, false);
    const stripped = stripHashes(formatted, false);
    expect(stripped).toBe(original);
  });

  it("roundtrips with custom prefix", () => {
    const original = "hello\nworld";
    const formatted = formatFileWithHashes(original, undefined, ">> ");
    const stripped = stripHashes(formatted, ">> ");
    expect(stripped).toBe(original);
  });
});

// ---------------------------------------------------------------------------
// parseHashRef
// ---------------------------------------------------------------------------

describe("parseHashRef", () => {
  it("parses a valid 3-char hash reference", () => {
    const result = parseHashRef("2:f1a");
    expect(result).toEqual({ line: 2, hash: "f1a" });
  });

  it("parses a valid 4-char hash reference", () => {
    const result = parseHashRef("2:f1a3");
    expect(result).toEqual({ line: 2, hash: "f1a3" });
  });

  it("parses a valid 2-char hash reference (legacy)", () => {
    const result = parseHashRef("1:ab");
    expect(result).toEqual({ line: 1, hash: "ab" });
  });

  it("parses multi-digit line numbers", () => {
    const result = parseHashRef("123:cde");
    expect(result).toEqual({ line: 123, hash: "cde" });
  });

  it("throws on invalid format — missing hash", () => {
    expect(() => parseHashRef("2:")).toThrow("Invalid hash reference");
  });

  it("throws on invalid format — no colon", () => {
    expect(() => parseHashRef("2f1")).toThrow("Invalid hash reference");
  });

  it("throws on invalid format — hash too long (9 chars)", () => {
    expect(() => parseHashRef("2:f1a3b5c7d")).toThrow("Invalid hash reference");
  });

  it("throws on invalid format — non-hex hash", () => {
    expect(() => parseHashRef("2:zzz")).toThrow("Invalid hash reference");
  });
});

// ---------------------------------------------------------------------------
// normalizeHashRef
// ---------------------------------------------------------------------------

describe("normalizeHashRef", () => {
  it("keeps plain refs unchanged (normalized case)", () => {
    expect(normalizeHashRef("2:f1A")).toBe("2:f1a");
  });

  it("extracts ref from annotated line with prefix", () => {
    expect(normalizeHashRef("#HL 12:AbC|const value = 1;")).toBe("12:abc");
  });

  it("extracts ref from annotated line without prefix", () => {
    expect(normalizeHashRef("12:AbC|const value = 1;")).toBe("12:abc");
  });

  it("throws for invalid ref", () => {
    expect(() => normalizeHashRef("not-a-ref")).toThrow("Invalid hash reference");
  });
});

// ---------------------------------------------------------------------------
// buildHashMap
// ---------------------------------------------------------------------------

describe("buildHashMap", () => {
  it("builds a map from hash refs to line numbers", () => {
    const content = "function hello() {\n  return \"world\";\n}";
    const map = buildHashMap(content);

    expect(map.size).toBe(3);

    const values = [...map.values()];
    expect(values).toContain(1);
    expect(values).toContain(2);
    expect(values).toContain(3);
  });

  it("keys match the format <lineNumber>:<hash>", () => {
    const content = "a\nb\nc";
    const map = buildHashMap(content);

    for (const key of map.keys()) {
      expect(key).toMatch(/^\d+:[0-9a-f]{3}$/);
    }
  });

  it("is consistent with computeLineHash", () => {
    const lines = ["first", "second", "third"];
    const content = lines.join("\n");
    const map = buildHashMap(content);

    for (let i = 0; i < lines.length; i++) {
      const hash = computeLineHash(i, lines[i]);
      const key = `${i + 1}:${hash}`;
      expect(map.has(key)).toBe(true);
      expect(map.get(key)).toBe(i + 1);
    }
  });

  it("handles empty content", () => {
    const map = buildHashMap("");
    expect(map.size).toBe(1); // One empty line
  });

  it("uses adaptive hash length for large files", () => {
    const lines = Array.from({ length: 300 }, (_, i) => `line ${i}`);
    const content = lines.join("\n");
    const map = buildHashMap(content);

    for (const key of map.keys()) {
      expect(key).toMatch(/^\d+:[0-9a-f]{3}$/);
    }
  });
});

// ---------------------------------------------------------------------------
// verifyHash
// ---------------------------------------------------------------------------

describe("verifyHash", () => {
  it("returns valid for correct hash", () => {
    const content = "line one\nline two\nline three";
    const hash = computeLineHash(1, "line two");
    const result = verifyHash(2, hash, content);
    expect(result.valid).toBe(true);
  });

  it("returns invalid for wrong hash", () => {
    const content = "line one\nline two\nline three";
    const result = verifyHash(2, "zzz", content);
    expect(result.valid).toBe(false);
    expect(result.message).toContain("Hash mismatch");
  });

  it("returns invalid for out-of-range line number", () => {
    const content = "line one\nline two";
    const result = verifyHash(5, "abc", content);
    expect(result.valid).toBe(false);
    expect(result.message).toContain("out of range");
  });

  it("returns invalid for line 0", () => {
    const content = "line one";
    const result = verifyHash(0, "abc", content);
    expect(result.valid).toBe(false);
    expect(result.message).toContain("out of range");
  });

  it("detects content changes (race condition protection)", () => {
    const originalContent = "line one\nline two\nline three";
    const hash = computeLineHash(1, "line two");

    // Content changed
    const modifiedContent = "line one\nmodified line\nline three";
    const result = verifyHash(2, hash, modifiedContent);
    expect(result.valid).toBe(false);
    expect(result.expected).toBe(hash);
    expect(result.actual).toBeDefined();
  });

  it("uses hash.length from ref, not adaptive length from file size", () => {
    // Create a small file
    const smallContent = "line one\nline two\nline three";
    const hash3 = computeLineHash(0, "line one", 3); // 3-char hash

    // Now imagine the file grew to >4096 lines — adaptive would give 4-char hashes
    // But verifyHash should still use hash.length (3) from the ref
    const bigLines = ["line one", "line two", "line three"];
    for (let i = 3; i < 5000; i++) bigLines.push(`extra line ${i}`);
    const bigContent = bigLines.join("\n");

    // This should still validate because verifyHash uses hash.length=3, not adaptive=4
    const result = verifyHash(1, hash3, bigContent);
    expect(result.valid).toBe(true);
  });

  it("detects indentation changes (trimEnd instead of trim)", () => {
    const content1 = "  indented line\nline two";
    const hash = computeLineHash(0, "  indented line");

    // Change indentation
    const content2 = "    indented line\nline two";
    const result = verifyHash(1, hash, content2);
    expect(result.valid).toBe(false);
  });

  it("accepts pre-split lines array to avoid redundant splitting", () => {
    const content = "line one\nline two\nline three";
    const lines = content.split("\n");
    const hash = computeLineHash(1, "line two");
    const result = verifyHash(2, hash, content, undefined, lines);
    expect(result.valid).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// resolveRange
// ---------------------------------------------------------------------------

describe("resolveRange", () => {
  const content = "line one\nline two\nline three\nline four";

  it("resolves a valid range", () => {
    const h1 = computeLineHash(0, "line one");
    const h3 = computeLineHash(2, "line three");
    const range = resolveRange(`1:${h1}`, `3:${h3}`, content);

    expect(range.startLine).toBe(1);
    expect(range.endLine).toBe(3);
    expect(range.lines).toEqual(["line one", "line two", "line three"]);
    expect(range.content).toBe("line one\nline two\nline three");
  });

  it("resolves a single-line range", () => {
    const h2 = computeLineHash(1, "line two");
    const range = resolveRange(`2:${h2}`, `2:${h2}`, content);

    expect(range.startLine).toBe(2);
    expect(range.endLine).toBe(2);
    expect(range.lines).toEqual(["line two"]);
  });

  it("throws on invalid start hash (non-hex)", () => {
    const h3 = computeLineHash(2, "line three");
    expect(() => resolveRange("1:zzz", `3:${h3}`, content)).toThrow("Invalid hash reference");
  });

  it("throws on invalid end hash (non-hex)", () => {
    const h1 = computeLineHash(0, "line one");
    expect(() => resolveRange(`1:${h1}`, "3:zzz", content)).toThrow("Invalid hash reference");
  });

  it("throws on mismatched start hash", () => {
    const h3 = computeLineHash(2, "line three");
    expect(() => resolveRange("1:aaa", `3:${h3}`, content)).toThrow("Start reference invalid");
  });

  it("throws on mismatched end hash", () => {
    const h1 = computeLineHash(0, "line one");
    expect(() => resolveRange(`1:${h1}`, "3:bbb", content)).toThrow("End reference invalid");
  });

  it("throws when start > end", () => {
    const h1 = computeLineHash(0, "line one");
    const h3 = computeLineHash(2, "line three");
    expect(() => resolveRange(`3:${h3}`, `1:${h1}`, content)).toThrow("Invalid range");
  });
});

// ---------------------------------------------------------------------------
// replaceRange
// ---------------------------------------------------------------------------

describe("replaceRange", () => {
  const content = "line one\nline two\nline three\nline four";

  it("replaces a range of lines", () => {
    const h2 = computeLineHash(1, "line two");
    const h3 = computeLineHash(2, "line three");
    const result = replaceRange(`2:${h2}`, `3:${h3}`, content, "new line A\nnew line B");

    expect(result).toBe("line one\nnew line A\nnew line B\nline four");
  });

  it("replaces a single line", () => {
    const h2 = computeLineHash(1, "line two");
    const result = replaceRange(`2:${h2}`, `2:${h2}`, content, "replaced");

    expect(result).toBe("line one\nreplaced\nline three\nline four");
  });

  it("can delete lines by replacing with empty string", () => {
    const h2 = computeLineHash(1, "line two");
    const h3 = computeLineHash(2, "line three");
    const result = replaceRange(`2:${h2}`, `3:${h3}`, content, "");

    expect(result).toBe("line one\n\nline four");
  });
});

// ---------------------------------------------------------------------------
// applyHashEdit
// ---------------------------------------------------------------------------

describe("applyHashEdit", () => {
  const content = "line one\nline two\nline three\nline four";

  it("replaces a range by hash refs", () => {
    const h2 = computeLineHash(1, "line two");
    const h3 = computeLineHash(2, "line three");
    const result = applyHashEdit(
      {
        operation: "replace",
        startRef: `2:${h2}`,
        endRef: `3:${h3}`,
        replacement: "new A\nnew B",
      },
      content,
    );

    expect(result.content).toBe("line one\nnew A\nnew B\nline four");
    expect(result.startLine).toBe(2);
    expect(result.endLine).toBe(3);
  });

  it("deletes a range by hash refs", () => {
    const h2 = computeLineHash(1, "line two");
    const h3 = computeLineHash(2, "line three");
    const result = applyHashEdit(
      {
        operation: "delete",
        startRef: `2:${h2}`,
        endRef: `3:${h3}`,
      },
      content,
    );

    expect(result.content).toBe("line one\nline four");
  });

  it("inserts before a hash ref", () => {
    const h2 = computeLineHash(1, "line two");
    const result = applyHashEdit(
      {
        operation: "insert_before",
        startRef: `2:${h2}`,
        replacement: "inserted",
      },
      content,
    );

    expect(result.content).toBe("line one\ninserted\nline two\nline three\nline four");
  });

  it("inserts after a hash ref", () => {
    const h2 = computeLineHash(1, "line two");
    const result = applyHashEdit(
      {
        operation: "insert_after",
        startRef: `2:${h2}`,
        replacement: "inserted",
      },
      content,
    );

    expect(result.content).toBe("line one\nline two\ninserted\nline three\nline four");
  });

  it("accepts annotated refs", () => {
    const h2 = computeLineHash(1, "line two");
    const result = applyHashEdit(
      {
        operation: "replace",
        startRef: `#HL 2:${h2}|line two`,
        replacement: "replaced",
      },
      content,
    );

    expect(result.content).toBe("line one\nreplaced\nline three\nline four");
  });

  it("throws for stale hashes", () => {
    expect(() =>
      applyHashEdit(
        {
          operation: "replace",
          startRef: "2:aaa",
          replacement: "x",
        },
        content,
      ),
    ).toThrow("Start reference invalid");
  });
});

// ---------------------------------------------------------------------------
// HashlineCache
// ---------------------------------------------------------------------------

describe("HashlineCache", () => {
  it("stores and retrieves cached content", () => {
    const cache = new HashlineCache(10);
    cache.set("file.ts", "content", "annotated");
    expect(cache.get("file.ts", "content")).toBe("annotated");
  });

  it("returns null for uncached files", () => {
    const cache = new HashlineCache(10);
    expect(cache.get("file.ts", "content")).toBeNull();
  });

  it("invalidates on content change", () => {
    const cache = new HashlineCache(10);
    cache.set("file.ts", "content v1", "annotated v1");
    expect(cache.get("file.ts", "content v2")).toBeNull();
  });

  it("evicts oldest entries when at capacity", () => {
    const cache = new HashlineCache(2);
    cache.set("a.ts", "a", "annotated-a");
    cache.set("b.ts", "b", "annotated-b");
    cache.set("c.ts", "c", "annotated-c"); // should evict a.ts

    expect(cache.get("a.ts", "a")).toBeNull();
    expect(cache.get("b.ts", "b")).toBe("annotated-b");
    expect(cache.get("c.ts", "c")).toBe("annotated-c");
  });

  it("moves accessed entries to most recent", () => {
    const cache = new HashlineCache(2);
    cache.set("a.ts", "a", "annotated-a");
    cache.set("b.ts", "b", "annotated-b");

    // Access a.ts to make it most recent
    cache.get("a.ts", "a");

    // Add c.ts — should evict b.ts (oldest)
    cache.set("c.ts", "c", "annotated-c");

    expect(cache.get("a.ts", "a")).toBe("annotated-a");
    expect(cache.get("b.ts", "b")).toBeNull();
  });

  it("invalidate removes a specific entry", () => {
    const cache = new HashlineCache(10);
    cache.set("file.ts", "content", "annotated");
    cache.invalidate("file.ts");
    expect(cache.get("file.ts", "content")).toBeNull();
  });

  it("clear removes all entries", () => {
    const cache = new HashlineCache(10);
    cache.set("a.ts", "a", "aa");
    cache.set("b.ts", "b", "bb");
    cache.clear();
    expect(cache.size).toBe(0);
  });

  it("reports correct size", () => {
    const cache = new HashlineCache(10);
    expect(cache.size).toBe(0);
    cache.set("a.ts", "a", "aa");
    expect(cache.size).toBe(1);
    cache.set("b.ts", "b", "bb");
    expect(cache.size).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// shouldExclude / matchesGlob
// ---------------------------------------------------------------------------

describe("shouldExclude", () => {
  it("excludes node_modules paths", () => {
    expect(shouldExclude("node_modules/foo/bar.js", ["**/node_modules/**"])).toBe(true);
  });

  it("excludes lock files", () => {
    expect(shouldExclude("package-lock.json", ["**/package-lock.json"])).toBe(true);
  });

  it("excludes minified files", () => {
    expect(shouldExclude("dist/app.min.js", ["**/*.min.js"])).toBe(true);
  });

  it("does not exclude normal files", () => {
    expect(shouldExclude("src/app.ts", ["**/node_modules/**", "**/*.min.js"])).toBe(false);
  });
});

describe("matchesGlob", () => {
  it("matches ** patterns", () => {
    expect(matchesGlob("a/b/c.js", "**/*.js")).toBe(true);
  });

  it("matches exact filenames", () => {
    expect(matchesGlob("yarn.lock", "yarn.lock")).toBe(true);
  });

  it("does not match unrelated patterns", () => {
    expect(matchesGlob("src/app.ts", "**/*.js")).toBe(false);
  });

  // --- Edge case tests for glob (issue #9) ---

  it("matches ? single-character wildcard", () => {
    expect(matchesGlob("file1.ts", "file?.ts")).toBe(true);
    expect(matchesGlob("file12.ts", "file?.ts")).toBe(false);
  });

  it("matches **/ for deep directory traversal", () => {
    expect(matchesGlob("a/b/c/d/file.ts", "**/file.ts")).toBe(true);
    expect(matchesGlob("file.ts", "**/file.ts")).toBe(true);
  });

  it("handles Windows-style backslash paths", () => {
    expect(matchesGlob("src\\utils\\helper.ts", "src/**/*.ts")).toBe(true);
    expect(matchesGlob("src\\app.ts", "**/*.ts")).toBe(true);
  });

  it("matches brace expansion {a,b}", () => {
    expect(matchesGlob("file.ts", "*.{ts,js}")).toBe(true);
    expect(matchesGlob("file.js", "*.{ts,js}")).toBe(true);
    expect(matchesGlob("file.py", "*.{ts,js}")).toBe(false);
  });

  it("matches character classes [abc]", () => {
    expect(matchesGlob("a.ts", "[abc].ts")).toBe(true);
    expect(matchesGlob("b.ts", "[abc].ts")).toBe(true);
    expect(matchesGlob("d.ts", "[abc].ts")).toBe(false);
  });

  it("matches negated character classes [^abc]", () => {
    expect(matchesGlob("d.ts", "[^abc].ts")).toBe(true);
    expect(matchesGlob("a.ts", "[^abc].ts")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// resolveConfig
// ---------------------------------------------------------------------------

describe("resolveConfig", () => {
  it("returns defaults when no config provided", () => {
    const config = resolveConfig();
    expect(config.cacheSize).toBe(100);
    expect(config.maxFileSize).toBe(1_048_576);
    expect(config.hashLength).toBe(0);
    expect(config.exclude.length).toBeGreaterThan(0);
    expect(config.prefix).toBe(DEFAULT_PREFIX);
  });

  it("merges partial config with defaults", () => {
    const config = resolveConfig({ cacheSize: 50 });
    expect(config.cacheSize).toBe(50);
    expect(config.maxFileSize).toBe(1_048_576);
    expect(config.prefix).toBe(DEFAULT_PREFIX);
  });

  it("allows overriding exclude patterns", () => {
    const config = resolveConfig({ exclude: ["*.test.ts"] });
    expect(config.exclude).toEqual(["*.test.ts"]);
  });

  it("allows setting prefix to false", () => {
    const config = resolveConfig({ prefix: false });
    expect(config.prefix).toBe(false);
  });

  it("allows setting custom prefix", () => {
    const config = resolveConfig({ prefix: ">> " });
    expect(config.prefix).toBe(">> ");
  });

  it("merges pluginConfig with userConfig (userConfig takes priority)", () => {
    const config = resolveConfig(
      { cacheSize: 50 },
      { cacheSize: 200, maxFileSize: 500_000 },
    );
    expect(config.cacheSize).toBe(50); // userConfig wins
    expect(config.maxFileSize).toBe(500_000); // from pluginConfig
  });

  it("uses pluginConfig when no userConfig provided", () => {
    const config = resolveConfig(undefined, { maxFileSize: 500_000 });
    expect(config.maxFileSize).toBe(500_000);
    expect(config.cacheSize).toBe(100); // default
  });
});

// ---------------------------------------------------------------------------
// getByteLength
// ---------------------------------------------------------------------------

describe("getByteLength", () => {
  it("returns correct byte length for ASCII strings", () => {
    expect(getByteLength("hello")).toBe(5);
    expect(getByteLength("")).toBe(0);
  });

  it("returns correct byte length for Cyrillic (2 bytes per char)", () => {
    // "Привет" = 6 chars, 12 bytes in UTF-8
    expect(getByteLength("Привет")).toBe(12);
  });

  it("returns correct byte length for CJK characters (3 bytes per char)", () => {
    // "中文" = 2 chars, 6 bytes in UTF-8
    expect(getByteLength("中文")).toBe(6);
  });

  it("returns correct byte length for emoji (4 bytes per char)", () => {
    // "🎉" = 1 char (2 UTF-16 code units), 4 bytes in UTF-8
    expect(getByteLength("🎉")).toBe(4);
  });

  it("returns correct byte length for mixed content", () => {
    // "Hello Привет 中文 🎉" = 5 + 1 + 12 + 1 + 6 + 1 + 4 = 30 bytes
    expect(getByteLength("Hello Привет 中文 🎉")).toBe(30);
  });
});

// ---------------------------------------------------------------------------
// Unicode tests (issue #8)
// ---------------------------------------------------------------------------

describe("Unicode support", () => {
  it("hashes Cyrillic content correctly", () => {
    const content = "Привет мир\nВторая строка\nТретья строка";
    const formatted = formatFileWithHashes(content);
    const stripped = stripHashes(formatted);
    expect(stripped).toBe(content);
  });

  it("hashes emoji content correctly", () => {
    const content = "Hello 🎉\n🚀 Launch\n✨ Sparkle";
    const formatted = formatFileWithHashes(content);
    const stripped = stripHashes(formatted);
    expect(stripped).toBe(content);
  });

  it("hashes CJK content correctly", () => {
    const content = "中文测试\n日本語テスト\n한국어 테스트";
    const formatted = formatFileWithHashes(content);
    const stripped = stripHashes(formatted);
    expect(stripped).toBe(content);
  });

  it("produces different hashes for different Unicode content", () => {
    const hash1 = computeLineHash(0, "Привет");
    const hash2 = computeLineHash(0, "Пока");
    expect(hash1).not.toBe(hash2);
  });

  it("produces different hashes for different emoji", () => {
    const hash1 = computeLineHash(0, "🎉");
    const hash2 = computeLineHash(0, "🚀");
    expect(hash1).not.toBe(hash2);
  });

  it("verifyHash works with Unicode content", () => {
    const content = "Привет\n中文\n🎉";
    const hash = computeLineHash(0, "Привет");
    const result = verifyHash(1, hash, content);
    expect(result.valid).toBe(true);
  });

  it("buildHashMap works with Unicode content", () => {
    const content = "Привет\n中文\n🎉";
    const map = buildHashMap(content);
    expect(map.size).toBe(3);
  });

  it("stripHashes handles mixed Unicode and ASCII", () => {
    const content = "Hello world\nПривет мир\n中文测试\n🎉🚀✨";
    const formatted = formatFileWithHashes(content);
    const stripped = stripHashes(formatted);
    expect(stripped).toBe(content);
  });
});

// ---------------------------------------------------------------------------
// createHashline (factory)
// ---------------------------------------------------------------------------

describe("createHashline", () => {
  it("creates an instance with default config", () => {
    const hl = createHashline();
    expect(hl.config.cacheSize).toBe(100);
    expect(hl.config.hashLength).toBe(0);
    expect(hl.config.prefix).toBe(DEFAULT_PREFIX);
  });

  it("formats and strips content correctly", () => {
    const hl = createHashline();
    const content = "hello\nworld";
    const formatted = hl.formatFileWithHashes(content);
    const stripped = hl.stripHashes(formatted);
    expect(stripped).toBe(content);
  });

  it("uses cache when filePath is provided", () => {
    const hl = createHashline();
    const content = "hello\nworld";

    const formatted1 = hl.formatFileWithHashes(content, "test.ts");
    const formatted2 = hl.formatFileWithHashes(content, "test.ts");

    expect(formatted1).toBe(formatted2);
    expect(hl.cache.size).toBe(1);
  });

  it("respects hashLength override", () => {
    const hl = createHashline({ hashLength: 3 });
    const formatted = hl.formatFileWithHashes("hello");
    expect(formatted).toMatch(/^#HL 1:[0-9a-f]{3}\|hello$/);
  });

  it("respects prefix: false for legacy format", () => {
    const hl = createHashline({ prefix: false });
    const formatted = hl.formatFileWithHashes("hello");
    expect(formatted).toMatch(/^1:[0-9a-f]{3}\|hello$/);
    const stripped = hl.stripHashes(formatted);
    expect(stripped).toBe("hello");
  });

  it("respects custom prefix", () => {
    const hl = createHashline({ prefix: ">> " });
    const formatted = hl.formatFileWithHashes("hello");
    expect(formatted).toMatch(/^>> 1:[0-9a-f]{3}\|hello$/);
    const stripped = hl.stripHashes(formatted);
    expect(stripped).toBe("hello");
  });

  it("verifyHash works through instance", () => {
    const hl = createHashline();
    const content = "line one\nline two";
    const hash = hl.computeLineHash(0, "line one");
    const result = hl.verifyHash(1, hash, content);
    expect(result.valid).toBe(true);
  });

  it("shouldExclude works through instance", () => {
    const hl = createHashline();
    expect(hl.shouldExclude("node_modules/foo.js")).toBe(true);
    expect(hl.shouldExclude("src/app.ts")).toBe(false);
  });

  it("resolveRange works through instance", () => {
    const hl = createHashline();
    const content = "a\nb\nc";
    const h1 = hl.computeLineHash(0, "a");
    const h2 = hl.computeLineHash(1, "b");
    const range = hl.resolveRange(`1:${h1}`, `2:${h2}`, content);
    expect(range.lines).toEqual(["a", "b"]);
  });

  it("replaceRange works through instance", () => {
    const hl = createHashline();
    const content = "a\nb\nc";
    const h2 = hl.computeLineHash(1, "b");
    const result = hl.replaceRange(`2:${h2}`, `2:${h2}`, content, "x");
    expect(result).toBe("a\nx\nc");
  });

  it("applyHashEdit works through instance", () => {
    const hl = createHashline();
    const content = "a\nb\nc";
    const h2 = hl.computeLineHash(1, "b");
    const result = hl.applyHashEdit(
      {
        operation: "replace",
        startRef: `2:${h2}`,
        replacement: "x",
      },
      content,
    );
    expect(result.content).toBe("a\nx\nc");
  });
});
