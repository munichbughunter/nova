import { assertEquals, assertStringIncludes } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { TerminalController } from "./terminal-controller.ts";

Deno.test("TerminalController", async (t) => {
  await t.step("should generate correct ANSI escape sequences", () => {
    assertEquals(TerminalController.hideCursor(), "\x1b[?25l");
    assertEquals(TerminalController.showCursor(), "\x1b[?25h");
    assertEquals(TerminalController.clearLine(), "\r\x1b[K");
    assertEquals(TerminalController.reset(), "\x1b[0m");
  });

  await t.step("should generate color codes", () => {
    assertEquals(TerminalController.color(32), "\x1b[32m");
    assertEquals(TerminalController.color(31), "\x1b[31m");
  });

  await t.step("should move cursor to column", () => {
    assertEquals(TerminalController.moveCursorToColumn(10), "\x1b[10G");
  });

  await t.step("should have progress characters defined", () => {
    assertEquals(typeof TerminalController.PROGRESS_CHARS.filled, "string");
    assertEquals(typeof TerminalController.PROGRESS_CHARS.empty, "string");
    assertEquals(typeof TerminalController.PROGRESS_CHARS.leftBorder, "string");
    assertEquals(typeof TerminalController.PROGRESS_CHARS.rightBorder, "string");
  });

  await t.step("should have spinner characters", () => {
    assertEquals(Array.isArray(TerminalController.SPINNER_CHARS), true);
    assertEquals(TerminalController.SPINNER_CHARS.length > 0, true);
    // Check that all spinner chars are strings
    TerminalController.SPINNER_CHARS.forEach(char => {
      assertEquals(typeof char, "string");
    });
  });

  await t.step("should have status icons", () => {
    assertEquals(typeof TerminalController.STATUS_ICONS.success, "string");
    assertEquals(typeof TerminalController.STATUS_ICONS.error, "string");
    assertEquals(typeof TerminalController.STATUS_ICONS.warning, "string");
    assertEquals(typeof TerminalController.STATUS_ICONS.pending, "string");
    assertEquals(typeof TerminalController.STATUS_ICONS.processing, "string");
  });

  await t.step("should detect TTY capability", () => {
    const isTTY = TerminalController.isTTY();
    assertEquals(typeof isTTY, "boolean");
  });

  await t.step("should detect color support", () => {
    const supportsColor = TerminalController.supportsColor();
    assertEquals(typeof supportsColor, "boolean");
  });
});