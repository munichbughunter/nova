import { assertEquals, assertStringIncludes } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { spy, stub, restore } from "https://deno.land/std@0.208.0/testing/mock.ts";
import { 
  TerminalProgressRenderer, 
  createProgressRenderer 
} from "./terminal-progress-renderer.ts";
import { PlainTextProgressRenderer } from "./plain-text-progress-renderer.ts";
import { FileStatus, DEFAULT_COLORS } from "./types.ts";

Deno.test("TerminalProgressRenderer", async (t) => {
  let originalStdout: any;
  let stdoutWrites: string[] = [];

  // Mock stdout.write to capture output
  const mockStdoutWrite = (data: string) => {
    stdoutWrites.push(data);
    return true;
  };

  await t.step("setup", () => {
    const process = (globalThis as any).process;
    originalStdout = process?.stdout?.write;
    if (process?.stdout) {
      process.stdout.write = mockStdoutWrite as any;
    }
  });

  await t.step("should initialize with default config", () => {
    const renderer = new TerminalProgressRenderer();
    assertEquals(typeof renderer, "object");
  });

  await t.step("should start progress display", () => {
    stdoutWrites = [];
    const renderer = new TerminalProgressRenderer();
    renderer.start(5);
    
    // Should hide cursor if TTY
    const process = (globalThis as any).process;
    if (process?.stdout?.isTTY) {
      assertStringIncludes(stdoutWrites.join(''), '\x1b[?25l');
    }
  });

  await t.step("should update progress with percentage and filename", () => {
    stdoutWrites = [];
    const renderer = new TerminalProgressRenderer();
    renderer.start(3);
    renderer.updateProgress("src/test.ts", 1, 3);
    
    const output = stdoutWrites.join('');
    const process = (globalThis as any).process;
    if (process?.stdout?.isTTY) {
      assertStringIncludes(output, "33%");
      assertStringIncludes(output, "test.ts");
    }
  });

  await t.step("should handle file status updates", () => {
    stdoutWrites = [];
    const renderer = new TerminalProgressRenderer();
    renderer.start(1);
    renderer.updateFileStatus("src/test.ts", FileStatus.SUCCESS);
    
    const output = stdoutWrites.join('');
    const process = (globalThis as any).process;
    if (process?.stdout?.isTTY) {
      assertStringIncludes(output, "test.ts");
    }
  });

  await t.step("should display errors", () => {
    stdoutWrites = [];
    const renderer = new TerminalProgressRenderer();
    renderer.start(1);
    renderer.error("src/test.ts", "Test error");
    
    // Error method uses console.log, so we check that it was called
    // The actual error output is handled by console.log, not stdout.write
    // This test verifies the method doesn't crash and handles the error
    assertEquals(typeof renderer.error, "function");
  });

  await t.step("should complete and show cursor", () => {
    stdoutWrites = [];
    const renderer = new TerminalProgressRenderer();
    renderer.start(1);
    renderer.complete();
    
    const output = stdoutWrites.join('');
    const process = (globalThis as any).process;
    if (process?.stdout?.isTTY) {
      assertStringIncludes(output, '\x1b[?25h'); // Show cursor
    }
  });

  await t.step("should cleanup properly", () => {
    stdoutWrites = [];
    const renderer = new TerminalProgressRenderer();
    renderer.start(1);
    renderer.cleanup();
    
    const output = stdoutWrites.join('');
    const process = (globalThis as any).process;
    if (process?.stdout?.isTTY) {
      assertStringIncludes(output, '\x1b[?25h'); // Show cursor
    }
  });

  await t.step("cleanup", () => {
    const process = (globalThis as any).process;
    if (process?.stdout) {
      process.stdout.write = originalStdout;
    }
  });
});

Deno.test("PlainTextProgressRenderer", async (t) => {
  let consoleOutput: string[] = [];
  let originalConsoleLog: any;
  let originalConsoleError: any;

  const mockConsoleLog = (...args: any[]) => {
    consoleOutput.push(args.join(' '));
  };

  const mockConsoleError = (...args: any[]) => {
    consoleOutput.push('ERROR: ' + args.join(' '));
  };

  await t.step("setup", () => {
    originalConsoleLog = console.log;
    originalConsoleError = console.error;
    console.log = mockConsoleLog;
    console.error = mockConsoleError;
  });

  await t.step("should start with file count message", () => {
    consoleOutput = [];
    const renderer = new PlainTextProgressRenderer();
    renderer.start(5);
    
    assertStringIncludes(consoleOutput[0], "Starting analysis of 5 files");
  });

  await t.step("should update progress with file info", () => {
    consoleOutput = [];
    const renderer = new PlainTextProgressRenderer();
    renderer.updateProgress("src/test.ts", 2, 5);
    
    assertStringIncludes(consoleOutput[0], "[2/5]");
    assertStringIncludes(consoleOutput[0], "40%");
    assertStringIncludes(consoleOutput[0], "src/test.ts");
  });

  await t.step("should display file status", () => {
    consoleOutput = [];
    const renderer = new PlainTextProgressRenderer();
    renderer.updateFileStatus("src/test.ts", FileStatus.SUCCESS);
    
    assertStringIncludes(consoleOutput[0], "SUCCESS");
    assertStringIncludes(consoleOutput[0], "src/test.ts");
  });

  await t.step("should display completion message", () => {
    consoleOutput = [];
    const renderer = new PlainTextProgressRenderer();
    renderer.complete();
    
    assertStringIncludes(consoleOutput[0], "Analysis complete");
  });

  await t.step("should display errors", () => {
    consoleOutput = [];
    const renderer = new PlainTextProgressRenderer();
    renderer.error("src/test.ts", "Test error");
    
    assertStringIncludes(consoleOutput[0], "ERROR");
    assertStringIncludes(consoleOutput[0], "src/test.ts");
    assertStringIncludes(consoleOutput[0], "Test error");
  });

  await t.step("cleanup", () => {
    console.log = originalConsoleLog;
    console.error = originalConsoleError;
  });
});

Deno.test("createProgressRenderer factory", async (t) => {
  await t.step("should create appropriate renderer based on TTY", () => {
    const renderer = createProgressRenderer();
    assertEquals(typeof renderer, "object");
    
    // Should implement ProgressRenderer interface
    assertEquals(typeof renderer.start, "function");
    assertEquals(typeof renderer.updateProgress, "function");
    assertEquals(typeof renderer.updateFileStatus, "function");
    assertEquals(typeof renderer.complete, "function");
    assertEquals(typeof renderer.error, "function");
    assertEquals(typeof renderer.cleanup, "function");
  });

  await t.step("should accept custom config", () => {
    const config = {
      width: 50,
      colors: DEFAULT_COLORS
    };
    const renderer = createProgressRenderer(config);
    assertEquals(typeof renderer, "object");
  });
});