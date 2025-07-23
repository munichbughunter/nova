
// src/services/response_cache_test.ts

import { ResponseCache } from "./response_cache.ts";
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

Deno.test("ResponseCache - should set and get a value", () => {
  const cache = new ResponseCache<string>();
  cache.set("key1", "value1", 1000);
  assertEquals(cache.get("key1"), "value1");
});

Deno.test("ResponseCache - should return undefined for expired entries", async () => {
  const cache = new ResponseCache<string>();
  cache.set("key1", "value1", 10);
  await new Promise((resolve) => setTimeout(resolve, 20));
  assertEquals(cache.get("key1"), undefined);
});

Deno.test("ResponseCache - should delete an entry", () => {
  const cache = new ResponseCache<string>();
  cache.set("key1", "value1", 1000);
  cache.delete("key1");
  assertEquals(cache.get("key1"), undefined);
});

Deno.test("ResponseCache - should clear all entries", () => {
  const cache = new ResponseCache<string>();
  cache.set("key1", "value1", 1000);
  cache.set("key2", "value2", 1000);
  cache.clear();
  assertEquals(cache.get("key1"), undefined);
  assertEquals(cache.get("key2"), undefined);
});
