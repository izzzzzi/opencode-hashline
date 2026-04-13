## [1.3.3](https://github.com/izzzzzi/opencode-hashline/compare/v1.3.2...v1.3.3) (2026-04-13)


### Bug Fixes

* pin zod to ~4.1.8 to match @opencode-ai/plugin type expectations ([26d6817](https://github.com/izzzzzi/opencode-hashline/commit/26d6817bb3806982accd8e238e23b6bb3206419c))

## [1.3.2](https://github.com/izzzzzi/opencode-hashline/compare/v1.3.1...v1.3.2) (2026-04-13)


### Bug Fixes

* add debug logging when callID absent (deduplication disabled) ([4b7335c](https://github.com/izzzzzi/opencode-hashline/commit/4b7335c920cfdeec0db506910a67c6363fb2844a))
* add fallback disambiguation for max-length hash collisions ([afba0c7](https://github.com/izzzzzi/opencode-hashline/commit/afba0c7678f878197d6c6d8a14272ecfcd20d89f))
* add safeReapply support to replaceRange ([5b6f0a9](https://github.com/izzzzzi/opencode-hashline/commit/5b6f0a995597c9ad0f51022f01e39907213a2bcc))
* replace createBoundedSet monkey-patch with BoundedSet class ([60c3cd6](https://github.com/izzzzzi/opencode-hashline/commit/60c3cd636f1b96c9546f441d47677395c69544b8))
* replace dynamic import('fs') with static appendFileSync import ([cb85699](https://github.com/izzzzzi/opencode-hashline/commit/cb856998aa4724567820440b51ab249209335a57))


### Performance Improvements

* cache revPattern alongside hashLinePattern in stripHashes ([847cd60](https://github.com/izzzzzi/opencode-hashline/commit/847cd6051c9fc93e01da2bee85f32a7031ce9291))
* optimize collision resolution with dirty-set tracking (PERF-1) ([f59c243](https://github.com/izzzzzi/opencode-hashline/commit/f59c243bdbd85957a801ab72802cb2e103a6ef0e))
* use Buffer.byteLength instead of TextEncoder allocation ([2a0c1d7](https://github.com/izzzzzi/opencode-hashline/commit/2a0c1d79812cc73b7fd60bd530e95afd8ff66211))

## [1.3.1](https://github.com/izzzzzi/opencode-hashline/compare/v1.3.0...v1.3.1) (2026-03-07)


### Bug Fixes

* harden temp-file handling and docs ([a0100c5](https://github.com/izzzzzi/opencode-hashline/commit/a0100c5584fa80ef85357ebf65f867d20012f080))

# [1.3.0](https://github.com/izzzzzi/opencode-hashline/compare/v1.2.0...v1.3.0) (2026-02-22)


### Features

* add file revision, safe reapply, and structured error diagnostics ([e2d00d2](https://github.com/izzzzzi/opencode-hashline/commit/e2d00d219bfe6b14f58d1462ce8e0a55f6e8ae6a))

# [1.2.0](https://github.com/izzzzzi/opencode-hashline/compare/v1.1.3...v1.2.0) (2026-02-21)


### Features

* add apply_patch benchmark mode and update README comparison table ([9c46a8c](https://github.com/izzzzzi/opencode-hashline/commit/9c46a8cc4c8aea8966a376def12ddcd5b1f8e889))

## [1.1.3](https://github.com/izzzzzi/opencode-hashline/compare/v1.1.2...v1.1.3) (2026-02-21)


### Bug Fixes

* security hardening from audit findings ([a4a7ad7](https://github.com/izzzzzi/opencode-hashline/commit/a4a7ad79b43df0a8354609650db04135ca23b48c))

## [1.1.2](https://github.com/izzzzzi/opencode-hashline/compare/v1.1.1...v1.1.2) (2026-02-21)


### Bug Fixes

* preserve CRLF line endings on Windows after hashline edits ([215668e](https://github.com/izzzzzi/opencode-hashline/commit/215668e73cdb9f3e17e1138e3108294af86fecd8))

## [1.1.1](https://github.com/izzzzzi/opencode-hashline/compare/v1.1.0...v1.1.1) (2026-02-21)


### Bug Fixes

* access denied on hashline_edit for non-git projects ([3bc2cb3](https://github.com/izzzzzi/opencode-hashline/commit/3bc2cb3330984c88919aee9007c055b475f01d21)), closes [#7](https://github.com/izzzzzi/opencode-hashline/issues/7)

# [1.1.0](https://github.com/izzzzzi/opencode-hashline/compare/v1.0.6...v1.1.0) (2026-02-21)


### Features

* make Russian README default, rename build output to opencode-hashline.js ([9a62087](https://github.com/izzzzzi/opencode-hashline/commit/9a620877a8f577e4a3a98bd7fbeb7d0dee896d4f))

## [1.0.6](https://github.com/izzzzzi/opencode-hashline/compare/v1.0.5...v1.0.6) (2026-02-15)


### Bug Fixes

* update zod peer dependency to v4 for compatibility ([0b8c107](https://github.com/izzzzzi/opencode-hashline/commit/0b8c107d7aabdf8e5fc4ab9c272589433ebff380))

## [1.0.5](https://github.com/izzzzzi/opencode-hashline/compare/v1.0.4...v1.0.5) (2026-02-15)


### Bug Fixes

* disable debug logging by default, add debug config flag ([ea65b6d](https://github.com/izzzzzi/opencode-hashline/commit/ea65b6d119e128932eff8adf8680086e86173179))

## [1.0.4](https://github.com/izzzzzi/opencode-hashline/compare/v1.0.3...v1.0.4) (2026-02-15)


### Bug Fixes

* strip hashline prefixes from patch-formatted lines ([ce5c553](https://github.com/izzzzzi/opencode-hashline/commit/ce5c553b72563901304b336e95f678adbcbb0bbe))

## [1.0.3](https://github.com/izzzzzi/opencode-hashline/compare/v1.0.2...v1.0.3) (2026-02-15)


### Bug Fixes

* security hardening from audit findings ([308901e](https://github.com/izzzzzi/opencode-hashline/commit/308901ebf60d630f9da2998ee10bf8d8df7baaa2))

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
