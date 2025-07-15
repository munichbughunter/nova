import type { 
    RepositoryService, 
    PullRequest, 
    DiffData, 
    DiffComment,
    GitService 
} from '../agents/types.ts';
import type { Logger } from '../utils/logger.ts';
import { RepositoryDetector } from './repository_detector.ts';

/**
 * Abstract base class for repository services (GitLab, GitHub)
 */
export abstract class RepositoryServiceBase implements RepositoryService {
    protected logger: Logger;
    protected gitService: GitService;
    protected repositoryDetector: RepositoryDetector;

    constructor(logger: Logger, gitService: GitService) {
        this.logger = logger.child('RepositoryService');
        this.gitService = gitService;
        this.repositoryDetector = new RepositoryDetector(logger, gitService);
    }

    /**
     * Detect repository type using the repository detector
     */
    async detectRepositoryType(): Promise<'gitlab' | 'github' | 'unknown'> {
        return await this.repositoryDetector.detectRepositoryType();
    }

    /**
     * Get repository information
     */
    async getRepositoryInfo() {
        return await this.repositoryDetector.getRepositoryInfo();
    }

    /**
     * Abstract methods to be implemented by concrete services
     */
    abstract getPullRequests(): Promise<PullRequest[]>;
    abstract getPullRequestDiff(prId: string): Promise<DiffData>;
    abstract postDiffComment(prId: string, comment: DiffComment): Promise<void>;

    /**
     * Validate that this service can handle the detected repository type
     */
    protected async validateRepositoryType(expectedType: 'gitlab' | 'github'): Promise<void> {
        const detectedType = await this.detectRepositoryType();
        
        if (detectedType === 'unknown') {
            throw new Error('Unable to detect repository type. Please ensure you are in a Git repository with a configured remote.');
        }
        
        if (detectedType !== expectedType) {
            throw new Error(`Repository type mismatch. Expected ${expectedType}, but detected ${detectedType}.`);
        }
    }

    /**
     * Helper method to format dates consistently
     */
    protected formatDate(dateString: string): Date {
        return new Date(dateString);
    }

    /**
     * Helper method to determine PR/MR status
     */
    protected normalizeStatus(status: string): 'open' | 'closed' | 'merged' {
        const normalizedStatus = status.toLowerCase();
        
        if (normalizedStatus === 'opened' || normalizedStatus === 'open') {
            return 'open';
        }
        
        if (normalizedStatus === 'merged') {
            return 'merged';
        }
        
        return 'closed';
    }
}