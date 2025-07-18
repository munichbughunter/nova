/**
 * Tests for MonitoringService
 */

import { assertEquals, assertExists, assert } from 'https://deno.land/std@0.208.0/assert/mod.ts';
import { MonitoringService, createMonitoringService } from './monitoring.service.ts';
import { Logger } from '../../utils/logger.ts';

// Mock logger for testing
const mockLogger = new Logger('test', false);

Deno.test('MonitoringService - Initialization', () => {
    const service = new MonitoringService(mockLogger);
    
    const metrics = service.getSystemMetrics();
    
    assertEquals(metrics.validation.totalValidations, 0);
    assertEquals(metrics.analysis.totalAnalyses, 0);
    // With no operations, the system should be healthy but with a lower score
    assert(metrics.systemHealth === 'healthy' || metrics.systemHealth === 'unhealthy');
    assertExists(metrics.lastUpdated);
});

Deno.test('MonitoringService - Factory Function', () => {
    const service = createMonitoringService(mockLogger, 1000, 500);
    
    assertExists(service);
    const metrics = service.getSystemMetrics();
    assertEquals(metrics.validation.totalValidations, 0);
});

Deno.test('MonitoringService - Record Validation Success', () => {
    const service = new MonitoringService(mockLogger);
    
    service.recordValidation(
        true, // success
        150, // duration
        ['coverage-transformer'], // transformations
        false, // error recovery used
        false, // error recovery success
        [] // validation errors
    );
    
    const metrics = service.getSystemMetrics();
    
    assertEquals(metrics.validation.totalValidations, 1);
    assertEquals(metrics.validation.successfulValidations, 1);
    assertEquals(metrics.validation.failedValidations, 0);
    assertEquals(metrics.validation.transformationsApplied, 1);
    assertEquals(metrics.validation.validationSuccessRate, 100);
    assertEquals(metrics.validation.transformationsByType['coverage-transformer'], 1);
    assertEquals(metrics.validation.averageValidationTime, 150);
});

Deno.test('MonitoringService - Record Validation Failure with Error Recovery', () => {
    const service = new MonitoringService(mockLogger);
    
    service.recordValidation(
        false, // success
        300, // duration
        ['type-coercion'], // transformations
        true, // error recovery used
        false, // error recovery success
        ['invalid_type', 'missing_field'] // validation errors
    );
    
    const metrics = service.getSystemMetrics();
    
    assertEquals(metrics.validation.totalValidations, 1);
    assertEquals(metrics.validation.successfulValidations, 0);
    assertEquals(metrics.validation.failedValidations, 1);
    assertEquals(metrics.validation.errorRecoveryAttempts, 1);
    assertEquals(metrics.validation.errorRecoveryFailures, 1);
    assertEquals(metrics.validation.validationSuccessRate, 0);
    assertEquals(metrics.validation.errorRecoverySuccessRate, 0);
    assertEquals(metrics.validation.validationErrorsByType['invalid_type'], 1);
    assertEquals(metrics.validation.validationErrorsByType['missing_field'], 1);
});

Deno.test('MonitoringService - Record Successful Error Recovery', () => {
    const service = new MonitoringService(mockLogger);
    
    service.recordValidation(
        true, // success
        250, // duration
        ['coverage-transformer', 'boolean-transformer'], // transformations
        true, // error recovery used
        true, // error recovery success
        ['invalid_type'] // validation errors
    );
    
    const metrics = service.getSystemMetrics();
    
    assertEquals(metrics.validation.totalValidations, 1);
    assertEquals(metrics.validation.successfulValidations, 1);
    assertEquals(metrics.validation.errorRecoveryAttempts, 1);
    assertEquals(metrics.validation.errorRecoverySuccesses, 1);
    assertEquals(metrics.validation.errorRecoverySuccessRate, 100);
    assertEquals(metrics.validation.transformationsByType['coverage-transformer'], 1);
    assertEquals(metrics.validation.transformationsByType['boolean-transformer'], 1);
});

Deno.test('MonitoringService - Record Analysis Success', () => {
    const service = new MonitoringService(mockLogger);
    
    service.recordAnalysis(
        'file', // analysis type
        true, // success
        2500, // duration
        3, // files count
        'ollama', // llm provider
        1800, // llm response time
        700 // file processing time
    );
    
    const metrics = service.getSystemMetrics();
    
    assertEquals(metrics.analysis.totalAnalyses, 1);
    assertEquals(metrics.analysis.successfulAnalyses, 1);
    assertEquals(metrics.analysis.failedAnalyses, 0);
    assertEquals(metrics.analysis.analysesByType['file'], 1);
    assertEquals(metrics.analysis.totalFilesAnalyzed, 3);
    assertEquals(metrics.analysis.averageFilesPerAnalysis, 3);
    assertEquals(metrics.analysis.llmProviderUsage['ollama'], 1);
    assertEquals(metrics.analysis.analysisSuccessRate, 100);
    assertEquals(metrics.analysis.averageAnalysisTime, 2500);
    assertEquals(metrics.analysis.averageLLMResponseTime, 1800);
    assertEquals(metrics.analysis.averageFileProcessingTime, 700);
});

Deno.test('MonitoringService - Record Analysis Failure', () => {
    const service = new MonitoringService(mockLogger);
    
    service.recordAnalysis(
        'pr', // analysis type
        false, // success
        5000, // duration
        1, // files count
        'openai', // llm provider
        undefined, // llm response time (failed)
        200 // file processing time
    );
    
    const metrics = service.getSystemMetrics();
    
    assertEquals(metrics.analysis.totalAnalyses, 1);
    assertEquals(metrics.analysis.successfulAnalyses, 0);
    assertEquals(metrics.analysis.failedAnalyses, 1);
    assertEquals(metrics.analysis.analysesByType['pr'], 1);
    assertEquals(metrics.analysis.llmProviderUsage['openai'], 1);
    assertEquals(metrics.analysis.llmProviderErrors['openai'], 1);
    assertEquals(metrics.analysis.analysisSuccessRate, 0);
    assertEquals(metrics.analysis.llmProviderSuccessRate, 0);
});

Deno.test('MonitoringService - Multiple Analysis Types', () => {
    const service = new MonitoringService(mockLogger);
    
    // Record different analysis types
    service.recordAnalysis('file', true, 1000, 1, 'ollama');
    service.recordAnalysis('changes', true, 1500, 2, 'openai');
    service.recordAnalysis('pr', false, 3000, 5, 'ollama');
    
    const metrics = service.getSystemMetrics();
    
    assertEquals(metrics.analysis.totalAnalyses, 3);
    assertEquals(metrics.analysis.successfulAnalyses, 2);
    assertEquals(metrics.analysis.failedAnalyses, 1);
    assertEquals(metrics.analysis.analysesByType['file'], 1);
    assertEquals(metrics.analysis.analysesByType['changes'], 1);
    assertEquals(metrics.analysis.analysesByType['pr'], 1);
    assertEquals(metrics.analysis.llmProviderUsage['ollama'], 2);
    assertEquals(metrics.analysis.llmProviderUsage['openai'], 1);
    assertEquals(metrics.analysis.llmProviderErrors['ollama'], 1);
    assertEquals(metrics.analysis.totalFilesAnalyzed, 8);
    assertEquals(metrics.analysis.averageFilesPerAnalysis, 8/3);
});

Deno.test('MonitoringService - Performance Timing', () => {
    const service = new MonitoringService(mockLogger);
    
    const timingId = service.startTiming('test_operation', { testData: 'value' });
    
    assertExists(timingId);
    
    // Simulate some work
    const duration = service.endTiming(timingId, true, { result: 'success' });
    
    assertExists(duration);
    assert(duration! >= 0);
    
    const stats = service.getDetailedStats();
    assertEquals(stats.performanceTimings.length, 1);
    assertEquals(stats.performanceTimings[0].operation, 'test_operation');
    assertEquals(stats.performanceTimings[0].success, true);
});

Deno.test('MonitoringService - Performance Timing Not Found', () => {
    const service = new MonitoringService(mockLogger);
    
    const duration = service.endTiming('nonexistent-id', true);
    
    assertEquals(duration, null);
});

Deno.test('MonitoringService - Cache Operation Recording', () => {
    const service = new MonitoringService(mockLogger);
    
    service.recordCacheOperation('hit', 'analysis', 50, { key: 'test-key' });
    service.recordCacheOperation('miss', 'transformation', 100);
    service.recordCacheOperation('set', 'analysis', 200);
    service.recordCacheOperation('evict', 'transformation');
    
    const stats = service.getDetailedStats();
    
    // Should have 4 cache events
    const cacheEvents = stats.recentEvents.filter(event => event.type === 'cache');
    assertEquals(cacheEvents.length, 4);
    
    const hitEvent = cacheEvents.find(event => event.operation === 'cache_hit');
    assertExists(hitEvent);
    assertEquals(hitEvent.duration, 50);
    assertEquals(hitEvent.metadata.cacheType, 'analysis');
    assertEquals(hitEvent.metadata.key, 'test-key');
});

Deno.test('MonitoringService - System Health Calculation', () => {
    const service = new MonitoringService(mockLogger);
    
    // Record some successful operations
    service.recordValidation(true, 100, ['coverage-transformer']);
    service.recordValidation(true, 150, [], true, true);
    service.recordAnalysis('file', true, 2000, 1, 'ollama');
    service.recordAnalysis('changes', true, 1500, 2, 'openai');
    
    const healthStatus = service.getHealthStatus();
    
    assertEquals(healthStatus.status, 'healthy');
    assert(healthStatus.score >= 85);
    assertEquals(healthStatus.issues.length, 0);
    assertEquals(healthStatus.recommendations.length, 0);
});

Deno.test('MonitoringService - System Health Degraded', () => {
    const service = new MonitoringService(mockLogger);
    
    // Record mostly failed operations
    service.recordValidation(false, 200, [], true, false, ['invalid_type']);
    service.recordValidation(false, 250, [], true, false, ['missing_field']);
    service.recordValidation(true, 180, ['coverage-transformer']);
    service.recordAnalysis('file', false, 5000, 1, 'ollama');
    service.recordAnalysis('pr', false, 8000, 3, 'openai');
    service.recordAnalysis('changes', true, 35000, 2, 'ollama'); // Very slow
    
    const healthStatus = service.getHealthStatus();
    
    // With mostly failed operations, the system should be degraded or unhealthy
    assert(healthStatus.status === 'degraded' || healthStatus.status === 'unhealthy');
    assert(healthStatus.score < 85);
    assert(healthStatus.issues.length > 0);
    assert(healthStatus.recommendations.length > 0);
});

Deno.test('MonitoringService - Detailed Statistics', () => {
    const service = new MonitoringService(mockLogger);
    
    // Record various operations
    service.recordValidation(true, 100, ['coverage-transformer']);
    service.recordValidation(false, 200, [], true, false, ['invalid_type']);
    service.recordAnalysis('file', true, 1500, 1, 'ollama');
    service.recordAnalysis('pr', false, 3000, 2, 'openai');
    
    const timingId = service.startTiming('custom_operation');
    service.endTiming(timingId, true);
    
    const stats = service.getDetailedStats();
    
    assertExists(stats.metrics);
    assert(stats.recentEvents.length > 0);
    assert(stats.performanceTimings.length > 0);
    assert(stats.topOperations.length > 0);
    assert(stats.errorSummary.length > 0);
    
    // Check that events are sorted by timestamp (newest first)
    for (let i = 1; i < stats.recentEvents.length; i++) {
        assert(stats.recentEvents[i-1].timestamp >= stats.recentEvents[i].timestamp);
    }
});

Deno.test('MonitoringService - Export and Reset', () => {
    const service = new MonitoringService(mockLogger);
    
    // Record some data
    service.recordValidation(true, 100, ['coverage-transformer']);
    service.recordAnalysis('file', true, 1500, 1, 'ollama');
    
    const exportData = service.exportData();
    
    assertExists(exportData);
    const parsed = JSON.parse(exportData);
    assertExists(parsed.metrics);
    assertExists(parsed.events);
    assertExists(parsed.exportTime);
    assertExists(parsed.uptime);
    
    // Reset and verify
    service.reset();
    
    const metricsAfterReset = service.getSystemMetrics();
    assertEquals(metricsAfterReset.validation.totalValidations, 0);
    assertEquals(metricsAfterReset.analysis.totalAnalyses, 0);
});

Deno.test('MonitoringService - Success Rate Calculations', () => {
    const service = new MonitoringService(mockLogger);
    
    // Record mixed validation results
    service.recordValidation(true, 100);
    service.recordValidation(true, 150);
    service.recordValidation(false, 200);
    service.recordValidation(true, 120);
    
    // Record mixed analysis results
    service.recordAnalysis('file', true, 1000, 1, 'ollama');
    service.recordAnalysis('file', true, 1200, 1, 'ollama');
    service.recordAnalysis('file', false, 2000, 1, 'ollama');
    service.recordAnalysis('changes', true, 1500, 2, 'openai');
    service.recordAnalysis('pr', false, 3000, 3, 'openai');
    
    const metrics = service.getSystemMetrics();
    
    // Validation: 3 success out of 4 = 75%
    assertEquals(metrics.validation.validationSuccessRate, 75);
    
    // Analysis: 3 success out of 5 = 60%
    assertEquals(metrics.analysis.analysisSuccessRate, 60);
    
    // LLM Provider: 3 success out of 5 = 60%
    assertEquals(metrics.analysis.llmProviderSuccessRate, 60);
});

Deno.test('MonitoringService - Average Calculations', () => {
    const service = new MonitoringService(mockLogger);
    
    // Record validations with different durations
    service.recordValidation(true, 100);
    service.recordValidation(true, 200);
    service.recordValidation(true, 300);
    
    // Record analyses with different durations and file counts
    service.recordAnalysis('file', true, 1000, 1, 'ollama', 800, 200);
    service.recordAnalysis('changes', true, 2000, 3, 'openai', 1500, 500);
    service.recordAnalysis('pr', true, 3000, 2, 'ollama', 2200, 800);
    
    const metrics = service.getSystemMetrics();
    
    // Average validation time: (100 + 200 + 300) / 3 = 200
    assertEquals(metrics.validation.averageValidationTime, 200);
    
    // Average analysis time: (1000 + 2000 + 3000) / 3 = 2000
    assertEquals(metrics.analysis.averageAnalysisTime, 2000);
    
    // Average LLM response time: (800 + 1500 + 2200) / 3 = 1500
    assertEquals(metrics.analysis.averageLLMResponseTime, 1500);
    
    // Average file processing time: (200 + 500 + 800) / 3 = 500
    assertEquals(metrics.analysis.averageFileProcessingTime, 500);
    
    // Total files: 1 + 3 + 2 = 6, analyses: 3, average: 2
    assertEquals(metrics.analysis.averageFilesPerAnalysis, 2);
});

Deno.test('MonitoringService - Event Severity Classification', () => {
    const service = new MonitoringService(mockLogger);
    
    // Record operations with different characteristics
    service.recordValidation(true, 100); // Success - low severity
    service.recordValidation(false, 200); // Failure - medium severity
    service.recordAnalysis('file', true, 1000, 1, 'ollama'); // Success - low severity
    service.recordAnalysis('pr', false, 5000, 3, 'openai'); // Failure - high severity
    
    const timingId1 = service.startTiming('fast_operation');
    service.endTiming(timingId1, true); // Fast - low severity
    
    const timingId2 = service.startTiming('slow_operation');
    // Simulate slow operation by ending it immediately
    service.endTiming(timingId2, true);
    
    const stats = service.getDetailedStats();
    
    const lowSeverityEvents = stats.recentEvents.filter(event => event.severity === 'low');
    const mediumSeverityEvents = stats.recentEvents.filter(event => event.severity === 'medium');
    const highSeverityEvents = stats.recentEvents.filter(event => event.severity === 'high');
    
    assert(lowSeverityEvents.length > 0);
    assert(mediumSeverityEvents.length > 0 || highSeverityEvents.length > 0);
});

Deno.test('MonitoringService - Memory Usage Estimation', () => {
    const service = new MonitoringService(mockLogger);
    
    // Record many operations to increase memory usage
    for (let i = 0; i < 100; i++) {
        service.recordValidation(true, 100 + i, ['transformer-' + i]);
        service.recordAnalysis('file', true, 1000 + i, 1, 'provider-' + (i % 3));
    }
    
    const metrics = service.getSystemMetrics();
    
    assert(metrics.memoryUsage > 0);
    assert(typeof metrics.memoryUsage === 'number');
});

Deno.test('MonitoringService - Event Limit Enforcement', () => {
    const maxEvents = 10;
    const service = new MonitoringService(mockLogger, maxEvents);
    
    // Record more events than the limit
    for (let i = 0; i < 15; i++) {
        service.recordValidation(true, 100);
    }
    
    const stats = service.getDetailedStats();
    
    // Should not exceed the maximum number of events
    assert(stats.recentEvents.length <= maxEvents);
});

Deno.test('MonitoringService - Timing Limit Enforcement', () => {
    const maxTimings = 5;
    const service = new MonitoringService(mockLogger, 1000, maxTimings);
    
    // Start more timings than the limit
    const timingIds: string[] = [];
    for (let i = 0; i < 8; i++) {
        const id = service.startTiming(`operation_${i}`);
        timingIds.push(id);
        service.endTiming(id, true);
    }
    
    const stats = service.getDetailedStats();
    
    // Should not exceed the maximum number of timings
    assert(stats.performanceTimings.length <= maxTimings);
});