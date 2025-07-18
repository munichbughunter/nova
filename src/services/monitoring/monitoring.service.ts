/**
 * Comprehensive Monitoring and Observability Service
 * 
 * This service provides centralized monitoring, metrics collection, and observability
 * features for the code review agent system, including validation errors, transformations,
 * cache performance, and analysis operations.
 */

import type { Logger } from '../../utils/logger.ts';
import type { CacheMetrics } from '../performance_cache.ts';
import type { ErrorMetrics } from '../error-handling/types.ts';
import type { ValidationResult } from '../analysis/validation/validation.service.ts';

/**
 * Validation metrics for monitoring transformation and error recovery
 */
export interface ValidationMetrics {
    totalValidations: number;
    successfulValidations: number;
    failedValidations: number;
    transformationsApplied: number;
    errorRecoveryAttempts: number;
    errorRecoverySuccesses: number;
    errorRecoveryFailures: number;
    
    // Transformation type breakdown
    transformationsByType: Record<string, number>;
    
    // Error type breakdown
    validationErrorsByType: Record<string, number>;
    
    // Performance metrics
    averageValidationTime: number;
    averageTransformationTime: number;
    averageRecoveryTime: number;
    
    // Success rates
    validationSuccessRate: number;
    transformationSuccessRate: number;
    errorRecoverySuccessRate: number;
    
    // Timing statistics
    lastValidationTime: Date | null;
    oldestValidationTime: Date | null;
}

/**
 * Analysis operation metrics
 */
export interface AnalysisMetrics {
    totalAnalyses: number;
    successfulAnalyses: number;
    failedAnalyses: number;
    
    // Analysis type breakdown
    analysesByType: Record<string, number>; // file, changes, pr
    
    // Performance metrics
    averageAnalysisTime: number;
    averageFileProcessingTime: number;
    averageLLMResponseTime: number;
    
    // File statistics
    totalFilesAnalyzed: number;
    averageFilesPerAnalysis: number;
    
    // LLM provider statistics
    llmProviderUsage: Record<string, number>;
    llmProviderErrors: Record<string, number>;
    
    // Success rates
    analysisSuccessRate: number;
    llmProviderSuccessRate: number;
    
    // Timing statistics
    lastAnalysisTime: Date | null;
    oldestAnalysisTime: Date | null;
}

/**
 * Performance timing entry for detailed tracking
 */
export interface PerformanceTiming {
    id: string;
    operation: string;
    startTime: Date;
    endTime?: Date;
    duration?: number;
    success?: boolean;
    metadata?: Record<string, unknown>;
}

/**
 * Comprehensive system metrics
 */
export interface SystemMetrics {
    validation: ValidationMetrics;
    analysis: AnalysisMetrics;
    cache: CacheMetrics;
    errors: ErrorMetrics;
    
    // System-wide statistics
    uptime: number;
    totalOperations: number;
    operationsPerMinute: number;
    memoryUsage: number;
    
    // Health indicators
    systemHealth: 'healthy' | 'degraded' | 'unhealthy';
    healthScore: number; // 0-100
    
    // Last update timestamp
    lastUpdated: Date;
}

/**
 * Event for monitoring system activities
 */
export interface MonitoringEvent {
    id: string;
    type: 'validation' | 'analysis' | 'cache' | 'error' | 'performance';
    operation: string;
    timestamp: Date;
    duration?: number;
    success: boolean;
    metadata: Record<string, unknown>;
    severity: 'low' | 'medium' | 'high' | 'critical';
}

/**
 * Main monitoring and observability service
 */
export class MonitoringService {
    private logger: Logger;
    private validationMetrics: ValidationMetrics;
    private analysisMetrics: AnalysisMetrics;
    private events: MonitoringEvent[] = [];
    private performanceTimings: Map<string, PerformanceTiming> = new Map();
    private maxEvents: number = 5000;
    private maxTimings: number = 1000;
    private startTime: Date;

    constructor(logger: Logger, maxEvents: number = 5000, maxTimings: number = 1000) {
        this.logger = logger.child('MonitoringService');
        this.maxEvents = maxEvents;
        this.maxTimings = maxTimings;
        this.startTime = new Date();
        
        this.validationMetrics = this.initializeValidationMetrics();
        this.analysisMetrics = this.initializeAnalysisMetrics();
        
        this.logger.info('Monitoring service initialized', {
            maxEvents,
            maxTimings,
            startTime: this.startTime.toISOString()
        });
    }

    /**
     * Record validation operation metrics
     */
    recordValidation(
        success: boolean,
        duration: number,
        transformationsApplied: string[] = [],
        errorRecoveryUsed: boolean = false,
        errorRecoverySuccess: boolean = false,
        validationErrors: string[] = []
    ): void {
        this.validationMetrics.totalValidations++;
        
        if (success) {
            this.validationMetrics.successfulValidations++;
        } else {
            this.validationMetrics.failedValidations++;
        }
        
        // Track transformations
        if (transformationsApplied.length > 0) {
            this.validationMetrics.transformationsApplied++;
            
            for (const transformation of transformationsApplied) {
                if (!this.validationMetrics.transformationsByType[transformation]) {
                    this.validationMetrics.transformationsByType[transformation] = 0;
                }
                this.validationMetrics.transformationsByType[transformation]++;
            }
        }
        
        // Track error recovery
        if (errorRecoveryUsed) {
            this.validationMetrics.errorRecoveryAttempts++;
            
            if (errorRecoverySuccess) {
                this.validationMetrics.errorRecoverySuccesses++;
            } else {
                this.validationMetrics.errorRecoveryFailures++;
            }
        }
        
        // Track validation errors by type
        for (const errorType of validationErrors) {
            if (!this.validationMetrics.validationErrorsByType[errorType]) {
                this.validationMetrics.validationErrorsByType[errorType] = 0;
            }
            this.validationMetrics.validationErrorsByType[errorType]++;
        }
        
        // Update timing metrics
        this.updateValidationTiming(duration);
        
        // Update success rates
        this.updateValidationSuccessRates();
        
        // Record monitoring event
        this.recordEvent({
            type: 'validation',
            operation: 'validate_data',
            success,
            duration,
            metadata: {
                transformationsApplied,
                errorRecoveryUsed,
                errorRecoverySuccess,
                validationErrors
            },
            severity: success ? 'low' : 'medium'
        });
        
        this.logger.debug('Recorded validation metrics', {
            success,
            duration,
            transformationsCount: transformationsApplied.length,
            errorRecoveryUsed,
            totalValidations: this.validationMetrics.totalValidations
        });
    }

    /**
     * Record analysis operation metrics
     */
    recordAnalysis(
        analysisType: 'file' | 'changes' | 'pr',
        success: boolean,
        duration: number,
        filesCount: number = 1,
        llmProvider?: string,
        llmResponseTime?: number,
        fileProcessingTime?: number
    ): void {
        this.analysisMetrics.totalAnalyses++;
        
        if (success) {
            this.analysisMetrics.successfulAnalyses++;
        } else {
            this.analysisMetrics.failedAnalyses++;
        }
        
        // Track analysis by type
        if (!this.analysisMetrics.analysesByType[analysisType]) {
            this.analysisMetrics.analysesByType[analysisType] = 0;
        }
        this.analysisMetrics.analysesByType[analysisType]++;
        
        // Track file statistics
        this.analysisMetrics.totalFilesAnalyzed += filesCount;
        
        // Track LLM provider usage
        if (llmProvider) {
            if (!this.analysisMetrics.llmProviderUsage[llmProvider]) {
                this.analysisMetrics.llmProviderUsage[llmProvider] = 0;
            }
            this.analysisMetrics.llmProviderUsage[llmProvider]++;
            
            if (!success) {
                if (!this.analysisMetrics.llmProviderErrors[llmProvider]) {
                    this.analysisMetrics.llmProviderErrors[llmProvider] = 0;
                }
                this.analysisMetrics.llmProviderErrors[llmProvider]++;
            }
        }
        
        // Update timing metrics
        this.updateAnalysisTiming(duration, llmResponseTime, fileProcessingTime);
        
        // Update success rates and averages
        this.updateAnalysisSuccessRates();
        this.updateAnalysisAverages();
        
        // Record monitoring event
        this.recordEvent({
            type: 'analysis',
            operation: `analyze_${analysisType}`,
            success,
            duration,
            metadata: {
                analysisType,
                filesCount,
                llmProvider,
                llmResponseTime,
                fileProcessingTime
            },
            severity: success ? 'low' : 'high'
        });
        
        this.logger.debug('Recorded analysis metrics', {
            analysisType,
            success,
            duration,
            filesCount,
            llmProvider,
            totalAnalyses: this.analysisMetrics.totalAnalyses
        });
    }

    /**
     * Start performance timing for an operation
     */
    startTiming(operation: string, metadata?: Record<string, unknown>): string {
        const id = this.generateTimingId();
        const timing: PerformanceTiming = {
            id,
            operation,
            startTime: new Date(),
            metadata
        };
        
        this.performanceTimings.set(id, timing);
        
        // Clean up old timings if we exceed the limit
        if (this.performanceTimings.size > this.maxTimings) {
            this.cleanupOldTimings();
        }
        
        this.logger.debug('Started performance timing', { id, operation });
        return id;
    }

    /**
     * End performance timing for an operation
     */
    endTiming(id: string, success: boolean = true, additionalMetadata?: Record<string, unknown>): number | null {
        const timing = this.performanceTimings.get(id);
        if (!timing) {
            this.logger.warn('Timing not found', { id });
            return null;
        }
        
        const endTime = new Date();
        const duration = endTime.getTime() - timing.startTime.getTime();
        
        timing.endTime = endTime;
        timing.duration = duration;
        timing.success = success;
        
        if (additionalMetadata) {
            timing.metadata = { ...timing.metadata, ...additionalMetadata };
        }
        
        // Record performance event
        this.recordEvent({
            type: 'performance',
            operation: timing.operation,
            success,
            duration,
            metadata: timing.metadata || {},
            severity: duration > 10000 ? 'high' : duration > 5000 ? 'medium' : 'low'
        });
        
        this.logger.debug('Ended performance timing', {
            id,
            operation: timing.operation,
            duration,
            success
        });
        
        return duration;
    }

    /**
     * Record cache operation metrics
     */
    recordCacheOperation(
        operation: 'hit' | 'miss' | 'set' | 'evict',
        cacheType: 'analysis' | 'transformation',
        duration?: number,
        metadata?: Record<string, unknown>
    ): void {
        this.recordEvent({
            type: 'cache',
            operation: `cache_${operation}`,
            success: true,
            duration,
            metadata: {
                cacheType,
                ...metadata
            },
            severity: 'low'
        });
        
        this.logger.debug('Recorded cache operation', {
            operation,
            cacheType,
            duration
        });
    }

    /**
     * Get comprehensive system metrics
     */
    getSystemMetrics(cacheMetrics?: CacheMetrics, errorMetrics?: ErrorMetrics): SystemMetrics {
        const now = new Date();
        const uptime = now.getTime() - this.startTime.getTime();
        const totalOperations = this.validationMetrics.totalValidations + this.analysisMetrics.totalAnalyses;
        const operationsPerMinute = totalOperations > 0 ? (totalOperations / (uptime / 60000)) : 0;
        
        // Calculate system health
        const healthScore = this.calculateSystemHealthScore();
        const systemHealth = this.determineSystemHealth(healthScore);
        
        return {
            validation: { ...this.validationMetrics },
            analysis: { ...this.analysisMetrics },
            cache: cacheMetrics || this.getDefaultCacheMetrics(),
            errors: errorMetrics || this.getDefaultErrorMetrics(),
            uptime,
            totalOperations,
            operationsPerMinute,
            memoryUsage: this.estimateMemoryUsage(),
            systemHealth,
            healthScore,
            lastUpdated: now
        };
    }

    /**
     * Get detailed monitoring statistics
     */
    getDetailedStats(): {
        metrics: SystemMetrics;
        recentEvents: MonitoringEvent[];
        performanceTimings: PerformanceTiming[];
        topOperations: Array<{ operation: string; count: number; averageDuration: number }>;
        errorSummary: Array<{ type: string; count: number; percentage: number }>;
    } {
        const metrics = this.getSystemMetrics();
        
        // Get recent events (last 100)
        const recentEvents = this.events
            .slice(-100)
            .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
        
        // Get completed performance timings
        const performanceTimings = Array.from(this.performanceTimings.values())
            .filter(timing => timing.endTime)
            .sort((a, b) => (b.endTime?.getTime() || 0) - (a.endTime?.getTime() || 0))
            .slice(0, 50);
        
        // Calculate top operations by frequency and performance
        const operationStats = this.calculateOperationStats();
        
        // Calculate error summary
        const errorSummary = this.calculateErrorSummary();
        
        return {
            metrics,
            recentEvents,
            performanceTimings,
            topOperations: operationStats,
            errorSummary
        };
    }

    /**
     * Export monitoring data to JSON
     */
    exportData(): string {
        const exportData = {
            metrics: this.getSystemMetrics(),
            events: this.events,
            performanceTimings: Array.from(this.performanceTimings.values()),
            exportTime: new Date().toISOString(),
            uptime: new Date().getTime() - this.startTime.getTime()
        };
        
        return JSON.stringify(exportData, null, 2);
    }

    /**
     * Reset all monitoring data
     */
    reset(): void {
        this.validationMetrics = this.initializeValidationMetrics();
        this.analysisMetrics = this.initializeAnalysisMetrics();
        this.events = [];
        this.performanceTimings.clear();
        this.startTime = new Date();
        
        this.logger.info('Monitoring data reset');
    }

    /**
     * Get health status of the system
     */
    getHealthStatus(): {
        status: 'healthy' | 'degraded' | 'unhealthy';
        score: number;
        issues: string[];
        recommendations: string[];
    } {
        const score = this.calculateSystemHealthScore();
        const status = this.determineSystemHealth(score);
        const issues: string[] = [];
        const recommendations: string[] = [];
        
        // Check validation health
        if (this.validationMetrics.validationSuccessRate < 90) {
            issues.push(`Low validation success rate: ${this.validationMetrics.validationSuccessRate.toFixed(1)}%`);
            recommendations.push('Review validation schemas and transformation logic');
        }
        
        // Check analysis health
        if (this.analysisMetrics.analysisSuccessRate < 85) {
            issues.push(`Low analysis success rate: ${this.analysisMetrics.analysisSuccessRate.toFixed(1)}%`);
            recommendations.push('Check LLM provider connectivity and error handling');
        }
        
        // Check error recovery health
        if (this.validationMetrics.errorRecoverySuccessRate < 70) {
            issues.push(`Low error recovery success rate: ${this.validationMetrics.errorRecoverySuccessRate.toFixed(1)}%`);
            recommendations.push('Enhance error recovery strategies');
        }
        
        // Check performance
        if (this.analysisMetrics.averageAnalysisTime > 30000) {
            issues.push(`High average analysis time: ${(this.analysisMetrics.averageAnalysisTime / 1000).toFixed(1)}s`);
            recommendations.push('Optimize analysis pipeline and consider caching improvements');
        }
        
        return {
            status,
            score,
            issues,
            recommendations
        };
    }

    /**
     * Initialize validation metrics
     */
    private initializeValidationMetrics(): ValidationMetrics {
        return {
            totalValidations: 0,
            successfulValidations: 0,
            failedValidations: 0,
            transformationsApplied: 0,
            errorRecoveryAttempts: 0,
            errorRecoverySuccesses: 0,
            errorRecoveryFailures: 0,
            transformationsByType: {},
            validationErrorsByType: {},
            averageValidationTime: 0,
            averageTransformationTime: 0,
            averageRecoveryTime: 0,
            validationSuccessRate: 0,
            transformationSuccessRate: 0,
            errorRecoverySuccessRate: 0,
            lastValidationTime: null,
            oldestValidationTime: null
        };
    }

    /**
     * Initialize analysis metrics
     */
    private initializeAnalysisMetrics(): AnalysisMetrics {
        return {
            totalAnalyses: 0,
            successfulAnalyses: 0,
            failedAnalyses: 0,
            analysesByType: {},
            averageAnalysisTime: 0,
            averageFileProcessingTime: 0,
            averageLLMResponseTime: 0,
            totalFilesAnalyzed: 0,
            averageFilesPerAnalysis: 0,
            llmProviderUsage: {},
            llmProviderErrors: {},
            analysisSuccessRate: 0,
            llmProviderSuccessRate: 0,
            lastAnalysisTime: null,
            oldestAnalysisTime: null
        };
    }

    /**
     * Record a monitoring event
     */
    private recordEvent(eventData: Omit<MonitoringEvent, 'id' | 'timestamp'>): void {
        const event: MonitoringEvent = {
            id: this.generateEventId(),
            timestamp: new Date(),
            ...eventData
        };
        
        this.events.push(event);
        
        // Keep only the most recent events
        if (this.events.length > this.maxEvents) {
            this.events = this.events.slice(-this.maxEvents);
        }
    }

    /**
     * Update validation timing metrics
     */
    private updateValidationTiming(duration: number): void {
        const now = new Date();
        
        if (this.validationMetrics.totalValidations === 1) {
            this.validationMetrics.averageValidationTime = duration;
            this.validationMetrics.oldestValidationTime = now;
        } else {
            // Calculate running average
            const totalTime = this.validationMetrics.averageValidationTime * (this.validationMetrics.totalValidations - 1);
            this.validationMetrics.averageValidationTime = (totalTime + duration) / this.validationMetrics.totalValidations;
        }
        
        this.validationMetrics.lastValidationTime = now;
    }

    /**
     * Update analysis timing metrics
     */
    private updateAnalysisTiming(duration: number, llmResponseTime?: number, fileProcessingTime?: number): void {
        const now = new Date();
        
        if (this.analysisMetrics.totalAnalyses === 1) {
            this.analysisMetrics.averageAnalysisTime = duration;
            this.analysisMetrics.oldestAnalysisTime = now;
        } else {
            // Calculate running average
            const totalTime = this.analysisMetrics.averageAnalysisTime * (this.analysisMetrics.totalAnalyses - 1);
            this.analysisMetrics.averageAnalysisTime = (totalTime + duration) / this.analysisMetrics.totalAnalyses;
        }
        
        if (llmResponseTime !== undefined) {
            if (this.analysisMetrics.averageLLMResponseTime === 0) {
                this.analysisMetrics.averageLLMResponseTime = llmResponseTime;
            } else {
                const totalLLMTime = this.analysisMetrics.averageLLMResponseTime * (this.analysisMetrics.totalAnalyses - 1);
                this.analysisMetrics.averageLLMResponseTime = (totalLLMTime + llmResponseTime) / this.analysisMetrics.totalAnalyses;
            }
        }
        
        if (fileProcessingTime !== undefined) {
            if (this.analysisMetrics.averageFileProcessingTime === 0) {
                this.analysisMetrics.averageFileProcessingTime = fileProcessingTime;
            } else {
                const totalFileTime = this.analysisMetrics.averageFileProcessingTime * (this.analysisMetrics.totalAnalyses - 1);
                this.analysisMetrics.averageFileProcessingTime = (totalFileTime + fileProcessingTime) / this.analysisMetrics.totalAnalyses;
            }
        }
        
        this.analysisMetrics.lastAnalysisTime = now;
    }

    /**
     * Update validation success rates
     */
    private updateValidationSuccessRates(): void {
        if (this.validationMetrics.totalValidations > 0) {
            this.validationMetrics.validationSuccessRate = 
                (this.validationMetrics.successfulValidations / this.validationMetrics.totalValidations) * 100;
        }
        
        if (this.validationMetrics.transformationsApplied > 0) {
            this.validationMetrics.transformationSuccessRate = 
                (this.validationMetrics.successfulValidations / this.validationMetrics.transformationsApplied) * 100;
        }
        
        if (this.validationMetrics.errorRecoveryAttempts > 0) {
            this.validationMetrics.errorRecoverySuccessRate = 
                (this.validationMetrics.errorRecoverySuccesses / this.validationMetrics.errorRecoveryAttempts) * 100;
        }
    }

    /**
     * Update analysis success rates
     */
    private updateAnalysisSuccessRates(): void {
        if (this.analysisMetrics.totalAnalyses > 0) {
            this.analysisMetrics.analysisSuccessRate = 
                (this.analysisMetrics.successfulAnalyses / this.analysisMetrics.totalAnalyses) * 100;
        }
        
        const totalLLMOperations = Object.values(this.analysisMetrics.llmProviderUsage).reduce((sum, count) => sum + count, 0);
        const totalLLMErrors = Object.values(this.analysisMetrics.llmProviderErrors).reduce((sum, count) => sum + count, 0);
        
        if (totalLLMOperations > 0) {
            this.analysisMetrics.llmProviderSuccessRate = 
                ((totalLLMOperations - totalLLMErrors) / totalLLMOperations) * 100;
        }
    }

    /**
     * Update analysis averages
     */
    private updateAnalysisAverages(): void {
        if (this.analysisMetrics.totalAnalyses > 0) {
            this.analysisMetrics.averageFilesPerAnalysis = 
                this.analysisMetrics.totalFilesAnalyzed / this.analysisMetrics.totalAnalyses;
        }
    }

    /**
     * Calculate system health score (0-100)
     */
    private calculateSystemHealthScore(): number {
        let score = 100;
        
        // Validation health (30% weight)
        const validationScore = this.validationMetrics.validationSuccessRate * 0.3;
        
        // Analysis health (40% weight)
        const analysisScore = this.analysisMetrics.analysisSuccessRate * 0.4;
        
        // Error recovery health (20% weight)
        const recoveryScore = this.validationMetrics.errorRecoverySuccessRate * 0.2;
        
        // Performance health (10% weight)
        let performanceScore = 10;
        if (this.analysisMetrics.averageAnalysisTime > 30000) {
            performanceScore = 5;
        } else if (this.analysisMetrics.averageAnalysisTime > 15000) {
            performanceScore = 7;
        }
        
        score = validationScore + analysisScore + recoveryScore + performanceScore;
        
        return Math.max(0, Math.min(100, score));
    }

    /**
     * Determine system health status based on score
     */
    private determineSystemHealth(score: number): 'healthy' | 'degraded' | 'unhealthy' {
        if (score >= 85) return 'healthy';
        if (score >= 60) return 'degraded';
        return 'unhealthy';
    }

    /**
     * Calculate operation statistics
     */
    private calculateOperationStats(): Array<{ operation: string; count: number; averageDuration: number }> {
        const operationMap = new Map<string, { count: number; totalDuration: number }>();
        
        for (const event of this.events) {
            if (event.duration !== undefined) {
                const existing = operationMap.get(event.operation) || { count: 0, totalDuration: 0 };
                existing.count++;
                existing.totalDuration += event.duration;
                operationMap.set(event.operation, existing);
            }
        }
        
        return Array.from(operationMap.entries())
            .map(([operation, stats]) => ({
                operation,
                count: stats.count,
                averageDuration: stats.totalDuration / stats.count
            }))
            .sort((a, b) => b.count - a.count)
            .slice(0, 10);
    }

    /**
     * Calculate error summary
     */
    private calculateErrorSummary(): Array<{ type: string; count: number; percentage: number }> {
        const errorEvents = this.events.filter(event => !event.success);
        const totalErrors = errorEvents.length;
        
        if (totalErrors === 0) {
            return [];
        }
        
        const errorMap = new Map<string, number>();
        
        for (const event of errorEvents) {
            const count = errorMap.get(event.operation) || 0;
            errorMap.set(event.operation, count + 1);
        }
        
        return Array.from(errorMap.entries())
            .map(([type, count]) => ({
                type,
                count,
                percentage: (count / totalErrors) * 100
            }))
            .sort((a, b) => b.count - a.count);
    }

    /**
     * Clean up old performance timings
     */
    private cleanupOldTimings(): void {
        const timings = Array.from(this.performanceTimings.entries());
        timings.sort((a, b) => a[1].startTime.getTime() - b[1].startTime.getTime());
        
        // Remove oldest 20% of timings
        const toRemove = Math.floor(timings.length * 0.2);
        for (let i = 0; i < toRemove; i++) {
            this.performanceTimings.delete(timings[i][0]);
        }
    }

    /**
     * Estimate memory usage
     */
    private estimateMemoryUsage(): number {
        const eventsSize = this.events.length * 500; // Rough estimate per event
        const timingsSize = this.performanceTimings.size * 300; // Rough estimate per timing
        const metricsSize = 10000; // Rough estimate for metrics objects
        
        return eventsSize + timingsSize + metricsSize;
    }

    /**
     * Get default cache metrics when not provided
     */
    private getDefaultCacheMetrics(): CacheMetrics {
        return {
            totalRequests: 0,
            cacheHits: 0,
            cacheMisses: 0,
            hitRate: 0,
            totalEntries: 0,
            maxEntries: 0,
            memoryUsage: 0,
            maxMemoryUsage: 0,
            averageAccessTime: 0,
            evictionCount: 0,
            transformationCacheHits: 0,
            transformationCacheMisses: 0,
            fileChangeDetections: 0,
            expiredEntries: 0,
            oldestEntryAge: 0,
            newestEntryAge: 0
        };
    }

    /**
     * Get default error metrics when not provided
     */
    private getDefaultErrorMetrics(): ErrorMetrics {
        return {
            totalErrors: 0,
            errorsByType: {},
            errorsByOperation: {},
            retryAttempts: 0,
            successfulRetries: 0,
            failedRetries: 0,
            fallbacksUsed: 0,
            fallbackSuccesses: 0,
            fallbackFailures: 0,
            averageRetryDelay: 0,
            errorRecoveryRate: 0,
            lastResetTime: new Date()
        };
    }

    /**
     * Generate unique event ID
     */
    private generateEventId(): string {
        return `event_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    /**
     * Generate unique timing ID
     */
    private generateTimingId(): string {
        return `timing_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }
}

/**
 * Factory function to create a MonitoringService
 */
export function createMonitoringService(
    logger: Logger,
    maxEvents?: number,
    maxTimings?: number
): MonitoringService {
    return new MonitoringService(logger, maxEvents, maxTimings);
}