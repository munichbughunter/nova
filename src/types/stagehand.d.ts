// Type declarations for Stagehand related components
// These declarations help avoid explicit 'any' types

export interface SchemaType {
  _def?: {
    typeName: string;
  };
  _cached?: {
    shape: Record<string, unknown>;
    keys: string[];
  };
  name?: string;
  shape?: Record<string, { description?: string }>;
}

export interface SummaryType {
  type: string;
  keyCount: number;
  keys: string[];
  hasMoreKeys?: boolean;
  id?: string;
  name?: string;
  role?: string;
  status?: string;
  error?: string;
  message?: string;
}

export interface StagehandAction {
  description: string;
  action?: string;
  method?: string;
  selector: string;
  arguments?: string[];
  type?: string;
}

// Options for chat completion
export interface CreateCompletionOptions {
  messages: unknown[];
  tools?: unknown[];
  response_model?: {
    name: string;
    schema: SchemaType;
  };
}

// These are used to allow more precise types in the AISdkClient
declare module "@browserbasehq/stagehand" {
  interface LLMClient {
    type: string;
    createChatCompletion<T>(options: CreateCompletionOptions): Promise<T>;
  }
} 