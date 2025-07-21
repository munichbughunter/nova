/**
 * Enhanced CLI Handler Tests
 * 
 * Unit tests for enhanced CLI options and command handling
 */

import { assertEquals, assertExists, assert } from "jsr:@std/assert";
import { Logger } from "../utils/logger.ts";
import { EnhancedCLIHandler } from "./enhanced-cli-handler.ts";
import type { EnhancedCLIOptions, EnhancedReviewCommand } from "../types/enhanced-cli.types.ts";

// Create test logger
const testLogger = new Logger("enhanced-cli-handler-test");

Deno.test("EnhancedCLIHandler - Basic instantiation", () => {
    const handler = new EnhancedCLIHandler(testLogger);
    assertExists(handler);
});

Deno.test("EnhancedCLIHandler - Parse basic file review command", () => {
    const handler = new EnhancedCLIHandler(testLogger);
    const args = ["src/main.ts", "src/utils.ts"];
    
    const result = handler.parseEnhancedArgs(args);
    
    assertEquals(result.errors.length, 0);
    assertEquals(result.command?.mode, "file");
    assertEquals(result.command?.files, ["src/main.ts", "src/utils.ts"]);
    assertEquals(result.options.outputFormat, "console");
    assertEquals(result.options.sequential, true);
});

Deno.test("EnhancedCLIHandler - Parse dry-run option", () => {
    const handler = new EnhancedCLIHandler(testLogger);
    const args = ["--dry-run", "src/main.ts"];
    
    const result = handler.parseEnhancedArgs(args);
    
    assertEquals(result.errors.length, 0);
    assertEquals(result.options.dryRun, true);
    assertEquals(result.command?.dryRun, true);
    assertEquals(result.command?.files, ["src/main.ts"]);
});

Deno.test("EnhancedCLIHandler - Parse JSON report option", () => {
    const handler = new EnhancedCLIHandler(testLogger);
    const args = ["--json-report", "report.json", "src/main.ts"];
    
    const result = handler.parseEnhancedArgs(args);
    
    assertEquals(result.errors.length, 0);
    assertEquals(result.options.jsonReport, "report.json");
    assertEquals(result.command?.jsonReport, "report.json");
});

Deno.test("EnhancedCLIHandler - Parse group-by-directory option", () => {
    const handler = new EnhancedCLIHandler(testLogger);
    const args = ["--group-by-directory", "src/*.ts"];
    
    const result = handler.parseEnhancedArgs(args);
    
    assertEquals(result.errors.length, 0);
    assertEquals(result.options.groupByDirectory, true);
    assertEquals(result.command?.groupByDirectory, true);
});

Deno.test("EnhancedCLIHandler - Parse output format options", () => {
    const handler = new EnhancedCLIHandler(testLogger);
    
    // Test console format
    let result = handler.parseEnhancedArgs(["--output-format", "console", "src/main.ts"]);
    assertEquals(result.options.outputFormat, "console");
    
    // Test json format
    result = handler.parseEnhancedArgs(["--output-format", "json", "src/main.ts"]);
    assertEquals(result.options.outputFormat, "json");
    
    // Test both format
    result = handler.parseEnhancedArgs(["--output-format", "both", "src/main.ts"]);
    assertEquals(result.options.outputFormat, "both");
});

Deno.test("EnhancedCLIHandler - Parse processing options", () => {
    const handler = new EnhancedCLIHandler(testLogger);
    const args = [
        "--sequential",
        "--show-progress", 
        "--show-eta",
        "--show-throughput",
        "src/main.ts"
    ];
    
    const result = handler.parseEnhancedArgs(args);
    
    assertEquals(result.errors.length, 0);
    assertEquals(result.options.sequential, true);
    assertEquals(result.options.showProgress, true);
    assertEquals(result.options.showETA, true);
    assertEquals(result.options.showThroughput, true);
});

Deno.test("EnhancedCLIHandler - Parse error handling options", () => {
    const handler = new EnhancedCLIHandler(testLogger);
    const args = [
        "--max-errors", "5",
        "--continue-on-error",
        "--file-ordering", "size",
        "src/main.ts"
    ];
    
    const result = handler.parseEnhancedArgs(args);
    
    assertEquals(result.errors.length, 0);
    assertEquals(result.options.maxErrors, 5);
    assertEquals(result.options.continueOnError, true);
    assertEquals(result.options.fileOrdering, "size");
});

Deno.test("EnhancedCLIHandler - Parse aliases", () => {
    const handler = new EnhancedCLIHandler(testLogger);
    const args = [
        "-d", // --dry-run
        "-j", "report.json", // --json-report
        "-g", // --group-by-directory
        "-o", "both", // --output-format
        "src/main.ts"
    ];
    
    const result = handler.parseEnhancedArgs(args);
    
    assertEquals(result.errors.length, 0);
    assertEquals(result.options.dryRun, true);
    assertEquals(result.options.jsonReport, "report.json");
    assertEquals(result.options.groupByDirectory, true);
    assertEquals(result.options.outputFormat, "both");
});

Deno.test("EnhancedCLIHandler - Parse changes command", () => {
    const handler = new EnhancedCLIHandler(testLogger);
    const args = ["changes"];
    
    const result = handler.parseEnhancedArgs(args);
    
    assertEquals(result.errors.length, 0);
    assertEquals(result.command?.mode, "changes");
    assertEquals(result.command?.files, undefined);
});

Deno.test("EnhancedCLIHandler - Parse PR command", () => {
    const handler = new EnhancedCLIHandler(testLogger);
    
    // Test PR without ID
    let result = handler.parseEnhancedArgs(["pr"]);
    assertEquals(result.command?.mode, "pr");
    assertEquals(result.command?.prId, undefined);
    
    // Test PR with ID
    result = handler.parseEnhancedArgs(["pr", "123"]);
    assertEquals(result.command?.mode, "pr");
    assertEquals(result.command?.prId, "123");
});

Deno.test("EnhancedCLIHandler - Validation errors", () => {
    const handler = new EnhancedCLIHandler(testLogger);
    
    // Test invalid output format
    let result = handler.parseEnhancedArgs(["--output-format", "invalid", "src/main.ts"]);
    assert(result.errors.length > 0, `Expected errors but got: ${JSON.stringify(result.errors)}`);
    assert(result.errors.some(error => error.includes("Invalid output format")), `Expected 'Invalid output format' error but got: ${JSON.stringify(result.errors)}`);
    
    // Test invalid file ordering
    result = handler.parseEnhancedArgs(["--file-ordering", "invalid", "src/main.ts"]);
    assert(result.errors.length > 0, `Expected errors but got: ${JSON.stringify(result.errors)}`);
    assert(result.errors.some(error => error.includes("Invalid file ordering")), `Expected 'Invalid file ordering' error but got: ${JSON.stringify(result.errors)}`);
    
    // Test invalid max errors - use a different approach to test negative numbers
    // Since -1 might be interpreted as a flag, let's test with a non-integer value
    result = handler.parseEnhancedArgs(["--max-errors", "abc", "src/main.ts"]);
    assert(result.errors.length > 0, `Expected errors but got: ${JSON.stringify(result.errors)}`);
    assert(result.errors.some(error => error.includes("Invalid max errors")), `Expected 'Invalid max errors' error but got: ${JSON.stringify(result.errors)}`);
});

Deno.test("EnhancedCLIHandler - Validation warnings", () => {
    const handler = new EnhancedCLIHandler(testLogger);
    
    // Test dry-run with JSON report warning
    const result = handler.parseEnhancedArgs(["--dry-run", "--json-report", "report.json", "src/main.ts"]);
    assert(result.warnings.length > 0);
    assert(result.warnings.some(warning => warning.includes("JSON report will not be generated in dry-run mode")));
});

Deno.test("EnhancedCLIHandler - Default values", () => {
    const handler = new EnhancedCLIHandler(testLogger);
    const args = ["src/main.ts"];
    
    const result = handler.parseEnhancedArgs(args);
    
    // Check normalized options after validation
    assertEquals(result.options.outputFormat, "console");
    assertEquals(result.options.fileOrdering, "alphabetical");
    assertEquals(result.options.maxErrors, 10);
    assertEquals(result.options.continueOnError, true);
    assertEquals(result.options.sequential, true);
    assertEquals(result.options.showProgress, true);
    // These should be false by default from parseArgs, not from our defaults
    assertEquals(result.options.dryRun, false);
    assertEquals(result.options.groupByDirectory, false);
});

Deno.test("EnhancedCLIHandler - Convert to legacy ReviewCommand", () => {
    const handler = new EnhancedCLIHandler(testLogger);
    
    const enhancedCommand: EnhancedReviewCommand = {
        mode: "file",
        files: ["src/main.ts", "src/utils.ts"],
        dryRun: false,
        groupByDirectory: false,
        outputFormat: "console",
        sequential: true,
        showProgress: true
    };
    
    const legacyCommand = handler.toLegacyReviewCommand(enhancedCommand);
    
    assertEquals(legacyCommand.mode, "file");
    assertEquals(legacyCommand.files, ["src/main.ts", "src/utils.ts"]);
    assertEquals(legacyCommand.prId, undefined);
});

Deno.test("EnhancedCLIHandler - Create output format config", () => {
    const handler = new EnhancedCLIHandler(testLogger);
    
    const options: EnhancedCLIOptions = {
        outputFormat: "both",
        jsonReport: "report.json"
    };
    
    const config = handler.createOutputFormatConfig(options);
    
    assertEquals(config.format, "both");
    assertEquals(config.jsonPath, "report.json");
    assertEquals(config.includeMetrics, true);
    assertEquals(config.colorOutput, true);
});

Deno.test("EnhancedCLIHandler - Generate enhanced help", () => {
    const handler = new EnhancedCLIHandler(testLogger);
    
    const helpText = handler.generateEnhancedHelp();
    
    assert(helpText.includes("Enhanced Code Review Options"));
    assert(helpText.includes("--dry-run"));
    assert(helpText.includes("--json-report"));
    assert(helpText.includes("--group-by-directory"));
    assert(helpText.includes("--output-format"));
    assert(helpText.includes("Processing Options"));
    assert(helpText.includes("Error Handling Options"));
});

Deno.test("EnhancedCLIHandler - Validate file arguments", () => {
    const handler = new EnhancedCLIHandler(testLogger);
    
    const files = [
        "src/main.ts",
        "src/utils.js",
        "src/**/*.ts",
        "", // Invalid empty string
        "src/file with spaces.ts",
        "very-long-path".repeat(50) // Invalid too long
    ];
    
    const result = handler.validateFileArguments(files);
    
    assert(result.valid.includes("src/main.ts"));
    assert(result.valid.includes("src/utils.js"));
    assert(result.valid.includes("src/**/*.ts"));
    assert(result.valid.includes("src/file with spaces.ts"));
    assert(result.invalid.includes(""));
    assert(result.invalid.some(file => file.includes("very-long-path")));
});

Deno.test("EnhancedCLIHandler - Complex command parsing", () => {
    const handler = new EnhancedCLIHandler(testLogger);
    const args = [
        "--dry-run",
        "--json-report", "detailed-report.json",
        "--group-by-directory",
        "--output-format", "both",
        "--show-eta",
        "--show-throughput",
        "--max-errors", "3",
        "--file-ordering", "modified",
        "src/**/*.ts",
        "tests/**/*.test.ts"
    ];
    
    const result = handler.parseEnhancedArgs(args);
    
    assertEquals(result.errors.length, 0);
    assertEquals(result.options.dryRun, true);
    assertEquals(result.options.jsonReport, "detailed-report.json");
    assertEquals(result.options.groupByDirectory, true);
    assertEquals(result.options.outputFormat, "both");
    assertEquals(result.options.showETA, true);
    assertEquals(result.options.showThroughput, true);
    assertEquals(result.options.maxErrors, 3);
    assertEquals(result.options.fileOrdering, "modified");
    assertEquals(result.command?.files, ["src/**/*.ts", "tests/**/*.test.ts"]);
});

Deno.test("EnhancedCLIHandler - Help flag handling", () => {
    const handler = new EnhancedCLIHandler(testLogger);
    const args = ["--help"];
    
    const result = handler.parseEnhancedArgs(args);
    
    assertEquals(result.options.help, true);
    assertEquals(result.errors.length, 0);
});

Deno.test("EnhancedCLIHandler - Empty args handling", () => {
    const handler = new EnhancedCLIHandler(testLogger);
    const args: string[] = [];
    
    const result = handler.parseEnhancedArgs(args);
    
    assertEquals(result.errors.length, 0);
    assertEquals(result.command?.mode, "changes"); // Default to changes mode
    assertEquals(result.options.outputFormat, "console");
});