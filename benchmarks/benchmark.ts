/**
 * Benchmark script for opencode-hashline.
 *
 * Measures performance of formatFileWithHashes() and stripHashes()
 * on files of various sizes (10, 100, 1000, 5000, 10000 lines).
 *
 * Usage: npx tsx benchmarks/benchmark.ts
 */

import { formatFileWithHashes, stripHashes } from "../src/hashline.js";

const SIZES = [10, 100, 1_000, 5_000, 10_000];
const WARMUP_RUNS = 3;
const BENCH_RUNS = 10;

function generateFile(lineCount: number): string {
  const lines: string[] = [];
  for (let i = 0; i < lineCount; i++) {
    const indent = "  ".repeat(i % 4);
    lines.push(`${indent}const variable_${i} = "value_${i}"; // line ${i}`);
  }
  return lines.join("\n");
}

function benchmarkFn(fn: (input: string) => string, input: string): number {
  // Warmup
  for (let i = 0; i < WARMUP_RUNS; i++) {
    fn(input);
  }

  // Measure
  const times: number[] = [];
  for (let i = 0; i < BENCH_RUNS; i++) {
    const start = performance.now();
    fn(input);
    const end = performance.now();
    times.push(end - start);
  }

  // Return median
  times.sort((a, b) => a - b);
  return times[Math.floor(times.length / 2)];
}

function formatNumber(n: number): string {
  return n.toLocaleString("en-US");
}

function padLeft(str: string, len: number): string {
  return str.padStart(len);
}

function padRight(str: string, len: number): string {
  return str.padEnd(len);
}

console.log("Hashline Benchmark");
console.log("==================\n");

const COL_WIDTHS = [18, 27, 18, 31, 30];
const HEADERS = [
  "File Size (lines)",
  "formatFileWithHashes (ms)",
  "stripHashes (ms)",
  "Throughput format (lines/sec)",
  "Throughput strip (lines/sec)",
];

// Print header
const headerLine = HEADERS.map((h, i) => padRight(h, COL_WIDTHS[i])).join(" │ ");
console.log(headerLine);
console.log(COL_WIDTHS.map((w) => "─".repeat(w)).join("─┼─"));

for (const size of SIZES) {
  const fileContent = generateFile(size);
  const annotated = formatFileWithHashes(fileContent);

  const formatTime = benchmarkFn(formatFileWithHashes, fileContent);
  const stripTime = benchmarkFn(stripHashes, annotated);

  const formatThroughput = Math.round(size / (formatTime / 1000));
  const stripThroughput = Math.round(size / (stripTime / 1000));

  const row = [
    padLeft(formatNumber(size), COL_WIDTHS[0]),
    padLeft(formatTime.toFixed(2), COL_WIDTHS[1]),
    padLeft(stripTime.toFixed(2), COL_WIDTHS[2]),
    padLeft(formatNumber(formatThroughput), COL_WIDTHS[3]),
    padLeft(formatNumber(stripThroughput), COL_WIDTHS[4]),
  ].join(" │ ");

  console.log(row);
}

console.log("\nDone.");
