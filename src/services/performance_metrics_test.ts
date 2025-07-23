
// src/services/performance_metrics_test.ts

import { PerformanceMetrics } from "./performance_metrics.ts";
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

Deno.test("PerformanceMetrics - should record a metric", () => {
  const metrics = new PerformanceMetrics();
  metrics.recordMetric("test_metric", 100);
  const allMetrics = metrics.getMetrics();
  assertEquals(allMetrics.length, 1);
  assertEquals(allMetrics[0].name, "test_metric");
  assertEquals(allMetrics[0].value, 100);
});

Deno.test("PerformanceMetrics - should clear all metrics", () => {
  const metrics = new PerformanceMetrics();
  metrics.recordMetric("test_metric", 100);
  metrics.clearMetrics();
  assertEquals(metrics.getMetrics().length, 0);
});

Deno.test("PerformanceMetrics - should get metrics by name", () => {
  const metrics = new PerformanceMetrics();
  metrics.recordMetric("metric_a", 10);
  metrics.recordMetric("metric_b", 20);
  metrics.recordMetric("metric_a", 30);
  const metricA = metrics.getMetricsByName("metric_a");
  assertEquals(metricA.length, 2);
  assertEquals(metricA[0].value, 10);
  assertEquals(metricA[1].value, 30);
});

Deno.test("PerformanceMetrics - should calculate average", () => {
  const metrics = new PerformanceMetrics();
  metrics.recordMetric("metric_c", 10);
  metrics.recordMetric("metric_c", 20);
  metrics.recordMetric("metric_c", 30);
  assertEquals(metrics.getAverage("metric_c"), 20);
  assertEquals(metrics.getAverage("non_existent_metric"), 0);
});

Deno.test("PerformanceMetrics - should calculate sum", () => {
  const metrics = new PerformanceMetrics();
  metrics.recordMetric("metric_d", 10);
  metrics.recordMetric("metric_d", 20);
  metrics.recordMetric("metric_d", 30);
  assertEquals(metrics.getSum("metric_d"), 60);
  assertEquals(metrics.getSum("non_existent_metric"), 0);
});

Deno.test("PerformanceMetrics - should record metrics with tags", () => {
  const metrics = new PerformanceMetrics();
  metrics.recordMetric("tagged_metric", 50, { type: "api", endpoint: "/users" });
  const allMetrics = metrics.getMetrics();
  assertEquals(allMetrics[0].tags!.type, "api");
  assertEquals(allMetrics[0].tags!.endpoint, "/users");
});
