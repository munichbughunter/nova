import { ProjectSchema } from '@gitbeaker/rest';
import { DBService } from '../services/db_service.ts';
import { Logger } from './logger.ts';

interface RecentGitLabProject extends ProjectSchema {
    type: 'gitlab';
    timestamp?: Date;
}

// Here we will cache user data in our database (will use db_service to interact with the database)
// this will be used by commands that need to cache user data
/**
 * UserCache is a singleton class that manages user-related caching operations
 * It provides a centralized way to handle user data persistence and retrieval
 */
export class UserCache {
    private static instance: UserCache | null = null;
    private db!: DBService;
    private logger: Logger;
    private readonly maxRecentProjects = 10;
    private initialized = false;

    private constructor() {
        this.logger = new Logger('UserCache');
    }

    public static async getInstance(): Promise<UserCache> {
        if (!UserCache.instance) {
            UserCache.instance = new UserCache();
            await UserCache.instance.initialize();
        }
        return UserCache.instance;
    }

    private async initialize(): Promise<void> {
        if (!this.initialized) {
            this.db = await DBService.getInstance();
            this.initialized = true;
        }
    }

    private async ensureInitialized(): Promise<void> {
        if (!this.initialized) {
            await this.initialize();
        }
    }

    /**
     * Get recently viewed projects
     */
    public async getRecentProjects(): Promise<RecentGitLabProject[]> {
        try {
            await this.ensureInitialized();
            const projects = await this.db.getRecentProjects();
            return projects.map((p) => ({
                ...p,
                type: 'gitlab' as const,
            }));
        } catch (error) {
            this.logger.error('Error getting recent projects:', error);
            return [];
        }
    }

    /**
     * Add a project to recent projects list
     */
    public async addRecentProject(project: ProjectSchema | Record<string, unknown>): Promise<void> {
        try {
            await this.ensureInitialized();

            // Ensure project has the right fields regardless of input type
            const projectToAdd: ProjectSchema = this.ensureProjectSchema(project);

            await this.db.addRecentProject(projectToAdd);
        } catch (error) {
            this.logger.error('Error adding project to recent list:', error);
        }
    }

    /**
     * Ensures an object is a valid ProjectSchema, converting from other formats if needed
     */
    private ensureProjectSchema(project: ProjectSchema | Record<string, unknown>): ProjectSchema {
        // If it's already a full ProjectSchema, return it
        if (this.isFullProjectSchema(project)) {
            return project;
        }

        // Convert from potential GraphQL response or other formats
        return this.convertToProjectSchema(project);
    }

    /**
     * Type guard to check if object is a full ProjectSchema
     */
    private isFullProjectSchema(
        project: ProjectSchema | Record<string, unknown>,
    ): project is ProjectSchema {
        return 'path_with_namespace' in project &&
            'web_url' in project &&
            'last_activity_at' in project &&
            'namespace' in project;
    }

    /**
     * Convert a record to ProjectSchema
     */
    private convertToProjectSchema(project: Record<string, unknown>): ProjectSchema {
        // Create a minimal ProjectSchema for DB storage
        const pns = (project.path_with_namespace as string) ||
            (project.fullPath as string) || '';
        const webUrl = (project.web_url as string) ||
            (project.webUrl as string) || '';
        const archived = project.archived as boolean;
        const visibility = project.visibility as string;
        const lastActivity = (project.last_activity_at as string) ||
            (project.lastActivityAt as string) ||
            new Date().toISOString();

        return {
            id: project.id as string | number,
            name: project.name as string,
            description: (project.description as string) || '',
            path_with_namespace: pns,
            web_url: webUrl,
            visibility: visibility,
            last_activity_at: lastActivity,
            archived: archived,
            // Add mandatory fields
            avatar_url: null,
            created_at: lastActivity,
            default_branch: 'main',
            description_html: (project.description as string) || '',
            forks_count: 0,
            http_url_to_repo: webUrl,
            issues_enabled: true,
            jobs_enabled: true,
            lfs_enabled: false,
            merge_requests_enabled: true,
            mirror: false,
            namespace: {
                id: 0,
                name: pns.split('/')[0] || '',
                path: pns.split('/')[0] || '',
                kind: 'group',
                full_path: pns.split('/')[0] || '',
            },
            open_issues_count: 0,
            owner: null,
            public_jobs: true,
            readme_url: null,
            runners_token: '',
            shared_runners_enabled: true,
            ssh_url_to_repo: '',
            star_count: 0,
            tag_list: [],
            empty_repo: false,
            wiki_enabled: true,
            snippets_enabled: true,
            can_create_merge_request_in: true,
            resolve_outdated_diff_discussions: false,
            container_registry_access_level: 'enabled',
            container_registry_enabled: true,
            security_and_compliance_enabled: false,
            packages_enabled: true,
            service_desk_enabled: false,
            service_desk_address: null,
            issues_access_level: 'enabled',
            repository_access_level: 'enabled',
            merge_requests_access_level: 'enabled',
            forking_access_level: 'enabled',
            wiki_access_level: 'enabled',
            builds_access_level: 'enabled',
            snippets_access_level: 'enabled',
            pages_access_level: 'enabled',
            operations_access_level: 'enabled',
            analytics_access_level: 'enabled',
            container_registry_image_prefix: '',
            _links: {
                self: webUrl,
                issues: `${webUrl}/issues`,
                merge_requests: `${webUrl}/merge_requests`,
                repo_branches: `${webUrl}/branches`,
                labels: `${webUrl}/labels`,
                events: `${webUrl}/events`,
                members: `${webUrl}/members`,
                cluster_agents: `${webUrl}/cluster_agents`,
            },
            build_coverage_regex: null,
            build_git_strategy: 'fetch',
            build_timeout: 3600,
            auto_cancel_pending_pipelines: 'enabled',
            build_allow_git_fetch: true,
            pull_mirror_available_override: false,
            ci_config_path: null,
            ci_default_git_depth: 20,
            remove_source_branch_after_merge: true,
            request_access_enabled: true,
            shared_with_groups: [],
            only_allow_merge_if_pipeline_succeeds: false,
            only_allow_merge_if_all_discussions_are_resolved: false,
            allow_merge_on_skipped_pipeline: false,
            permissions: {
                project_access: null,
                group_access: null,
            },
        } as unknown as ProjectSchema;
    }

    /**
     * Clear all recent projects
     */
    public async clearRecentProjects(): Promise<void> {
        try {
            await this.ensureInitialized();
            await this.db.clearProjectsCache();
        } catch (error) {
            this.logger.error('Error clearing recent projects:', error);
        }
    }

    /**
     * Get cached projects list
     */
    public async getCachedProjectsList(): Promise<
        { projects: ProjectSchema[]; timestamp: Date } | null
    > {
        try {
            await this.ensureInitialized();
            return await this.db.getCachedProjectsList();
        } catch (error) {
            this.logger.error('Error getting cached projects list:', error);
            return null;
        }
    }

    /**
     * Cache projects list
     */
    public async cacheProjectsList(
        projects: Array<ProjectSchema | Record<string, unknown>>,
    ): Promise<void> {
        try {
            await this.ensureInitialized();

            // Convert any non-ProjectSchema to ProjectSchema
            const projectsToCache = projects.map((project) =>
                this.isFullProjectSchema(project) ? project : this.convertToProjectSchema(project)
            );

            await this.db.cacheProjectsList(projectsToCache);
        } catch (error) {
            this.logger.error('Error caching projects list:', error);
        }
    }

    /**
     * Clear cached projects list
     */
    public async clearCachedProjectsList(): Promise<void> {
        try {
            await this.ensureInitialized();
            await this.db.clearProjectsCache();
        } catch (error) {
            this.logger.error('Error clearing cached projects list:', error);
        }
    }
}
