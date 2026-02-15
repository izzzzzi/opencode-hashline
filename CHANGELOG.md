## [1.0.2](https://github.com/izzzzzi/opencode-hashline/compare/v1.0.1...v1.0.2) (2026-02-15)


### Bug Fixes

* add callID deduplication for batch tool support ([1fa7dc9](https://github.com/izzzzzi/opencode-hashline/commit/1fa7dc90e9f8bb86fb6a63d13c18165638a7ad61))
* retry release with automation token ([7118027](https://github.com/izzzzzi/opencode-hashline/commit/7118027060aee9fdd86f7acfbe11570c2cfb51c3))

## [1.0.2](https://github.com/izzzzzi/opencode-hashline/compare/v1.0.1...v1.0.2) (2026-02-15)


### Bug Fixes

* add callID deduplication for batch tool support ([1fa7dc9](https://github.com/izzzzzi/opencode-hashline/commit/1fa7dc90e9f8bb86fb6a63d13c18165638a7ad61))

# 1.0.0 (2026-02-15)


### Bug Fixes

* add semantic-release plugins to devDependencies ([563785e](https://github.com/izzzzzi/opencode-hashline/commit/563785efd906356f704edec6e692e3b3dd723dd5))
* replace @opencode-ai/plugin/tool with direct zod import for CJS compatibility ([e17a620](https://github.com/izzzzzi/opencode-hashline/commit/e17a620c97f64b547417d8725a138345086a05d7))

# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.0] — 2026-02-14

### Changed

- **Minimum hash length raised to 3** — eliminates 2-char hash collisions. `getAdaptiveHashLength()` now returns 3 for files ≤4096 lines and 4 for larger files.
- **Collision fallback** — `formatFileWithHashes()` detects hash collisions and automatically uses a longer hash for colliding lines.
- **Glob matching replaced with picomatch** — `matchesGlob()` now uses the `picomatch` library instead of a custom regex-based implementation. Full support for `{a,b}`, `[abc]`, `**`, `?`, and all standard glob patterns.
- **Byte-accurate size checks** — all file size comparisons now use `getByteLength()` (UTF-8 `TextEncoder`) instead of `string.length`, correctly handling multi-byte characters (Cyrillic, CJK, emoji).
- **`resolveConfig()` accepts plugin config** — now takes an optional second argument `pluginConfig` (from `opencode.json` context) and merges it with user config and defaults.
- **`isFileReadTool()` exported** — the tool-name detection heuristic is now a public export for testing and customization.

### Performance

- **Lines array reuse** — `resolveRange()` and `verifyHash()` now accept an optional pre-split `lines` array, avoiding redundant `content.split("\n")` calls in hot paths.
- **Cached `Math.pow(16, hashLen)`** — modulus computation is cached in a `Map` and computed only once per hash length.
- **Cached strip regex** — `stripHashes()` caches the compiled `RegExp` per prefix, avoiding recompilation on every call.

### Added

- **Unicode tests** — Cyrillic, emoji 🎉, CJK (中文) content: hashing, byte counting, strip roundtrip.
- **Glob edge-case tests** — `?`, `**/`, Windows `\` paths, `{a,b}` brace expansion, `[abc]` character classes.
- **Integration tests** — full plugin cycle: read → hash → edit → verify, stale content detection, cache behavior.
- **Typed hook mocks** — removed all `as any` casts in hook tests; replaced with typed factory functions.
- **`getByteLength()` utility** — exported function for accurate UTF-8 byte length calculation.
- **CI workflow** — `.github/workflows/ci.yml` with install, typecheck, build, test on Node 18/20/22.
- **CHANGELOG.md** — this file.

### Fixed

- **npm audit** — updated `vitest` to v4.x to resolve moderate esbuild/vite vulnerabilities in dev dependencies.

## [1.0.0] — 2026-02-13

### Added

- Initial release.
- Content-addressable line hashing with FNV-1a.
- Adaptive hash length (2–4 chars based on file size).
- `#HL ` magic prefix for safe stripping.
- LRU cache for annotated file content.
- OpenCode plugin hooks: `tool.execute.after`, `tool.execute.before`, `experimental.chat.system.transform`.
- System prompt injection with hashline usage instructions.
- Range operations: `resolveRange()`, `replaceRange()`.
- `createHashline()` factory for custom instances.
- Exclude patterns and `shouldExclude()`.
- Comprehensive test suite.
