/**
 * Integration tests for monitoring service with other services
 */

import { assertEquals, assertExists, assert } from 'https://deno.land/std@0.208.0/assert/mod.ts';
import { MonitoringService } from './monitoring.service.ts';
import { ValidationService } from '../analysis/validation/validation.service.ts';
import { PerformanceCache } from '../performance_cache.ts';
import { Logger } from '../../utils/logger.ts';
import { z } from 'zod';

const logger = new Logger('integration-test', false);

Deno.test('Monitoring Integration - ValidationService', async () => {
    const monitoringService = new MonitoringService(logger);
    const validationService = new ValidationService(logger, monitoringService);
    
    // Use a schema that matches the validation service's transformers
    const reviewSchema = z.object({
        grade: z.enum(['A', 'B', 'C', 'D', 'F']),
        coverage: z.number(),
        testsPresent: z.boolean(),
        value: z.enum(['high', 'medium', 'low']),
        state: z.enum(['pass', 'warning', 'fail']),
        issues: z.array(z.any()).default([]),
        suggestions: z.array(z.string()).default([]),
        summary: z.string().default('Analysis completed')
    });
    
    // Test successful validation
    const validData = { 
        grade: 'A', 
        coverage: 85, 
        testsPresent: true, 
        value: 'high', 
        state: 'pass',
        issues: [],
        suggestions: ['Great code!'],
        summary: 'Excellent implementation'
    };
    const result1 = await validationService.validateWithTransformation(validData, reviewSchema);
    
    assertEquals(result1.success, true);
    
    // Test validation with transformation (string coverage and boolean)
    const dataWithTransformation = { 
        grade: 'B', 
        coverage: '75%', // String that should be transformed to number
        testsPresent: 'true', // String that should be transformed to boolean
        value: 'medium', 
        state: 'pass',
        issues: [],
        suggestions: ['Good code'],
        summary: 'Good implementation'
    };
    const result2 = await validationService.validateWithTransformation(dataWithTransformation, reviewSchema);
    
    assertEquals(result2.success, true);
    assertEquals(result2.data?.coverage, 75);
    assertEquals(result2.data?.testsPresent, true);
    
    // Check monitoring metrics
    const metrics = monitoringService.getSystemMetrics();
    assertEquals(metrics.validation.totalValidations, 2);
    assertEquals(metrics.validation.successfulValidations, 2);
    assert(metrics.validation.transformationsApplied >= 1);
});

Deno.test('Monitoring Integration - PerformanceCache', () => {
    const monitoringService = new MonitoringService(logger);
    const cache = new PerformanceCache(logger, 100, 60000, 1024 * 1024, monitoringService);
    
    const mockAnalysis = {
        grade: 'A' as const,
        coverage: 85,
        testsPresent: true,
        value: 'high' as const,
        state: 'pass' as const,
        issues: [],
        suggestions: ['Great code!'],
        summary: 'Excellent implementation'
    };
    
    const filePath = 'test.ts';
    const content = 'console.log("test");';
    
    // Test cache miss
    const result1 = cache.get(filePath, content);
    assertEquals(result1, null);
    
    // Test cache set
    cache.set(filePath, content, mockAnalysis);
    
    // Test cache hit
    const result2 = cache.get(filePath, content);
    assertExists(result2);
    assertEquals(result2.grade, 'A');
    
    // Test transformation cache
    cache.cacheTransformation({ test: 'data' }, 'test-transform', { transformed: true });
    const transformResult = cache.getTransformation({ test: 'data' }, 'test-transform');
    assertExists(transformResult);
    
    // Check that cache operations were recorded in monitoring
    const stats = monitoringService.getDetailedStats();
    const cacheEvents = stats.recentEvents.filter(event => event.type === 'cache');
    assert(cacheEvents.length > 0);
});

Deno.test('Monitoring Integration - System Health', () => {
    const monitoringService = new MonitoringService(logger);
    
    // Record some operations to test health calculation
    monitoringService.recordValidation(true, 100, ['coverage-transformer']);
    monitoringService.recordValidation(true, 150, [], true, true);
    monitoringService.recordAnalysis('file', true, 2000, 1, 'ollama');
    monitoringService.recordAnalysis('changes', true, 1500, 2, 'openai');
    
    const healthStatus = monitoringService.getHealthStatus();
    
    assertEquals(healthStatus.status, 'healthy');
    assert(healthStatus.score >= 85);
    assertEquals(healthStatus.issues.length, 0);
    assertEquals(healthStatus.recommendations.length, 0);
    
    // Test degraded health
    for (let i = 0; i < 10; i++) {
        monitoringService.recordValidation(false, 300, [], true, false, ['invalid_type']);
        monitoringService.recordAnalysis('pr', false, 8000, 1, 'ollama');
    }
    
    const degradedHealth = monitoringService.getHealthStatus();
    assert(degradedHealth.status === 'degraded' || degradedHealth.status === 'unhealthy');
    assert(degradedHealth.score < 85);
    assert(degradedHealth.issues.length > 0);
    assert(degradedHealth.recommendations.length > 0);
});

Deno.test('Monitoring Integration - Performance Timing', () => {
    const monitoringService = new MonitoringService(logger);
    
    // Test performance timing
    const timingId = monitoringService.startTiming('test_operation', { testData: 'value' });
    assertExists(timingId);
    
    // Simulate some work
    const duration = monitoringService.endTiming(timingId, true, { result: 'success' });
    assertExists(duration);
    assert(duration >= 0);
    
    // Check that performance event was recorded
    const stats = monitoringService.getDetailedStats();
    const performanceEvents = stats.recentEvents.filter(event => event.type === 'performance');
    assertEquals(performanceEvents.length, 1);
    assertEquals(performanceEvents[0].operation, 'test_operation');
    assertEquals(performanceEvents[0].success, true);
});

Deno.test('Monitoring Integration - Metrics Export and Import', () => {
    const monitoringService = new MonitoringService(logger);
    
    // Record some data
    monitoringService.recordValidation(true, 100, ['coverage-transformer']);
    monitoringService.recordAnalysis('file', true, 1500, 1, 'ollama');
    
    // Export metrics
    const exportData = monitoringService.exportData();
    assertExists(exportData);
    
    const parsed = JSON.parse(exportData);
    assertExists(parsed.metrics);
    assertExists(parsed.events);
    assertExists(parsed.exportTime);
    assertExists(parsed.uptime);
    
    assertEquals(parsed.metrics.validation.totalValidations, 1);
    assertEquals(parsed.metrics.analysis.totalAnalyses, 1);
    
    // Test reset
    monitoringService.reset();
    const metricsAfterReset = monitoringService.getSystemMetrics();
    assertEquals(metricsAfterReset.validation.totalValidations, 0);
    assertEquals(metricsAfterReset.analysis.totalAnalyses, 0);
});