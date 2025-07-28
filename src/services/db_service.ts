import { ProjectSchema } from '@gitbeaker/rest';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import process from 'node:process';
import { DatabaseSync } from 'node:sqlite';
import { Logger } from '../utils/logger.ts';

export class DatabaseService {
  private static instance: DatabaseService | null = null;
  private db!: DatabaseSync;
  private maxRecentProjects = 10;
  private dashboardCacheDuration = 24 * 60 * 60 * 1000; // 24 hours
  private data: {
    cachedJiraSprintData?: Record<string, CachedJiraSprintData>;
  } = {};
  private logger: Logger;

  private constructor() {
    this.logger = new Logger('DatabaseService');
  }

  private saveData(): Promise<void> {
    // No-op for now as we're using SQLite for persistence
    return Promise.resolve();
  }

  private async initialize(): Promise<void> {
    try {
      const homeDir = process.env.HOME || '';
      const configDir = join(homeDir, '.nova');
      await mkdir(configDir, { recursive: true });
      const dbPath = join(configDir, 'nova.db');
      this.db = new DatabaseSync(dbPath);
      await this.initializeTables();
      await this.initializeJiraTables();
      await this.initializeConfluenceTables();
    } catch (error) {
      this.logger.error('Error initializing database:', error);
      throw error;
    }
  }

  public static async getInstance(): Promise<DatabaseService> {
    if (!DatabaseService.instance) {
      DatabaseService.instance = new DatabaseService();
      try {
        await DatabaseService.instance.initialize();
      } catch (error) {
        DatabaseService.instance = null;
        throw error;
      }
    }
    return DatabaseService.instance;
  }

  private initializeTables(): Promise<void> {
    try {
      // Create recent projects table
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS recent_projects (
          full_path TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          last_viewed TEXT NOT NULL
        )
      `);

      // Create dashboard cache table
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS dashboard_cache (
          project_path TEXT PRIMARY KEY,
          metrics TEXT,
          timestamp TEXT
        )
      `);

      // Create projects cache table
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS projects_cache (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          data TEXT NOT NULL,
          timestamp TEXT NOT NULL
        )
      `);

      // Create namespaces cache table
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS namespaces_cache (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          data TEXT NOT NULL,
          timestamp TEXT NOT NULL
        )
      `);

      // Create Jira projects cache table
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS jira_projects_cache (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          data TEXT NOT NULL,
          timestamp TEXT NOT NULL
        )
      `);

      // Create recent Jira projects table
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS recent_jira_projects (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          project_key TEXT UNIQUE,
          name TEXT,
          last_viewed TEXT
        )
      `);

      // Create Jira dashboard cache table
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS jira_dashboard_cache (
          project_key TEXT PRIMARY KEY,
          metrics TEXT,
          timestamp TEXT
        )
      `);

      // Create recent Confluence spaces table
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS recent_confluence_spaces (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          space_key TEXT UNIQUE,
          name TEXT,
          last_viewed TEXT
        )
      `);

      // Create confluence spaces cache table
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS confluence_spaces_cache (
          space_key TEXT PRIMARY KEY,
          data TEXT,
          timestamp TEXT
        )
      `);

      // Create confluence dashboard cache table
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS confluence_dashboard_cache (
          space_key TEXT PRIMARY KEY,
          stats TEXT,
          timestamp TEXT
        )
      `);

      // Create DORA metrics cache table
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS dora_metrics_cache (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          jira_project_key TEXT NOT NULL,
          gitlab_project_path TEXT NOT NULL,
          time_range TEXT NOT NULL,
          results TEXT NOT NULL,
          timestamp TEXT NOT NULL,
          UNIQUE(jira_project_key, gitlab_project_path, time_range)
        )
      `);

      // Create cached_projects_list table
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS cached_projects_list (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          projects TEXT NOT NULL,
          timestamp TEXT NOT NULL
        )
      `);

      return Promise.resolve();
    } catch (error) {
      this.logger.error('Error initializing tables:', error);
      throw error;
    }
  }

  // Recent Projects Methods
  public addRecentProject(project: ProjectSchema): void {
    try {
      // First delete if exists to update timestamp
      const deleteStmt = this.db.prepare(
        'DELETE FROM recent_projects WHERE full_path = ?',
      );
      deleteStmt.run(project.path_with_namespace);

      // Then insert new record
      const insertStmt = this.db.prepare(
        'INSERT INTO recent_projects (full_path, name, last_viewed) VALUES (?, ?, ?)',
      );
      insertStmt.run(
        project.path_with_namespace,
        project.name,
        project.last_activity_at,
      );

      // Maintain limit of 10 most recent
      const cleanupStmt = this.db.prepare(
        'DELETE FROM recent_projects WHERE full_path NOT IN (SELECT full_path FROM recent_projects ORDER BY last_viewed DESC LIMIT 10)',
      );
      cleanupStmt.run();
    } catch (error) {
      this.logger.error('Error adding recent project:', error);
      throw error;
    }
  }

  public getRecentProjects(): Promise<ProjectSchema[]> {
    try {
      const stmt = this.db.prepare(
        'SELECT full_path, name, last_viewed FROM recent_projects ORDER BY last_viewed DESC LIMIT 10',
      );
      const rows = stmt.all() as Array<{ full_path: string; name: string; last_viewed: string }>;

      const allProjects = this.getCachedProjectsList();
      const projects = rows.map((row) => {
        const project = allProjects?.projects.find((p) => p.path_with_namespace === row.full_path);
        return project ? { ...project, name: row.name, last_activity_at: row.last_viewed } : null;
      }).filter(Boolean);

      return Promise.resolve(projects as ProjectSchema[]);
    } catch (error) {
      this.logger.error('Error getting recent projects:', error);
      return Promise.resolve([]);
    }
  }

  // Recent Jira Projects Methods
  public addRecentJiraProject(project: RecentJiraProject): Promise<void> {
    try {
      // First, delete if project already exists
      const deleteStmt = this.db.prepare(
        'DELETE FROM recent_jira_projects WHERE project_key = $key',
      );
      deleteStmt.run({ $key: project.key });

      // Then insert new record
      const insertStmt = this.db.prepare(
        'INSERT INTO recent_jira_projects (project_key, name, last_viewed) VALUES ($key, $name, $viewed)',
      );
      insertStmt.run({
        $key: project.key,
        $name: project.name,
        $viewed: project.lastViewed.toISOString(),
      });

      return Promise.resolve();
    } catch (error) {
      this.logger.error('Error adding recent Jira project:', error);
      return Promise.reject(error);
    }
  }

  public getRecentJiraProjects(): Promise<RecentJiraProject[]> {
    try {
      const stmt = this.db.prepare(
        'SELECT project_key as key, name, last_viewed FROM recent_jira_projects ORDER BY last_viewed DESC LIMIT 10',
      );
      const rows = stmt.all() as Array<{ key: string; name: string; last_viewed: string }>;

      const projects = rows.map((row) => ({
        key: row.key,
        name: row.name,
        lastViewed: new Date(row.last_viewed),
      }));

      return Promise.resolve(projects);
    } catch (error) {
      this.logger.error('Error getting recent Jira projects:', error);
      return Promise.resolve([]);
    }
  }

  // Dashboard Cache Methods
  public cacheDashboard(projectPath: string, metrics: GitLabProjectMetrics): Promise<void> {
    try {
      const timestamp = new Date().toISOString();
      const metricsJson = JSON.stringify(metrics);

      const stmt = this.db.prepare(
        'INSERT OR REPLACE INTO dashboard_cache (project_path, metrics, timestamp) VALUES ($path, $metrics, $time)',
      );
      stmt.run({
        $path: projectPath,
        $metrics: metricsJson,
        $time: timestamp,
      });

      return Promise.resolve();
    } catch (error) {
      this.logger.error('Error caching dashboard:', error);
      return Promise.reject(error);
    }
  }

  public clearDashboardCache(projectPath?: string): Promise<void> {
    try {
      if (projectPath) {
        const stmt = this.db.prepare('DELETE FROM dashboard_cache WHERE project_path = $path');
        stmt.run({ $path: projectPath });
      } else {
        this.db.exec('DELETE FROM dashboard_cache');
      }
      return Promise.resolve();
    } catch (error) {
      this.logger.error('Error clearing dashboard cache:', error);
      return Promise.reject(error);
    }
  }

  // Confluence Methods
  getRecentConfluenceSpaces(): Promise<RecentConfluenceSpace[]> {
    try {
      const stmt = this.db.prepare(`
        SELECT space_key as key, name, last_viewed 
        FROM recent_confluence_spaces 
        ORDER BY last_viewed DESC 
        LIMIT 10
      `);
      const rows = stmt.all() as Array<{ key: string; name: string; last_viewed: string }>;

      const spaces = rows.map((row) => ({
        key: row.key,
        name: row.name,
        lastViewed: new Date(row.last_viewed),
      }));

      return Promise.resolve(spaces);
    } catch (error) {
      this.logger.error('Error getting recent Confluence spaces:', error);
      return Promise.resolve([]);
    }
  }

  addRecentConfluenceSpace(spaceKey: string, name: string): void {
    const stmt = this.db.prepare(
      'INSERT OR REPLACE INTO recent_confluence_spaces (space_key, name, last_viewed) VALUES ($key, $name, datetime("now"))',
    );
    stmt.run({ $key: spaceKey, $name: name });
  }

  clearConfluenceDashboardCache(spaceKey: string): void {
    try {
      const stmt = this.db.prepare(
        'DELETE FROM confluence_dashboard_cache WHERE space_key = $key',
      );
      stmt.run({ $key: spaceKey });
    } catch (error) {
      this.logger.error('Error clearing Confluence dashboard cache:', error);
    }
  }

  cacheConfluenceSpaces(spaces: ConfluenceSpace[]): void {
    try {
      this.db.exec('DELETE FROM confluence_spaces_cache');

      const stmt = this.db.prepare(
        'INSERT INTO confluence_spaces_cache (space_key, data, timestamp) VALUES ($key, $data, $time)',
      );

      const timestamp = new Date().toISOString();
      for (const space of spaces) {
        stmt.run({
          $key: space.key,
          $data: JSON.stringify(space),
          $time: timestamp,
        });
      }
    } catch (error) {
      this.logger.error('Error caching Confluence spaces:', error);
    }
  }

  clearConfluenceSpacesCache(): Promise<void> {
    try {
      this.db.exec('DELETE FROM confluence_spaces_cache');
      return Promise.resolve();
    } catch (error) {
      this.logger.error('Error clearing Confluence spaces cache:', error);
      return Promise.reject(error);
    }
  }

  cacheConfluenceDashboard(spaceKey: string, stats: ConfluenceSpaceStats): Promise<void> {
    try {
      const stmt = this.db.prepare(
        'INSERT OR REPLACE INTO confluence_dashboard_cache (space_key, stats, timestamp) VALUES ($key, $stats, $time)',
      );
      stmt.run({
        $key: spaceKey,
        $stats: JSON.stringify(stats),
        $time: new Date().toISOString(),
      });
      return Promise.resolve();
    } catch (error) {
      this.logger.error('Error caching Confluence dashboard:', error);
      return Promise.reject(error);
    }
  }

  public async getCachedConfluenceSpaces(): Promise<ConfluenceSpace[] | null> {
    try {
      const stmt = this.db.prepare(
        'SELECT data, timestamp FROM confluence_spaces_cache',
      );
      const rows = stmt.all() as Array<{ data: string; timestamp: string }>;

      if (rows.length === 0) return null;

      // Check if cache is too old (24 hours)
      const firstRow = rows[0];
      const age = Date.now() - new Date(firstRow.timestamp).getTime();
      if (age > this.dashboardCacheDuration) {
        await this.clearConfluenceSpacesCache();
        return null;
      }

      return rows.map((row) => JSON.parse(row.data));
    } catch (error) {
      this.logger.error('Error getting cached Confluence spaces:', error);
      return null;
    }
  }

  public async getCachedConfluenceDashboard(
    spaceKey: string,
  ): Promise<{ stats: ConfluenceSpaceStats; timestamp: Date } | null> {
    try {
      const stmt = this.db.prepare(
        'SELECT stats, timestamp FROM confluence_dashboard_cache WHERE space_key = $key',
      );
      const row = stmt.get({ $key: spaceKey }) as { stats: string; timestamp: string } | undefined;

      if (!row) return null;

      // Check if cache is too old
      const age = Date.now() - new Date(row.timestamp).getTime();
      if (age > this.dashboardCacheDuration) {
        await this.clearConfluenceDashboardCache(spaceKey);
        return null;
      }

      return {
        stats: JSON.parse(row.stats),
        timestamp: new Date(row.timestamp),
      };
    } catch (error) {
      this.logger.error('Error getting cached Confluence dashboard:', error);
      return null;
    }
  }

  public async getCachedDashboard(projectPath: string): Promise<CachedDashboard | null> {
    try {
      const stmt = this.db.prepare(
        'SELECT metrics, timestamp FROM dashboard_cache WHERE project_path = $path',
      );
      const row = stmt.get({ $path: projectPath }) as
        | { metrics: string; timestamp: string }
        | undefined;

      if (!row) return null;

      // Check if cache is too old
      const age = Date.now() - new Date(row.timestamp).getTime();
      if (age > this.dashboardCacheDuration) {
        await this.clearDashboardCache(projectPath);
        return null;
      }

      return {
        projectPath,
        metrics: JSON.parse(row.metrics),
        timestamp: new Date(row.timestamp),
      };
    } catch (error) {
      this.logger.error('Error getting cached dashboard:', error);
      return null;
    }
  }

  public async getCachedJiraDashboard(projectKey: string): Promise<CachedJiraDashboard | null> {
    try {
      const stmt = this.db.prepare(
        'SELECT metrics, timestamp FROM jira_dashboard_cache WHERE project_key = $key',
      );
      const row = stmt.get({ $key: projectKey }) as
        | { metrics: string; timestamp: string }
        | undefined;

      if (!row) {
        return null;
      }

      // Check if cache is too old
      const age = Date.now() - new Date(row.timestamp).getTime();
      if (age > this.dashboardCacheDuration) {
        await this.clearJiraDashboardCache(projectKey);
        return null;
      }

      return {
        projectKey,
        metrics: JSON.parse(row.metrics),
        timestamp: new Date(row.timestamp),
      };
    } catch (error) {
      this.logger.error('Error getting cached Jira dashboard:', error);
      return null;
    }
  }

  public cacheJiraDashboard(projectKey: string, metrics: JiraProjectMetrics): void {
    try {
      const stmt = this.db.prepare(
        'INSERT OR REPLACE INTO jira_dashboard_cache (project_key, metrics, timestamp) VALUES ($key, $metrics, $time)',
      );
      stmt.run({
        $key: projectKey,
        $metrics: JSON.stringify(metrics),
        $time: new Date().toISOString(),
      });
    } catch (error) {
      this.logger.error('Error caching Jira dashboard:', error);
    }
  }

  public clearJiraDashboardCache(projectKey?: string): void {
    try {
      if (projectKey) {
        const stmt1 = this.db.prepare('DELETE FROM jira_raw_data WHERE project_key = $key');
        const stmt2 = this.db.prepare('DELETE FROM jira_dashboard_cache WHERE project_key = $key');
        stmt1.run({ $key: projectKey });
        stmt2.run({ $key: projectKey });
      } else {
        this.db.exec('DELETE FROM jira_raw_data');
        this.db.exec('DELETE FROM jira_dashboard_cache');
      }
    } catch (error) {
      this.logger.error('Error clearing Jira dashboard cache:', error);
    }
  }

  public getGitLabDashboard(projectPath: string): CachedDashboard | null {
    try {
      const stmt = this.db.prepare(
        'SELECT metrics, timestamp FROM dashboard_cache WHERE project_path = $path',
      );
      const row = stmt.get({ $path: projectPath }) as
        | { metrics: string; timestamp: string }
        | undefined;

      if (!row) {
        return null;
      }

      const timestamp = new Date(row.timestamp);
      if (Date.now() - timestamp.getTime() > this.dashboardCacheDuration) {
        // Cache expired
        return null;
      }

      return {
        projectPath,
        metrics: JSON.parse(row.metrics),
        timestamp,
      };
    } catch (error) {
      this.logger.error('Error getting GitLab dashboard:', error);
      return null;
    }
  }

  // Cache GitLab projects list
  public cacheProjectsList(projects: ProjectSchema[]): void {
    try {
      this.clearProjectsCache();
      const stmt = this.db.prepare(
        'INSERT INTO projects_cache (data, timestamp) VALUES ($data, $time)',
      );
      stmt.run({
        $data: JSON.stringify(projects),
        $time: new Date().toISOString(),
      });
    } catch (error) {
      this.logger.error('Error caching projects list:', error);
    }
  }

  public clearProjectsCache(): void {
    try {
      const stmt = this.db.prepare('DELETE FROM projects_cache');
      stmt.run();
    } catch (error) {
      this.logger.error('Error clearing projects cache:', error);
    }
  }

  // Cache GitLab namespaces list
  public cacheNamespacesList(namespaces: GitLabNamespace[]): void {
    try {
      this.clearNamespacesCache();
      const stmt = this.db.prepare(
        'INSERT INTO namespaces_cache (namespaces, timestamp) VALUES ($namespaces, $time)',
      );
      stmt.run({
        namespaces: JSON.stringify(namespaces),
        time: new Date().toISOString(),
      });
    } catch (error) {
      this.logger.error('Error caching namespaces list:', error);
    }
  }

  public clearNamespacesCache(): void {
    try {
      const stmt = this.db.prepare('DELETE FROM namespaces_cache');
      stmt.run();
    } catch (error) {
      this.logger.error('Error clearing namespaces cache:', error);
    }
  }

  /**
   * Cache Jira projects list
   */
  public cacheJiraProjectsList(projects: JiraProject[]): void {
    try {
      this.clearJiraProjectsCache();
      const stmt = this.db.prepare(
        'INSERT INTO jira_projects_cache (data, timestamp) VALUES ($data, $time)',
      );
      stmt.run({
        $data: JSON.stringify(projects),
        $time: new Date().toISOString(),
      });
    } catch (error) {
      this.logger.error('Error caching Jira projects list:', error);
    }
  }

  /**
   * Get cached Jira projects list
   */
  public getCachedJiraProjectsList(): { projects: JiraProject[]; timestamp: Date } | null {
    try {
      const stmt = this.db.prepare(
        'SELECT data, timestamp FROM jira_projects_cache ORDER BY timestamp DESC LIMIT 1',
      );
      const row = stmt.get() as { data: string; timestamp: string } | undefined;

      if (!row) {
        return null;
      }

      return {
        projects: JSON.parse(row.data),
        timestamp: new Date(row.timestamp),
      };
    } catch (error) {
      this.logger.error('Error getting cached Jira projects list:', error);
      return null;
    }
  }

  /**
   * Clear Jira projects cache
   */
  public clearJiraProjectsCache(): void {
    try {
      const stmt = this.db.prepare('DELETE FROM jira_projects_cache');
      stmt.run();
    } catch (error) {
      this.logger.error('Error clearing Jira projects cache:', error);
    }
  }

  /**
   * Cache Jira sprint data for a project
   */
  public cacheJiraSprintData(projectKey: string, sprintData: SprintData[]): void {
    if (!this.data.cachedJiraSprintData) {
      this.data.cachedJiraSprintData = {};
    }
    this.data.cachedJiraSprintData[projectKey] = {
      projectKey,
      sprintData,
      timestamp: new Date(),
    };
    this.saveData();
    this.logger.info(`Cached Jira sprint data for project ${projectKey}`);
  }

  /**
   * Clear Jira sprint data cache for a project or all projects
   */
  public clearJiraSprintDataCache(projectKey?: string): void {
    if (projectKey) {
      if (this.data.cachedJiraSprintData?.[projectKey]) {
        delete this.data.cachedJiraSprintData[projectKey];
        this.saveData();
        this.logger.info(`Cleared Jira sprint data cache for project ${projectKey}`);
      }
    } else {
      this.data.cachedJiraSprintData = {};
      this.saveData();
      this.logger.info('Cleared all Jira sprint data cache');
    }
  }

  /**
   * Get cached Jira sprint data for a project
   */
  public getCachedJiraSprintData(projectKey: string): CachedJiraSprintData | null {
    if (!this.data.cachedJiraSprintData?.[projectKey]) {
      return null;
    }

    const cached = this.data.cachedJiraSprintData[projectKey];

    // Check if cache is older than 24 hours
    if (Date.now() - cached.timestamp.getTime() > 24 * 60 * 60 * 1000) {
      this.logger.info(
        `Cache for Jira sprint data (${projectKey}) is older than 24 hours, removing it`,
      );
      this.clearJiraSprintDataCache(projectKey);
      return null;
    }

    return cached;
  }

  // Cleanup
  public close(): Promise<void> {
    try {
      this.db.close();
      return Promise.resolve();
    } catch (error) {
      this.logger.error('Error closing database:', error);
      return Promise.reject(error);
    }
  }

  public getCachedDoraMetrics(
    jiraProjectKey: string,
    gitlabProjectPath: string,
    timeRange: TimeRange,
  ): CachedDoraMetrics | null {
    try {
      const stmt = this.db.prepare(
        'SELECT results, timestamp FROM dora_metrics_cache WHERE jira_project_key = $jiraKey AND gitlab_project_path = $gitlabPath AND time_range = $timeRange',
      );
      const row = stmt.get({
        $jiraKey: jiraProjectKey,
        $gitlabPath: gitlabProjectPath,
        $timeRange: timeRange,
      }) as { results: string; timestamp: string } | undefined;

      if (!row) {
        return null;
      }

      // Check if cache is expired
      const timestamp = new Date(row.timestamp);
      if (Date.now() - timestamp.getTime() > this.dashboardCacheDuration) {
        this.clearDoraMetricsCache(jiraProjectKey, gitlabProjectPath, timeRange);
        return null;
      }

      const results = JSON.parse(row.results);
      // Ensure timestamp in results is a Date object
      results.timestamp = new Date(results.timestamp);

      return {
        jiraProjectKey,
        gitlabProjectPath,
        timeRange,
        results,
        timestamp,
      };
    } catch (error) {
      this.logger.error('Error getting cached DORA metrics:', error);
      return null;
    }
  }

  public cacheDoraMetrics(
    jiraProjectKey: string,
    gitlabProjectPath: string,
    timeRange: TimeRange,
    results: DoraMetricsResult,
  ): void {
    try {
      const resultsJson = JSON.stringify(results);
      const stmt = this.db.prepare(
        'INSERT OR REPLACE INTO dora_metrics_cache (jira_project_key, gitlab_project_path, time_range, results, timestamp) VALUES ($jiraKey, $gitlabPath, $timeRange, $results, $time)',
      );
      stmt.run({
        $jiraKey: jiraProjectKey,
        $gitlabPath: gitlabProjectPath,
        $timeRange: timeRange,
        $results: resultsJson,
        $time: new Date().toISOString(),
      });
    } catch (error) {
      this.logger.error('Error caching DORA metrics:', error);
    }
  }

  public clearDoraMetricsCache(
    jiraProjectKey?: string,
    gitlabProjectPath?: string,
    timeRange?: TimeRange,
  ): void {
    try {
      if (jiraProjectKey && gitlabProjectPath && timeRange) {
        const stmt = this.db.prepare(
          'DELETE FROM dora_metrics_cache WHERE jira_project_key = $jiraKey AND gitlab_project_path = $gitlabPath AND time_range = $timeRange',
        );
        stmt.run({
          $jiraKey: jiraProjectKey,
          $gitlabPath: gitlabProjectPath,
          $timeRange: timeRange,
        });
      } else {
        const stmt = this.db.prepare('DELETE FROM dora_metrics_cache');
        stmt.run();
      }
    } catch (error) {
      this.logger.error('Error clearing DORA metrics cache:', error);
    }
  }

  public getCachedProjectsList(): { projects: ProjectSchema[]; timestamp: Date } | null {
    try {
      const stmt = this.db.prepare(
        'SELECT data, timestamp FROM projects_cache ORDER BY timestamp DESC LIMIT 1',
      );
      const row = stmt.get() as { data: string; timestamp: string } | undefined;

      if (!row) {
        return null;
      }

      return {
        projects: JSON.parse(row.data),
        timestamp: new Date(row.timestamp),
      };
    } catch (error) {
      this.logger.error('Error getting cached projects list:', error);
      return null;
    }
  }

  public getCachedNamespacesList(): { namespaces: GitLabNamespace[]; timestamp: Date } | null {
    try {
      const stmt = this.db.prepare(
        'SELECT namespaces, timestamp FROM namespaces_cache ORDER BY timestamp DESC LIMIT 1',
      );
      const row = stmt.get() as { namespaces: string; timestamp: string } | undefined;

      if (!row) {
        return null;
      }

      return {
        namespaces: JSON.parse(row.namespaces),
        timestamp: new Date(row.timestamp),
      };
    } catch (error) {
      this.logger.error('Error getting cached namespaces list:', error);
      return null;
    }
  }

  public initializeConfluenceTables(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS confluence_recent_spaces (
        space_key TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        last_viewed DATETIME NOT NULL
      )
    `);

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS confluence_pages_cache (
        page_id TEXT PRIMARY KEY,
        data TEXT NOT NULL,
        timestamp TEXT NOT NULL
      )
    `);
  }

  getCachedConfluencePage(pageId: string): ConfluencePage | null {
    try {
      const stmt = this.db.prepare(
        'SELECT data, timestamp FROM confluence_pages_cache WHERE page_id LIKE $pattern',
      );
      const row = stmt.get({ $pattern: `%:${pageId}` }) as
        | { data: string; timestamp: string }
        | undefined;

      if (!row) return null;

      // Check if cache is too old (24 hours)
      const age = Date.now() - new Date(row.timestamp).getTime();
      if (age > this.dashboardCacheDuration) {
        this.clearConfluencePageCache(pageId);
        return null;
      }

      return JSON.parse(row.data);
    } catch (error) {
      this.logger.error('Error getting cached Confluence page:', error);
      return null;
    }
  }

  public cacheConfluencePage(pageId: string, page: ConfluencePage): void {
    try {
      const stmt = this.db.prepare(
        'INSERT OR REPLACE INTO confluence_pages_cache (page_id, data, timestamp) VALUES ($id, $data, $time)',
      );

      stmt.run({
        $id: `${page.space?.key || 'unknown'}:${pageId}`,
        $data: JSON.stringify(page),
        $time: new Date().toISOString(),
      });
    } catch (error) {
      this.logger.error('Error caching Confluence page:', error);
    }
  }

  public clearConfluencePageCache(pageId: string): void {
    try {
      const stmt = this.db.prepare(
        'DELETE FROM confluence_pages_cache WHERE page_id LIKE $pattern',
      );
      stmt.run({ $pattern: `%:${pageId}` });
    } catch (error) {
      this.logger.error('Error clearing Confluence page cache:', error);
    }
  }

  /**
   * Cache raw Jira data
   */
  cacheJiraRawData(projectKey: string, data: {
    project: JiraProject;
    issues: { issues: JiraIssue[] };
    sprintData: SprintData[];
  }): void {
    const stmt = this.db.prepare(
      'INSERT OR REPLACE INTO jira_raw_data (project_key, data, timestamp) VALUES ($key, $data, $time)',
    );
    stmt.run({
      $key: projectKey,
      $data: JSON.stringify(data),
      $time: new Date().toISOString(),
    });
  }

  /**
   * Get cached raw Jira data
   */
  getCachedJiraRawData(projectKey: string): {
    data: {
      project: JiraProject;
      issues: { issues: JiraIssue[] };
      sprintData: SprintData[];
    };
    timestamp: Date;
  } | null {
    try {
      const stmt = this.db.prepare(
        'SELECT data, timestamp FROM jira_raw_data WHERE project_key = $key',
      );
      const result = stmt.get({ $key: projectKey }) as
        | { data: string; timestamp: string }
        | undefined;

      if (!result) return null;

      return {
        data: JSON.parse(result.data),
        timestamp: new Date(result.timestamp),
      };
    } catch (error) {
      this.logger.error('Error getting cached Jira raw data:', error);
      return null;
    }
  }

  /**
   * Initialize Jira tables
   */
  async initializeJiraTables(): Promise<void> {
    await this.db.exec(`
      CREATE TABLE IF NOT EXISTS jira_raw_data (
        project_key TEXT PRIMARY KEY,
        data TEXT NOT NULL,
        timestamp TEXT NOT NULL
      )
    `);

    await this.db.exec(`
      CREATE TABLE IF NOT EXISTS jira_dashboard_cache (
        project_key TEXT PRIMARY KEY,
        metrics TEXT NOT NULL,
        timestamp TEXT NOT NULL
      )
    `);

    await this.db.exec(`
      CREATE TABLE IF NOT EXISTS jira_recent_projects (
        key TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        last_viewed TEXT NOT NULL
      )
    `);
  }

  public clearConfluencePagesCache(): void {
    try {
      this.db.exec('DELETE FROM confluence_pages_cache');
    } catch (error) {
      this.logger.error('Error clearing Confluence pages cache:', error);
    }
  }

  public async getCachedConfluencePages(spaceKey: string): Promise<ConfluencePage[] | null> {
    try {
      const stmt = this.db.prepare(
        'SELECT data, timestamp FROM confluence_pages_cache WHERE page_id LIKE $pattern',
      );
      const rows = stmt.all({ $pattern: `${spaceKey}:%` }) as Array<
        { data: string; timestamp: string }
      >;

      if (rows.length === 0) return null;

      // Check if cache is too old (24 hours)
      const firstRow = rows[0];
      const age = Date.now() - new Date(firstRow.timestamp).getTime();
      if (age > this.dashboardCacheDuration) {
        await this.clearConfluencePagesCache();
        return null;
      }

      return rows.map((row) => JSON.parse(row.data));
    } catch (error) {
      this.logger.error('Error getting cached Confluence pages:', error);
      return null;
    }
  }

  public cacheConfluencePages(spaceKey: string, pages: ConfluencePage[]): Promise<void> {
    try {
      // Clear existing pages for this space
      const stmt = this.db.prepare(
        'DELETE FROM confluence_pages_cache WHERE page_id LIKE $pattern',
      );
      stmt.run({ $pattern: `${spaceKey}:%` });

      // Insert new pages
      const insertStmt = this.db.prepare(
        'INSERT INTO confluence_pages_cache (page_id, data, timestamp) VALUES ($id, $data, $time)',
      );

      const timestamp = new Date().toISOString();
      for (const page of pages) {
        insertStmt.run({
          $id: `${spaceKey}:${page.id}`,
          $data: JSON.stringify(page),
          $time: timestamp,
        });
      }
      return Promise.resolve();
    } catch (error) {
      this.logger.error('Error caching Confluence pages:', error);
      return Promise.reject(error);
    }
  }
}
