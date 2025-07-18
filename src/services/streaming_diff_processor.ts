import type { Logger } from '../utils/logger.ts';

/**
 * Diff chunk for streaming processing
 */
export interface DiffChunk {
    filePath: string;
    startLine: number;
    endLine: number;
    content: string;
    changeType: 'added' | 'modified' | 'deleted';
    context: string; // Surrounding context for better analysis
}

/**
 * Streaming diff processor configuration
 */
export interface StreamingDiffConfig {
    chunkSize: number; // Lines per chunk
    contextLines: number; // Lines of context around changes
    maxChunkSize: number; // Maximum chunk size in bytes
    concurrency: number; // Number of chunks to process concurrently
}

/**
 * Result of processing a diff chunk
 */
export interface DiffChunkResult {
    chunk: DiffChunk;
    analysis?: any; // Analysis result for the chunk
    error?: Error;
    processingTime: number;
}

/**
 * Streaming processor for large diffs
 */
export class StreamingDiffProcessor {
    private logger: Logger;
    private config: StreamingDiffConfig;

    constructor(logger: Logger, config: Partial<StreamingDiffConfig> = {}) {
        this.logger = logger.child('StreamingDiffProcessor');
        this.config = {
            chunkSize: config.chunkSize ?? 100, // 100 lines per chunk
            contextLines: config.contextLines ?? 3,
            maxChunkSize: config.maxChunkSize ?? 50 * 1024, // 50KB
            concurrency: config.concurrency ?? 3,
        };
    }

    /**
     * Process a large diff by streaming it in chunks
     */
    async processDiffStream(
        filePath: string,
        diffContent: string,
        processor: (chunk: DiffChunk) => Promise<any>,
        onProgress?: (processed: number, total: number) => void
    ): Promise<DiffChunkResult[]> {
        this.logger.info(`Starting streaming diff processing for ${filePath}`);

        // Parse diff into chunks
        const chunks = this.parseDiffIntoChunks(filePath, diffContent);
        
        if (chunks.length === 0) {
            this.logger.debug(`No chunks found in diff for ${filePath}`);
            return [];
        }

        this.logger.debug(`Split diff into ${chunks.length} chunks for processing`);

        // Process chunks with controlled concurrency
        const results: DiffChunkResult[] = [];
        const semaphore = new StreamingSemaphore(this.config.concurrency);
        let processedCount = 0;

        const chunkPromises = chunks.map(async (chunk, index) => {
            await semaphore.acquire();
            
            try {
                const startTime = Date.now();
                
                try {
                    const analysis = await processor(chunk);
                    const processingTime = Date.now() - startTime;
                    
                    const result: DiffChunkResult = {
                        chunk,
                        analysis,
                        processingTime,
                    };
                    
                    results.push(result);
                    processedCount++;
                    
                    if (onProgress) {
                        onProgress(processedCount, chunks.length);
                    }
                    
                    this.logger.debug(`Processed chunk ${index + 1}/${chunks.length} in ${processingTime}ms`);
                    return result;
                } catch (error) {
                    const processingTime = Date.now() - startTime;
                    const result: DiffChunkResult = {
                        chunk,
                        error: error instanceof Error ? error : new Error(String(error)),
                        processingTime,
                    };
                    
                    results.push(result);
                    processedCount++;
                    
                    if (onProgress) {
                        onProgress(processedCount, chunks.length);
                    }
                    
                    this.logger.warn(`Failed to process chunk ${index + 1}/${chunks.length}: ${error}`);
                    return result;
                }
            } finally {
                semaphore.release();
            }
        });

        await Promise.all(chunkPromises);

        this.logger.info(`Completed streaming diff processing for ${filePath}: ${results.length} chunks processed`);
        return results;
    }

    /**
     * Parse diff content into processable chunks
     */
    private parseDiffIntoChunks(filePath: string, diffContent: string): DiffChunk[] {
        const lines = diffContent.split('\n');
        const chunks: DiffChunk[] = [];
        
        let currentChunk: string[] = [];
        let currentStartLine = 1;
        let currentChangeType: 'added' | 'modified' | 'deleted' = 'modified';
        let chunkByteSize = 0;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const lineByteSize = new TextEncoder().encode(line).length;

            // Determine change type from diff markers
            if (line.startsWith('+')) {
                currentChangeType = 'added';
            } else if (line.startsWith('-')) {
                currentChangeType = 'deleted';
            }

            // Check if we should create a new chunk
            const shouldCreateChunk = 
                currentChunk.length >= this.config.chunkSize ||
                chunkByteSize + lineByteSize > this.config.maxChunkSize ||
                (currentChunk.length > 0 && this.isChunkBoundary(line));

            if (shouldCreateChunk && currentChunk.length > 0) {
                // Create chunk with context
                const chunkContent = currentChunk.join('\n');
                const context = this.extractContext(lines, currentStartLine, currentStartLine + currentChunk.length - 1);
                
                chunks.push({
                    filePath,
                    startLine: currentStartLine,
                    endLine: currentStartLine + currentChunk.length - 1,
                    content: chunkContent,
                    changeType: currentChangeType,
                    context,
                });

                // Reset for next chunk
                currentChunk = [];
                currentStartLine = i + 1;
                chunkByteSize = 0;
            }

            currentChunk.push(line);
            chunkByteSize += lineByteSize;
        }

        // Add final chunk if there's remaining content
        if (currentChunk.length > 0) {
            const chunkContent = currentChunk.join('\n');
            const context = this.extractContext(lines, currentStartLine, currentStartLine + currentChunk.length - 1);
            
            chunks.push({
                filePath,
                startLine: currentStartLine,
                endLine: currentStartLine + currentChunk.length - 1,
                content: chunkContent,
                changeType: currentChangeType,
                context,
            });
        }

        return chunks;
    }

    /**
     * Check if a line represents a natural chunk boundary
     */
    private isChunkBoundary(line: string): boolean {
        // Function/class boundaries
        if (line.match(/^\s*(function|class|interface|type|const|let|var)\s/)) {
            return true;
        }
        
        // Block boundaries
        if (line.match(/^\s*[{}]\s*$/)) {
            return true;
        }
        
        // Comment blocks
        if (line.match(/^\s*(\/\*|\/\/|#)/)) {
            return true;
        }
        
        return false;
    }

    /**
     * Extract context lines around a chunk
     */
    private extractContext(lines: string[], startLine: number, endLine: number): string {
        const contextStart = Math.max(0, startLine - this.config.contextLines - 1);
        const contextEnd = Math.min(lines.length - 1, endLine + this.config.contextLines - 1);
        
        const contextLines = lines.slice(contextStart, contextEnd + 1);
        return contextLines.join('\n');
    }

    /**
     * Merge chunk results back into a complete analysis
     */
    mergeChunkResults(results: DiffChunkResult[]): {
        filePath: string;
        totalChunks: number;
        successfulChunks: number;
        failedChunks: number;
        totalProcessingTime: number;
        mergedAnalysis: any;
        errors: Error[];
    } {
        const successful = results.filter(r => !r.error);
        const failed = results.filter(r => r.error);
        const totalProcessingTime = results.reduce((sum, r) => sum + r.processingTime, 0);
        
        // Merge analyses from successful chunks
        const mergedAnalysis = this.mergeAnalyses(successful.map(r => r.analysis).filter(Boolean));
        
        return {
            filePath: results[0]?.chunk.filePath || '',
            totalChunks: results.length,
            successfulChunks: successful.length,
            failedChunks: failed.length,
            totalProcessingTime,
            mergedAnalysis,
            errors: failed.map(r => r.error!),
        };
    }

    /**
     * Merge multiple analysis results into one
     */
    private mergeAnalyses(analyses: any[]): any {
        if (analyses.length === 0) {
            return null;
        }
        
        if (analyses.length === 1) {
            return analyses[0];
        }

        // Basic merging strategy - can be enhanced based on analysis structure
        const merged = {
            issues: [] as any[],
            suggestions: [] as string[],
            metrics: {} as any,
        };

        analyses.forEach(analysis => {
            if (analysis.issues) {
                merged.issues.push(...analysis.issues);
            }
            if (analysis.suggestions) {
                merged.suggestions.push(...analysis.suggestions);
            }
            if (analysis.metrics) {
                // Merge metrics (simple approach)
                Object.assign(merged.metrics, analysis.metrics);
            }
        });

        // Remove duplicates
        merged.suggestions = [...new Set(merged.suggestions)];
        
        return merged;
    }

    /**
     * Get processing statistics
     */
    getProcessingStats(results: DiffChunkResult[]): {
        totalChunks: number;
        successfulChunks: number;
        failedChunks: number;
        averageChunkSize: number;
        totalProcessingTime: number;
        averageProcessingTime: number;
        throughput: number; // chunks per second
    } {
        const successful = results.filter(r => !r.error).length;
        const failed = results.filter(r => r.error).length;
        const totalProcessingTime = results.reduce((sum, r) => sum + r.processingTime, 0);
        const averageProcessingTime = results.length > 0 ? totalProcessingTime / results.length : 0;
        const averageChunkSize = results.length > 0 
            ? results.reduce((sum, r) => sum + r.chunk.content.length, 0) / results.length 
            : 0;
        const throughput = totalProcessingTime > 0 ? (results.length * 1000) / totalProcessingTime : 0;

        return {
            totalChunks: results.length,
            successfulChunks: successful,
            failedChunks: failed,
            averageChunkSize,
            totalProcessingTime,
            averageProcessingTime,
            throughput,
        };
    }
}

/**
 * Simple semaphore for streaming concurrency control
 */
class StreamingSemaphore {
    private permits: number;
    private waitQueue: (() => void)[] = [];

    constructor(permits: number) {
        this.permits = permits;
    }

    async acquire(): Promise<void> {
        if (this.permits > 0) {
            this.permits--;
            return;
        }

        return new Promise<void>((resolve) => {
            this.waitQueue.push(resolve);
        });
    }

    release(): void {
        if (this.waitQueue.length > 0) {
            const resolve = this.waitQueue.shift()!;
            resolve();
        } else {
            this.permits++;
        }
    }
}