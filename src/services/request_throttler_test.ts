
// src/services/request_throttler_test.ts

import { RequestThrottler } from "./request_throttler.ts";
import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";

Deno.test("RequestThrottler - should limit concurrent requests", async () => {
  const throttler = new RequestThrottler<number>(2, 0); // 2 concurrent, no interval
  let running = 0;
  const results: number[] = [];

  const task = async (id: number) => {
    running++;
    assert(running <= 2, `Too many concurrent requests: ${running}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
    running--;
    return id;
  };

  const promises = Array.from({ length: 5 }, (_, i) => throttler.addRequest(async () => task(i)));
  const resolvedResults = await Promise.all(promises);
  assertEquals(resolvedResults.sort(), [0, 1, 2, 3, 4]);
});

Deno.test("RequestThrottler - should respect the interval between requests", async () => {
  const throttler = new RequestThrottler<number>(1, 100); // 1 concurrent, 100ms interval
  const start = Date.now();
  const results: number[] = [];

  const task = async (id: number) => {
    await new Promise((resolve) => setTimeout(resolve, 10));
    results.push(id);
    return id;
  };

  const promises = Array.from({ length: 3 }, (_, i) => throttler.addRequest(async () => task(i)));
  await Promise.all(promises);
  const end = Date.now();

  assert(end - start >= 200, `Expected at least 200ms, got ${end - start}ms`); // 2 intervals for 3 requests
  assertEquals(results, [0, 1, 2]);
});

Deno.test("RequestThrottler - should handle errors", async () => {
  const throttler = new RequestThrottler<string>(1, 0);

  const task1 = async () => "success";
  const task2 = async () => {
    throw new Error("failure");
  };

  const promise1 = throttler.addRequest(task1);
  const promise2 = throttler.addRequest(task2);

  const result1 = await promise1;
  assertEquals(result1, "success");

  let error: Error | undefined;
  try {
    await promise2;
  } catch (e) {
    error = e as Error;
  }
  assert(error instanceof Error && error.message === "failure");
});
