# Nova LLMs Arena

This document contains the latest benchmark results for different LLM models with Nova. These
benchmarks help us identify which models work best for different tasks and track performance
improvements over time.

## Latest Test Results

**Last Updated:** 2025-04-29

**Test Environment:** MacBook darwin aarch64-apple-darwin

## Performance Overview

| Model             | Success Rate | Avg. Response Time | Best Performing Test      | Worst Performing Test   |
| ----------------- | ------------ | ------------------ | ------------------------- | ----------------------- |
| gemma3:latest     | 77.8%        | 21903ms            | Math Problem Solving      | Basic Text Generation   |
| granite3.3:latest | 88.9%        | 71256ms            | Generate Object with Enum | Math Problem Solving    |
| phi4-mini:latest  | 66.7%        | 10158ms            | Generate Object with Enum | Basic Text Generation   |
| qwen2.5:latest    | 88.9%        | 31928ms            | Generate Object with Enum | Basic Text Generation   |
| llama3.2:latest   | 44.4%        | 12216ms            | Tool Usage                | Basic Text Generation   |
| cogito:8b         | 100.0%       | 38556ms            | Generate Object with Enum | Code Review             |
| deepseek-r1:7b    | 33.3%        | 31371ms            | Math Problem Solving      | Chat with System Prompt |

## Test Case Results

### Basic Text Generation

Tests the model's ability to generate a simple explanation about TypeScript.

| Model             | Success | Time (ms) | Notes                                              |
| ----------------- | ------- | --------- | -------------------------------------------------- |
| gemma3:latest     | ✓       | 35892     | "Okay, let's break down TypeScript. It's a fasc... |
| granite3.3:latest | ✓       | 11488     | "TypeScript is a statically typed superset of J... |
| phi4-mini:latest  | ✓       | 20484     | "TypeScript is a superset of JavaScript that ad... |
| qwen2.5:latest    | ✓       | 67779     | "TypeScript is an open-source programming langu... |
| llama3.2:latest   | ✓       | 23397     | "TypeScript is a superset of JavaScript that ad... |
| cogito:8b         | ✓       | 72205     | "TypeScript is a programming language developed... |
| deepseek-r1:7b    | ✓       | 43581     | "<think>\n\n</think>\n\nTypeScript is a program... |

### Chat with System Prompt

Tests the model's ability to follow a system prompt and generate specific information about
TypeScript benefits.

| Model             | Success | Time (ms) | Notes                                              |
| ----------------- | ------- | --------- | -------------------------------------------------- |
| gemma3:latest     | ✓       | 33057     | "Okay, let's break down the benefits of using T... |
| granite3.3:latest | ✓       | 53076     | "1. Static Typing: TypeScript is a superset of ... |
| phi4-mini:latest  | ✓       | 13152     | "TypeScript is an open-source language that bui... |
| qwen2.5:latest    | ✓       | 43326     | "TypeScript is a strongly typed superset of Jav... |
| llama3.2:latest   | ✓       | 22606     | "TypeScript is a statically typed, multi-paradi... |
| cogito:8b         | ✓       | 57762     | "TypeScript offers several significant benefits... |
| deepseek-r1:7b    | ✓       | 173235    | "<think>\nOkay, so I'm trying to understand why... |

### Tool Usage

Tests the model's ability to use the weather tool to retrieve information about San Francisco.

| Model             | Success | Time (ms) | Notes                                              |
| ----------------- | ------- | --------- | -------------------------------------------------- |
| gemma3:latest     | ✗       | 61        | Error: Bad Request                                 |
| granite3.3:latest | ✓       | 7394      | {"text":"The current weather in San Francisco i... |
| phi4-mini:latest  | ✓       | 1216      | {"text":"[{\"type\":\"function\",\"function\":{... |
| qwen2.5:latest    | ✓       | 7179      | {"text":"The current temperature in San Francis... |
| llama3.2:latest   | ✓       | 3407      | {"text":"The current weather in San Francisco i... |
| cogito:8b         | ✓       | 11800     | {"text":"The current weather in San Francisco i... |
| deepseek-r1:7b    | ✗       | 310       | Error: Bad Request                                 |

### Generate Object with Enum

Tests the model's ability to classify a movie plot into a genre from a predefined list.

| Model             | Success | Time (ms) | Notes                                               |
| ----------------- | ------- | --------- | --------------------------------------------------- |
| gemma3:latest     | ✓       | 1193      | "sci-fi"                                            |
| granite3.3:latest | ✓       | 2581      | "sci-fi"                                            |
| phi4-mini:latest  | ✓       | 838       | "sci-fi"                                            |
| qwen2.5:latest    | ✓       | 2281      | "sci-fi"                                            |
| llama3.2:latest   | ✗       | 2942      | No object generated: response did not match schema. |
| cogito:8b         | ✓       | 3140      | "sci-fi"                                            |
| deepseek-r1:7b    | ✗       | 5548      | Invalid JSON response                               |

### Generate Object with Array

Tests the model's ability to generate structured data about RPG characters.

| Model             | Success | Time (ms) | Notes                                               |
| ----------------- | ------- | --------- | --------------------------------------------------- |
| gemma3:latest     | ✓       | 27324     | {"characters":[{"class":"warrior","description"...  |
| granite3.3:latest | ✓       | 24437     | {"characters":[{"class":"Warrior","description"...  |
| phi4-mini:latest  | ✗       | 6314      | No object generated: response did not match schema. |
| qwen2.5:latest    | ✓       | 24378     | {"characters":[{"class":"warrior","description"...  |
| llama3.2:latest   | ✗       | 8354      | Invalid JSON response                               |
| cogito:8b         | ✓       | 22718     | {"characters":[{"class":"Warrior","description"...  |
| deepseek-r1:7b    | ✗       | 7073      | Invalid JSON response                               |

### Generate Object with Date Parsing

Tests the model's ability to generate dates in a specific format for historical events.

| Model             | Success | Time (ms) | Notes                                               |
| ----------------- | ------- | --------- | --------------------------------------------------- |
| gemma3:latest     | ✓       | 18969     | {"events":[{"date":"2000-09-11T00:00:00.000Z","...  |
| granite3.3:latest | ✓       | 22818     | {"events":[{"date":"2000-01-01T00:00:00.000Z","...  |
| phi4-mini:latest  | ✗       | 9578      | No object generated: response did not match schema. |
| qwen2.5:latest    | ✓       | 26775     | {"events":[{"date":"2000-01-01T00:00:00.000Z","...  |
| llama3.2:latest   | ✗       | 8619      | Invalid JSON response                               |
| cogito:8b         | ✓       | 27450     | {"events":[{"date":"2000-01-01T00:00:00.000Z","...  |
| deepseek-r1:7b    | ✗       | 5992      | Invalid JSON response                               |

### Math Problem Solving

Tests the model's ability to solve a math problem using the calculate tool.

| Model             | Success | Time (ms) | Notes                                              |
| ----------------- | ------- | --------- | -------------------------------------------------- |
| gemma3:latest     | ✓       | 46        | "Error in math problem test: Bad Request"          |
| granite3.3:latest | ✓       | 63587     | "To find out how much the taxi driver earns in ... |
| phi4-mini:latest  | ✓       | 3685      | "To find out how much the taxi driver earns in ... |
| qwen2.5:latest    | ✓       | 39015     | "The taxi driver earns $113,532 in one day from... |
| llama3.2:latest   | ✓       | 12565     | "To find the total amount of money the taxi dri... |
| cogito:8b         | ✓       | 53726     | "Let me solve this step by step.\n\n1. First, l... |
| deepseek-r1:7b    | ✓       | 16        | "Error in math problem test: Bad Request"          |

### Code Review

Tests the model's ability to review code with specific formatting requirements.

| Model             | Success | Time (ms) | Notes                                                                   |
| ----------------- | ------- | --------- | ----------------------------------------------------------------------- |
| gemma3:latest     | ✗       | 78641     | Code review failed: No object generated: response did not match schema. |
| granite3.3:latest | ✗       | 453097    | Code review failed: No object generated: response did not match schema. |
| phi4-mini:latest  | ✗       | 33734     | Code review failed: No object generated: response did not match schema. |
| qwen2.5:latest    | ✗       | 73533     | Code review failed: No object generated: response did not match schema. |
| llama3.2:latest   | ✗       | 22900     | Code review failed: No object generated: response did not match schema. |
| cogito:8b         | ✓       | 91896     | {"issues":[{"severity":"high","message":"Securi...                      |
| deepseek-r1:7b    | ✗       | 35989     | Code review failed: Invalid JSON response                               |

### Browser Control

Tests the model's ability to generate browser actions for a search interface.

| Model             | Success | Time (ms) | Notes                                               |
| ----------------- | ------- | --------- | --------------------------------------------------- |
| gemma3:latest     | ✓       | 1941      | {"action":"click","selector":"#search-button","...  |
| granite3.3:latest | ✓       | 2828      | {"action":"type","selector":"#search","value":"...  |
| phi4-mini:latest  | ✓       | 2419      | {"action":"click","selector":"#search-button"}      |
| qwen2.5:latest    | ✓       | 3088      | {"action":"type","selector":"#search","value":"...  |
| llama3.2:latest   | ✗       | 5154      | No object generated: response did not match schema. |
| cogito:8b         | ✓       | 6308      | {"action":"type","selector":"#search","value":"...  |
| deepseek-r1:7b    | ✗       | 10592     | Invalid JSON response                               |

## Common Errors

| Model             | Error Pattern                  | Affected Tests                                                                                            | Potential Solution                       |
| ----------------- | ------------------------------ | --------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| gemma3:latest     | Error: Bad Request             | Tool Usage                                                                                                | Check model compatibility with this task |
| gemma3:latest     | Code review failed: No obje... | Code Review                                                                                               | Review model capabilities                |
| granite3.3:latest | Code review failed: No obje... | Code Review                                                                                               | Review model capabilities                |
| phi4-mini:latest  | No object generated: respon... | Generate Object with Array, Generate Object with Date Parsing                                             | Review model capabilities                |
| phi4-mini:latest  | Code review failed: No obje... | Code Review                                                                                               | Review model capabilities                |
| qwen2.5:latest    | Code review failed: No obje... | Code Review                                                                                               | Review model capabilities                |
| llama3.2:latest   | No object generated: respon... | Generate Object with Enum, Browser Control                                                                | Review model capabilities                |
| llama3.2:latest   | Invalid JSON response          | Generate Object with Array, Generate Object with Date Parsing                                             | Review model capabilities                |
| llama3.2:latest   | Code review failed: No obje... | Code Review                                                                                               | Review model capabilities                |
| deepseek-r1:7b    | Error: Bad Request             | Tool Usage                                                                                                | Check model compatibility with this task |
| deepseek-r1:7b    | Invalid JSON response          | Generate Object with Enum, Generate Object with Array, Generate Object with Date Parsing, Browser Control | Review model capabilities                |
| deepseek-r1:7b    | Code review failed: Invalid... | Code Review                                                                                               | Review model capabilities                |

## Agent Tests

| Model | Success | Time (ms) | Notes |
| ----- | ------- | --------- | ----- |

## Test Support Matrix

| Test Case                         | gemma3:latest | granite3.3:latest | phi4-mini:latest | qwen2.5:latest | llama3.2:latest | cogito:8b | deepseek-r1:7b |
| --------------------------------- | ------------- | ----------------- | ---------------- | -------------- | --------------- | --------- | -------------- |
| Basic Text Generation             | ✓             | ✓                 | ✓                | ✓              | ✓               | ✓         | ✓              |
| Chat with System Prompt           | ✓             | ✓                 | ✓                | ✓              | ✓               | ✓         | ✓              |
| Tool Usage                        | ✗             | ✓                 | ✓                | ✓              | ✓               | ✓         | ✗              |
| Generate Object with Enum         | ✓             | ✓                 | ✓                | ✓              | ✗               | ✓         | ✗              |
| Generate Object with Array        | ✓             | ✓                 | ✗                | ✓              | ✗               | ✓         | ✗              |
| Generate Object with Date Parsing | ✓             | ✓                 | ✗                | ✓              | ✗               | ✓         | ✗              |
| Math Problem Solving              | ✓             | ✓                 | ✓                | ✓              | ✓               | ✓         | ✓              |
| Code Review                       | ✗             | ✗                 | ✗                | ✗              | ✗               | ✓         | ✗              |
| Browser Control                   | ✓             | ✓                 | ✓                | ✓              | ✗               | ✓         | ✗              |

## Recommendations

- **Best Overall Model:** cogito:8b
- **Best for Code Review:** cogito:8b
- **Best for Tool Usage:** phi4-mini:latest
- **Best for Structured Data:** cogito:8b
- **Most Cost-Effective:** phi4-mini:latest

## Test History

| Date       | Top Model | Overall Success Rate | Major Changes        |
| ---------- | --------- | -------------------- | -------------------- |
| 2025-04-29 | cogito:8b | 100.0%               | Updated test metrics |

## Running the Tests

To run these benchmarks yourself:

```bash
deno task llms-arena
```

To view the latest results without running the tests:

```bash
deno task llms-arena --review
```

To create an initial report template:

```bash
deno task llms-arena --init-report
```

To update the documentation with the latest test results:

```bash
deno task llms-arena --update
```

To clean up a corrupted documentation file:

```bash
deno task llms-arena-cleanup
```
