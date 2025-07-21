import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { PathTruncator } from "./path-truncator.ts";

Deno.test("PathTruncator", async (t) => {
  await t.step("should return path unchanged if within max length", () => {
    const path = "src/file.ts";
    const result = PathTruncator.truncate(path, 20);
    assertEquals(result, "src/file.ts");
  });

  await t.step("should truncate long paths while preserving filename", () => {
    const path = "very/long/directory/structure/with/many/levels/file.ts";
    const result = PathTruncator.truncate(path, 30);
    assertEquals(result, ".../with/many/levels/file.ts");
  });

  await t.step("should truncate filename if it's too long", () => {
    const path = "src/very-long-filename-that-exceeds-limit.ts";
    const result = PathTruncator.truncate(path, 20);
    assertEquals(result, "...-exceeds-limit.ts");
  });

  await t.step("should handle single filename", () => {
    const path = "file.ts";
    const result = PathTruncator.truncate(path, 10);
    assertEquals(result, "file.ts");
  });

  await t.step("should handle empty path", () => {
    const path = "";
    const result = PathTruncator.truncate(path, 10);
    assertEquals(result, "");
  });

  await t.step("should truncate for terminal width", () => {
    const path = "src/very/long/path/to/file.ts";
    const result = PathTruncator.truncateForTerminal(path, 80, 40);
    // Should fit within available space (80 - 40 = 40, but minimum 20)
    assertEquals(result.length <= 40, true);
  });

  await t.step("should respect minimum space", () => {
    const path = "src/file.ts";
    const result = PathTruncator.truncateForTerminal(path, 50, 45);
    // Should use minimum 20 characters
    assertEquals(result, "src/file.ts");
  });

  await t.step("should get terminal width with fallback", () => {
    const width = PathTruncator.getTerminalWidth();
    assertEquals(typeof width, "number");
    assertEquals(width >= 80, true); // Should be at least 80 (fallback)
  });
});