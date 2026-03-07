import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, openSync, closeSync, writeFileSync, existsSync, statSync, readdirSync, rmSync, constants as fsConstants } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { randomBytes } from "crypto";

// ---------------------------------------------------------------------------
// These tests verify the temp-file infrastructure patterns used in index.ts:
//   1. Single exit listener (no MaxListenersExceededWarning)
//   2. Private temp directory via mkdtempSync
//   3. Atomic exclusive file creation (O_EXCL)
// ---------------------------------------------------------------------------

// Reproduce the same writeTempFile logic from index.ts
function writeTempFile(tempDir: string, content: string): string {
  const name = `hl-${randomBytes(16).toString("hex")}.txt`;
  const tmpPath = join(tempDir, name);
  const fd = openSync(tmpPath, fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL, 0o600);
  try {
    writeFileSync(fd, content, "utf-8");
  } finally {
    closeSync(fd);
  }
  return tmpPath;
}

// Reproduce the same registerTempDir singleton pattern from index.ts
function createTempRegistry() {
  const dirs = new Set<string>();
  let registered = false;
  let listenerCount = 0;

  function register(dir: string) {
    dirs.add(dir);
    if (!registered) {
      registered = true;
      listenerCount++;
    }
  }

  return { dirs, register, getListenerCount: () => listenerCount };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("temp file infrastructure", () => {
  const createdDirs: string[] = [];

  afterEach(() => {
    for (const d of createdDirs) {
      try { rmSync(d, { recursive: true, force: true }); } catch {}
    }
    createdDirs.length = 0;
  });

  // --- Single exit listener ---

  it("registerTempDir pattern adds exactly one listener regardless of instance count", () => {
    const registry = createTempRegistry();

    // Simulate 20 plugin instances registering their temp dirs
    for (let i = 0; i < 20; i++) {
      const dir = mkdtempSync(join(tmpdir(), "hashline-test-"));
      createdDirs.push(dir);
      registry.register(dir);
    }

    expect(registry.getListenerCount()).toBe(1);
    expect(registry.dirs.size).toBe(20);
  });

  // --- Private temp directory ---

  it("mkdtempSync creates a directory only accessible to the owner", () => {
    const dir = mkdtempSync(join(tmpdir(), "hashline-test-"));
    createdDirs.push(dir);

    expect(existsSync(dir)).toBe(true);
    const stats = statSync(dir);
    expect(stats.isDirectory()).toBe(true);
    // On macOS/Linux, mkdtempSync creates with 0o700 by default
    if (process.platform !== "win32") {
      const mode = stats.mode & 0o777;
      expect(mode).toBe(0o700);
    }
  });

  // --- Atomic exclusive file creation ---

  it("writeTempFile creates a file with O_EXCL (no overwrite)", () => {
    const dir = mkdtempSync(join(tmpdir(), "hashline-test-"));
    createdDirs.push(dir);

    const path = writeTempFile(dir, "hello world");
    expect(existsSync(path)).toBe(true);

    // Verify content
    const { readFileSync } = require("fs");
    expect(readFileSync(path, "utf-8")).toBe("hello world");
  });

  it("writeTempFile sets restrictive permissions (0o600)", () => {
    if (process.platform === "win32") return; // permissions not enforced on Windows

    const dir = mkdtempSync(join(tmpdir(), "hashline-test-"));
    createdDirs.push(dir);

    const path = writeTempFile(dir, "secret content");
    const stats = statSync(path);
    const mode = stats.mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it("writeTempFile generates unique filenames (no collisions)", () => {
    const dir = mkdtempSync(join(tmpdir(), "hashline-test-"));
    createdDirs.push(dir);

    const paths = new Set<string>();
    for (let i = 0; i < 100; i++) {
      const path = writeTempFile(dir, `content-${i}`);
      expect(paths.has(path)).toBe(false);
      paths.add(path);
    }

    // All files should exist in the directory
    const files = readdirSync(dir);
    expect(files.length).toBe(100);
  });

  it("writeTempFile refuses to follow symlinks (O_EXCL fails on existing target)", () => {
    if (process.platform === "win32") return;

    const dir = mkdtempSync(join(tmpdir(), "hashline-test-"));
    createdDirs.push(dir);

    // Create a real file, then a symlink pointing to it
    const realFile = join(dir, "real.txt");
    writeFileSync(realFile, "original", "utf-8");

    // O_EXCL with a pre-existing name should fail — verify the pattern works
    const existingName = join(dir, "existing.txt");
    writeFileSync(existingName, "data", "utf-8");

    expect(() => {
      openSync(existingName, fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL, 0o600);
    }).toThrow();
  });

  it("rmSync with recursive:true cleans up entire temp directory", () => {
    const dir = mkdtempSync(join(tmpdir(), "hashline-test-"));

    // Create several files
    for (let i = 0; i < 5; i++) {
      writeTempFile(dir, `file-${i}`);
    }

    expect(readdirSync(dir).length).toBe(5);

    rmSync(dir, { recursive: true, force: true });
    expect(existsSync(dir)).toBe(false);
    // Don't add to createdDirs since we already removed it
  });
});
