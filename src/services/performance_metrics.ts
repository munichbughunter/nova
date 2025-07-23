
// src/services/performance_metrics.ts

interface Metric {
  name: string;
  value: number;
  timestamp: number;
  tags?: Record<string, string>;
}

class PerformanceMetrics {
  private metrics: Metric[] = [];

  public recordMetric(name: string, value: number, tags?: Record<string, string>): void {
    this.metrics.push({ name, value, timestamp: Date.now(), tags });
  }

  public getMetrics(): Metric[] {
    return [...this.metrics];
  }

  public clearMetrics(): void {
    this.metrics = [];
  }

  public getMetricsByName(name: string): Metric[] {
    return this.metrics.filter(metric => metric.name === name);
  }

  public getAverage(name: string): number {
    const relevantMetrics = this.getMetricsByName(name);
    if (relevantMetrics.length === 0) {
      return 0;
    }
    const sum = relevantMetrics.reduce((acc, metric) => acc + metric.value, 0);
    return sum / relevantMetrics.length;
  }

  public getSum(name: string): number {
    const relevantMetrics = this.getMetricsByName(name);
    return relevantMetrics.reduce((acc, metric) => acc + metric.value, 0);
  }
}

export { PerformanceMetrics };
export type { Metric };
