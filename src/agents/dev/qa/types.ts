import { GitLabService } from "../../../services/gitlab_service.ts";
import { AgentContext } from "../../base_agent.ts";
import { TestStep } from "../types.ts";

export interface QAAgentContext extends AgentContext {
  gitlab: GitLabService;
}

export interface StagehandObservation {
  description: string;
  element: string;
  selector?: string;
  confidence: number;
  screenshot?: string;
}

export interface StagehandStep {
  instruction: string;
  observation?: string;
  elementSelector?: string;
  screenshot?: string;
  error?: string;
  success: boolean;
  playwrightCode?: string;
}

export interface TestSession {
  name: string;
  description: string;
  startUrl: string;
  steps: StagehandStep[];
  observations: StagehandObservation[];
  playwrightCode: string[];
  lastPendingStep?: TestStep;
  completed: boolean;
  success: boolean;
  startTime: Date;
  endTime?: Date;
}

export interface StagehandOptions {
  browserType?: 'chromium' | 'firefox' | 'webkit';
  headless?: boolean;
  slowMo?: number;
  modelId?: string;
  debug?: boolean;
} 