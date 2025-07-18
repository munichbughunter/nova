/**
 * Error Metrics Collection Service
 * 
 * This service collects and tracks error metrics, recovery rates,
 * and performance statistics for the error handling framework.
 */

import type { Logger } from '../../utils/logger.ts';
import { ErrorMetrics, ErrorContext, ErrorResolution, ErrorEvent, ErrorType, ErrorSeverity } from './types.ts';

/**
 * Service for collecting and managing error metrics
 */
export class ErrorMetricsCollector {
    private logger: Logger;
    private metrics: ErrorMetrics;
    private events: ErrorEvent[] = [];
    private maxEvents: number = 1000; // Keep last 1000 events

    constructor(logger: Logger, maxEvents: number = 1000) {
        this.logger = logger.child('ErrorMetricsCollector');
        this.maxEvents = maxEvents;
        this.metrics = this.initializeMetrics();
    }

    /**
     * Record an error occurrence
     */
    recordError(errorType: string, context: ErrorContext): void {
        this.metrics.totalErrors++;
        
        // Track errors by type
        if (!this.metrics.errorsByType[errorType]) {
            this.metrics.errorsByType[errorType] = 0;
        }
        this.metrics.errorsByType[errorType]++;
        
        // Track errors by operation
        if (!this.metrics.errorsByOperation[context.operation]) {
            this.metrics.errorsByOperation[context.operation] = 0;
        }
        this.metrics.errorsByOperation[context.operation]++;

        // Create error event
        const event: ErrorEvent = {
            id: this.generateEventId(),
            type: this.mapToErrorType(errorType),
            severity: this.determineSeverity(errorType, context),
            operation: context.operation,
            timestamp: context.timestamp,
            resolved: false,
            retryCount: context.attemptNumber - 1,
            totalDuration: 0,
            context,
        };

        this.addEvent(event);

        this.logger.debug('Recorded error', {
            errorType,
            operation: context.operation,
            totalErrors: this.metrics.totalErrors,
        });
    }

    /**
     * Record an error resolution
     */
    recordResolution(errorType: string, resolution: ErrorResolution): void {
        const latestEvent = this.findLatestUnresolvedEvent(errorType);
        
        if (latestEvent) {
            latestEvent.resolved = true;
            latestEvent.resolutionStrategy = resolution.strategy;
            latestEvent.totalDuration = Date.now() - latestEvent.timestamp.getTime();
        }

        // Track retry attempts
        if (resolution.strategy === 'retry') {
            this.metrics.retryAttempts++;
            
            if (resolution.retryAfter) {
                this.updateAverageRetryDelay(resolution.retryAfter);
            }
        }

        // Track successful recoveries
        if (resolution.strategy === 'transform' || resolution.strategy === 'fallback') {
            this.updateErrorRecoveryRate(true);
        }

        this.logger.debug('Recorded error resolution', {
            errorType,
            strategy: resolution.strategy,
            retryAttempts: this.metrics.retryAttempts,
        });
    }

    /**
     * Record a successful retry
     */
    recordSuccessfulRetry(context: ErrorContext): void {
        this.metrics.successfulRetries++;
        this.updateErrorRecoveryRate(true);
        
        this.logger.debug('Recorded successful retry', {
            operation: context.operation,
            attemptNumber: context.attemptNumber,
            successfulRetries: this.metrics.successfulRetries,
        });
    }

    /**
     * Record a failed retry
     */
    recordFailedRetry(context: ErrorContext): void {
        this.metrics.failedRetries++;
        this.updateErrorRecoveryRate(false);
        
        this.logger.debug('Recorded failed retry', {
            operation: context.operation,
            attemptNumber: context.attemptNumber,
            failedRetries: this.metrics.failedRetries,
        });
    }

    /**
     * Record a successful fallback operation
     */
    recordFallbackSuccess(context: ErrorContext): void {
        this.metrics.fallbacksUsed++;
        this.metrics.fallbackSuccesses++;
        this.updateErrorRecoveryRate(true);
        
        this.logger.debug('Recorded successful fallback', {
            operation: context.operation,
            fallbackSuccesses: this.metrics.fallbackSuccesses,
        });
    }

    /**
     * Record a failed fallback operation
     */
    recordFallbackFailure(context: ErrorContext): void {
        this.metrics.fallbacksUsed++;
        this.metrics.fallbackFailures++;
        this.updateErrorRecoveryRate(false);
        
        this.logger.debug('Recorded failed fallback', {
            operation: context.operation,
            fallbackFailures: this.metrics.fallbackFailures,
        });
    }

    /**
     * Get current metrics
     */
    getMetrics(): ErrorMetrics {
        return { ...this.metrics };
    }

    /**
     * Get detailed error statistics
     */
    getDetailedStats(): {
        metrics: ErrorMetrics;
        topErrorTypes: Array<{ type: string; count: number; percentage: number }>;
        topOperations: Array<{ operation: string; count: number; percentage: number }>;
        recentEvents: ErrorEvent[];
        recoveryRateByType: Record<string, number>;
    } {
        const topErrorTypes = Object.entries(this.metrics.errorsByType)
            .map(([type, count]) => ({
                type,
                count,
                percentage: (count / this.metrics.totalErrors) * 100,
            }))
            .sort((a, b) => b.count - a.count)
            .slice(0, 10);

        const topOperations = Object.entries(this.metrics.errorsByOperation)
            .map(([operation, count]) => ({
                operation,
                count,
                percentage: (count / this.metrics.totalErrors) * 100,
            }))
            .sort((a, b) => b.count - a.count)
            .slice(0, 10);

        const recentEvents = this.events
            .slice(-50) // Last 50 events
            .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

        const recoveryRateByType = this.calculateRecoveryRateByType();

        return {
            metrics: this.getMetrics(),
            topErrorTypes,
            topOperations,
            recentEvents,
            recoveryRateByType,
        };
    }

    /**
     * Reset all metrics
     */
    reset(): void {
        this.metrics = this.initializeMetrics();
        this.events = [];
        
        this.logger.info('Error metrics reset');
    }

    /**
     * Export metrics to JSON
     */
    exportMetrics(): string {
        const exportData = {
            metrics: this.getMetrics(),
            events: this.events,
            exportTime: new Date().toISOString(),
        };
        
        return JSON.stringify(exportData, null, 2);
    }

    /**
     * Import metrics from JSON
     */
    importMetrics(jsonData: string): void {
        try {
            const importData = JSON.parse(jsonData);
            
            if (importData.metrics) {
                this.metrics = { ...this.metrics, ...importData.metrics };
            }
            
            if (importData.events && Array.isArray(importData.events)) {
                this.events = importData.events.map((event: any) => ({
                    ...event,
                    timestamp: new Date(event.timestamp),
                }));
            }
            
            this.logger.info('Error metrics imported successfully');
        } catch (error) {
            this.logger.error('Failed to import metrics', { error });
            throw new Error('Invalid metrics data format');
        }
    }

    /**
     * Initialize metrics structure
     */
    private initializeMetrics(): ErrorMetrics {
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
            lastResetTime: new Date(),
        };
    }

    /**
     * Add event to the events list, maintaining max size
     */
    private addEvent(event: ErrorEvent): void {
        this.events.push(event);
        
        // Keep only the most recent events
        if (this.events.length > this.maxEvents) {
            this.events = this.events.slice(-this.maxEvents);
        }
    }

    /**
     * Find the latest unresolved event for a given error type
     */
    private findLatestUnresolvedEvent(errorType: string): ErrorEvent | undefined {
        for (let i = this.events.length - 1; i >= 0; i--) {
            const event = this.events[i];
            if (event.type === this.mapToErrorType(errorType) && !event.resolved) {
                return event;
            }
        }
        return undefined;
    }

    /**
     * Update average retry delay
     */
    private updateAverageRetryDelay(newDelay: number): void {
        if (this.metrics.retryAttempts === 1) {
            this.metrics.averageRetryDelay = newDelay;
        } else {
            // Calculate running average
            const totalDelay = this.metrics.averageRetryDelay * (this.metrics.retryAttempts - 1);
            this.metrics.averageRetryDelay = (totalDelay + newDelay) / this.metrics.retryAttempts;
        }
    }

    /**
     * Update error recovery rate
     */
    private updateErrorRecoveryRate(successful: boolean): void {
        const totalAttempts = this.metrics.successfulRetries + this.metrics.failedRetries + 
                             this.metrics.fallbackSuccesses + this.metrics.fallbackFailures;
        
        if (totalAttempts === 0) {
            this.metrics.errorRecoveryRate = 0;
            return;
        }
        
        const successfulAttempts = this.metrics.successfulRetries + this.metrics.fallbackSuccesses;
        this.metrics.errorRecoveryRate = (successfulAttempts / totalAttempts) * 100;
    }

    /**
     * Calculate recovery rate by error type
     */
    private calculateRecoveryRateByType(): Record<string, number> {
        const recoveryRates: Record<string, number> = {};
        
        // Group events by type and calculate recovery rates
        const eventsByType: Record<string, ErrorEvent[]> = {};
        
        for (const event of this.events) {
            const typeKey = event.type.toString();
            if (!eventsByType[typeKey]) {
                eventsByType[typeKey] = [];
            }
            eventsByType[typeKey].push(event);
        }
        
        for (const [type, events] of Object.entries(eventsByType)) {
            const resolvedEvents = events.filter(e => e.resolved);
            const recoveryRate = events.length > 0 ? (resolvedEvents.length / events.length) * 100 : 0;
            recoveryRates[type] = Math.round(recoveryRate * 100) / 100; // Round to 2 decimal places
        }
        
        return recoveryRates;
    }

    /**
     * Map string error type to ErrorType enum
     */
    private mapToErrorType(errorType: string): ErrorType {
        const typeMap: Record<string, ErrorType> = {
            'validation': ErrorType.VALIDATION,
            'llm': ErrorType.LLM_PROVIDER,
            'api': ErrorType.API_REQUEST,
            'network': ErrorType.NETWORK,
            'authentication': ErrorType.AUTHENTICATION,
            'permission': ErrorType.PERMISSION,
            'rate_limit': ErrorType.RATE_LIMIT,
            'file_not_found': ErrorType.FILE_NOT_FOUND,
            'timeout': ErrorType.TIMEOUT,
            'service_unavailable': ErrorType.SERVICE_UNAVAILABLE,
            'git': ErrorType.GIT_OPERATION,
            'configuration': ErrorType.CONFIGURATION,
        };
        
        return typeMap[errorType.toLowerCase()] || ErrorType.UNKNOWN;
    }

    /**
     * Determine error severity based on type and context
     */
    private determineSeverity(errorType: string, context: ErrorContext): ErrorSeverity {
        // High severity errors
        if (['authentication', 'permission', 'configuration'].includes(errorType.toLowerCase())) {
            return ErrorSeverity.HIGH;
        }
        
        // Medium severity errors
        if (['api', 'llm', 'network', 'timeout'].includes(errorType.toLowerCase())) {
            return ErrorSeverity.MEDIUM;
        }
        
        // Critical errors based on context
        if (context.attemptNumber > 3) {
            return ErrorSeverity.HIGH;
        }
        
        // Default to low severity
        return ErrorSeverity.LOW;
    }

    /**
     * Generate unique event ID
     */
    private generateEventId(): string {
        return `error_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }
}

/**
 * Factory function to create an ErrorMetricsCollector
 */
export function createErrorMetricsCollector(
    logger: Logger,
    maxEvents?: number
): ErrorMetricsCollector {
    return new ErrorMetricsCollector(logger, maxEvents);
}