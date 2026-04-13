# Codebase Audit — opencode-hashline

**Date:** 2026-04-13
**Scope:** Full audit — bugs, security, performance, code quality, tests, architecture

## Project Overview

opencode-hashline is an OpenCode plugin implementing content-addressable line hashing for precise AI code editing. Each file line is annotated with a hash tag (`#HL 1:a3f|code`), enabling AI models to reference lines by hash instead of fragile string matching.

- **Codebase:** ~1185 lines across 4 source files
- **Tests:** 237 tests, all passing
- **TypeScript:** strict mode, clean typecheck

## Findings

### 1. Bugs & Correctness

#### BUG-1 (medium): `replaceRange` doesn't support `safeReapply`, duplicates split

**File:** `src/hashline.ts:786-803`
**Problem:** `replaceRange` calls `resolveRange` without passing `safeReapply`, so it never supports line relocation. It also splits content a second time on line 797 after `resolveRange` already split internally.
**Fix:** Pass `safeReapply` parameter through to `resolveRange`, and refactor to avoid double split.

#### BUG-2 (medium): Collision resolution may leave duplicate hashes at maxLen=8

**File:** `src/hashline.ts:396-419`
**Problem:** If two different `idx:content` pairs produce identical hashes at every length from 3 to 8, the loop exits silently with duplicate hashes. `verifyHash`/`applyHashEdit` could then resolve to the wrong line.
**Probability:** Extremely low (FNV-1a at 32 bits = 4B values), but no fallback exists.
**Fix:** After the collision loop, scan for remaining duplicates and log a warning or append a disambiguation suffix.

#### BUG-3 (low): `getByteLength` allocates a full `Uint8Array`

**File:** `src/hashline.ts:1057-1059`
**Problem:** `TextEncoder.encode()` creates a full buffer just to read `.length`. In Node.js, `Buffer.byteLength(str, 'utf-8')` computes length without allocation.
**Fix:** Replace with `Buffer.byteLength`.

#### BUG-4 (low): `createBoundedSet` monkey-patches `Set.add`

**File:** `src/hooks.ts:32-43`
**Problem:** Fragile pattern — overrides `.add` on instance. Works but breaks if someone calls via `Set.prototype.add.call()`.
**Fix:** Replace with a small `BoundedSet` class.

### 2. Security

#### SEC-1 (low): `sanitizeConfig` doesn't limit `exclude` array length

**File:** `src/index.ts:75-78`
**Problem:** A malicious config with millions of patterns would slow every `shouldExclude` call.
**Fix:** Add `slice(0, 1000)` after filtering.

#### SEC-2 (low): `globMatcherCache` grows unbounded

**File:** `src/hashline.ts:1020`
**Problem:** Compiled picomatch matchers cached forever. Patterns come from static config so practically not a problem.
**Fix:** No action required, or add a max size if desired.

#### SEC-3 (low): `stripRegexCache` grows unbounded

**File:** `src/hashline.ts:437`
**Problem:** Same pattern as SEC-2.
**Fix:** Same as SEC-2.

**Note:** Existing security measures are well-implemented — path traversal protection, O_EXCL temp files, config sanitization, worktree boundary checks.

### 3. Performance

#### PERF-1 (medium): Collision resolution rescans all lines each round

**File:** `src/hashline.ts:396-419`
**Problem:** After upgrading hash length for a colliding group, `hasCollisions = true` triggers a full rescan. Could track only changed indices.
**Fix:** Maintain a dirty set and only rescan upgraded entries.

#### PERF-2 (medium): `getByteLength` allocates full buffer

Same as BUG-3. Replace `TextEncoder.encode().length` with `Buffer.byteLength()`.

#### PERF-3 (low): `replaceRange` duplicates `split("\n")`

Same as BUG-1. `resolveRange` already splits; `replaceRange` splits again.

#### PERF-4 (low): `stripHashes` creates `revPattern` on every call

**File:** `src/hashline.ts:462`
**Problem:** `hashLinePattern` is cached but `revPattern` is recreated each time.
**Fix:** Cache both patterns together.

#### PERF-5 (low): Repeated CRLF normalization across chained operations

**File:** Multiple functions in `src/hashline.ts`
**Problem:** `applyHashEdit`, `resolveRange`, `replaceRange`, `stripHashes` each call `detectLineEnding` and `replace(/\r\n/g, "\n")` independently.
**Fix:** Normalize once at the entry point and pass normalized content downstream.

### 4. Code Quality

#### CODE-1 (medium): Duplicated logic between `applyHashEdit` and `resolveRange`

**Files:** `src/hashline.ts:698-773` and `src/hashline.ts:811-928`
**Problem:** ~60 lines of near-identical code: line ending normalization, parseHashRef + verifyHash for start/end, relocation handling, error construction.
**Fix:** Refactor `resolveRange` to accept pre-split `lines[]`, then reuse it in `applyHashEdit`.

#### CODE-2 (medium): Unnecessary dynamic `import("fs")` in index.ts

**File:** `src/index.ts:181`
**Problem:** `await import("fs")` for `appendFileSync`, but `fs` is already statically imported on line 13.
**Fix:** Use the existing static import.

#### CODE-3 (low): Double `as` cast for plugin input

**File:** `src/index.ts:173-174`
**Problem:** `(input as Record<string, unknown>).directory as string | undefined` — two casts losing type safety.
**Fix:** Define a `PluginInput` interface.

#### CODE-4 (low): Factory `createHashline` has 80 lines of trivial delegations

**File:** `src/hashline.ts:1102-1184`
**Problem:** Each method just passes through `hl`/`pfx` to the module-level function. Adding a new function requires updating both factory and interface.
**Fix:** Not critical. Could use a Proxy or partial application, but added complexity may not be worth it.

#### CODE-5 (low): `callID` deduplication silently disabled when absent

**File:** `src/hooks.ts:139-143, 216-219`
**Problem:** When `callID` is undefined, deduplication is skipped entirely without logging.
**Fix:** Add a debug log for clarity.

### 5. Test Coverage

#### TEST-1 (medium): No tests for `createHashlinePlugin` (index.ts)

The main entry point (~100 lines) including config loading, `chat.message` hook, temp file creation, and exit listener is untested.

#### TEST-2 (medium): No tests for `sanitizeConfig`

Security-critical validation function with no test coverage. Should test: invalid input types, prototype pollution, boundary values, prefix validation, array filtering.

#### TEST-3 (medium): No tests for `chat.message` hook

Complex logic: `file://` URL parsing, worktree boundary check, exclude/size checks, cache, temp file URL swap — all untested.

#### TEST-4 (low): No tests for config priority (loadConfig)

Global → project → programmatic override order is untested.

#### TEST-5 (low): No edge case tests for `isWithin`

Windows paths (`C:\`, UNC `\\server\share`) and root dir (`/`) special cases untested.

#### TEST-6 (low): `findCandidateLines` missing edge case tests

Empty file, single-line file, all identical lines — not tested.

### 6. Architecture

#### ARCH-1 (medium): `hashline.ts` has too many responsibilities

1185 lines covering: config, types, errors, hashing, formatting, parsing, verification, range ops, cache, glob matching, utilities, factory. Splittable into focused modules when the project grows.

#### ARCH-2 (low): `replaceRange` is an orphan API

Not used internally — `applyHashEdit` covers its functionality with better support (single split, safeReapply). Exported in `utils.ts` and `HashlineInstance` so may have external consumers. Consider deprecation.

#### ARCH-3 (low): Duplicated annotation logic between hooks and `chat.message`

`tool.execute.after` (hooks.ts) and `chat.message` (index.ts) both implement "should annotate?" logic independently. Common logic could be extracted to a shared helper.

## Summary

| Severity | Count |
|----------|-------|
| Critical | 0 |
| Medium | 8 |
| Low | 12 |
| Info | 2 |

The project is in good shape — solid foundation, good test coverage, correct architecture. Findings are at the level of making good code better.

## Recommended Fix Order

1. **BUG-1 + CODE-1 + PERF-3:** Refactor `resolveRange` to accept pre-split lines, reuse in `applyHashEdit` and `replaceRange`, add `safeReapply` support to `replaceRange`
2. **BUG-3 / PERF-2:** Replace `TextEncoder.encode().length` with `Buffer.byteLength()`
3. **CODE-2:** Remove dynamic `import("fs")`, use static import
4. **TEST-2:** Add `sanitizeConfig` tests
5. **TEST-1 + TEST-3:** Add integration tests for `createHashlinePlugin` and `chat.message`
6. **PERF-1:** Optimize collision resolution with dirty-set tracking
7. **PERF-4:** Cache `revPattern` alongside `hashLinePattern`
8. **BUG-2:** Add fallback for max-length hash collisions
9. **BUG-4:** Replace `createBoundedSet` with a class
10. **SEC-1:** Limit `exclude` array length in `sanitizeConfig`
11. **Remaining low items:** CODE-3, CODE-5, TEST-4, TEST-5, TEST-6, ARCH-2, ARCH-3
