/**
 * Core Hashline logic — content-addressable line hashing for precise AI code editing.
 *
 * Each line gets a hex hash tag derived from its index and trimmed content.
 * Hash length adapts to file size: 3 chars (≤4096 lines), 4 chars (>4096).
 * Minimum hash length is 3 to reduce collision risk.
 * Format: `#HL <lineNumber>:<hash>|<originalLine>`
 *
 * Example:
 *   #HL 1:a3f|function hello() {
 *   #HL 2:f1c|  return "world";
 *   #HL 3:0e7|}
 */

import picomatch from "picomatch";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/**
 * Configuration object for Hashline.
 */
export interface HashlineConfig {
  /** Glob patterns to exclude from processing */
  exclude?: string[];
  /** Maximum file size in bytes to process (default: 1MB) */
  maxFileSize?: number;
  /** Override hash length (3–4). If not set, adaptive length is used. */
  hashLength?: number;
  /** LRU cache size — number of files to cache (default: 100) */
  cacheSize?: number;
  /**
   * Magic prefix for hashline annotations.
   * Default: "#HL " — lines are formatted as `#HL 1:a3f|code here`.
   * Set to `false` to disable prefix (legacy format: `1:a3f|code here`).
   */
  prefix?: string | false;
  /** Enable debug logging to ~/.config/opencode/hashline-debug.log (default: false) */
  debug?: boolean;
}

/** Default exclude patterns */
export const DEFAULT_EXCLUDE_PATTERNS: string[] = [
  "**/node_modules/**",
  "**/*.lock",
  "**/package-lock.json",
  "**/yarn.lock",
  "**/pnpm-lock.yaml",
  "**/*.min.js",
  "**/*.min.css",
  "**/*.bundle.js",
  "**/*.map",
  "**/*.wasm",
  "**/*.png",
  "**/*.jpg",
  "**/*.jpeg",
  "**/*.gif",
  "**/*.ico",
  "**/*.svg",
  "**/*.woff",
  "**/*.woff2",
  "**/*.ttf",
  "**/*.eot",
  "**/*.pdf",
  "**/*.zip",
  "**/*.tar",
  "**/*.gz",
  "**/*.exe",
  "**/*.dll",
  "**/*.so",
  "**/*.dylib",
];

/** Default prefix for hashline annotations */
export const DEFAULT_PREFIX = "#HL ";

/** Default configuration values */
export const DEFAULT_CONFIG: Required<HashlineConfig> = {
  exclude: DEFAULT_EXCLUDE_PATTERNS,
  maxFileSize: 1_048_576, // 1 MB
  hashLength: 0, // 0 = adaptive
  cacheSize: 100,
  prefix: DEFAULT_PREFIX,
  debug: false,
};

/**
 * Merge user config with defaults.
 *
 * @param config - optional partial user config
 * @param pluginConfig - optional config from plugin context (e.g. opencode.json)
 */
export function resolveConfig(
  config?: HashlineConfig,
  pluginConfig?: HashlineConfig,
): Required<HashlineConfig> {
  // Merge: pluginConfig (from opencode.json) is overridden by explicit config
  const merged: HashlineConfig = {
    ...pluginConfig,
    ...config,
  };

  if (!merged || Object.keys(merged).length === 0) {
    return { ...DEFAULT_CONFIG, exclude: [...DEFAULT_CONFIG.exclude] };
  }

  return {
    exclude: merged.exclude ?? [...DEFAULT_CONFIG.exclude],
    maxFileSize: merged.maxFileSize ?? DEFAULT_CONFIG.maxFileSize,
    hashLength: merged.hashLength ?? DEFAULT_CONFIG.hashLength,
    cacheSize: merged.cacheSize ?? DEFAULT_CONFIG.cacheSize,
    prefix: merged.prefix !== undefined ? merged.prefix : DEFAULT_CONFIG.prefix,
    debug: merged.debug ?? DEFAULT_CONFIG.debug,
  };
}

// ---------------------------------------------------------------------------
// Hash computation
// ---------------------------------------------------------------------------

/**
 * Simple fast hash function (FNV-1a inspired).
 * Returns a 32-bit unsigned integer.
 */
function fnv1aHash(str: string): number {
  let hash = 0x811c9dc5; // FNV offset basis
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = (hash * 0x01000193) >>> 0; // FNV prime, keep as uint32
  }
  return hash;
}

/**
 * Cache for Math.pow(16, hashLen) computations.
 * Key: hashLen, Value: 16^hashLen
 */
const modulusCache = new Map<number, number>();

/**
 * Get cached modulus value for a given hash length.
 */
function getModulus(hashLen: number): number {
  let cached = modulusCache.get(hashLen);
  if (cached === undefined) {
    cached = Math.pow(16, hashLen);
    modulusCache.set(hashLen, cached);
  }
  return cached;
}

/**
 * Determine the appropriate hash length based on the number of lines.
 *
 * Minimum hash length is 3 to reduce collision risk.
 * - ≤4096 lines → 3 hex chars (4096 values)
 * - >4096 lines → 4 hex chars (65536 values)
 */
export function getAdaptiveHashLength(lineCount: number): number {
  if (lineCount <= 4096) return 3;
  return 4;
}

/**
 * Compute a hex hash for a given line.
 *
 * Uses trimEnd() so that leading whitespace (indentation) IS significant,
 * but trailing whitespace is ignored.
 *
 * @param idx - 0-based line index
 * @param line - the raw line content
 * @param hashLen - number of hex characters (3–4, default 3)
 * @returns lowercase hex string of the specified length
 */
export function computeLineHash(idx: number, line: string, hashLen: number = 3): string {
  const trimmed = line.trimEnd();
  const input = `${idx}:${trimmed}`;
  const raw = fnv1aHash(input);
  const modulus = getModulus(hashLen);
  const hash = raw % modulus;
  return hash.toString(16).padStart(hashLen, "0");
}

/**
 * Format file content with hashline annotations.
 *
 * Each line becomes: `<prefix><1-based lineNumber>:<hash>|<originalLine>`
 * Hash length adapts to file size unless overridden.
 * Includes collision detection: if two lines produce the same hash,
 * the colliding line gets a longer hash.
 *
 * @param content - raw file content
 * @param hashLen - override hash length (0 or undefined = adaptive)
 * @param prefix - prefix string (default "#HL "), or false to disable
 * @returns annotated content with hash prefixes
 */
export function formatFileWithHashes(
  content: string,
  hashLen?: number,
  prefix?: string | false,
): string {
  const normalized = content.includes("\r\n") ? content.replace(/\r\n/g, "\n") : content;
  const lines = normalized.split("\n");
  const effectiveLen = hashLen && hashLen >= 3 ? hashLen : getAdaptiveHashLength(lines.length);
  const effectivePrefix = prefix === undefined ? DEFAULT_PREFIX : (prefix === false ? "" : prefix);

  // Collision detection: compute all hashes, detect collisions, re-hash with longer length
  const hashes: string[] = new Array(lines.length);
  const seen = new Map<string, number>(); // hash -> first index that used it

  for (let idx = 0; idx < lines.length; idx++) {
    const hash = computeLineHash(idx, lines[idx], effectiveLen);
    if (seen.has(hash)) {
      // Collision detected — use longer hash for this line
      const longerLen = Math.min(effectiveLen + 1, 8);
      hashes[idx] = computeLineHash(idx, lines[idx], longerLen);
    } else {
      seen.set(hash, idx);
      hashes[idx] = hash;
    }
  }

  return lines
    .map((line, idx) => {
      return `${effectivePrefix}${idx + 1}:${hashes[idx]}|${line}`;
    })
    .join("\n");
}

/**
 * Cache for compiled strip-hash regex patterns.
 * Key: escaped prefix string, Value: compiled RegExp
 */
const stripRegexCache = new Map<string, RegExp>();

/**
 * Strip hashline prefixes to recover original file content.
 *
 * Recognizes the pattern `<prefix><number>:<2-8 hex>|` at the start of each line.
 * By default looks for the `#HL ` prefix to avoid false positives.
 *
 * @param content - hashline-annotated content
 * @param prefix - prefix string (default "#HL "), or false for legacy format
 * @returns original content without hash prefixes
 */
export function stripHashes(content: string, prefix?: string | false): string {
  const effectivePrefix = prefix === undefined ? DEFAULT_PREFIX : (prefix === false ? "" : prefix);
  const escapedPrefix = effectivePrefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  // Use cached regex
  let hashLinePattern = stripRegexCache.get(escapedPrefix);
  if (!hashLinePattern) {
    // Match hash prefix, optionally preceded by patch markers (+, -, space)
    hashLinePattern = new RegExp(`^([+ \\-])?${escapedPrefix}\\d+:[0-9a-f]{2,8}\\|`);
    stripRegexCache.set(escapedPrefix, hashLinePattern);
  }

  const lineEnding = detectLineEnding(content);
  const normalized = lineEnding === "\r\n" ? content.replace(/\r\n/g, "\n") : content;
  const result = normalized
    .split("\n")
    .map((line) => {
      const match = line.match(hashLinePattern!);
      if (match) {
        // Preserve the patch marker (+/-/space) if present
        const patchMarker = match[1] || "";
        return patchMarker + line.slice(match[0].length);
      }
      return line;
    })
    .join("\n");
  return lineEnding === "\r\n" ? result.replace(/\n/g, "\r\n") : result;
}

/**
 * Parse a hash reference like "2:f1a" or "2:f1a3" into its components.
 *
 * @param ref - reference string in the format "<lineNumber>:<hash>"
 * @returns parsed line number (1-based) and hash string
 */
export function parseHashRef(ref: string): { line: number; hash: string } {
  const match = ref.match(/^(\d+):([0-9a-f]{2,8})$/);
  if (!match) {
    throw new Error(`Invalid hash reference: "${ref}". Expected format: "<line>:<2-8 char hex>"`);
  }
  return {
    line: parseInt(match[1], 10),
    hash: match[2],
  };
}

/**
 * Normalize a hash reference.
 *
 * Accepts:
 * - plain refs: `2:f1c`
 * - annotated refs: `#HL 2:f1c|line content` or `2:f1c|line content`
 *
 * Returns canonical lowercased format: `<line>:<hash>`
 */
export function normalizeHashRef(ref: string): string {
  const trimmed = ref.trim();

  const plain = trimmed.match(/^(\d+):([0-9a-f]{2,8})$/i);
  if (plain) {
    return `${parseInt(plain[1], 10)}:${plain[2].toLowerCase()}`;
  }

  const annotated = trimmed.match(/^(?:[#\w]*\s+)?(\d+):([0-9a-f]{2,8})\|.*$/i);
  if (annotated) {
    return `${parseInt(annotated[1], 10)}:${annotated[2].toLowerCase()}`;
  }

  throw new Error(
    `Invalid hash reference: "${ref}". Expected "<line>:<hash>" or an annotated line like "#HL <line>:<hash>|..."`,
  );
}

/**
 * Supported hash-aware edit operations.
 */
export type HashEditOperation = "replace" | "delete" | "insert_before" | "insert_after";

/**
 * Input for hash-aware edit application.
 */
export interface HashEditInput {
  operation: HashEditOperation;
  startRef: string;
  endRef?: string;
  replacement?: string;
}

/**
 * Result of applying a hash-aware edit.
 */
export interface HashEditResult {
  operation: HashEditOperation;
  startLine: number;
  endLine: number;
  content: string;
}

/**
 * Build a mapping from hash tags to 1-based line numbers.
 *
 * Note: If multiple lines produce the same hash, the last one wins.
 * In practice, collisions are rare since the hash incorporates the line index.
 *
 * @param content - raw file content (without hash prefixes)
 * @param hashLen - override hash length (0 or undefined = adaptive)
 * @returns Map from "<lineNumber>:<hash>" to 1-based line number
 */
export function buildHashMap(content: string, hashLen?: number): Map<string, number> {
  const lines = content.split("\n");
  const effectiveLen = hashLen && hashLen >= 3 ? hashLen : getAdaptiveHashLength(lines.length);
  const map = new Map<string, number>();
  for (let idx = 0; idx < lines.length; idx++) {
    const hash = computeLineHash(idx, lines[idx], effectiveLen);
    const lineNum = idx + 1;
    map.set(`${lineNum}:${hash}`, lineNum);
  }
  return map;
}

// ---------------------------------------------------------------------------
// Hash verification
// ---------------------------------------------------------------------------

/**
 * Result of hash verification.
 */
export interface VerifyHashResult {
  valid: boolean;
  expected?: string;
  actual?: string;
  message?: string;
}

/**
 * Verify that a line's hash matches the current content.
 *
 * This protects against race conditions — if the file changed between
 * read and edit, the hash won't match.
 *
 * The hash length is determined from the provided hash string itself
 * (hash.length), not from the current file size. This ensures that
 * a reference like "2:f1a" remains valid even if the file has grown.
 *
 * @param lineNumber - 1-based line number
 * @param hash - expected hash from the hash reference
 * @param currentContent - current raw file content (string or pre-split lines)
 * @param hashLen - override hash length (0 or undefined = use hash.length from ref)
 * @param lines - optional pre-split lines array to avoid re-splitting
 * @returns verification result
 */
export function verifyHash(
  lineNumber: number,
  hash: string,
  currentContent: string,
  hashLen?: number,
  lines?: string[],
): VerifyHashResult {
  const contentLines = lines ?? currentContent.split("\n");
  // Use the length of the provided hash, not adaptive length from file size
  const effectiveLen = hashLen && hashLen >= 2 ? hashLen : hash.length;

  if (lineNumber < 1 || lineNumber > contentLines.length) {
    return {
      valid: false,
      message: `Line ${lineNumber} is out of range (file has ${contentLines.length} lines)`,
    };
  }

  const idx = lineNumber - 1;
  const actualHash = computeLineHash(idx, contentLines[idx], effectiveLen);

  if (actualHash !== hash) {
    return {
      valid: false,
      expected: hash,
      actual: actualHash,
      message: `Hash mismatch at line ${lineNumber}: expected "${hash}", got "${actualHash}". The file may have changed since it was read.`,
    };
  }

  return { valid: true };
}

// ---------------------------------------------------------------------------
// Range operations
// ---------------------------------------------------------------------------

/**
 * Result of a range resolution.
 */
export interface ResolvedRange {
  startLine: number;
  endLine: number;
  lines: string[];
  content: string;
}

/**
 * Resolve a range of lines by hash references.
 * Splits content once and passes lines array to verifyHash to avoid redundant splits.
 *
 * @param startRef - start hash reference (e.g. "1:a3f")
 * @param endRef - end hash reference (e.g. "3:0e7")
 * @param content - raw file content
 * @param hashLen - override hash length (0 or undefined = use hash.length from ref)
 * @returns resolved range with line numbers and content
 */
export function resolveRange(
  startRef: string,
  endRef: string,
  content: string,
  hashLen?: number,
): ResolvedRange {
  const start = parseHashRef(startRef);
  const end = parseHashRef(endRef);

  if (start.line > end.line) {
    throw new Error(
      `Invalid range: start line ${start.line} is after end line ${end.line}`,
    );
  }

  const lineEnding = detectLineEnding(content);
  const normalized = lineEnding === "\r\n" ? content.replace(/\r\n/g, "\n") : content;

  // Split once and reuse for both verifications and range extraction
  const lines = normalized.split("\n");

  // Use hash.length from the refs for verification, not adaptive
  const startVerify = verifyHash(start.line, start.hash, normalized, hashLen, lines);
  if (!startVerify.valid) {
    throw new Error(`Start reference invalid: ${startVerify.message}`);
  }

  const endVerify = verifyHash(end.line, end.hash, normalized, hashLen, lines);
  if (!endVerify.valid) {
    throw new Error(`End reference invalid: ${endVerify.message}`);
  }

  const rangeLines = lines.slice(start.line - 1, end.line);

  return {
    startLine: start.line,
    endLine: end.line,
    lines: rangeLines,
    content: rangeLines.join(lineEnding),
  };
}

/**
 * Replace a range of lines identified by hash references with new content.
 * Splits content once and reuses the lines array.
 *
 * @param startRef - start hash reference
 * @param endRef - end hash reference
 * @param content - current raw file content
 * @param replacement - new content to replace the range with
 * @param hashLen - override hash length (0 or undefined = use hash.length from ref)
 * @returns new file content with the range replaced
 */
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

/**
 * Apply a hash-aware edit operation directly against file content.
 *
 * Unlike search/replace tools, this resolves references by line+hash and
 * verifies them before editing, so exact old-string matching is not required.
 */
export function applyHashEdit(
  input: HashEditInput,
  content: string,
  hashLen?: number,
): HashEditResult {
  const lineEnding = detectLineEnding(content);
  const workContent = lineEnding === "\r\n" ? content.replace(/\r\n/g, "\n") : content;

  const normalizedStart = normalizeHashRef(input.startRef);
  const start = parseHashRef(normalizedStart);
  const lines = workContent.split("\n");

  const startVerify = verifyHash(start.line, start.hash, workContent, hashLen, lines);
  if (!startVerify.valid) {
    throw new Error(`Start reference invalid: ${startVerify.message}`);
  }

  if (input.operation === "insert_before" || input.operation === "insert_after") {
    if (input.replacement === undefined) {
      throw new Error(`Operation "${input.operation}" requires "replacement" content`);
    }

    const insertionLines = input.replacement.split("\n");
    const insertIndex = input.operation === "insert_before" ? start.line - 1 : start.line;
    const next = [
      ...lines.slice(0, insertIndex),
      ...insertionLines,
      ...lines.slice(insertIndex),
    ].join("\n");

    return {
      operation: input.operation,
      startLine: start.line,
      endLine: start.line,
      content: lineEnding === "\r\n" ? next.replace(/\n/g, "\r\n") : next,
    };
  }

  const normalizedEnd = normalizeHashRef(input.endRef ?? input.startRef);
  const end = parseHashRef(normalizedEnd);
  if (start.line > end.line) {
    throw new Error(
      `Invalid range: start line ${start.line} is after end line ${end.line}`,
    );
  }

  const endVerify = verifyHash(end.line, end.hash, workContent, hashLen, lines);
  if (!endVerify.valid) {
    throw new Error(`End reference invalid: ${endVerify.message}`);
  }

  const replacement =
    input.operation === "delete"
      ? ""
      : input.replacement;

  if (replacement === undefined) {
    throw new Error(`Operation "${input.operation}" requires "replacement" content`);
  }

  const before = lines.slice(0, start.line - 1);
  const after = lines.slice(end.line);
  const replacementLines = input.operation === "delete" ? [] : replacement.split("\n");
  const next = [...before, ...replacementLines, ...after].join("\n");

  return {
    operation: input.operation,
    startLine: start.line,
    endLine: end.line,
    content: lineEnding === "\r\n" ? next.replace(/\n/g, "\r\n") : next,
  };
}

// ---------------------------------------------------------------------------
// LRU Cache
// ---------------------------------------------------------------------------

interface CacheEntry {
  contentHash: number;
  annotated: string;
}

/**
 * Simple LRU cache for annotated file content.
 */
export class HashlineCache {
  private cache: Map<string, CacheEntry>;
  private maxSize: number;

  constructor(maxSize: number = 100) {
    this.cache = new Map();
    this.maxSize = maxSize;
  }

  /**
   * Get cached annotated content for a file, or null if not cached / stale.
   */
  get(filePath: string, content: string): string | null {
    const entry = this.cache.get(filePath);
    if (!entry) return null;

    const currentHash = fnv1aHash(content);
    if (entry.contentHash !== currentHash) {
      this.cache.delete(filePath);
      return null;
    }

    // Move to end (most recently used)
    this.cache.delete(filePath);
    this.cache.set(filePath, entry);
    return entry.annotated;
  }

  /**
   * Store annotated content in the cache.
   */
  set(filePath: string, content: string, annotated: string): void {
    // If already exists, delete first to update position
    if (this.cache.has(filePath)) {
      this.cache.delete(filePath);
    }

    // Evict oldest if at capacity
    if (this.cache.size >= this.maxSize) {
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) {
        this.cache.delete(oldest);
      }
    }

    this.cache.set(filePath, {
      contentHash: fnv1aHash(content),
      annotated,
    });
  }

  /**
   * Invalidate a specific file from the cache.
   */
  invalidate(filePath: string): void {
    this.cache.delete(filePath);
  }

  /**
   * Clear the entire cache.
   */
  clear(): void {
    this.cache.clear();
  }

  /**
   * Get the current number of cached entries.
   */
  get size(): number {
    return this.cache.size;
  }
}

// ---------------------------------------------------------------------------
// Glob matching (using picomatch for full glob support)
// ---------------------------------------------------------------------------

/**
 * Glob matcher using picomatch for full glob support.
 * Supports `*`, `**`, `?`, `{a,b}`, `[abc]`, and all standard glob patterns.
 * Windows paths are normalized to forward slashes.
 */
export function matchesGlob(filePath: string, pattern: string): boolean {
  // Normalize Windows separators
  const normalizedPath = filePath.replace(/\\/g, "/");
  const normalizedPattern = pattern.replace(/\\/g, "/");

  const isMatch = picomatch(normalizedPattern, { dot: true });
  return isMatch(normalizedPath);
}

/**
 * Check if a file path should be excluded based on config patterns.
 */
export function shouldExclude(filePath: string, patterns: string[]): boolean {
  return patterns.some((pattern) => matchesGlob(filePath, pattern));
}

// ---------------------------------------------------------------------------
// Byte length utility
// ---------------------------------------------------------------------------

/**
 * Get the UTF-8 byte length of a string.
 * Uses TextEncoder for accurate UTF-8 byte counting.
 * This correctly handles multi-byte characters (Cyrillic, CJK, emoji, etc.).
 */
const textEncoder = new TextEncoder();
export function getByteLength(content: string): number {
  return textEncoder.encode(content).length;
}

/**
 * Detect the line ending style used in a string.
 * Returns "\r\n" if any CRLF sequence is present, otherwise "\n".
 */
export function detectLineEnding(content: string): "\r\n" | "\n" {
  return content.includes("\r\n") ? "\r\n" : "\n";
}

// ---------------------------------------------------------------------------
// Factory — createHashline
// ---------------------------------------------------------------------------

/**
 * A Hashline instance with custom configuration.
 */
export interface HashlineInstance {
  config: Required<HashlineConfig>;
  cache: HashlineCache;
  formatFileWithHashes: (content: string, filePath?: string) => string;
  stripHashes: (content: string) => string;
  computeLineHash: (idx: number, line: string) => string;
  buildHashMap: (content: string) => Map<string, number>;
  verifyHash: (lineNumber: number, hash: string, currentContent: string) => VerifyHashResult;
  resolveRange: (startRef: string, endRef: string, content: string) => ResolvedRange;
  replaceRange: (startRef: string, endRef: string, content: string, replacement: string) => string;
  applyHashEdit: (input: HashEditInput, content: string) => HashEditResult;
  normalizeHashRef: (ref: string) => string;
  parseHashRef: (ref: string) => { line: number; hash: string };
  shouldExclude: (filePath: string) => boolean;
}

/**
 * Create a Hashline instance with custom configuration.
 *
 * @param config - custom configuration options
 * @returns configured Hashline instance
 */
export function createHashline(config?: HashlineConfig): HashlineInstance {
  const resolved = resolveConfig(config);
  const cache = new HashlineCache(resolved.cacheSize);
  const hl = resolved.hashLength || 0;
  const pfx = resolved.prefix;

  return {
    config: resolved,
    cache,

    formatFileWithHashes(content: string, filePath?: string): string {
      if (filePath) {
        // Check cache
        const cached = cache.get(filePath, content);
        if (cached) return cached;
      }

      const result = formatFileWithHashes(content, hl, pfx);

      if (filePath) {
        cache.set(filePath, content, result);
      }

      return result;
    },

    stripHashes(content: string): string {
      return stripHashes(content, pfx);
    },

    computeLineHash(idx: number, line: string): string {
      return computeLineHash(idx, line, hl || 3);
    },

    buildHashMap(content: string): Map<string, number> {
      return buildHashMap(content, hl);
    },

    verifyHash(lineNumber: number, hash: string, currentContent: string): VerifyHashResult {
      return verifyHash(lineNumber, hash, currentContent, hl);
    },

    resolveRange(startRef: string, endRef: string, content: string): ResolvedRange {
      return resolveRange(startRef, endRef, content, hl);
    },

    replaceRange(startRef: string, endRef: string, content: string, replacement: string): string {
      return replaceRange(startRef, endRef, content, replacement, hl);
    },

    applyHashEdit(input: HashEditInput, content: string): HashEditResult {
      return applyHashEdit(input, content, hl);
    },

    normalizeHashRef(ref: string): string {
      return normalizeHashRef(ref);
    },

    parseHashRef(ref: string): { line: number; hash: string } {
      return parseHashRef(ref);
    },

    shouldExclude(filePath: string): boolean {
      return shouldExclude(filePath, resolved.exclude);
    },
  };
}
