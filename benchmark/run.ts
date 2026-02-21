#!/usr/bin/env npx tsx
/**
 * Deterministic benchmark for opencode-hashline.
 *
 * Modes:
 *   npx tsx benchmark/run.ts               — hashline mode (hash-reference edits)
 *   npx tsx benchmark/run.ts --no-hash     — str_replace mode (exact string matching)
 *   npx tsx benchmark/run.ts --apply-patch — apply_patch mode (unified diff context matching)
 *
 * For each fixture (mutated React source file):
 *   hashline:    annotate → hash-reference → applyHashEdit → verify
 *   str_replace: compute old_string/new_string → string.replace → verify
 *   apply_patch: build unified diff (3 context lines) → apply by context anchor → verify
 */

import { readFileSync, readdirSync, statSync } from "fs";
import { join, basename } from "path";
import {
  formatFileWithHashes,
  stripHashes,
  computeLineHash,
  applyHashEdit,
  getAdaptiveHashLength,
  type HashEditInput,
} from "../src/hashline";

const FIXTURES_DIR = join(import.meta.dirname!, "fixtures");
const USE_HASHLINE = !process.argv.includes("--no-hash") && !process.argv.includes("--apply-patch");
const USE_APPLY_PATCH = process.argv.includes("--apply-patch");

interface FixtureMeta {
  mutation_type: string;
  mutation_category: string;
  difficulty: string;
  difficulty_score: number;
  line_number: number;
  original_snippet: string;
  mutated_snippet: string;
  file_path: string;
  context?: {
    file_lines: number;
    is_repeated_line: boolean;
    repeat_count: number;
    similar_block_count: number;
  };
}

interface TestResult {
  id: string;
  category: string;
  difficulty: string;
  annotateOk: boolean;
  stripRoundTrip: boolean;
  editApplied: boolean;
  editCorrect: boolean;
  error?: string;
  annotateTimeMs: number;
  editTimeMs: number;
  isRepeatedLine: boolean;
  repeatCount: number;
  similarBlocks: number;
}

function findInputFile(fixtureDir: string): string {
  const inputDir = join(fixtureDir, "input");
  const files = readdirSync(inputDir);
  if (files.length === 0) throw new Error("No input files");
  return join(inputDir, files[0]);
}

function findExpectedFile(fixtureDir: string): string {
  const expectedDir = join(fixtureDir, "expected");
  const files = readdirSync(expectedDir);
  if (files.length === 0) throw new Error("No expected files");
  return join(expectedDir, files[0]);
}

// ---------------------------------------------------------------------------
// Hashline mode: edit by hash references
// ---------------------------------------------------------------------------

function buildHashEdit(input: string, expected: string): HashEditInput | null {
  const inputLines = input.split("\n");
  const expectedLines = expected.split("\n");
  const hashLen = getAdaptiveHashLength(inputLines.length);

  let firstDiff = -1;
  const maxLen = Math.max(inputLines.length, expectedLines.length);
  for (let i = 0; i < maxLen; i++) {
    if (inputLines[i] !== expectedLines[i]) {
      if (firstDiff === -1) firstDiff = i;
    }
  }

  if (firstDiff === -1) return null;

  let endInput = inputLines.length - 1;
  let endExpected = expectedLines.length - 1;
  while (endInput > firstDiff && endExpected > firstDiff && inputLines[endInput] === expectedLines[endExpected]) {
    endInput--;
    endExpected--;
  }

  const startLine = firstDiff + 1;
  const endLine = endInput + 1;

  const startHash = computeLineHash(firstDiff, inputLines[firstDiff], hashLen);
  const endHash = computeLineHash(endInput, inputLines[endInput], hashLen);

  const replacementLines = expectedLines.slice(firstDiff, endExpected + 1);

  if (replacementLines.length === 0) {
    return {
      operation: "delete",
      startRef: `${startLine}:${startHash}`,
      endRef: `${endLine}:${endHash}`,
    };
  }

  return {
    operation: "replace",
    startRef: `${startLine}:${startHash}`,
    endRef: startLine === endLine ? undefined : `${endLine}:${endHash}`,
    replacement: replacementLines.join("\n"),
  };
}

// ---------------------------------------------------------------------------
// str_replace mode: simulate exact-match string replacement (no hashes)
// ---------------------------------------------------------------------------

interface StrReplaceEdit {
  oldString: string;
  newString: string;
}

function buildStrReplaceEdit(input: string, expected: string): StrReplaceEdit | null {
  const inputLines = input.split("\n");
  const expectedLines = expected.split("\n");

  let firstDiff = -1;
  const maxLen = Math.max(inputLines.length, expectedLines.length);
  for (let i = 0; i < maxLen; i++) {
    if (inputLines[i] !== expectedLines[i]) {
      if (firstDiff === -1) firstDiff = i;
    }
  }

  if (firstDiff === -1) return null;

  let endInput = inputLines.length - 1;
  let endExpected = expectedLines.length - 1;
  while (endInput > firstDiff && endExpected > firstDiff && inputLines[endInput] === expectedLines[endExpected]) {
    endInput--;
    endExpected--;
  }

  const oldString = inputLines.slice(firstDiff, endInput + 1).join("\n");
  const newString = expectedLines.slice(firstDiff, endExpected + 1).join("\n");

  return { oldString, newString };
}

/**
 * Simulate str_replace: find FIRST occurrence of oldString and replace it.
 * Returns null if oldString not found or appears multiple times (ambiguous).
 */
function applyStrReplace(
  content: string,
  edit: StrReplaceEdit,
): { content: string; error?: string } {
  const firstIdx = content.indexOf(edit.oldString);
  if (firstIdx === -1) {
    return { content, error: "old_string not found in file" };
  }

  const secondIdx = content.indexOf(edit.oldString, firstIdx + 1);
  if (secondIdx !== -1) {
    return {
      content: content.slice(0, firstIdx) + edit.newString + content.slice(firstIdx + edit.oldString.length),
      error: `AMBIGUOUS: old_string appears multiple times (first replace used)`,
    };
  }

  return {
    content: content.slice(0, firstIdx) + edit.newString + content.slice(firstIdx + edit.oldString.length),
  };
}

// ---------------------------------------------------------------------------
// apply_patch mode: unified diff with context-line anchor matching
// ---------------------------------------------------------------------------

const PATCH_CONTEXT = 3;

interface ApplyPatchEdit {
  contextBefore: string[];
  removedLines: string[];
  addedLines: string[];
  contextAfter: string[];
}

/**
 * Build a unified-diff-style edit: extract the changed region plus surrounding
 * context lines. This mirrors how models using apply_patch produce patches.
 */
function buildApplyPatchEdit(input: string, expected: string): ApplyPatchEdit | null {
  const inputLines = input.split("\n");
  const expectedLines = expected.split("\n");

  let firstDiff = -1;
  const maxLen = Math.max(inputLines.length, expectedLines.length);
  for (let i = 0; i < maxLen; i++) {
    if (inputLines[i] !== expectedLines[i]) {
      if (firstDiff === -1) firstDiff = i;
    }
  }
  if (firstDiff === -1) return null;

  let endInput = inputLines.length - 1;
  let endExpected = expectedLines.length - 1;
  while (
    endInput > firstDiff &&
    endExpected > firstDiff &&
    inputLines[endInput] === expectedLines[endExpected]
  ) {
    endInput--;
    endExpected--;
  }

  const startCtx = Math.max(0, firstDiff - PATCH_CONTEXT);
  const endCtxInput = Math.min(inputLines.length - 1, endInput + PATCH_CONTEXT);

  return {
    contextBefore: inputLines.slice(startCtx, firstDiff),
    removedLines: inputLines.slice(firstDiff, endInput + 1),
    addedLines: expectedLines.slice(firstDiff, endExpected + 1),
    contextAfter: inputLines.slice(endInput + 1, endCtxInput + 1),
  };
}

/**
 * Apply a patch edit by locating the context anchor in the file.
 *
 * Searches for the sequence [contextBefore + removedLines] in the file.
 * If the anchor is unique → apply cleanly.
 * If the anchor matches multiple locations → ambiguous (apply first, report warning).
 * If the anchor is not found → fail.
 */
function applyPatchEdit(
  content: string,
  edit: ApplyPatchEdit,
): { content: string; error?: string } {
  const lines = content.split("\n");
  const anchor = [...edit.contextBefore, ...edit.removedLines];

  if (anchor.length === 0) return { content };

  // Find all positions where the anchor matches
  const matchPositions: number[] = [];
  outer: for (let i = 0; i <= lines.length - anchor.length; i++) {
    for (let j = 0; j < anchor.length; j++) {
      if (lines[i + j] !== anchor[j]) continue outer;
    }
    matchPositions.push(i);
  }

  if (matchPositions.length === 0) {
    return { content, error: "Patch context not found in file" };
  }

  const applyAt = matchPositions[0];
  const before = lines.slice(0, applyAt + edit.contextBefore.length);
  const after = lines.slice(applyAt + edit.contextBefore.length + edit.removedLines.length);
  const result = [...before, ...edit.addedLines, ...after].join("\n");

  if (matchPositions.length > 1) {
    return {
      content: result,
      error: `AMBIGUOUS: patch context matches ${matchPositions.length} locations (first used)`,
    };
  }

  return { content: result };
}

// ---------------------------------------------------------------------------
// Test runner
// ---------------------------------------------------------------------------

function runFixture(fixtureDir: string): TestResult {
  const id = basename(fixtureDir);
  let meta: FixtureMeta;
  try {
    meta = JSON.parse(readFileSync(join(fixtureDir, "metadata.json"), "utf-8"));
  } catch {
    meta = { mutation_type: "unknown", mutation_category: "unknown", difficulty: "unknown", difficulty_score: 0, line_number: 0, original_snippet: "", mutated_snippet: "", file_path: "" };
  }

  const result: TestResult = {
    id,
    category: meta.mutation_category,
    difficulty: meta.difficulty,
    annotateOk: false,
    stripRoundTrip: false,
    editApplied: false,
    editCorrect: false,
    annotateTimeMs: 0,
    editTimeMs: 0,
    isRepeatedLine: meta.context?.is_repeated_line ?? false,
    repeatCount: meta.context?.repeat_count ?? 0,
    similarBlocks: meta.context?.similar_block_count ?? 0,
  };

  try {
    const inputPath = findInputFile(fixtureDir);
    const expectedPath = findExpectedFile(fixtureDir);
    const input = readFileSync(inputPath, "utf-8");
    const expected = readFileSync(expectedPath, "utf-8");

    if (USE_HASHLINE) {
      // --- Hashline mode ---

      // 1. Annotate
      const t0 = performance.now();
      const annotated = formatFileWithHashes(input);
      result.annotateTimeMs = performance.now() - t0;
      result.annotateOk = annotated.length > input.length;

      // 2. Strip round-trip
      const stripped = stripHashes(annotated);
      result.stripRoundTrip = stripped === input;

      if (!result.stripRoundTrip) {
        result.error = "Strip round-trip failed";
        return result;
      }

      // 3. Build and apply edit
      const edit = buildHashEdit(input, expected);
      if (!edit) {
        result.error = "No diff found";
        return result;
      }

      const t1 = performance.now();
      const editResult = applyHashEdit(edit, input);
      result.editTimeMs = performance.now() - t1;
      result.editApplied = true;
      result.editCorrect = editResult.content === expected;

      if (!result.editCorrect) {
        const resultLines = editResult.content.split("\n");
        const expectedLines = expected.split("\n");
        for (let i = 0; i < Math.max(resultLines.length, expectedLines.length); i++) {
          if (resultLines[i] !== expectedLines[i]) {
            result.error = `Mismatch at line ${i + 1}`;
            break;
          }
        }
      }
    } else if (USE_APPLY_PATCH) {
      // --- apply_patch mode ---
      result.annotateOk = true;
      result.stripRoundTrip = true;

      const edit = buildApplyPatchEdit(input, expected);
      if (!edit) {
        result.error = "No diff found";
        return result;
      }

      const t1 = performance.now();
      const { content: edited, error } = applyPatchEdit(input, edit);
      result.editTimeMs = performance.now() - t1;
      result.editApplied = true;
      result.editCorrect = edited === expected;

      if (error) {
        result.error = error;
        if (error.startsWith("AMBIGUOUS") && edited === expected) {
          result.editCorrect = true;
          result.error = `${error} (but first match was correct)`;
        }
      }

      if (!result.editCorrect && !result.error) {
        result.error = "Result doesn't match expected";
      }
    } else {
      // --- str_replace mode ---
      result.annotateOk = true; // no annotation step
      result.stripRoundTrip = true;

      const edit = buildStrReplaceEdit(input, expected);
      if (!edit) {
        result.error = "No diff found";
        return result;
      }

      const t1 = performance.now();
      const { content: edited, error } = applyStrReplace(input, edit);
      result.editTimeMs = performance.now() - t1;
      result.editApplied = true;
      result.editCorrect = edited === expected;

      if (error) {
        result.error = error;
        // For ambiguous case, check if first-match replacement was correct
        if (error.startsWith("AMBIGUOUS") && edited === expected) {
          result.editCorrect = true;
          result.error = `${error} (but first match was correct)`;
        }
      }

      if (!result.editCorrect && !result.error) {
        result.error = "Result doesn't match expected";
      }
    }
  } catch (e) {
    result.error = e instanceof Error ? e.message : String(e);
  }

  return result;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const fixtures = readdirSync(FIXTURES_DIR)
  .filter(name => {
    try { return statSync(join(FIXTURES_DIR, name)).isDirectory(); } catch { return false; }
  })
  .sort();

const mode = USE_HASHLINE ? "hashline" : USE_APPLY_PATCH ? "apply_patch" : "str_replace";
const modeDesc = USE_HASHLINE
  ? "hashline (hash-reference edits)"
  : USE_APPLY_PATCH
    ? "apply_patch (unified diff context matching)"
    : "str_replace (exact string matching)";
console.log(`\nopencode-hashline Benchmark (${mode})`);
console.log(`${"=".repeat(36 + mode.length)}`);
console.log(`Fixtures: ${fixtures.length}`);
console.log(`Mode:     ${modeDesc}`);
console.log(``);

const results: TestResult[] = [];
let passed = 0;
let failed = 0;
let ambiguous = 0;

for (const fixture of fixtures) {
  const result = runFixture(join(FIXTURES_DIR, fixture));
  results.push(result);

  const isAmbig = result.error?.startsWith("AMBIGUOUS");
  if (isAmbig) ambiguous++;

  const status = result.editCorrect
    ? (isAmbig ? "\x1b[33m~\x1b[0m" : "\x1b[32m✓\x1b[0m")
    : "\x1b[31m✗\x1b[0m";
  if (result.editCorrect) passed++;
  else failed++;

  const extra = result.isRepeatedLine ? ` [repeated×${result.repeatCount}]` : "";
  const timings = `edit: ${result.editTimeMs.toFixed(2)}ms`;
  console.log(`  ${status} ${result.id} [${result.category}/${result.difficulty}]${extra} ${timings}${result.error ? ` — ${result.error}` : ""}`);
}

// Summary
console.log(``);
console.log(`Results (${modeDesc})`);
console.log(`-------`);
console.log(`  Total:     ${results.length}`);
console.log(`  Passed:    \x1b[32m${passed}\x1b[0m`);
if (ambiguous > 0) {
  console.log(`  Ambiguous: \x1b[33m${ambiguous}\x1b[0m (old_string matched multiple locations)`);
}
console.log(`  Failed:    ${failed > 0 ? `\x1b[31m${failed}\x1b[0m` : "0"}`);
console.log(`  Rate:      ${((passed / results.length) * 100).toFixed(1)}%`);
console.log(``);

// Timing
const totalEdit = results.reduce((s, r) => s + r.editTimeMs, 0);
if (USE_HASHLINE) {
  const totalAnnotate = results.reduce((s, r) => s + r.annotateTimeMs, 0);
  console.log(`Timing`);
  console.log(`------`);
  console.log(`  Avg annotate:  ${(totalAnnotate / results.length).toFixed(2)}ms`);
  console.log(`  Avg edit:      ${(totalEdit / results.length).toFixed(2)}ms`);
  console.log(`  Total:         ${(totalAnnotate + totalEdit).toFixed(2)}ms`);
} else {
  console.log(`Timing`);
  console.log(`------`);
  console.log(`  Avg edit:  ${(totalEdit / results.length).toFixed(2)}ms`);
  console.log(`  Total:     ${totalEdit.toFixed(2)}ms`);
}

// Category breakdown
const byCategory = new Map<string, { total: number; passed: number; ambig: number }>();
for (const r of results) {
  const cat = r.category;
  const entry = byCategory.get(cat) ?? { total: 0, passed: 0, ambig: 0 };
  entry.total++;
  if (r.editCorrect) entry.passed++;
  if (r.error?.startsWith("AMBIGUOUS")) entry.ambig++;
  byCategory.set(cat, entry);
}

console.log(``);
console.log(`By Category`);
console.log(`-----------`);
for (const [cat, stats] of [...byCategory.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
  const rate = ((stats.passed / stats.total) * 100).toFixed(0);
  const ambigNote = stats.ambig > 0 ? ` (${stats.ambig} ambiguous)` : "";
  console.log(`  ${cat.padEnd(20)} ${stats.passed}/${stats.total} (${rate}%)${ambigNote}`);
}

// Repeated lines analysis (interesting for str_replace)
const repeatedResults = results.filter(r => r.isRepeatedLine);
if (repeatedResults.length > 0) {
  const repeatedPassed = repeatedResults.filter(r => r.editCorrect).length;
  console.log(``);
  console.log(`Repeated Lines (str_replace risk zone)`);
  console.log(`--------------------------------------`);
  console.log(`  Fixtures with repeated target line: ${repeatedResults.length}`);
  console.log(`  Passed: ${repeatedPassed}/${repeatedResults.length} (${((repeatedPassed / repeatedResults.length) * 100).toFixed(0)}%)`);
  for (const r of repeatedResults) {
    const status = r.editCorrect ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m";
    console.log(`  ${status} ${r.id} — repeats: ${r.repeatCount}, similar blocks: ${r.similarBlocks}${r.error ? ` — ${r.error}` : ""}`);
  }
}

process.exit(failed > 0 ? 1 : 0);
