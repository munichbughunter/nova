import type {
    AgentContext,
    UserNotification,
    UserQuestion,
    UserResponse,
    FileOperation,
    FileReadOptions,
    FileWriteOptions,
    MCPToolResult,
} from './types.ts';
import { Logger } from '../utils/logger.ts';

/**
 * Tool wrapper for notifying users about agent actions
 */
export async function notifyUser(
    context: AgentContext,
    notification: UserNotification,
): Promise<MCPToolResult> {
    const logger = context.logger?.child('notifyUser') || new Logger('notifyUser');
    
    try {
        // If MCP service is available, use it to display notification
        if (context.mcpService) {
            return await context.mcpService.executeTool('f1e_notify_user', notification as unknown as Record<string, unknown>, context);
        }

        // Fallback to console output
        const typeColors = {
            info: '\x1b[36m', // Cyan
            warning: '\x1b[33m', // Yellow
            error: '\x1b[31m', // Red
            success: '\x1b[32m', // Green
        };
        
        const reset = '\x1b[0m';
        const color = typeColors[notification.type] || typeColors.info;
        
        let output = `${color}[${notification.type.toUpperCase()}]${reset}`;
        
        if (notification.title) {
            output += ` ${notification.title}`;
        }
        
        output += `\n${notification.message}`;
        
        if (notification.actions?.length) {
            output += '\nAvailable actions:';
            notification.actions.forEach((action, index) => {
                output += `\n  ${index + 1}. ${action.label} (${action.action})`;
            });
        }
        
        console.log(output);
        
        return {
            success: true,
            data: { displayed: true, fallback: true },
            message: 'Notification displayed via console',
        };
    } catch (error) {
        logger.error('Failed to notify user:', error);
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
        };
    }
}

/**
 * Tool wrapper for asking users questions
 */
export async function askUser(
    context: AgentContext,
    question: UserQuestion,
): Promise<UserResponse> {
    const logger = context.logger?.child('askUser') || new Logger('askUser');
    
    try {
        // If MCP service is available, use it for interactive prompts
        if (context.mcpService) {
            const result = await context.mcpService.executeTool('f1e_ask_user', question as unknown as Record<string, unknown>, context);
            
            if (result.success && result.data) {
                return result.data as UserResponse;
            }
            
            // If MCP tool failed, fall back to console
            logger.warn('MCP ask_user tool failed, falling back to console');
        }

        // Fallback to basic console interaction
        console.log(`\n${question.question}`);
        
        if (question.type === 'confirm') {
            console.log('Enter y/yes or n/no:');
            
            // In a real implementation, this would use readline or similar
            // For now, return default or simulate user input
            const defaultValue = question.defaultValue as boolean ?? false;
            logger.warn('Using console fallback - returning default value:', defaultValue);
            
            return {
                success: true,
                value: defaultValue,
                cancelled: false,
            };
        }
        
        if (question.type === 'select' && question.options) {
            console.log('Options:');
            question.options.forEach((option, index) => {
                console.log(`  ${index + 1}. ${option}`);
            });
            
            // Return first option as fallback
            const defaultValue = question.defaultValue as string ?? question.options[0];
            logger.warn('Using console fallback - returning default option:', defaultValue);
            
            return {
                success: true,
                value: defaultValue,
                cancelled: false,
            };
        }
        
        // For text input, return default or empty
        const defaultValue = question.defaultValue as string ?? '';
        logger.warn('Using console fallback - returning default text:', defaultValue);
        
        return {
            success: true,
            value: defaultValue,
            cancelled: false,
        };
    } catch (error) {
        logger.error('Failed to ask user:', error);
        return {
            success: false,
            cancelled: true,
        };
    }
}

/**
 * Tool wrapper for reading files
 */
export async function readFile(
    context: AgentContext,
    path: string,
    options: FileReadOptions = {},
): Promise<MCPToolResult> {
    const logger = context.logger?.child('readFile') || new Logger('readFile');
    
    try {
        logger.debug(`Reading file: ${path}`, options);

        // If MCP service is available, use it for file operations
        if (context.mcpService) {
            const params = {
                path,
                encoding: options.encoding || 'utf8',
                maxSize: options.maxSize,
            };
            
            const result = await context.mcpService.executeTool('f1e_read_task_file', params, context);
            
            if (result.success) {
                return result;
            }
            
            // If specific tool failed, try generic file read
            const genericResult = await context.mcpService.executeTool('f1e_read_file', params, context);
            if (genericResult.success) {
                return genericResult;
            }
        }

        // Fallback to Deno file operations
        const encoding = options.encoding || 'utf8';
        
        if (encoding === 'binary') {
            const data = await Deno.readFile(path);
            
            // Check max size if specified
            if (options.maxSize && data.length > options.maxSize) {
                return {
                    success: false,
                    error: `File size ${data.length} exceeds maximum ${options.maxSize}`,
                };
            }
            
            return {
                success: true,
                data: data,
                message: `Read ${data.length} bytes from ${path}`,
            };
        } else {
            const content = await Deno.readTextFile(path);
            
            // Check max size if specified
            if (options.maxSize && content.length > options.maxSize) {
                return {
                    success: false,
                    error: `File size ${content.length} exceeds maximum ${options.maxSize}`,
                };
            }
            
            return {
                success: true,
                data: { content, encoding },
                message: `Read ${content.length} characters from ${path}`,
            };
        }
    } catch (error) {
        logger.error(`Failed to read file ${path}:`, error);
        
        if (error instanceof Deno.errors.NotFound) {
            return {
                success: false,
                error: `File not found: ${path}`,
            };
        }
        
        if (error instanceof Deno.errors.PermissionDenied) {
            return {
                success: false,
                error: `Permission denied: ${path}`,
            };
        }
        
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
        };
    }
}

/**
 * Tool wrapper for writing files
 */
export async function writeFile(
    context: AgentContext,
    path: string,
    content: string | Uint8Array,
    options: FileWriteOptions = {},
): Promise<MCPToolResult> {
    const logger = context.logger?.child('writeFile') || new Logger('writeFile');
    
    try {
        logger.debug(`Writing file: ${path}`, {
            contentType: typeof content,
            contentLength: content.length,
            options,
        });

        // If MCP service is available, use it for file operations
        if (context.mcpService) {
            const params = {
                path,
                content: typeof content === 'string' ? content : new TextDecoder().decode(content),
                encoding: options.encoding || 'utf8',
                mode: options.mode,
                createDirs: options.createDirs,
            };
            
            const result = await context.mcpService.executeTool('f1e_write_task_file', params, context);
            
            if (result.success) {
                return result;
            }
            
            // If specific tool failed, try generic file write
            const genericResult = await context.mcpService.executeTool('f1e_write_file', params, context);
            if (genericResult.success) {
                return genericResult;
            }
        }

        // Fallback to Deno file operations
        
        // Create directories if requested
        if (options.createDirs) {
            const dir = path.substring(0, path.lastIndexOf('/'));
            if (dir) {
                await Deno.mkdir(dir, { recursive: true });
            }
        }
        
        const writeOptions: Deno.WriteFileOptions = {};
        if (options.mode) {
            writeOptions.mode = options.mode;
        }
        
        if (typeof content === 'string') {
            await Deno.writeTextFile(path, content, writeOptions);
        } else {
            await Deno.writeFile(path, content, writeOptions);
        }
        
        return {
            success: true,
            data: { path, bytesWritten: content.length },
            message: `Wrote ${content.length} ${typeof content === 'string' ? 'characters' : 'bytes'} to ${path}`,
        };
    } catch (error) {
        logger.error(`Failed to write file ${path}:`, error);
        
        if (error instanceof Deno.errors.PermissionDenied) {
            return {
                success: false,
                error: `Permission denied: ${path}`,
            };
        }
        
        if (error instanceof Deno.errors.NotFound) {
            return {
                success: false,
                error: `Directory not found: ${path} (use createDirs option to create directories)`,
            };
        }
        
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
        };
    }
}

/**
 * Tool wrapper for file operations (generic)
 */
export async function performFileOperation(
    context: AgentContext,
    operation: FileOperation,
): Promise<MCPToolResult> {
    const { path, content, options } = operation;
    
    if (content === undefined) {
        // Read operation
        return await readFile(context, path, options as FileReadOptions);
    } else {
        // Write operation
        return await writeFile(context, path, content, options as FileWriteOptions);
    }
}
