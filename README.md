<div align="center">

# 🔗 opencode-hashline

**Content-addressable line hashing for precise AI code editing**

[![CI](https://github.com/izzzzzi/opencode-hashline/actions/workflows/ci.yml/badge.svg)](https://github.com/izzzzzi/opencode-hashline/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/opencode-hashline.svg?style=flat&colorA=18181B&colorB=28CF8D)](https://www.npmjs.com/package/opencode-hashline)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg?style=flat&colorA=18181B&colorB=28CF8D)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-blue?style=flat&colorA=18181B&colorB=3178C6)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-ESM-green?style=flat&colorA=18181B&colorB=339933)](https://nodejs.org/)

[🇷🇺 Русский](README.ru.md) | **🇬🇧 English**

<br />

*Hashline plugin for [OpenCode](https://github.com/anomalyco/opencode) — annotate every line with a deterministic hash tag so the AI can reference and edit code with surgical precision.*

</div>

---

## 📖 What is Hashline?

Hashline annotates every line of a file with a short, deterministic hex hash tag. When the AI reads a file, it sees:

```
#HL 1:a3f|function hello() {
#HL 2:f1c|  return "world";
#HL 3:0e7|}
```

> **Note:** Hash length is adaptive — it depends on file size (3 chars for ≤4096 lines, 4 chars for >4096 lines). Minimum hash length is 3 to reduce collision risk. The `#HL ` prefix protects against false positives when stripping hashes and is configurable.

The AI model can then reference lines by their hash tags for precise editing:

- **"Replace line `2:f1c`"** — target a specific line unambiguously
- **"Replace block from `1:a3f` to `3:0e7`"** — target a range of lines
- **"Insert after `3:0e7`"** — insert at a precise location

### 🤔 Why does this help?

Traditional line numbers shift as edits are made, causing off-by-one errors and stale references. Hashline tags are **content-addressable** — they're derived from both the line index and the line's content, so they serve as a stable, verifiable reference that the AI can use to communicate about code locations with precision.

---

## ✨ Features

### 📏 Adaptive Hash Length

Hash length automatically adapts to file size to minimize collisions:

| File Size | Hash Length | Possible Values |
|-----------|:----------:|:---------------:|
| ≤ 256 lines | 2 hex chars | 256 |
| ≤ 4,096 lines | 3 hex chars | 4,096 |
| > 4,096 lines | 4 hex chars | 65,536 |

### 🏷️ Magic Prefix (`#HL `)

Lines are annotated with a configurable prefix (default: `#HL `) to prevent false positives when stripping hashes. This ensures that data lines like `1:ab|some data` are not accidentally stripped.

```
#HL 1:a3|function hello() {
#HL 2:f1|  return "world";
#HL 3:0e|}
```

The prefix can be customized or disabled for backward compatibility:

```typescript
// Custom prefix
const hl = createHashline({ prefix: ">> " });

// Disable prefix (legacy format: "1:a3|code")
const hl = createHashline({ prefix: false });
```

### 💾 LRU Caching

Built-in LRU cache (`filePath → annotatedContent`) with configurable size (default: 100 files). When the same file is read again with unchanged content, the cached result is returned instantly. Cache is automatically invalidated when file content changes.

### ✅ Hash Verification

Verify that a line hasn't changed since it was read — protects against race conditions:

```typescript
import { verifyHash } from "opencode-hashline";

const result = verifyHash(2, "f1c", currentContent);
if (!result.valid) {
  console.error(result.message); // "Hash mismatch at line 2: ..."
}
```

Hash verification uses the length of the provided hash reference (not the current file size), so a reference like `2:f1` remains valid even if the file has grown.

### 🔍 Indentation-Sensitive Hashing

Hash computation uses `trimEnd()` (not `trim()`), so changes to leading whitespace (indentation) are detected as content changes, while trailing whitespace is ignored.

### 📐 Range Operations

Resolve and replace ranges of lines by hash references:

```typescript
import { resolveRange, replaceRange } from "opencode-hashline";

// Get lines between two hash references
const range = resolveRange("1:a3f", "3:0e7", content);
console.log(range.lines); // ["function hello() {", '  return "world";', "}"]

// Replace a range with new content
const newContent = replaceRange(
  "1:a3f", "3:0e7", content,
  "function goodbye() {\n  return 'farewell';\n}"
);
```

### ⚙️ Configurable

Create custom Hashline instances with specific settings:

```typescript
import { createHashline } from "opencode-hashline";

const hl = createHashline({
  exclude: ["**/node_modules/**", "**/*.min.js"],
  maxFileSize: 512_000,  // 512 KB
  hashLength: 3,         // force 3-char hashes
  cacheSize: 200,        // cache up to 200 files
  prefix: "#HL ",        // magic prefix (default)
});

// Use the configured instance
const annotated = hl.formatFileWithHashes(content, "src/app.ts");
const isExcluded = hl.shouldExclude("node_modules/foo.js"); // true
```

#### Configuration Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `exclude` | `string[]` | See below | Glob patterns for files to skip |
| `maxFileSize` | `number` | `1_000_000` | Max file size in bytes |
| `hashLength` | `number \| undefined` | `undefined` (adaptive) | Force specific hash length |
| `cacheSize` | `number` | `100` | Max files in LRU cache |
| `prefix` | `string \| false` | `"#HL "` | Line prefix (`false` to disable) |

Default exclude patterns cover: lock files, `node_modules`, minified files, binary files (images, fonts, archives, etc.).

---

## 📦 Installation

```bash
npm install opencode-hashline
```

---

## 🔧 Configuration

Add the plugin to your `opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["opencode-hashline"]
}
```

That's it! The plugin automatically:

| # | Action | Description |
|:-:|--------|-------------|
| 1 | 📝 **Annotates file reads** | When the AI reads a file, each line gets a `#HL` hash prefix |
| 2 | ✂️ **Strips hash prefixes on edits** | When the AI writes/edits a file, hash prefixes are removed before applying changes |
| 3 | 🧠 **Injects system prompt instructions** | The AI is told how to interpret and use hashline references |
| 4 | 💾 **Caches results** | Repeated reads of the same file return cached annotations |
| 5 | 🔍 **Filters by tool** | Only file-reading tools (e.g. `read_file`, `cat`, `view`) get annotations; other tools are left untouched |
| 6 | ⚙️ **Respects config** | Excluded files and files exceeding `maxFileSize` are skipped |

---

## 🛠️ How It Works

### Hash Computation

Each line's hash is computed from:
- The **0-based line index**
- The **trimEnd'd line content** — leading whitespace (indentation) IS significant

This is fed through an **FNV-1a** hash function, reduced to the appropriate modulus based on file size, and rendered as a hex string.

### Plugin Hooks

The plugin registers three OpenCode hooks:

| Hook | Purpose |
|------|---------|
| `tool.execute.after` | Injects hashline annotations into file-read tool output |
| `tool.execute.before` | Strips hashline prefixes from file-edit tool arguments |
| `experimental.chat.system.transform` | Adds hashline usage instructions to the system prompt |

### Tool Detection Heuristic (`isFileReadTool`)

The plugin needs to determine which tools are "file-read" tools (to annotate their output) vs "file-edit" tools (to strip hash prefixes from their input). Since the OpenCode plugin API does not expose a semantic tool category, the plugin uses a name-based heuristic:

**Exact match** — the tool name (case-insensitive) is compared against the allow-list:
- `read`, `file_read`, `read_file`, `cat`, `view`

**Dotted suffix match** — for namespaced tools like `mcp.read` or `custom_provider.file_read`, the part after the last `.` is matched against the same list.

**Fallback heuristic** — if the tool has `path`, `filePath`, or `file` arguments AND the tool name does NOT contain write/edit/execute indicators (`write`, `edit`, `patch`, `execute`, `run`, `command`, `shell`, `bash`), it is treated as a file-read tool.

**How to customize:**
- Name your custom tool to match one of the patterns above (e.g. `my_read_file`)
- Include `path`, `filePath`, or `file` in its arguments
- Or extend the `FILE_READ_TOOLS` list in a fork

The `isFileReadTool()` function is exported for testing and advanced usage:

```typescript
import { isFileReadTool } from "opencode-hashline";

isFileReadTool("read_file");                          // true
isFileReadTool("mcp.read");                           // true
isFileReadTool("custom_reader", { path: "app.ts" });  // true (heuristic)
isFileReadTool("file_write", { path: "app.ts" });     // false (write indicator)
```

### Programmatic API

The core utilities are also exported for programmatic use:

```typescript
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
  HashlineCache,
  createHashline,
  shouldExclude,
  matchesGlob,
  resolveConfig,
  DEFAULT_PREFIX,
} from "opencode-hashline";
```

### Core Functions

```typescript
// Compute hash for a single line
const hash = computeLineHash(0, "function hello() {"); // e.g. "a3f"

// Compute hash with specific length
const hash4 = computeLineHash(0, "function hello() {", 4); // e.g. "a3f2"

// Annotate entire file content (adaptive hash length, with #HL prefix)
const annotated = formatFileWithHashes(fileContent);
// "#HL 1:a3|function hello() {\n#HL 2:f1|  return \"world\";\n#HL 3:0e|}"

// Annotate with specific hash length
const annotated3 = formatFileWithHashes(fileContent, 3);

// Annotate without prefix (legacy format)
const annotatedLegacy = formatFileWithHashes(fileContent, undefined, false);

// Strip annotations to get original content
const original = stripHashes(annotated);
```

### Hash References & Verification

```typescript
// Parse a hash reference
const { line, hash } = parseHashRef("2:f1c"); // { line: 2, hash: "f1c" }

// Build a lookup map
const map = buildHashMap(fileContent); // Map<"2:f1c", 2>

// Verify a hash reference (uses hash.length, not file size)
const result = verifyHash(2, "f1c", fileContent);
```

### Range Operations

```typescript
// Resolve a range
const range = resolveRange("1:a3f", "3:0e7", fileContent);

// Replace a range
const newContent = replaceRange("1:a3f", "3:0e7", fileContent, "new content");
```

### Utilities

```typescript
// Check if a file should be excluded
const excluded = shouldExclude("node_modules/foo.js", ["**/node_modules/**"]);

// Create a configured instance
const hl = createHashline({ cacheSize: 50, hashLength: 3 });
```

---

## 📊 Benchmark

Run the benchmark to measure performance of `formatFileWithHashes()` and `stripHashes()` on files of various sizes:

```bash
npm run benchmark
```

### Performance Overview

> Both operations are **sub-linear in practice** — throughput increases with file size, peaking at **~1.8M lines/sec** for stripping and **~1.1M lines/sec** for formatting. Even a 10,000-line file is processed in under 10ms.

### ⏱️ Execution Time

| File Size | `formatFileWithHashes` | `stripHashes` | Ratio |
|----------:|:----------------------:|:-------------:|:-----:|
| **10** lines | 0.05 ms | 0.03 ms | 1.7× |
| **100** lines | 0.12 ms | 0.08 ms | 1.5× |
| **1,000** lines | 0.95 ms | 0.60 ms | 1.6× |
| **5,000** lines | 4.50 ms | 2.80 ms | 1.6× |
| **10,000** lines | 9.20 ms | 5.50 ms | 1.7× |

### 🚀 Throughput (lines/sec)

```
formatFileWithHashes                          stripHashes
                                              
  10 lines   ██░░░░░░░░░░░░░░░░░░   200K       10 lines   ██░░░░░░░░░░░░░░░░░░   333K
 100 lines   ████████░░░░░░░░░░░░   833K      100 lines   █████████████░░░░░░░░ 1,250K
  1K lines   ██████████░░░░░░░░░░ 1,053K       1K lines   █████████████████░░░░ 1,667K
  5K lines   ███████████░░░░░░░░░ 1,111K       5K lines   ██████████████████░░░ 1,786K
 10K lines   ██████████░░░░░░░░░░ 1,087K      10K lines   ██████████████████░░░ 1,818K
                                              
              ▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔                        ▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔
              0        600K    1.2M                         0       1M        2M
```

### Key Takeaways

- **`stripHashes` is ~1.6× faster** than `formatFileWithHashes` — stripping only needs regex matching, while formatting computes FNV-1a hashes per line
- **Throughput scales well** — going from 10 to 10,000 lines, throughput increases ~5× for format and ~5.5× for strip
- **Real-world impact**: a typical 1,000-line source file is annotated in **< 1ms** — imperceptible to the user

<details>
<summary>📋 Raw benchmark output</summary>

```
Hashline Benchmark
==================

File Size (lines) │ formatFileWithHashes (ms) │ stripHashes (ms) │ Throughput format (lines/sec) │ Throughput strip (lines/sec)
──────────────────┼───────────────────────────┼──────────────────┼───────────────────────────────┼────────────────────────────
              10  │                     0.05  │            0.03  │                     200,000  │                    333,333
             100  │                     0.12  │            0.08  │                     833,333  │                  1,250,000
           1,000  │                     0.95  │            0.60  │                   1,052,632  │                  1,666,667
           5,000  │                     4.50  │            2.80  │                   1,111,111  │                  1,785,714
          10,000  │                     9.20  │            5.50  │                   1,086,957  │                  1,818,182
```

</details>

---

## 🧑‍💻 Development

```bash
# Install dependencies
npm install

# Run tests
npm test

# Build
npm run build

# Type check
npm run typecheck
```

---

## 💡 Inspiration & Background

The idea behind hashline is inspired by concepts from **oh-my-pi** by [can1357](https://github.com/can1357/oh-my-pi) — an AI coding agent toolkit (coding agent CLI, unified LLM API, TUI libraries) — and the article "The Harness Problem."

**The Harness Problem** describes a fundamental limitation of current AI coding tools: while modern LLMs are extremely capable, the *harness* layer — the tooling that feeds context to the model and applies its edits back to files — loses information and introduces errors. The model sees a file's content, but when it needs to edit, it must "guess" surrounding context for search-and-replace (which breaks on duplicate lines) or produce diffs (which are unreliable in practice).

Hashline solves this by assigning each line a short, deterministic hash tag (e.g. `2:f1c`), making line addressing **exact and unambiguous**. The model can reference any line or range precisely, eliminating off-by-one errors and duplicate-line confusion.

**References:**
- [oh-my-pi by can1357](https://github.com/can1357/oh-my-pi) — AI coding agent toolkit: coding agent CLI, unified LLM API, TUI libraries
- [The Harness Problem](https://blog.can.ac/2026/02/12/the-harness-problem/) — blog post describing the problem in detail
- [Описание подхода на Хабре](https://habr.com/ru/companies/bothub/news/995986/) — overview of the approach in Russian

---

## 📄 License

[MIT](LICENSE) © opencode-hashline contributors
