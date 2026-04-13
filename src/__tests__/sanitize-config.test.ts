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
    const result = sanitizeConfig({ unknownKey: "value" });
    expect(result).toEqual({});
    expect((result as Record<string, unknown>).unknownKey).toBeUndefined();
  });
});
