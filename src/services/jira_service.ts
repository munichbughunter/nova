import { colors } from '@cliffy/ansi/colors';
import { Table } from '@cliffy/table';
import { Config } from '../config/mod.ts';
import { formatServiceStatus, formatTimestamp, ProgressIndicator, theme } from '../utils.ts';
import { DevCache } from '../utils/devcache.ts';
import { Logger } from '../utils/logger.ts';
import { DatabaseService } from './db_service.ts';

export class JiraService {
  private config: Config;
  private baseUrl: string;
  private jira: JiraClient;
  private logger: Logger;
  private cache: DevCache;
  private initialized = false;
  private currentProjectKey: string = '';
  private sprintFieldsLogged = false;
  private storyPointsField: string = 'customfield_10467';
  private isAnalyzingFields = false;

  private getFieldValue(issue: JiraIssue, fieldKey: string): unknown {
    const field = issue.fields[fieldKey];
    if (typeof field === 'object' && field !== null) {
      if ('value' in field) return field.value;
      if ('name' in field) return field.name;
    }
    return field;
  }

  constructor(config: Config) {
    if (
      !config.atlassian?.jira_url || !config.atlassian?.jira_token || !config.atlassian?.username
    ) {
      throw new Error('Jira is not configured properly.');
    }
    this.config = config;
    this.baseUrl = config.atlassian.jira_url;
    this.logger = new Logger('Jira', Deno.env.get('nova_DEBUG') === 'true');

    // Initialize cache
    this.cache = new DevCache({
      basePath: `${Deno.env.get('HOME')}/.nova/cache`,
      serviceName: 'jira',
      logger: this.logger,
    });

    // Initialize Jira client with basic structure
    this.jira = {
      board: {
        getSprintsForBoard: async (options: {
          boardId: number;
          state: string[];
          maxResults: number;
        }) => {
          const allSprints: JiraSprint[] = [];
          let startAt = 0;
          let isLast = false;

          // Fetch all sprints first
          while (!isLast) {
            const response = await this.request<
              { values: JiraSprint[]; isLast: boolean; total: number }
            >(
              `/rest/agile/1.0/board/${options.boardId}/sprint?state=${
                options.state.join(',')
              }&startAt=${startAt}&maxResults=50`,
            );

            if (response.values) {
              allSprints.push(...response.values);
            }

            isLast = response.isLast;
            if (!isLast) {
              startAt += response.values.length;
            }
          }

          // Sort sprints by end date (most recent first) and state (active first)
          const sortedSprints = allSprints.sort((a, b) => {
            // First sort by state (active sprints first)
            if (a.state === 'active' && b.state !== 'active') return -1;
            if (a.state !== 'active' && b.state === 'active') return 1;

            // Then sort by end date (most recent first)
            const dateA = a.endDate ? new Date(a.endDate).getTime() : 0;
            const dateB = b.endDate ? new Date(b.endDate).getTime() : 0;
            return dateB - dateA;
          });

          // Return only the requested number of sprints
          return {
            values: sortedSprints.slice(0, options.maxResults),
          };
        },
        getIssuesForSprint: (options: {
          sprintId: string;
          maxResults: number;
          fields: string[];
        }) =>
          this.request<{ issues: JiraIssue[] }>(
            `/rest/agile/1.0/sprint/${options.sprintId}/issue?maxResults=${options.maxResults}&fields=${
              options.fields.join(',')
            }`,
          ),
      },
    };
  }

  private async ensureCustomFieldsAnalyzed(): Promise<void> {
    if (!this.initialized) {
      await this.analyzeCustomFields();
      this.initialized = true;
    }
  }

  private async analyzeCustomFields(): Promise<void> {
    try {
      this.isAnalyzingFields = true;
      // Get a sample issue directly using request instead of searchIssues
      const response = await this.request<{ issues: JiraIssue[] }>('/rest/api/2/search', {
        method: 'POST',
        body: JSON.stringify({
          jql: 'order by created DESC',
          maxResults: 1,
          fields: ['*all'],
        }),
      });
      this.isAnalyzingFields = false;

      if (response.issues && response.issues.length > 0) {
        const sampleIssue = response.issues[0];

        // Log all custom fields and their values
        const customFields = Object.entries(sampleIssue.fields)
          .filter(([key, _value]) => key.startsWith('customfield_'))
          .reduce(
            (acc, [key, _value]) => ({ ...acc, [key]: this.getFieldValue(sampleIssue, key) }),
            {},
          );

        this.logger.debug('All custom fields found:', customFields);

        // Common story points field names and patterns
        const potentialFields = [
          'customfield_10016',
          'customfield_10002',
          'customfield_10004',
          'story_points',
          'storypoints',
          'points',
        ];

        // Additional patterns to check in field names and metadata
        const storyPointsPatterns = [
          /story.*point/i,
          /point.*story/i,
          /sp[_\s]?field/i,
          /^sp$/i,
          /^points?$/i,
          /estimate/i,
        ];

        // Check which fields exist and have numeric values
        const foundFields = Object.entries(sampleIssue.fields)
          .filter(([key, value]) => {
            const isNumeric = typeof value === 'number';
            const isCustomField = key.startsWith('customfield_');
            const isPotentialField = potentialFields.includes(key);
            const matchesPattern = isCustomField && (
              storyPointsPatterns.some((pattern) => pattern.test(key)) ||
              (sampleIssue.fields[key]?.name &&
                storyPointsPatterns.some((pattern) =>
                  pattern.test(sampleIssue.fields[key].name)
                )) ||
              (sampleIssue.fields[key]?.schema?.custom &&
                storyPointsPatterns.some((pattern) =>
                  pattern.test(sampleIssue.fields[key].schema.custom)
                ))
            );

            return isNumeric && (isPotentialField || matchesPattern);
          });

        if (foundFields.length > 0) {
          this.logger.debug(
            'Found potential story points fields:',
            foundFields.map(([key, value]) => ({
              field: key,
              value: value,
              type: typeof value,
              name: sampleIssue.fields[key]?.name || 'unnamed',
              schema: sampleIssue.fields[key]?.schema || 'no schema',
            })),
          );

          // If we found fields, use the first one as our story points field
          const firstField = foundFields[0][0];
          if (firstField !== this.storyPointsField) {
            this.logger.debug(
              `Setting story points field to: ${firstField} (was: ${this.storyPointsField})`,
            );
            this.storyPointsField = firstField;
          }
        } else {
          this.logger.debug('No story points fields found. Using default:', this.storyPointsField);
        }
      }
    } catch (error) {
      this.logger.error('Error analyzing custom fields:', error);
    }
  }

  private extractQueryType(key: string): string {
    // Extract query type from API endpoints
    if (key.includes('/rest/agile/')) {
      return 'agile';
    } else if (key.includes('/rest/api/')) {
      return 'api';
    }
    return 'other';
  }

  private async request<T>(
    path: string,
    options: RequestInit = {},
  ): Promise<T> {
    try {
      // Try to get from cache first
      const cacheKey = `${path}_${JSON.stringify(options)}`;
      const queryType = this.extractQueryType(path);
      const cached = await this.cache.get<T>(cacheKey, queryType);
      if (cached) {
        return cached;
      }

      const url = new URL(path, this.baseUrl);
      const headers = new Headers({
        'Authorization': `Basic ${
          btoa(`${this.config.atlassian?.username}:${this.config.atlassian?.jira_token}`)
        }`,
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'Accept-Language': 'en-US',
      });

      const response = await fetch(url, {
        ...options,
        headers: {
          ...Object.fromEntries(headers.entries()),
          ...options.headers,
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(
          `Jira API error: ${response.status} ${response.statusText} - ${errorText}`,
        );
      }

      const text = await response.text();
      if (!text) return {} as T;

      try {
        const data = JSON.parse(text) as T;
        // Cache the successful response
        await this.cache.set(cacheKey, data, queryType);
        return data;
      } catch {
        return {} as T;
      }
    } catch (error) {
      if (error instanceof Error) {
        throw new Error(`Error in request: ${error.message}`);
      }
      throw new Error('Unknown error in request');
    }
  }

  public async clearCache(pattern?: string): Promise<void> {
    await this.cache.clear(pattern);
  }

  private async initialize(projectKey: string): Promise<void> {
    if (!this.initialized || this.currentProjectKey !== projectKey) {
      this.currentProjectKey = projectKey;
      await this.ensureCustomFieldsAnalyzed();
      this.initialized = true;
    }
  }

  protected makeRequest<T>(
    endpoint: string,
    method: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'GET',
    body?: unknown,
  ): Promise<T> {
    const options: RequestInit = {
      method,
      ...(body ? { body: JSON.stringify(body) } : {}),
    };
    return this.request<T>(endpoint, options);
  }

  public async searchIssues(
    jql: string,
    options: { maxResults?: number; expandFields?: boolean } = {},
  ): Promise<{ issues: JiraIssue[] }> {
    try {
      if (!this.isAnalyzingFields) {
        await this.ensureCustomFieldsAnalyzed();
      }
      this.logger.debug('Searching issues with JQL:', jql);

      // Ensure project key is properly quoted in JQL if present
      const sanitizedJql = jql.replace(/project\s*=\s*([^"\s]+)/, 'project = "$1"');
      this.logger.debug('Sanitized JQL:', sanitizedJql);

      const allIssues: JiraIssue[] = [];
      let startAt = 0;
      const batchSize = 100; // Increased batch size for better performance
      const maxResults = options.maxResults || 1000; // Default to 1000 if not specified

      while (allIssues.length < maxResults) {
        this.logger.debug(`Fetching issues batch starting at ${startAt}`);

        // Construct the request body
        const requestBody = {
          jql: sanitizedJql,
          startAt,
          maxResults: Math.min(batchSize, maxResults - allIssues.length),
          fields: options.expandFields ? ['*all'] : [
            'summary',
            'description',
            'created',
            'resolutiondate',
            'updated',
            'duedate',
            'labels',
            'status',
            'issuetype',
            'priority',
            'assignee',
            'reporter',
            this.storyPointsField,
            'customfield_10020',
            'components',
            'changelog',
          ],
          expand: ['changelog'],
        };

        const response = await this.request<{ issues: JiraIssue[]; total: number }>(
          '/rest/api/2/search',
          {
            method: 'POST',
            body: JSON.stringify(requestBody),
          },
        );

        if (response.issues && response.issues.length > 0) {
          // Log fields of first issue in first batch for debugging
          if (startAt === 0 && response.issues.length > 0) {
            const sampleIssue = response.issues[0];
            this.logger.debug('Sample issue fields:', {
              key: sampleIssue.key,
              fields: Object.entries(sampleIssue.fields)
                .filter(([_key, value]) => value !== null)
                .reduce(
                  (acc, [key, _value]) => ({ ...acc, [key]: this.getFieldValue(sampleIssue, key) }),
                  {},
                ),
            });
          }

          allIssues.push(...response.issues);
          this.logger.debug(
            `Retrieved ${response.issues.length} issues (total: ${allIssues.length}/${response.total})`,
          );

          // Check if we've retrieved all issues
          if (allIssues.length >= response.total || response.issues.length < batchSize) {
            break;
          }

          // Prepare for next batch
          startAt += batchSize;
        } else {
          break;
        }
      }

      this.logger.debug(`Completed search, found ${allIssues.length} total issues`);
      return { issues: allIssues };
    } catch (error) {
      this.logger.error('Error searching issues:', error);
      throw error;
    }
  }

  public getIssue(issueKey: string): Promise<JiraIssue> {
    return this.request<JiraIssue>(`/rest/api/2/issue/${issueKey}`);
  }

  /**
   * Get all projects with caching support
   */
  async getProjects(forceRefresh = false): Promise<JiraProject[]> {
    try {
      // Check cache first if not forced to refresh
      if (!forceRefresh) {
        const db = await DatabaseService.getInstance();
        const cachedData = await db.getCachedJiraProjectsList();

        // Use cache if it exists and is less than 1 day old
        const oneDay = 24 * 60 * 60 * 1000; // 24 hours in milliseconds
        if (
          cachedData && cachedData.projects && cachedData.projects.length > 0 &&
          (Date.now() - cachedData.timestamp.getTime() < oneDay)
        ) {
          this.logger.debug(
            `Using cached project list with ${cachedData.projects.length} projects from:`,
            cachedData.timestamp,
          );
          return cachedData.projects;
        }
      }

      this.logger.debug('Fetching fresh project list...');

      // If no cache or forced refresh, fetch from API
      const response = await this.request<JiraProject[]>('/rest/api/2/project');

      if (!Array.isArray(response)) {
        throw new Error('Invalid response format from Jira API');
      }

      // Transform URLs to match expected format
      const transformedResponse = response.map((project) => ({
        ...project,
        url: `${this.baseUrl}/browse/${project.key}`,
      }));

      // Cache the results if we successfully fetched projects
      if (transformedResponse.length > 0) {
        const db = await DatabaseService.getInstance();
        await db.cacheJiraProjectsList(transformedResponse);
        this.logger.info(`Successfully cached ${transformedResponse.length} projects`);
      }

      return transformedResponse;
    } catch (error) {
      this.logger.error('Error fetching Jira projects:', error);
      throw error;
    }
  }

  /**
   * Get a specific project
   */
  public async getProject(projectKey: string): Promise<JiraProject> {
    await this.initialize(projectKey);
    const endpoint = `/rest/api/2/project/${encodeURIComponent(projectKey)}`;
    const project = await this.request<JiraProject>(endpoint);
    return {
      ...project,
      url: `${this.baseUrl}/browse/${project.key}`,
    };
  }

  /**
   * Get all boards
   */
  async getBoards(projectKey?: string): Promise<JiraBoard[]> {
    try {
      const endpoint = projectKey
        ? `/rest/agile/1.0/board?projectKeyOrId=${encodeURIComponent(projectKey)}&type=scrum,kanban`
        : '/rest/agile/1.0/board';

      this.logger.debug('Fetching boards with endpoint:', endpoint);

      const allBoards: JiraBoard[] = [];
      let startAt = 0;
      const maxResults = 50; // Fetch in smaller batches

      while (true) {
        this.logger.debug(`Fetching boards batch starting at ${startAt}`);
        const response = await this.request<{
          values: JiraBoard[];
          isLast: boolean;
          total: number;
        }>(`${endpoint}&startAt=${startAt}&maxResults=${maxResults}`);

        if (response.values && response.values.length > 0) {
          allBoards.push(...response.values);
          this.logger.debug(
            `Retrieved ${response.values.length} boards (total: ${allBoards.length}/${response.total})`,
          );

          // Check if we've retrieved all boards
          if (response.isLast || response.values.length < maxResults) {
            break;
          }

          // Prepare for next batch
          startAt += maxResults;
        } else {
          break;
        }
      }

      if (allBoards.length === 0) {
        this.logger.info('No boards found for project:', projectKey);
        return [];
      }

      this.logger.debug(
        'Found boards:',
        allBoards.map((b) => ({ id: b.id, name: b.name, type: b.type })),
      );
      return allBoards;
    } catch (error) {
      this.logger.error('Error fetching boards:', error);
      return [];
    }
  }

  /**
   * Get a board by id
   */
  getBoard(boardId: number): Promise<JiraBoard> {
    return this.request<JiraBoard>(`/rest/agile/1.0/board/${boardId}`);
  }

  /**
   * Get sprints for a board
   */
  async getSprints(
    boardId: number,
    state?: 'active' | 'closed' | 'future' | ('active' | 'closed' | 'future')[],
  ): Promise<JiraSprint[]> {
    try {
      let endpoint = `/rest/agile/1.0/board/${boardId}/sprint`;
      if (state) {
        // Handle both string and array formats
        const stateParam = Array.isArray(state) ? state.join(',') : state;
        endpoint += `?state=${stateParam}`;
      }

      this.logger.debug(
        `Fetching sprints for board ${boardId}${
          state ? ` with state ${Array.isArray(state) ? state.join(',') : state}` : ''
        }`,
      );

      const allSprints: JiraSprint[] = [];
      let startAt = 0;
      const maxResults = 50; // Fetch in smaller batches

      while (true) {
        this.logger.debug(`Fetching sprints batch starting at ${startAt}`);
        const response = await this.request<{
          values: JiraSprint[];
          isLast: boolean;
          total: number;
        }>(`${endpoint}${state ? '&' : '?'}startAt=${startAt}&maxResults=${maxResults}`);

        if (response.values && response.values.length > 0) {
          allSprints.push(...response.values);
          this.logger.debug(
            `Retrieved ${response.values.length} sprints (total: ${allSprints.length}/${response.total})`,
          );

          // Check if we've retrieved all sprints
          if (response.isLast || response.values.length < maxResults) {
            break;
          }

          // Prepare for next batch
          startAt += maxResults;
        } else {
          break;
        }
      }

      this.logger.debug(`Found ${allSprints.length} total sprints`);
      return allSprints;
    } catch (error) {
      this.logger.error('Error fetching sprints:', error);
      return [];
    }
  }

  /**
   * Get issues for a sprint
   */
  async getSprintIssues(sprintId: number): Promise<JiraIssue[]> {
    try {
      this.logger.debug(`Fetching issues for sprint ${sprintId}`);

      const allIssues: JiraIssue[] = [];
      let startAt = 0;
      const maxResults = 50; // Fetch in smaller batches

      while (true) {
        this.logger.debug(`Fetching sprint issues batch starting at ${startAt}`);
        const response = await this.request<{
          issues: JiraIssue[];
          isLast: boolean;
          total: number;
        }>(`/rest/agile/1.0/sprint/${sprintId}/issue?startAt=${startAt}&maxResults=${maxResults}`);

        if (response.issues && response.issues.length > 0) {
          allIssues.push(...response.issues);
          this.logger.debug(
            `Retrieved ${response.issues.length} issues (total: ${allIssues.length}/${response.total})`,
          );

          // Log sample issue fields once for the first batch only
          if (startAt === 0 && response.issues.length > 0) {
            const sampleIssue = response.issues[0];
            const relevantFields = {
              key: sampleIssue.key,
              summary: sampleIssue.fields.summary,
              status: sampleIssue.fields.status.name,
              created: sampleIssue.fields.created,
              updated: sampleIssue.fields.updated,
              resolutiondate: sampleIssue.fields.resolutiondate,
              storyPoints: sampleIssue.fields.customfield_10016,
              sprint: sampleIssue.fields.customfield_10460,
            };
            this.logger.debug('Sample issue fields:', relevantFields);

            // Log only non-null custom fields that might be relevant
            const nonNullCustomFields = Object.entries(sampleIssue.fields)
              .filter(([key, _value]) => key.startsWith('customfield_'))
              .reduce((acc, [key, value]) => ({ ...acc, [key]: value }), {});
            this.logger.debug('Non-null custom fields:', nonNullCustomFields);
          }

          // Check if we've retrieved all issues
          if (response.isLast || response.issues.length < maxResults) {
            break;
          }

          // Prepare for next batch
          startAt += maxResults;
        } else {
          break;
        }
      }

      this.logger.debug(`Found ${allIssues.length} total issues for sprint ${sprintId}`);
      return allIssues;
    } catch (error) {
      this.logger.error(`Error fetching issues for sprint ${sprintId}:`, error);
      return [];
    }
  }

  public async createIssue(params: {
    fields: {
      project: { key: string };
      issuetype: { name: string };
      summary: string;
      description?: string;
      labels?: string[];
    };
  }): Promise<{
    key: string;
    id: string;
    self: string;
  }> {
    const response = await this.request<{
      key: string;
      id: string;
      self: string;
    }>('/rest/api/2/issue', {
      method: 'POST',
      body: JSON.stringify(params),
    });

    return response;
  }

  /**
   * Update an issue
   */
  public async updateIssue(
    issueKey: string,
    data: { fields: Record<string, unknown> },
  ): Promise<void> {
    await this.request<void>(`/rest/api/2/issue/${issueKey}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  /**
   * Delete an issue
   */
  public async deleteIssue(issueKey: string): Promise<void> {
    await this.request<void>(`/rest/api/2/issue/${issueKey}`, {
      method: 'DELETE' as RequestInit['method'],
    });
  }

  /**
   * Add a comment to an issue
   */
  public async addComment(
    issueKey: string,
    comment: string,
  ): Promise<{ id: string; self: string }> {
    try {
      const endpoint = `/rest/api/2/issue/${encodeURIComponent(issueKey)}/comment`;
      const body = { body: comment };
      const response = await this.makeRequest<{ id: string; self: string }>(endpoint, 'POST', body);
      this.logger.info(`Comment added to issue ${issueKey}: ${response.id}`);
      return response;
    } catch (error) {
      this.logger.error(`Failed to add comment to issue ${issueKey}:`, error);
      throw error;
    }
  }

  /**
   * Get issue status statistics for a project
   */
  private async getIssueStats(projectKey: string): Promise<JiraIssueStats> {
    // Get all issues from active sprints and sprint history
    const sprintData = await this.getLastNSprintsData(6, projectKey);
    const allIssues = sprintData.sprintData.reduce((acc, sprint) => {
      // Use Set to deduplicate issues that might appear in multiple sprints
      const issueMap = new Map(acc.map((issue) => [issue.key, issue]));
      sprint.totalIssues.forEach((issue) => {
        if (!issueMap.has(issue.key)) {
          issueMap.set(issue.key, issue);
        }
      });
      return Array.from(issueMap.values());
    }, [] as JiraIssue[]);

    // Get recent activity data
    const [assignedToMe, createdByMe, dueSoon, overdueIssues, recentUpdated] = await Promise.all([
      this.searchIssues(`project = "${projectKey}" AND assignee = currentUser()`),
      this.searchIssues(`project = "${projectKey}" AND reporter = currentUser()`),
      this.searchIssues(`project = "${projectKey}" AND due >= now() AND due <= 1d`),
      this.searchIssues(`project = "${projectKey}" AND due < now() AND resolution = Unresolved`),
      this.searchIssues(`project = "${projectKey}" AND updated >= -7d ORDER BY updated DESC`),
    ]);

    // Calculate status statistics
    const metrics = this.getIssueMetrics(allIssues);
    const byPriority: Record<string, number> = {};

    allIssues.forEach((issue) => {
      // Priority counts
      const priority = issue.fields?.priority?.name || 'Unspecified';
      byPriority[priority] = (byPriority[priority] || 0) + 1;
    });

    // Count issues by type
    const bugs =
      allIssues.filter((issue) => issue.fields.issuetype.name.toLowerCase() === 'bug').length;
    const features =
      allIssues.filter((issue) =>
        ['story', 'task', 'feature'].includes(issue.fields.issuetype.name.toLowerCase())
      ).length;
    const technicalDebt =
      allIssues.filter((issue) =>
        issue.fields.labels?.some((label) => label.toLowerCase().includes('tech-debt'))
      ).length;

    // Ensure all counts are non-negative
    const total = Math.max(0, allIssues.length);
    const open = Math.max(0, metrics.open);
    const inProgress = Math.max(0, metrics.inProgress);
    const done = Math.max(0, metrics.done);
    const backlog = Math.max(0, metrics.backlog);

    return {
      total,
      open,
      inProgress,
      done,
      backlog,
      bugs: Math.max(0, bugs),
      features: Math.max(0, features),
      technicalDebt: Math.max(0, technicalDebt),
      byStatus: metrics.byStatus,
      byPriority,
      byType: metrics.byType,
      byMember: metrics.byMember,
      assignedToMe: Math.max(0, assignedToMe.issues.length),
      createdByMe: Math.max(0, createdByMe.issues.length),
      dueToday: Math.max(0, dueSoon.issues.length),
      overdue: Math.max(0, overdueIssues.issues.length),
      recent: Math.max(0, recentUpdated.issues.length),
    };
  }

  private getIssueMetrics(issues: JiraIssue[]): {
    byStatus: Record<string, number>;
    byType: Record<string, number>;
    byMember: Record<string, number>;
    backlog: number;
    inProgress: number;
    done: number;
    new: number;
    indeterminate: number;
    open: number;
  } {
    const metrics = {
      byStatus: {} as Record<string, number>,
      byType: {} as Record<string, number>,
      byMember: {} as Record<string, number>,
      backlog: 0,
      inProgress: 0,
      done: 0,
      new: 0,
      indeterminate: 0,
      open: 0,
    };

    issues.forEach((issue) => {
      // Status metrics
      const status = issue.fields.status.name;
      const statusCategory = issue.fields.status.statusCategory;
      metrics.byStatus[status] = (metrics.byStatus[status] || 0) + 1;

      // Type metrics
      const type = issue.fields.issuetype.name;
      metrics.byType[type] = (metrics.byType[type] || 0) + 1;

      // Member metrics
      if (issue.fields.assignee) {
        const member = issue.fields.assignee.displayName;
        metrics.byMember[member] = (metrics.byMember[member] || 0) + 1;
      }

      // Status category metrics
      const statusName = status.toLowerCase();

      // Update category counters based on status category key
      switch (statusCategory.key) {
        case 'new':
          metrics.new++;
          if (statusName.includes('backlog')) {
            metrics.backlog++;
          } else {
            metrics.open++;
          }
          break;
        case 'indeterminate':
          metrics.indeterminate++;
          metrics.inProgress++;
          break;
        case 'done':
          metrics.done++;
          break;
      }
    });

    return metrics;
  }

  /**
   * Get comprehensive project metrics
   */
  public async getProjectMetrics(
    jiraProjectKey: string,
    boardId?: number,
  ): Promise<JiraProjectMetrics> {
    await this.ensureCustomFieldsAnalyzed();
    // Start progress indicator
    const progress = new ProgressIndicator();
    progress.start('Analyzing Jira project metrics');

    try {
      // Check cache first
      const cacheKey = `project_metrics_${jiraProjectKey}_${boardId || 'default'}_${Date.now()}`; // Add timestamp to force refresh
      const cached = await this.cache.get<JiraProjectMetrics>(cacheKey, 'metrics');
      if (cached) {
        progress.stop();
        this.logger.debug('Using cached project metrics');
        return cached;
      }

      // Get project details
      progress.update('Fetching project details');
      const project = await this.getProject(jiraProjectKey);

      // Get boards for the project
      const boards = await this.getBoards(jiraProjectKey);
      this.logger.debug(
        'Found boards:',
        boards.map((b) => ({ id: b.id, name: b.name, type: b.type })),
      );

      // If no boardId is provided and there are multiple boards, ask user to select one
      let selectedBoard: JiraBoard | undefined;
      if (!boardId && boards.length > 0) {
        // Stop progress indicator while waiting for user input
        progress.stop();

        // Format boards for display
        const boardChoices = boards.map((b) => ({
          name: `${b.name} (${b.type})`,
          value: b.id.toString(),
        }));

        // Ask user to select a board
        const { Select } = await import('@cliffy/prompt');
        const selectedBoardId = await Select.prompt({
          message: 'Select a board to analyze:',
          options: boardChoices,
          default: boards.find((b) => b.type === 'scrum')?.id.toString() || boardChoices[0].value,
        });

        selectedBoard = boards.find((b) => b.id.toString() === selectedBoardId);

        // Restart progress indicator
        progress.start('Analyzing Jira project metrics');
      } else if (boardId) {
        selectedBoard = boards.find((b) => b.id === boardId);
      } else if (boards.length > 0) {
        // If no selection needed, prefer scrum board or take first available
        selectedBoard = boards.find((b) => b.type === 'scrum') || boards[0];
      }

      if (selectedBoard) {
        this.logger.debug(`Using board: ${selectedBoard.name} (${selectedBoard.type})`);
      }

      // Get last 6 periods data (either sprints or 2-week periods for Kanban)
      progress.update('Analyzing sprint/period data (last 6 periods)');
      const sprintData = selectedBoard?.type === 'scrum'
        ? (await this.getLastNSprintsData(6, jiraProjectKey, selectedBoard?.id)).sprintData
        : await this.getKanbanBoardData(6, jiraProjectKey);

      // Calculate metrics
      progress.update('Calculating project metrics');
      const issues = await this.getIssueStats(jiraProjectKey);
      const members = await this.getTeamMembers(jiraProjectKey);

      // Process recent activity
      progress.update('Processing recent activity (last 7 days)');
      const timeline = await this.getProjectTimeline(jiraProjectKey);

      // Analyze workflow bottlenecks
      progress.update('Analyzing workflow bottlenecks');
      let bottlenecks: { status: string; avgDuration: number; issueCount: number }[] = [];
      // Add null check before accessing stageTransitions
      if (sprintData && sprintData.length > 0 && sprintData[0].stageTransitions) {
        ({ bottlenecks } = this.identifyBottlenecks(sprintData[0].stageTransitions));
      }

      // Calculate sprint/period metrics
      progress.update('Calculating performance metrics');
      const sprintMetrics = this.getSprintMetrics(sprintData[0], sprintData);

      // Calculate health score
      progress.update('Calculating project health score');
      const healthScore = this.calculateHealthScore({
        project,
        issues,
        members,
        timeline,
        bottlenecks,
        sprints: sprintMetrics,
        boardType: selectedBoard?.type || 'scrum',
      });

      // Build metrics object
      progress.update('Compiling final metrics');

      // Calculate velocity and completion rate trends
      const velocityData = sprintData.map((s) => s.velocity);
      const completionRates = sprintData.map((s) => s.completionRate * 100);
      const sprintHistory = sprintData.map((s) => ({
        name: s.name,
        startDate: s.startDate,
        endDate: s.endDate,
        progress: s.progress,
        committedPoints: s.committedPoints,
        completedPoints: s.completedPoints,
        completionRate: s.completionRate,
        avgDailyVelocity: s.avgDailyVelocity,
        committedIssues: s.committedIssues.length,
        completedIssues: s.completedIssues.length,
        committedAndCompleted: s.committedAndCompleted,
        addedDuringSprintAndCompleted: s.addedDuringSprintAndCompleted,
        totalIssues: s.totalIssues.length,
        spiltOverIssues: s.spiltOverIssues.length,
      }));

      const metrics: JiraProjectMetrics = {
        project,
        issues: {
          total: issues.total,
          open: issues.open,
          inProgress: issues.inProgress,
          done: issues.done,
          backlog: issues.backlog,
          bugs: issues.bugs,
          features: issues.features,
          technicalDebt: issues.technicalDebt,
          byStatus: issues.byStatus,
          byType: issues.byType || {},
          byMember: issues.byMember || {},
        },
        members,
        timeline: {
          created: timeline.created,
          resolved: timeline.resolved,
          updated: timeline.updated,
          comments: timeline.comments || [],
        },
        bottlenecks,
        sprints: {
          active: sprintMetrics?.active,
          count: sprintData.length,
          activeCount: sprintData.filter((s) => s.state === 'active').length,
          closedCount: sprintData.filter((s) => s.state === 'closed').length,
          future: sprintData.filter((s) => s.state === 'future').length,
          avgVelocity: sprintMetrics?.avgVelocity || 0,
          avgCompletionRate: sprintMetrics?.avgCompletionRate || 0,
          avgCycleTime: {
            mean: 0,
            median: 0,
            distribution: {
              min: 0,
              max: 0,
              p25: 0,
              p75: 0,
              p90: 0,
            },
          },
          avgThroughput: sprintMetrics?.avgThroughput || 0,
          closed: sprintData.filter((s) => s.state === 'closed').length,
          velocityTrend: velocityData,
          completionRateTrend: completionRates,
          history: sprintHistory,
        },
        healthScore,
        boardType: selectedBoard?.type || 'scrum',
      };

      // Cache results
      progress.update('Caching results for future use');
      await this.cache.set(cacheKey, metrics, 'metrics');

      // Add to recent projects
      await this.addToRecentProjects(project);

      progress.stop();
      this.logger.passThrough('log', colors.green('✓ Project metrics generated successfully\n'));
      return metrics;
    } catch (error) {
      progress.stop();
      this.logger.error('Error getting project metrics:', error);
      throw error;
    }
  }

  /**
   * Calculate average velocity from sprint data
   */
  private calculateAverageVelocity(sprints: SprintData[]): number {
    if (!sprints.length) return 0;

    // Calculate velocity for each sprint based on completed points
    const velocities = sprints.map((sprint) => {
      // Calculate completed story points
      const completedPoints = sprint.completedIssues.reduce(
        (sum, issue) => sum + (issue.fields[this.storyPointsField] || 0),
        0,
      );

      // Calculate sprint duration in days
      const sprintDuration = Math.ceil(
        (sprint.endDate.getTime() - sprint.startDate.getTime()) / (1000 * 60 * 60 * 24),
      );

      // Return points per day
      return completedPoints / Math.max(1, sprintDuration);
    });

    // Calculate average velocity
    const avgVelocity = velocities.reduce((a, b) => a + b, 0) / velocities.length;

    this.logger.debug('Velocity calculation:', {
      velocities: velocities.map((v, i) => `Sprint ${i + 1}: ${v.toFixed(1)} points/day`),
      average: `${avgVelocity.toFixed(1)} points/day`,
    });

    return avgVelocity;
  }

  /**
   * Calculate average cycle time for completed issues
   */
  private calculateAverageCycleTime(issues: JiraIssue[]): {
    mean: number;
    median: number;
    distribution: {
      min: number;
      max: number;
      p25: number;
      p75: number;
      p90: number;
    };
  } {
    if (!issues.length) {
      return {
        mean: 0,
        median: 0,
        distribution: {
          min: 0,
          max: 0,
          p25: 0,
          p75: 0,
          p90: 0,
        },
      };
    }

    const cycleTimes = issues
      .filter((issue) => issue.fields.resolutiondate)
      .map((issue) => {
        const created = new Date(issue.fields.created);
        const resolved = new Date(issue.fields.resolutiondate!);
        // Calculate in hours instead of days
        return Math.max(0, (resolved.getTime() - created.getTime()) / (1000 * 60 * 60));
      })
      .sort((a, b) => a - b);

    if (!cycleTimes.length) {
      return {
        mean: 0,
        median: 0,
        distribution: {
          min: 0,
          max: 0,
          p25: 0,
          p75: 0,
          p90: 0,
        },
      };
    }

    const mean = cycleTimes.reduce((a, b) => a + b, 0) / cycleTimes.length;
    const median = cycleTimes[Math.floor(cycleTimes.length / 2)];
    const min = cycleTimes[0];
    const max = cycleTimes[cycleTimes.length - 1];
    const p25 = cycleTimes[Math.floor(cycleTimes.length * 0.25)];
    const p75 = cycleTimes[Math.floor(cycleTimes.length * 0.75)];
    const p90 = cycleTimes[Math.floor(cycleTimes.length * 0.90)];

    return {
      mean,
      median,
      distribution: {
        min,
        max,
        p25,
        p75,
        p90,
      },
    };
  }

  /**
   * Calculate stage transitions and bottlenecks
   */
  private calculateStageTransitions(issues: JiraIssue[]): {
    transitions: StageTransition[];
    statusAnalytics: StatusAnalytics[];
  } {
    const statusDurations: { [key: string]: number[] } = {};
    const statusCounts: { [key: string]: number } = {};
    const transitions: StageTransition[] = [];
    const maxDurations: { [key: string]: { duration: number; issueKey: string } } = {};

    issues.forEach((issue) => {
      const changelog = issue.changelog?.histories || [];
      let lastStatusChange = new Date(issue.fields.created).getTime();
      let currentStatus = issue.fields.status.name;

      // Initialize status if not seen before
      if (!statusDurations[currentStatus]) {
        statusDurations[currentStatus] = [];
        statusCounts[currentStatus] = 0;
        maxDurations[currentStatus] = { duration: 0, issueKey: issue.key };
      }
      statusCounts[currentStatus]++;

      changelog
        .filter((history) => history.items.some((item) => item.field === 'status'))
        .forEach((history) => {
          const changeTime = new Date(history.created).getTime();
          const duration = (changeTime - lastStatusChange) / (1000 * 60 * 60); // Hours

          if (duration > 0) {
            if (!statusDurations[currentStatus]) {
              statusDurations[currentStatus] = [];
              maxDurations[currentStatus] = { duration: 0, issueKey: issue.key };
            }
            statusDurations[currentStatus].push(duration);

            // Update max duration if this is longer
            if (duration > maxDurations[currentStatus].duration) {
              maxDurations[currentStatus] = { duration, issueKey: issue.key };
            }

            // Add to transitions
            const statusChange = history.items.find((item) => item.field === 'status');
            if (statusChange) {
              transitions.push({
                issueKey: issue.key,
                fromStatus: currentStatus,
                toStatus: statusChange.toString,
                timeSpentHours: duration,
              });
            }
          }

          const statusChange = history.items.find((item) => item.field === 'status');
          if (statusChange) {
            currentStatus = statusChange.toString;
            if (!statusDurations[currentStatus]) {
              statusDurations[currentStatus] = [];
              statusCounts[currentStatus] = 0;
              maxDurations[currentStatus] = { duration: 0, issueKey: issue.key };
            }
            statusCounts[currentStatus]++;
          }

          lastStatusChange = changeTime;
        });

      // Add duration for current status
      const now = new Date().getTime();
      const currentDuration = (now - lastStatusChange) / (1000 * 60 * 60);
      if (currentDuration > 0) {
        statusDurations[currentStatus].push(currentDuration);
        if (currentDuration > maxDurations[currentStatus].duration) {
          maxDurations[currentStatus] = { duration: currentDuration, issueKey: issue.key };
        }
      }
    });

    // Calculate averages and create analytics
    const statusAnalytics = Object.entries(statusDurations).map(([status, durations]) => ({
      status,
      avgDuration: durations.length ? durations.reduce((a, b) => a + b, 0) / durations.length : 0,
      maxDuration: maxDurations[status].duration,
      maxIssue: maxDurations[status].issueKey,
      issueCount: statusCounts[status] || 0,
    }));

    return { transitions, statusAnalytics };
  }

  private calculateReviewTime(_issue: JiraIssue): number | undefined {
    // Implementation depends on how code review data is stored in your Jira instance
    // This is a placeholder implementation
    return undefined;
  }

  private calculateFirstResponseTime(issue: JiraIssue): number | undefined {
    if (!issue.fields.created || !issue.fields.comment?.comments?.length) {
      return undefined;
    }

    const created = new Date(issue.fields.created).getTime();
    const firstComment = issue.fields.comment.comments
      .filter((c) => c.author.displayName !== issue.fields.reporter.displayName)
      .sort((a, b) => new Date(a.created).getTime() - new Date(b.created).getTime())[0];

    if (!firstComment) {
      return undefined;
    }

    return (new Date(firstComment.created).getTime() - created) / (1000 * 60 * 60); // Hours
  }

  private calculateBottlenecks(
    issues: JiraIssue[],
  ): Array<{ status: string; avgDuration: number; issueCount: number }> {
    const statusDurations: Record<string, number[]> = {};
    const now = Date.now();

    issues.forEach((issue) => {
      const changelog = issue.changelog?.histories || [];
      let lastStatusChange = new Date(issue.fields.created).getTime();
      let currentStatus = issue.fields.status.name;

      changelog
        .filter((h) => h.items.some((i) => i.field === 'status'))
        .forEach((history) => {
          const statusChange = history.items.find((i) => i.field === 'status');
          if (statusChange) {
            const changeTime = new Date(history.created).getTime();
            const duration = (changeTime - lastStatusChange) / (1000 * 60 * 60); // Hours

            if (!statusDurations[currentStatus]) {
              statusDurations[currentStatus] = [];
            }
            statusDurations[currentStatus].push(duration);

            lastStatusChange = changeTime;
            currentStatus = statusChange.toString;
          }
        });

      // Add current status duration
      if (!statusDurations[currentStatus]) {
        statusDurations[currentStatus] = [];
      }
      statusDurations[currentStatus].push((now - lastStatusChange) / (1000 * 60 * 60));
    });

    return Object.entries(statusDurations)
      .map(([status, durations]) => ({
        status,
        avgDuration: durations.reduce((a, b) => a + b, 0) / durations.length,
        issueCount: durations.length,
      }))
      .filter((b) => b.avgDuration > 24) // Only include statuses with avg duration > 24h
      .sort((a, b) => b.avgDuration - a.avgDuration);
  }

  private calculateQualityTrend(issues: JiraIssue[]): number[] {
    const periods = 5;
    const periodLength = 7 * 24 * 60 * 60 * 1000; // 7 days in ms
    const now = Date.now();
    const trend: number[] = [];

    for (let i = 0; i < periods; i++) {
      const periodEnd = now - (i * periodLength);
      const periodStart = periodEnd - periodLength;

      const periodIssues = issues.filter((issue) => {
        const created = new Date(issue.fields.created).getTime();
        return created >= periodStart && created < periodEnd;
      });

      const bugs = periodIssues.filter((i) => i.fields.issuetype.name === 'Bug').length;
      const total = periodIssues.length || 1; // Avoid division by zero

      trend.unshift((1 - (bugs / total)) * 100); // Quality percentage
    }

    return trend;
  }

  private calculateDeliveryTrend(sprints: SprintData[]): number[] {
    return sprints
      .map((sprint) => (sprint.completionRate || 0) * 100) // Convert to percentage
      .reverse()
      .slice(0, 5); // Last 5 sprints
  }

  /**
   * Format project metrics for display
   */
  formatProjectMetrics(metrics: JiraProjectMetrics): string {
    return this.formatProjectDashboard(metrics);
  }

  /**
   * Format sprint metrics for display
   */
  private formatSprintMetrics(sprintData: SprintData[]): string {
    return this.formatSprintAnalysis(sprintData);
  }

  private getCompletionRateIndicator(rate: number): string {
    if (rate >= 0.9) return '✅ Good';
    if (rate >= 0.8) return '⚠️ Needs Improvement';
    return '❌ Off track';
  }

  private getDaysAgo(date: Date | string | undefined): number {
    if (!date) return 0;

    const targetDate = typeof date === 'string' ? new Date(date) : date;
    if (isNaN(targetDate.getTime())) return 0;

    const now = new Date();
    const diffTime = Math.abs(now.getTime() - targetDate.getTime());
    return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  }

  private getTrendArrow(values: number[]): string {
    if (values.length < 2) return '→ Stable';

    const change = values[values.length - 1] - values[values.length - 2];
    const percentChange = (change / values[values.length - 2]) * 100;

    if (Math.abs(percentChange) < 5) return '→ Stable';
    if (percentChange > 0) return '↗ Slight increase';
    return '↘ Slight decrease';
  }

  private getCycleTimeTrendIndicator(
    cycleTime: { mean: number; median: number; distribution: { p75: number; p90: number } },
  ): string {
    const p75ToMedianRatio = cycleTime.distribution.p75 / cycleTime.median;
    const p90ToMedianRatio = cycleTime.distribution.p90 / cycleTime.median;

    if (p90ToMedianRatio > 3) return '❌ Very unpredictable';
    if (p90ToMedianRatio > 2) return '⚠️ Unpredictable';
    if (p75ToMedianRatio > 1.5) return '⚠️ Somewhat unpredictable';
    return '✅ Predictable';
  }

  // Add helper method for progress bar
  private formatProgressBar(progress: number): string {
    const width = 20;
    const filled = Math.round(progress * width);
    const empty = width - filled;
    return '█'.repeat(filled) + '░'.repeat(empty);
  }

  /**
   * Format issue information for display
   */
  formatIssueInfo(issue: JiraIssue): string {
    const sections: string[] = [];

    // Title section
    sections.push(theme.emphasis(`${theme.symbols.documentation} ${issue.fields.summary}`));

    // Basic info table
    const infoTable = new Table()
      .border(true)
      .padding(1);

    infoTable.push(['🔗 URL', `${this.baseUrl}/browse/${issue.key}`]);
    infoTable.push([
      '📊 Status',
      `${this.getStatusEmoji(issue.fields.status.statusCategory.key)} ${issue.fields.status.name}`,
    ]);
    infoTable.push(['📎 Type', issue.fields.issuetype.name]);
    infoTable.push(['🪜 Priority', issue.fields.priority.name]);
    infoTable.push(['👤 Assignee', issue.fields.assignee?.displayName || 'Unassigned']);
    infoTable.push(['👤 Reporter', issue.fields.reporter?.displayName || 'Unknown']);
    infoTable.push(['📅 Created', formatTimestamp(issue.fields.created)]);
    infoTable.push(['🕒 Updated', formatTimestamp(issue.fields.updated)]);

    if (issue.fields.dueDate) {
      infoTable.push(['⏰ Due Date', formatTimestamp(issue.fields.dueDate)]);
    }

    if (issue.fields.labels && issue.fields.labels.length > 0) {
      infoTable.push(['🏷️ Labels', issue.fields.labels.join(', ')]);
    }

    if (issue.fields.components && issue.fields.components.length > 0) {
      infoTable.push(['🧩 Components', issue.fields.components.map((c) => c.name).join(', ')]);
    }

    sections.push(infoTable.toString());

    // Description section if available
    if (issue.fields.description) {
      sections.push(theme.emphasis('\n📝 Description:'));
      const descriptionTable = new Table()
        .border(true)
        .padding(1);
      descriptionTable.push([issue.fields.description]);
      sections.push(descriptionTable.toString());
    }

    // Story Points if available
    const storyPoints = this.calculateStoryPoints(issue);
    if (storyPoints !== undefined && storyPoints !== null) {
      sections.push(theme.emphasis('\n📊 Story Points:'));
      const pointsTable = new Table()
        .border(true)
        .padding(1);
      pointsTable.push([storyPoints.toString()]);
      sections.push(pointsTable.toString());
    }

    // Comments section if available
    if (issue.fields.comment?.comments && issue.fields.comment.comments.length > 0) {
      sections.push(theme.emphasis('\n💬 Recent Comments:'));
      const commentsTable = new Table()
        .border(true)
        .padding(1)
        .header(['Author', 'Date', 'Comment']);

      issue.fields.comment.comments.slice(-3).forEach((comment) => {
        commentsTable.push([
          comment.author.displayName,
          formatTimestamp(comment.created),
          comment.body.length > 100 ? `${comment.body.substring(0, 100)}...` : comment.body,
        ]);
      });

      sections.push(commentsTable.toString());

      if (issue.fields.comment.comments.length > 3) {
        sections.push(
          theme.dim(`\nShowing last 3 of ${issue.fields.comment.comments.length} comments`),
        );
      }
    }

    return sections.join('\n');
  }

  /**
   * Format multiple issues for display
   */
  formatIssueList(issues: JiraIssue[]): string {
    if (issues.length === 0) {
      return 'No issues found.';
    }

    const getStatusColor = (statusCategory: string, statusName: string): string => {
      const name = statusName.toLowerCase();
      // Default/fallback colors based on category
      if (
        statusCategory === 'Done' || name.includes('done') || name.includes('finish') ||
        name.includes('complete')
      ) {
        return colors.green(`${theme.symbols.status.success} ${statusName}`);
      } else if (
        statusCategory === 'In Progress' || name.includes('progress') || name.includes('started')
      ) {
        // Use warning instead of running
        return colors.blue(`${theme.symbols.status.warning} ${statusName}`);
      } else if (name.includes('block') || name.includes('wait') || name.includes('hold')) {
        return colors.red(`${theme.symbols.status.error} ${statusName}`);
      } else if (statusCategory === 'To Do' || name.includes('todo') || name.includes('backlog')) {
        // Use warning instead of pending
        return colors.yellow(`${theme.symbols.status.warning} ${statusName}`);
      } else {
        // Use neutral instead of inactive
        return colors.dim(`${theme.symbols.status.neutral} ${statusName}`);
      }
    };

    const getPriorityColor = (priorityName: string): string => {
      const name = priorityName.toLowerCase();
      if (name.includes('highest') || name.includes('blocker') || name === '1') {
        // Use high instead of highest
        return colors.red(`${theme.symbols.priority.high} ${priorityName}`);
      } else if (name.includes('high') || name === '2') {
        return colors.yellow(`${theme.symbols.priority.high} ${priorityName}`);
      } else if (name.includes('medium') || name === '3') {
        return colors.blue(`${theme.symbols.priority.medium} ${priorityName}`);
      } else if (name.includes('low') || name === '4') {
        return colors.green(`${theme.symbols.priority.low} ${priorityName}`);
      } else if (name.includes('lowest') || name === '5') {
        // Use low instead of lowest
        return colors.blue(`${theme.symbols.priority.low} ${priorityName}`);
      } else {
        return colors.dim(`• ${priorityName}`);
      }
    };

    const _formatIssue = (issue: JiraIssue): string => {
      const issueTable = new Table()
        .border(true)
        .padding(1);

      // Add title as a header row instead of using .title()
      issueTable.push([
        `${
          getStatusColor(issue.fields.status.statusCategory.key, issue.fields.status.name)
        } ${issue.key}: ${theme.emphasis(issue.fields.summary)}`,
      ]);

      issueTable.push(['🚩 Priority', getPriorityColor(issue.fields.priority.name)]);
      issueTable.push([
        '📊 Status',
        getStatusColor(issue.fields.status.statusCategory.key, issue.fields.status.name),
      ]);
      issueTable.push([
        '👤 Assignee',
        issue.fields.assignee?.displayName || colors.dim('Unassigned'),
      ]);

      if (issue.fields.components?.length) {
        issueTable.push([
          '📋 Components',
          issue.fields.components.map((c: { name: string }) => colors.cyan(c.name)).join(', '),
        ]);
      }

      if (issue.fields.labels?.length) {
        issueTable.push([
          '🏷️ Labels',
          issue.fields.labels.map((label) => colors.magenta(label)).join(', '),
        ]);
      }

      issueTable.push(['🕒 Created', formatTimestamp(issue.fields.created)]);

      if (issue.fields.updated) {
        issueTable.push(['🔄 Updated', formatTimestamp(issue.fields.updated)]);
      }

      if (issue.fields.dueDate) {
        issueTable.push(['📅 Due', formatTimestamp(issue.fields.dueDate)]);
      }

      return issueTable.toString();
    };

    // Group issues by status category
    const issuesByStatus = issues.reduce((acc, issue) => {
      const category = issue.fields.status.statusCategory.key;
      if (!acc[category]) acc[category] = [];
      acc[category].push(issue);
      return acc;
    }, {} as Record<string, JiraIssue[]>);

    // Format summary header
    const summaryLines = [
      colors.bold('\nIssue Summary:'),
      `${colors.blue('⬤')} To Do: ${issuesByStatus['new']?.length || 0}`,
      `${colors.yellow('⬤')} In Progress: ${issuesByStatus['indeterminate']?.length || 0}`,
      `${colors.green('⬤')} Done: ${issuesByStatus['done']?.length || 0}`,
      '',
    ].join('\n');

    // Sort issues by status (To Do -> In Progress -> Done) and then by updated date
    const statusOrder: Record<string, number> = { new: 0, indeterminate: 1, done: 2 };
    const sortedIssues = issues.sort((a, b) => {
      const statusDiff = (statusOrder[a.fields.status.statusCategory.key] || 0) -
        (statusOrder[b.fields.status.statusCategory.key] || 0);
      if (statusDiff !== 0) return statusDiff;
      return new Date(b.fields.updated).getTime() - new Date(a.fields.updated).getTime();
    });

    return summaryLines + sortedIssues.map(_formatIssue).join('\n\n');
  }

  /**
   * Get list of recent projects
   */
  async getRecentProjects(): Promise<RecentProject[]> {
    await this.initialize(this.currentProjectKey);
    try {
      const db = await DatabaseService.getInstance();
      const recentProjects = await db.getRecentJiraProjects();
      this.logger.debug(`Retrieved ${recentProjects.length} recent projects from database`);
      // Add optional fullPath property to match RecentProject interface
      return recentProjects.map((p) => ({
        ...p,
        fullPath: p.key, // Use key as fullPath since Jira projects don't have paths
      }));
    } catch (error) {
      this.logger.error('Error getting recent Jira projects:', error);
      return [];
    }
  }

  /**
   * Add a project to recent history
   */
  private async addToRecentProjects(project: JiraProject | undefined): Promise<void> {
    this.logger.debug('Adding project to recent projects');
    if (!project) {
      this.logger.error('Cannot add undefined project to recent projects');
      return;
    }

    if (!project.key || !project.name) {
      this.logger.error('Project is missing key or name:', project);
      return;
    }

    try {
      const db = await DatabaseService.getInstance();
      await db.addRecentJiraProject({
        key: project.key,
        name: project.name,
        lastViewed: new Date(),
      });
      this.logger.debug(`Successfully added project ${project.key} to recent projects`);
    } catch (error) {
      this.logger.error('Error adding recent Jira project:', error);
    }
  }

  /**
   * Force refresh project metrics cache
   */
  async refreshProjectMetrics(projectKey: string): Promise<JiraProjectMetrics> {
    // Clear existing cache
    const db = await DatabaseService.getInstance();
    await db.clearJiraDashboardCache(projectKey);
    this.logger.debug('Cleared dashboard cache for:', projectKey);
    // Fetch fresh metrics
    return this.getProjectMetrics(projectKey);
  }

  private getStatusEmoji(statusCategory: string): string {
    switch (statusCategory) {
      case 'new':
        return '🔵';
      case 'indeterminate':
        return '🟡';
      case 'done':
        return '🟢';
      default:
        return '⚪';
    }
  }

  /**
   * Get data for the last N sprints
   */
  public async getLastNSprintsData(
    n: number,
    projectKey: string,
    boardId?: number,
  ): Promise<{
    sprintData: SprintData[];
    duplicateSprints: Array<{ dateRange: string; sprints: string[] }>;
  }> {
    this.logger.debug(`Getting last ${n} sprints data for project: ${projectKey}`);
    await this.initialize(projectKey);
    try {
      // Get boards for the project
      const boards = await this.getBoards(projectKey);

      // Find the Scrum board
      const scrumBoard = boardId
        ? boards.find((board) => board.id === boardId)
        : boards.find((board) => board.type === 'scrum');

      if (!scrumBoard) {
        this.logger.debug(`No Scrum board found, treating as Kanban board`);
        const kanbanData = await this.getKanbanBoardData(n, projectKey);
        return {
          sprintData: kanbanData,
          duplicateSprints: [], // No duplicates in Kanban boards
        };
      }

      this.logger.debug(`Found Scrum board: ${JSON.stringify(scrumBoard)}`);

      // For Scrum boards, get actual sprints
      const sprints = await this.jira.board.getSprintsForBoard({
        boardId: scrumBoard.id,
        state: ['active', 'closed'],
        maxResults: n, // Explicitly limit to n sprints
      }) as { values: JiraSprint[] };

      this.logger.debug(`Found ${sprints.values.length} sprints`);
      const sprintDataArray: SprintData[] = [];
      // Detect duplicate sprints (overlapping date ranges)
      const duplicateSprints: Array<{ dateRange: string; sprints: string[] }> = [];

      this.logger.debug(`Processing ${sprints.values.length} most recent sprints`);

      if (sprints.values.length === 0) {
        this.logger.debug('No recent sprints found, falling back to Kanban board data');
        const kanbanData = await this.getKanbanBoardData(n, projectKey);
        return {
          sprintData: kanbanData,
          duplicateSprints: [], // No duplicates in Kanban boards
        };
      }

      // Take only the last n sprints
      const recentSprints = sprints.values.slice(0, n);
      this.logger.debug(
        `Processing last ${n} sprints out of ${sprints.values.length} total sprints`,
      );

      for (const sprint of recentSprints) {
        this.logger.debug(`\nProcessing sprint: ${sprint.name} (${sprint.id})`);
        this.logger.debug(`Sprint dates: ${sprint.startDate} -> ${sprint.endDate}`);

        const issues = await this.jira.board.getIssuesForSprint({
          sprintId: sprint.id.toString(),
          maxResults: 1000,
          fields: ['*all'], // Request all fields
        }) as { issues: JiraIssue[] };

        this.logger.debug(`Found ${issues.issues.length} total issues for sprint`);

        const sprintData = await this.getSprintData(sprint, issues.issues);
        sprintDataArray.push(sprintData);
      }

      // Check for duplicate/overlapping sprints
      for (let i = 0; i < sprintDataArray.length; i++) {
        for (let j = i + 1; j < sprintDataArray.length; j++) {
          const sprint1 = sprintDataArray[i];
          const sprint2 = sprintDataArray[j];

          // Check for date range overlap
          if (sprint1.startDate <= sprint2.endDate && sprint2.startDate <= sprint1.endDate) {
            // Found overlap
            const dateRange =
              `${sprint1.startDate.toLocaleDateString()} - ${sprint1.endDate.toLocaleDateString()}`;

            // Check if this range already exists in our duplicates
            const existingRange = duplicateSprints.find((d) => d.dateRange === dateRange);
            if (existingRange) {
              if (!existingRange.sprints.includes(sprint1.name)) {
                existingRange.sprints.push(sprint1.name);
              }
              if (!existingRange.sprints.includes(sprint2.name)) {
                existingRange.sprints.push(sprint2.name);
              }
            } else {
              duplicateSprints.push({
                dateRange,
                sprints: [sprint1.name, sprint2.name],
              });
            }
          }
        }
      }

      return {
        sprintData: sprintDataArray,
        duplicateSprints,
      };
    } catch (error) {
      this.logger.error('Error getting sprint data:', error);
      throw new Error(
        `Failed to get sprint data: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  private calculateScopeChangeRate(
    history: Required<JiraProjectMetrics>['sprints']['history'],
  ): number {
    if (!history?.length) return 0;
    return history.reduce((sum: number, sprint) => {
      const added = sprint.addedDuringSprintAndCompleted?.length || 0;
      const committed = sprint.committedIssues || 1;
      return sum + ((added / committed) * 100);
    }, 0) / history.length;
  }

  private calculateSpilloverRate(
    history: Required<JiraProjectMetrics>['sprints']['history'],
  ): number {
    if (!history?.length) return 0;
    return history.reduce((sum: number, sprint) => {
      const spillover = sprint.spiltOverIssues || 0;
      const committed = sprint.committedIssues || 1;
      return sum + ((spillover / committed) * 100);
    }, 0) / history.length;
  }

  private calculateScopeChangeTrend(
    history: Required<JiraProjectMetrics>['sprints']['history'],
  ): number[] {
    if (!history?.length) return [];
    return history.map((sprint) => {
      const added = sprint.addedDuringSprintAndCompleted?.length || 0;
      const committed = sprint.committedIssues || 1;
      return ((added / committed) * 100);
    });
  }

  private calculateSpilloverTrend(
    history: Required<JiraProjectMetrics>['sprints']['history'],
  ): number[] {
    if (!history?.length) return [];
    return history.map((sprint) => {
      const spillover = sprint.spiltOverIssues || 0;
      const committed = sprint.committedIssues || 1;
      return ((spillover / committed) * 100);
    });
  }

  private wasIssueCommittedToSprint(issue: JiraIssue, sprintId: string | number): boolean {
    // Get sprint field
    const sprintField = issue.fields.customfield_10460;

    // Convert sprintId to string for comparison
    const sprintIdStr = String(sprintId);

    // Only log sprint field if debugging first time for this sprint
    if (!this.sprintFieldsLogged) {
      this.logger.debug(`Sprint field example for ${issue.key}:`, {
        sprintField,
        created: issue.fields.created,
        status: issue.fields.status.name,
      });
      this.sprintFieldsLogged = true;
    }

    // Check if sprint field is an array and contains our sprint
    if (Array.isArray(sprintField)) {
      const sprintEntry = sprintField.find((s) => String(s.id) === sprintIdStr);
      if (sprintEntry) {
        const sprintStartDate = new Date(sprintEntry.startDate);
        const sprintEndDate = new Date(sprintEntry.endDate);

        // First check the changelog for when the issue was added to the sprint
        if (issue.changelog?.histories) {
          for (const history of issue.changelog.histories) {
            for (const item of history.items) {
              if (item.field === 'Sprint' && item.toString?.includes(sprintIdStr)) {
                const addedDate = new Date(history.created);

                // Consider it committed if:
                // 1. It was added within 2 days of sprint start (planning window)
                // 2. OR it was added during the first 20% of the sprint (early additions)
                const planningWindowEnd = new Date(
                  sprintStartDate.getTime() + 2 * 24 * 60 * 60 * 1000,
                );
                const earlySprintWindow = new Date(
                  sprintStartDate.getTime() +
                    (sprintEndDate.getTime() - sprintStartDate.getTime()) * 0.2,
                );

                if (addedDate <= planningWindowEnd || addedDate <= earlySprintWindow) {
                  return true;
                }
              }
            }
          }
        }

        // If no changelog entry but issue was created just before or during sprint planning
        const issueCreated = new Date(issue.fields.created);
        const planningStart = new Date(sprintStartDate.getTime() - 24 * 60 * 60 * 1000); // 1 day before sprint
        if (issueCreated >= planningStart && issueCreated <= sprintStartDate) {
          return true;
        }
      }
    }

    return false;
  }

  // Get issues that were completed during the sprint
  private getCompletedSprintIssues(
    issues: JiraIssue[],
    sprint: { id: string | number; startDate: string; endDate: string },
  ): {
    completedIssues: JiraIssue[];
    committedAndCompleted: JiraIssue[];
    addedDuringSprintAndCompleted: JiraIssue[];
  } {
    const sprintStart = new Date(sprint.startDate);
    const sprintEnd = new Date(sprint.endDate);

    // First get all completed issues during the sprint
    const completedIssues = issues.filter((issue) => {
      // Check if issue is Done
      const isDone = issue.fields.status.statusCategory.name === 'Done';
      if (!isDone) return false;

      // Get resolution date
      const resolutionDate = issue.fields.resolutiondate
        ? new Date(issue.fields.resolutiondate)
        : null;
      if (!resolutionDate) return false;

      // Issue was completed during the sprint
      return resolutionDate >= sprintStart && resolutionDate <= sprintEnd;
    });

    // Then split them into committed vs added during sprint
    const committedAndCompleted = completedIssues.filter((issue) =>
      this.wasIssueCommittedToSprint(issue, sprint.id)
    );

    const addedDuringSprintAndCompleted = completedIssues.filter((issue) =>
      !this.wasIssueCommittedToSprint(issue, sprint.id)
    );

    // Log the breakdown for debugging
    this.logger.debug(`Completed issues breakdown for sprint ${sprint.id}:
    - Total completed: ${completedIssues.length}
    - Completed from committed: ${committedAndCompleted.length}
    - Completed from added: ${addedDuringSprintAndCompleted.length}`);

    return {
      completedIssues,
      committedAndCompleted,
      addedDuringSprintAndCompleted,
    };
  }

  private calculateSprintProgress(sprint: SprintData): number {
    // For active sprints, use a combination of time and completion
    if (sprint.state === 'active') {
      // Get dates
      const startDate = sprint.startDate;
      const endDate = sprint.endDate;
      const now = new Date();

      // Calculate time elapsed percentage
      const totalDuration = endDate.getTime() - startDate.getTime();
      const elapsed = Math.min(now.getTime() - startDate.getTime(), totalDuration);
      const timeProgress = Math.min(100, Math.max(0, (elapsed / totalDuration) * 100));

      // For completion rate, if it's over 100%, cap it at 100%
      // This is for display purposes - the team really achieved more, but for progress
      // visualization, the sprint is 100% complete at most
      const completionProgress = Math.min(100, (sprint.completionRate || 0) * 100);

      // Weighted calculation: 40% time based, 60% completion based
      const progress = (timeProgress * 0.4) + (completionProgress * 0.6);
      this.logger.debug(
        `Sprint ${sprint.name}: Time progress ${timeProgress.toFixed(1)}%, Completion ${
          completionProgress.toFixed(1)
        }%, Combined ${progress.toFixed(1)}%`,
      );
      return progress;
    } else {
      // For closed sprints, just use the completion rate, capped at 100%
      return Math.min(100, (sprint.completionRate || 0) * 100);
    }
  }

  /**
   * Identify bottlenecks in the workflow
   */
  private identifyBottlenecks(
    stageTransitions: { transitions: StageTransition[]; statusAnalytics: StatusAnalytics[] },
  ): {
    bottlenecks: { status: string; avgDuration: number; issueCount: number }[];
    blockedIssues: { status: string; key: string; duration: number }[];
  } {
    const THRESHOLD_HOURS = 24 * 7; // Consider a stage a bottleneck if average time > 7 days
    const BLOCKED_THRESHOLD = 24 * 30; // Flag issues blocked > 30 days

    // Identify bottleneck stages
    const bottlenecks = stageTransitions.statusAnalytics
      .filter((stat) => stat.avgDuration > THRESHOLD_HOURS)
      .map((stat) => ({
        status: stat.status,
        avgDuration: stat.avgDuration,
        issueCount: stat.issueCount,
      }));

    // Identify blocked issues
    const blockedIssues = stageTransitions.statusAnalytics
      .flatMap((stat) =>
        stat.maxDuration > BLOCKED_THRESHOLD
          ? [{ status: stat.status, key: stat.maxIssue, duration: stat.maxDuration }]
          : []
      );

    this.logger.debug('Bottleneck Analysis:', {
      bottlenecks: bottlenecks.map((b) =>
        `${b.status}: ${b.avgDuration.toFixed(1)} hours (${b.issueCount} issues)`
      ),
      blockedIssues: blockedIssues.map((i) =>
        `${i.key} in ${i.status} for ${i.duration.toFixed(1)} hours`
      ),
    });

    return { bottlenecks, blockedIssues };
  }

  private getStatusOutliers(
    sprint: SprintData,
  ): Array<{ status: string; duration: number; issueKey: string }> {
    const OUTLIER_THRESHOLD = 7 * 24; // 7 days in hours

    return sprint.stageTransitions.statusAnalytics
      .filter((stat) => stat.maxDuration > OUTLIER_THRESHOLD)
      .map((stat) => ({
        status: stat.status,
        duration: stat.maxDuration,
        issueKey: stat.maxIssue,
      }))
      .sort((a, b) => b.duration - a.duration);
  }

  private getStatusAnalysis(
    sprint: SprintData,
  ): Array<{ status: string; avgDuration: number; issueCount: number }> {
    return sprint.stageTransitions.statusAnalytics
      .filter((stat) => stat.avgDuration > 24) // Only show statuses with avg > 1 day
      .map((stat) => ({
        status: stat.status,
        avgDuration: stat.avgDuration,
        issueCount: stat.issueCount,
      }))
      .sort((a, b) => b.avgDuration - a.avgDuration);
  }

  private rateCompletionRate(rate: number): string {
    if (rate >= 0.9) return colors.green('On Target');
    if (rate >= 0.8) return colors.blue('Near Target');
    if (rate >= 0.7) return colors.yellow('Needs Focus');
    return colors.red('At Risk');
  }

  private rateSpilloverRate(rate: number): string {
    if (rate <= 0.1) return colors.green('On Target');
    if (rate <= 0.2) return colors.blue('Near Target');
    if (rate <= 0.3) return colors.yellow('Needs Focus');
    return colors.red('At Risk');
  }

  private rateVelocity(cycleTime: number, throughput: number): string {
    const cycleTimeScore = cycleTime <= 24 * 3
      ? 3
      : cycleTime <= 24 * 5
      ? 2
      : cycleTime <= 24 * 7
      ? 1
      : 0;
    const throughputScore = throughput >= 10 ? 3 : throughput >= 7 ? 2 : throughput >= 5 ? 1 : 0;
    const totalScore = cycleTimeScore + throughputScore;

    if (totalScore >= 5) return colors.green('On Target');
    if (totalScore >= 3) return colors.blue('Near Target');
    if (totalScore >= 2) return colors.yellow('Needs Focus');
    return colors.red('At Risk');
  }

  /**
   * Get Kanban board data in sprint-like format
   */
  private async getKanbanBoardData(
    n: number,
    projectKey: string,
    _boardId?: number,
  ): Promise<SprintData[]> {
    try {
      await this.initialize(projectKey);
      this.logger.debug('Getting Kanban board data for project:', projectKey);

      const sprintData: SprintData[] = [];
      const now = new Date();

      for (let i = 0; i < n; i++) {
        const endDate = new Date(now.getTime() - (i * 14 * 24 * 60 * 60 * 1000));
        const startDate = new Date(endDate.getTime() - (14 * 24 * 60 * 60 * 1000));

        this.logger.debug(`Processing period ${i + 1}:`, {
          startDate: startDate.toISOString().split('T')[0],
          endDate: endDate.toISOString().split('T')[0],
        });

        // Get all issues updated in this period
        const jql = `project = "${this.currentProjectKey}" AND updated >= "${
          startDate.toISOString().split('T')[0]
        }" AND updated <= "${endDate.toISOString().split('T')[0]}"`;
        const { issues } = await this.searchIssues(jql);

        this.logger.debug(`Found ${issues.length} issues for period ${i + 1}`);

        // For Kanban, "committed" issues are those that were in progress at the start of the period
        const committedIssues = issues.filter((issue) =>
          issue.fields.status.statusCategory.key === 'indeterminate' &&
          new Date(issue.fields.created) <= startDate
        );

        // Completed issues are those that moved to Done during this period
        const completedIssues = issues.filter((issue) => {
          const resolutionDate = issue.fields.resolutiondate
            ? new Date(issue.fields.resolutiondate)
            : null;
          return resolutionDate && resolutionDate >= startDate && resolutionDate <= endDate;
        });

        // For Kanban, spillover issues are those that were in progress but not completed
        const spiltOverIssues = committedIssues.filter((issue) =>
          !completedIssues.find((done) => done.id === issue.id) &&
          issue.fields.status.statusCategory.key !== 'done'
        );

        const stageTransitions = this.calculateStageTransitions(issues);
        const averageCycleTime = this.calculateAverageCycleTime(completedIssues);

        // Calculate points
        const committedPoints = committedIssues.reduce(
          (sum, issue) => sum + (issue.fields[this.storyPointsField] || 0),
          0,
        );
        const completedPoints = completedIssues.reduce(
          (sum, issue) => sum + (issue.fields[this.storyPointsField] || 0),
          0,
        );

        // For Kanban, calculate completion rate based on completed vs in-progress
        const completionRate = committedIssues.length > 0
          ? completedIssues.length / (committedIssues.length + completedIssues.length)
          : 0;

        // Calculate time-based progress
        const totalDuration = Math.ceil(
          (endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24),
        );
        const elapsedDuration = Math.max(
          0,
          Math.ceil((now.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)),
        );
        const timeProgress = Math.min(1, elapsedDuration / totalDuration);

        // Calculate velocity (completed points per day)
        const velocity = completedPoints / Math.max(1, elapsedDuration);
        const remainingDays = Math.max(
          0,
          Math.ceil((endDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)),
        );

        // Calculate metrics for all issues
        const allIssuesMetrics = this.calculateSprintMetrics(issues);

        // Separate completed issues into committed vs added during period
        const committedAndCompleted = completedIssues.filter((issue) =>
          committedIssues.some((committed) => committed.id === issue.id)
        );
        const addedDuringSprintAndCompleted = completedIssues.filter((issue) =>
          !committedIssues.some((committed) => committed.id === issue.id)
        );

        // Calculate points for committed vs added completed issues
        const committedCompletedPoints = committedAndCompleted.reduce(
          (sum, issue) => sum + (issue.fields[this.storyPointsField] || 0),
          0,
        );
        const addedCompletedPoints = addedDuringSprintAndCompleted.reduce(
          (sum, issue) => sum + (issue.fields[this.storyPointsField] || 0),
          0,
        );

        sprintData.push({
          id: `kanban-${i}`,
          name: `Period ${i + 1}`,
          startDate,
          endDate,
          state: 'closed', // Kanban periods are always treated as closed
          committedIssues,
          completedIssues,
          spiltOverIssues,
          totalIssues: issues,
          stageTransitions,
          averageCycleTime,
          completionRate,
          progress: (timeProgress + (completionRate || 0)) / 2,
          velocity,
          committedPoints,
          completedPoints,
          committedCompletedPoints,
          addedCompletedPoints,
          remainingDays,
          addedDuringSprintAndCompleted,
          committedAndCompleted,
          storyPoints: completedPoints,
          issueTypes: allIssuesMetrics.issueTypes,
          priorities: allIssuesMetrics.priorities,
          avgDailyVelocity: completedPoints / Math.max(1, Math.min(elapsedDuration, 14)),
        });

        this.logger.debug(`Kanban period ${i + 1} metrics:`, {
          totalIssues: issues.length,
          committedIssues: committedIssues.length,
          completedIssues: completedIssues.length,
          spiltOverIssues: spiltOverIssues.length,
          completionRate: completionRate * 100,
          velocity: velocity.toFixed(1),
        });
      }

      return sprintData;
    } catch (error) {
      this.logger.error('Error getting Kanban board data:', error);
      throw new Error(
        `Failed to get Kanban board data: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`,
      );
    }
  }

  formatProjectList(projects: JiraProject[]): string {
    if (projects.length === 0) {
      return 'No projects found.';
    }

    const getStatusColor = (statusCategory: string, statusName: string): string => {
      const name = statusName.toLowerCase();
      // Default/fallback colors based on category
      if (
        statusCategory === 'Done' || name.includes('done') || name.includes('finish') ||
        name.includes('complete')
      ) {
        return colors.green(`${theme.symbols.status.success} ${statusName}`);
      } else if (
        statusCategory === 'In Progress' || name.includes('progress') || name.includes('started')
      ) {
        // Use warning instead of running
        return colors.blue(`${theme.symbols.status.warning} ${statusName}`);
      } else if (name.includes('block') || name.includes('wait') || name.includes('hold')) {
        return colors.red(`${theme.symbols.status.error} ${statusName}`);
      } else if (statusCategory === 'To Do' || name.includes('todo') || name.includes('backlog')) {
        // Use warning instead of pending
        return colors.yellow(`${theme.symbols.status.warning} ${statusName}`);
      } else {
        // Use neutral instead of inactive
        return colors.dim(`${theme.symbols.status.neutral} ${statusName}`);
      }
    };

    const getPriorityColor = (priorityName: string): string => {
      const name = priorityName.toLowerCase();
      if (name.includes('highest') || name.includes('blocker') || name === '1') {
        // Fix theme.symbols.priority.highest reference
        return colors.red(`${theme.symbols.priority.high} ${priorityName}`);
      } else if (name.includes('high') || name === '2') {
        return colors.yellow(`${theme.symbols.priority.high} ${priorityName}`);
      } else if (name.includes('medium') || name === '3') {
        return colors.blue(`${theme.symbols.priority.medium} ${priorityName}`);
      } else if (name.includes('low') || name === '4') {
        return colors.green(`${theme.symbols.priority.low} ${priorityName}`);
      } else if (name.includes('lowest') || name === '5') {
        // Fix theme.symbols.priority.lowest reference
        return colors.blue(`${theme.symbols.priority.low} ${priorityName}`);
      } else {
        return colors.dim(`• ${priorityName}`);
      }
    };

    const _formatIssue = (issue: JiraIssue): string => {
      const issueTable = new Table()
        .border(true)
        .padding(1);

      // Add title as a header row instead of using .title()
      issueTable.push([
        `${
          getStatusColor(issue.fields.status.statusCategory.key, issue.fields.status.name)
        } ${issue.key}: ${theme.emphasis(issue.fields.summary)}`,
      ]);

      issueTable.push(['🚩 Priority', getPriorityColor(issue.fields.priority.name)]);
      issueTable.push([
        '📊 Status',
        getStatusColor(issue.fields.status.statusCategory.key, issue.fields.status.name),
      ]);
      issueTable.push([
        '👤 Assignee',
        issue.fields.assignee?.displayName || colors.dim('Unassigned'),
      ]);

      if (issue.fields.components?.length) {
        issueTable.push([
          '📋 Components',
          issue.fields.components.map((c: { name: string }) => colors.cyan(c.name)).join(', '),
        ]);
      }

      if (issue.fields.labels?.length) {
        issueTable.push([
          '🏷️ Labels',
          issue.fields.labels.map((label) => colors.magenta(label)).join(', '),
        ]);
      }

      issueTable.push(['🕒 Created', formatTimestamp(issue.fields.created)]);

      if (issue.fields.updated) {
        issueTable.push(['🔄 Updated', formatTimestamp(issue.fields.updated)]);
      }

      if (issue.fields.dueDate) {
        issueTable.push(['📅 Due', formatTimestamp(issue.fields.dueDate)]);
      }

      return issueTable.toString();
    };

    const formatProject = (project: JiraProject): string => {
      const projectTable = new Table()
        .border(true)
        .padding(1);

      // Add title as a header row instead of using .title()
      projectTable.push([
        `${theme.symbols.project} Project: ${theme.emphasis(project.name)} (${project.key})`,
      ]);

      projectTable.push(['🆔 ID', project.id]);
      projectTable.push(['🔗 URL', `${this.baseUrl}/projects/${project.key}`]);

      if (project.description) {
        projectTable.push(['📝 Description', project.description]);
      }

      projectTable.push(['📊 Type', project.projectTypeKey]);
      projectTable.push(['🎨 Style', project.style]);

      if (project.lead) {
        projectTable.push(['👤 Lead', project.lead.displayName]);
      }

      return projectTable.toString();
    };

    return projects.map(formatProject).join('\n\n');
  }

  formatSprintList(sprints: JiraSprint[]): string {
    if (sprints.length === 0) {
      return 'No sprints found.';
    }

    const formatSprint = (sprint: JiraSprint): string => {
      const sprintTable = new Table()
        .border(true)
        .padding(1);

      // Add title as a header row instead of using .title()
      sprintTable.push([`${theme.symbols.metrics} Sprint: ${theme.emphasis(sprint.name)}`]);

      sprintTable.push(['🆔 ID', sprint.id.toString()]);

      if (sprint.goal) {
        sprintTable.push(['🎯 Goal', sprint.goal]);
      }

      sprintTable.push(['📊 Status', sprint.state.toUpperCase()]);

      if (sprint.startDate) {
        sprintTable.push(['🕒 Start', formatTimestamp(sprint.startDate)]);
      }

      if (sprint.endDate) {
        sprintTable.push(['🏁 End', formatTimestamp(sprint.endDate)]);

        // Use endDate instead of completeDate
        if (sprint.state.toLowerCase() === 'closed') {
          sprintTable.push(['✓ Completed', formatTimestamp(sprint.endDate)]);
        }
      }

      return sprintTable.toString();
    };

    return sprints.map(formatSprint).join('\n\n');
  }

  formatProjectDashboard(metrics: JiraProjectMetrics): string {
    const { project, sprints, timeline, bottlenecks } = metrics;

    const sections = [];

    // Project header
    sections.push(
      `${theme.symbols.project} ${
        colors.bold('Jira Project Dashboard:')
      } ${project.name} (${project.key})\n`,
      `${theme.symbols.documentation} URL: ${this.baseUrl}/projects/${project.key}\n`,
    );

    // Health Score
    const healthScore = metrics.healthScore;
    sections.push(colors.bold('\n🏥 Project Health'));
    sections.push(
      new Table()
        .header(['Metric', 'Status'])
        .body([
          ['Overall Health', this.getHealthIndicator(healthScore)],
          ['Velocity Trend', this.getTrendIndicator(sprints?.velocityTrend || [])],
          ['Completion Trend', this.getTrendIndicator(sprints?.completionRateTrend || [])],
        ])
        .border(true)
        .toString(),
    );
    sections.push(
      colors.dim(
        '\nFootnotes:\n• Overall Health: Combined score based on velocity stability, completion rate, and quality metrics\n• Velocity Trend: Sprint-over-sprint change in completed story points\n• Completion Trend: Sprint-over-sprint change in completion rate',
      ),
    );

    // Issue Statistics
    sections.push(colors.bold('\n📊 Project Issue Statistics'));
    sections.push(
      new Table()
        .header(['Metric', 'Value'])
        .body([
          ['Total Issues', metrics.issues.total.toString()],
          ['To Do', metrics.issues.open.toString()],
          ['In Progress', metrics.issues.inProgress.toString()],
          ['Done', metrics.issues.done.toString()],
          ['Backlog', metrics.issues.backlog.toString()],
          ['', ''],
          ['Issue Types', ''],
          ['• Bugs', metrics.issues.bugs.toString()],
          ['• Features', metrics.issues.features.toString()],
          ['• Technical Debt', metrics.issues.technicalDebt.toString()],
        ])
        .border(true)
        .toString(),
    );
    sections.push(
      colors.dim(
        '\nFootnotes:\n• Shows current statistics for all issues in the project\n• To Do: Issues ready to be worked on\n• In Progress: Issues being actively worked on\n• Done: Issues marked as resolved/completed\n• Backlog: Issues not yet scheduled/prioritized\n• Bugs: Issues marked as defects/bugs\n• Features: Stories, tasks, and improvements\n• Technical Debt: Issues labeled with tech-debt',
      ),
    );

    // Sprint Metrics
    if (sprints?.active) {
      sections.push(colors.bold('\n🏃 Current Sprint Progress'));
      sections.push(
        new Table()
          .header(['Metric', 'Value'])
          .body([
            ['Current Sprint', sprints.active.name],
            ['Sprint Progress', `${Math.min(100, sprints.active.progress).toFixed(1)}%`],
            [
              'Sprint Dates',
              `${formatTimestamp(sprints.active.startDate)} → ${
                formatTimestamp(sprints.active.endDate)
              }`,
            ],
            ['Remaining Days', sprints.active.remainingDays.toString()],
            ['', ''],
            ['Work Summary', ''],
            ['Total Issues', `${sprints.active.totalIssues} issues`],
            [
              '• Committed Issues',
              `${sprints.active.committedIssues} issues (${sprints.active.committedPoints} points)`,
            ],
            [
              '• Completed Issues',
              `${sprints.active.completedIssues} issues (${sprints.active.completedPoints} points)`,
            ],
            [
              '  - From Committed',
              `${
                sprints.active.committedAndCompleted?.length || 0
              } issues (${sprints.active.committedCompletedPoints} points)`,
            ],
            [
              '  - Added & Completed',
              `${
                sprints.active.addedDuringSprintAndCompleted?.length || 0
              } issues (${sprints.active.addedCompletedPoints} points)`,
            ],
            ['• Spillover Issues', `${sprints.active.spiltOverIssues || 0} issues`],
            ['', ''],
            ['Issue Breakdown', ''],
            ['• Stories', sprints.active.issueTypes.story || '0'],
            ['• Tasks', sprints.active.issueTypes.task || '0'],
            ['• Bugs', sprints.active.issueTypes.bug || '0'],
            ['• Improvements', sprints.active.issueTypes.improvement || '0'],
            ['• Spikes', sprints.active.issueTypes.spike || '0'],
            ['', ''],
            ['Completion Metrics', ''],
            [
              'Committed Work',
              `${sprints.active.committedPoints} points (${sprints.active.committedIssues} issues)`,
            ],
            [
              'Completed Work',
              `${sprints.active.completedPoints} points (${sprints.active.completedIssues} issues)`,
            ],
            [
              'Completion Rate',
              `${(sprints.active.completionRate * 100).toFixed(1)}% ${
                this.getCompletionRateIndicator(sprints.active.completionRate)
              }`,
            ],
            ['Daily Velocity', `${sprints.active.avgDailyVelocity.toFixed(1)} points/day`],
          ])
          .border(true)
          .toString(),
      );
      sections.push(
        colors.dim(
          '\nFootnotes:\n• Progress: Combined measure of time elapsed (40%) and completion rate (60%)\n• Committed Issues: Issues planned at sprint start\n• Added Issues: Issues added during the sprint\n• Completion Rate: Percentage of committed work completed\n• Daily Velocity: Average number of issues completed per day',
        ),
      );
    }

    // Sprint History
    if (sprints?.history && sprints.history.length > 0) {
      sections.push(colors.bold('\n📚 Sprint History'));
      sections.push(
        new Table()
          .header(['Sprint', 'Dates', 'Committed', 'Added', 'Spillover', 'Total', 'Points'])
          .body(
            sprints.history.map((sprint) => [
              sprint.name || 'Unknown',
              `${formatTimestamp(sprint.startDate)} → ${formatTimestamp(sprint.endDate)}`,
              `${sprint.committedAndCompleted?.length || 0}/${sprint.committedIssues || 0}`,
              `${sprint.addedDuringSprintAndCompleted?.length || 0}`,
              `${sprint.spiltOverIssues || 0}`,
              `${sprint.totalIssues || 0}`,
              `${sprint.completedPoints || 0}`,
            ]),
          )
          .border(true)
          .toString(),
      );
      sections.push(
        colors.dim(
          '\nFootnotes:\n• Committed: Completed/Total issues planned at sprint start\n• Added: Issues added and completed during sprint\n• Spillover: Issues not completed and moved to next sprint\n• Total: All issues in the sprint\n• Points: Total story points completed\n• Trend: Shows sprint-over-sprint changes in velocity and completion rates',
        ),
      );

      // Sprint Performance Trends
      sections.push(colors.bold('\n📈 Sprint Performance Trends'));

      // Calculate trends
      const velocityTrend = this.getTrendIndicator(sprints.velocityTrend || []);
      const completionTrend = this.getTrendIndicator(sprints.completionRateTrend || []);
      const scopeChangeTrend = this.getTrendIndicator(
        this.calculateScopeChangeTrend(sprints.history),
      );
      const spilloverTrend = this.getTrendIndicator(this.calculateSpilloverTrend(sprints.history));

      sections.push(
        new Table()
          .header(['Metric', 'Value'])
          .body([
            ['Scope Change', ''],
            [
              '• Average Rate',
              `${this.calculateScopeChangeRate(sprints.history).toFixed(1)}% additional work`,
            ],
            ['• Trend', scopeChangeTrend],
            ['', ''],
            ['Spillover', ''],
            [
              '• Average Rate',
              `${this.calculateSpilloverRate(sprints.history).toFixed(1)}% of committed work`,
            ],
            ['• Trend', spilloverTrend],
            ['', ''],
            ['Velocity', ''],
            ['• Average', `${(sprints.avgVelocity || 0).toFixed(1)} points/sprint`],
            ['• Trend', velocityTrend],
            ['', ''],
            ['Completion Rate', ''],
            ['• Average', `${((sprints.avgCompletionRate || 0) * 100).toFixed(1)}%`],
            ['• Trend', completionTrend],
            ['', ''],
            ['Predictability Factors', ''],
            ['• Velocity Stability', sprints.stabilityScore || 'Low'],
            ['• Completion Consistency', sprints.predictabilityScore || 'Low'],
          ])
          .border(true)
          .toString(),
      );
      sections.push(
        colors.dim(
          "\nFootnotes:\n• Scope Change: Measures how much work is added during sprints\n• Spillover: Tracks issues not completed and carried to next sprint\n• Velocity: Story points completed per sprint\n• Completion Rate: Percentage of committed work completed\n• Predictability: Indicates team's consistency in estimating and delivering work",
        ),
      );
    }

    // Work Distribution
    if (sprints?.active) {
      sections.push(colors.bold('\n📊 Work Distribution'));
      const totalIssues = sprints.active.totalIssues || 1;

      const issueTypes = Object.entries(sprints.active.issueTypes)
        .filter(([_, count]) => count > 0)
        .map(([type, count]) => [
          `• ${type.charAt(0).toUpperCase() + type.slice(1)}`,
          `${count} (${((count / totalIssues) * 100).toFixed(1)}%)`,
        ]);

      const priorities = Object.entries(sprints.active.priorities)
        .filter(([_, count]) => count > 0)
        .map(([priority, count]) => [
          `• ${priority.charAt(0).toUpperCase() + priority.slice(1)}`,
          `${count} (${((count / totalIssues) * 100).toFixed(1)}%)`,
        ]);

      sections.push(
        new Table()
          .header(['Category', 'Distribution'])
          .body([
            ['Issue Types', ''],
            ...issueTypes,
            ['', ''],
            ['Priorities', ''],
            ...priorities,
          ])
          .border(true)
          .toString(),
      );
      sections.push(
        colors.dim(
          "\nFootnotes:\n• Distribution shows current sprint's breakdown of work\n• Ideal sprint typically has a balanced mix of different work types\n• High percentage of bugs may indicate quality issues\n• High percentage of high priority items may indicate reactive work",
        ),
      );
    }

    // Process Bottlenecks
    if (bottlenecks?.length) {
      sections.push(colors.bold('\n🚧 Process Bottlenecks'));
      sections.push(
        new Table()
          .header(['Status', 'Average Duration', 'Issues'])
          .body(
            bottlenecks.map((b) => [
              b.status,
              this.formatDuration(b.avgDuration),
              b.issueCount.toString(),
            ]),
          )
          .border(true)
          .toString(),
      );
      sections.push(
        colors.dim(
          '\nFootnotes:\n• Average Duration: Mean time issues spend in each status\n• Issues: Number of issues that passed through the status\n• Long durations may indicate process bottlenecks or blocked work',
        ),
      );
    }

    // Recent Activity
    if (timeline) {
      sections.push(colors.bold('\n📅 Recent Activity (7 days)'));
      sections.push(
        new Table()
          .header(['Metric', 'Count'])
          .body([
            ['Created', timeline.created[0]?.count.toString() || '0'],
            ['Resolved', timeline.resolved[0]?.count.toString() || '0'],
            ['Updated', timeline.updated[0]?.count.toString() || '0'],
            ['Comments', timeline.comments?.[0]?.count.toString() || '0'],
          ])
          .border(true)
          .toString(),
      );
      sections.push(
        colors.dim(
          '\nFootnotes:\n• Created: New issues created in the last 7 days\n• Resolved: Issues completed in the last 7 days\n• Updated: Issues modified in the last 7 days\n• Comments: Total comments added in the last 7 days',
        ),
      );
    }

    return sections.join('\n');
  }

  private calculateHealthScore(params: {
    project: JiraProject;
    issues: JiraIssueStats;
    members: JiraTeamMember[];
    timeline: JiraTimeline;
    bottlenecks: Array<{ status: string; avgDuration: number; issueCount: number }>;
    sprints?: JiraProjectMetrics['sprints'];
    boardType: 'scrum' | 'kanban';
  }): JiraProjectMetrics['healthScore'] {
    // Start with base scores
    let historicalScore = 5;
    let currentScore = 5;

    // Calculate historical metrics (excluding current sprint)
    const pastSprints = params.sprints?.history || [];

    if (pastSprints.length > 0) {
      // Calculate average completion rate from past sprints only
      const pastCompletionRates = pastSprints.map((sprint) => {
        const committed = sprint.committedIssues || 0;
        const completed = sprint.committedAndCompleted?.length || 0;
        return committed > 0 ? (completed / committed) * 100 : 0;
      });

      const avgHistoricalCompletion = pastCompletionRates.length > 0
        ? pastCompletionRates.reduce((sum, rate) => sum + rate, 0) / pastCompletionRates.length
        : 0;

      // Adjust historical score based on completion rate (40% weight)
      if (avgHistoricalCompletion >= 80) historicalScore += 2;
      else if (avgHistoricalCompletion >= 60) historicalScore += 1;
      else if (avgHistoricalCompletion <= 40) historicalScore -= 1;
      else if (avgHistoricalCompletion <= 20) historicalScore -= 2;

      // Calculate velocity trend excluding current sprint
      const pastVelocities = pastSprints.map((s) => s.completedPoints);
      const velocityTrend = this.calculateTrendChange(pastVelocities);

      // Adjust score based on velocity trend (20% weight)
      if (parseFloat(velocityTrend) > 10) historicalScore += 1;
      else if (parseFloat(velocityTrend) < -10) historicalScore -= 1;

      // Calculate stability score (20% weight)
      const stabilityScore = this.calculateStabilityScore(pastVelocities);
      if (stabilityScore === 'High') historicalScore += 1;
      else if (stabilityScore === 'Low') historicalScore -= 1;

      // Consider added work pattern (20% weight)
      const avgAddedWork = pastSprints.reduce((sum, sprint) =>
        sum + (sprint.addedDuringSprintAndCompleted?.length || 0), 0) / pastSprints.length;
      const addedWorkCompletion = pastSprints.map((sprint) =>
        (sprint.addedDuringSprintAndCompleted?.length || 0) / (avgAddedWork || 1)
      );

      const addedWorkStability = this.calculateVariance(addedWorkCompletion);
      if (addedWorkStability < 0.2) {
        historicalScore += 1; // Stable added work pattern
      } else if (addedWorkStability > 0.5) {
        historicalScore -= 1; // Unstable added work pattern
      }
    }

    // Calculate current sprint score
    const activeSprint = params.sprints?.active;
    if (activeSprint) {
      // Progress vs Time (40% weight)
      const progressRatio = activeSprint.progress / 100;
      const timeRatio = this.getDaysAgo(new Date(activeSprint.startDate)) /
        (this.getDaysAgo(new Date(activeSprint.startDate)) + activeSprint.remainingDays);

      if (progressRatio >= timeRatio) currentScore += 1;
      else if (progressRatio < timeRatio * 0.7) currentScore -= 1;

      // Velocity comparison to historical average (30% weight)
      const avgHistoricalVelocity = params.sprints?.avgVelocity || 0;
      if (activeSprint.avgDailyVelocity >= avgHistoricalVelocity) currentScore += 1;
      else if (activeSprint.avgDailyVelocity < avgHistoricalVelocity * 0.7) currentScore -= 1;

      // Added work ratio compared to historical pattern (30% weight)
      const avgHistoricalAdded = pastSprints.reduce((sum, sprint) =>
        sum + (sprint.addedDuringSprintAndCompleted?.length || 0), 0) / pastSprints.length;
      const currentAdded = activeSprint.addedDuringSprintAndCompleted?.length || 0;

      if (currentAdded <= avgHistoricalAdded * 1.2) {
        currentScore += 1;
      } else if (currentAdded > avgHistoricalAdded * 1.5) {
        currentScore -= 1;
      }
    }

    // Ensure scores stay within bounds
    historicalScore = Math.max(0, Math.min(10, historicalScore));
    currentScore = Math.max(0, Math.min(10, currentScore));

    // Calculate combined score with more weight on historical performance
    const combined = (historicalScore * 0.7) + (currentScore * 0.3);

    // Calculate trends using only completed sprints
    const velocityTrend = this.calculateTrendChange(pastSprints.map((s) => s.completedPoints));
    const completionTrend = this.calculateTrendChange(
      pastSprints.map((s) =>
        (s.committedAndCompleted?.length || 0) / (s.committedIssues || 1) * 100
      ),
    );
    const scopeChangeTrend = this.calculateScopeChangeTrend(pastSprints);

    return {
      current: currentScore,
      historical: historicalScore,
      combined,
      trends: {
        velocity: velocityTrend,
        completion: completionTrend,
        scope: this.getTrendIndicator(scopeChangeTrend),
      },
    };
  }

  private getHealthIndicator(health: {
    current: number;
    historical: number;
    combined: number;
    trends: {
      velocity: string;
      completion: string;
      scope: string;
    };
  }): string {
    const score = health.combined;
    if (score === null) return `${theme.symbols.status.neutral} No data`;

    let indicator = '';
    if (score >= 8) {
      indicator = `${theme.symbols.status.success} Healthy (${score.toFixed(1)}/10)`;
    } else if (score >= 6) {
      indicator = `${theme.symbols.status.warning} Fair (${score.toFixed(1)}/10)`;
    } else {
      indicator = `${theme.symbols.status.error} At Risk (${score.toFixed(1)}/10)`;
    }

    // Add historical vs current comparison
    if (health.current !== null) {
      indicator += `\n├─ Historical: ${health.historical.toFixed(1)}/10`;
      indicator += `\n├─ Current Sprint: ${health.current.toFixed(1)}/10`;
      indicator += '\n├─ Trends:';
      indicator += `\n│  ├─ Velocity: ${health.trends.velocity}`;
      indicator += `\n│  ├─ Completion: ${health.trends.completion}`;
      indicator += `\n│  └─ Scope Stability: ${health.trends.scope}`;
    }

    return indicator;
  }

  private getTrendIndicator(trend: number[]): string {
    if (!trend || trend.length < 2) return `${theme.symbols.status.neutral} No data`;

    const last = trend[trend.length - 1] || 0;
    const secondLast = trend[trend.length - 2] || 0;

    if (secondLast === 0) return `${theme.symbols.status.neutral} No trend data`;

    const change = last - secondLast;
    const percentChange = (change / Math.abs(secondLast)) * 100;

    if (Math.abs(percentChange) < 5) return `${theme.symbols.status.neutral} Stable`;
    if (percentChange > 0) {
      return `${theme.symbols.status.success} Improving (+${percentChange.toFixed(1)}%)`;
    }
    return `${theme.symbols.status.warning} Declining (${percentChange.toFixed(1)}%)`;
  }

  private getSprintMetrics(
    latestSprint: SprintData,
    sprintData: SprintData[],
  ): JiraProjectMetrics['sprints'] {
    this.logger.debug(
      'Sprint data before velocity calculation:',
      sprintData.map((s) => ({
        name: s.name,
        velocity: s.velocity,
        completionRate: s.completionRate,
      })),
    );

    // Calculate velocity trend (last 5 sprints)
    // Make sure all sprints have velocity values (even if 0)
    const velocityData = sprintData
      .map((sprint) => sprint ? (typeof sprint.velocity === 'number' ? sprint.velocity : 0) : 0)
      .slice(0, 5)
      .reverse();

    this.logger.debug('Velocity data after processing:', velocityData);

    // Calculate completion rate trend (last 5 sprints)
    // Make sure all sprints have completion rate values (even if 0)
    // Cap completion rates at 100% for trend purposes
    const completionRates = sprintData
      .map((sprint) =>
        sprint
          ? (typeof sprint.completionRate === 'number'
            ? Math.min(1, sprint.completionRate) * 100
            : 0)
          : 0
      )
      .slice(0, 5)
      .reverse();

    this.logger.debug('Completion rates after processing:', completionRates);

    // Calculate average velocity
    const avgVelocity = velocityData.length > 0
      ? velocityData.reduce((sum, velocity) => sum + velocity, 0) / velocityData.length
      : 0;

    // Calculate average completion rate
    const avgCompletionRate = completionRates.length > 0
      ? completionRates.reduce((sum, rate) => sum + rate, 0) / completionRates.length / 100
      : 0;

    // Map sprint history for display
    const history = sprintData.map((sprint) => ({
      name: sprint.name,
      startDate: sprint.startDate,
      endDate: sprint.endDate,
      progress: sprint.progress,
      committedPoints: sprint.committedPoints,
      completedPoints: sprint.completedPoints,
      completionRate: sprint.completionRate,
      avgDailyVelocity: sprint.avgDailyVelocity,
      committedIssues: sprint.committedIssues.length,
      completedIssues: sprint.completedIssues.length,
      committedAndCompleted: sprint.committedAndCompleted,
      addedDuringSprintAndCompleted: sprint.addedDuringSprintAndCompleted,
      totalIssues: sprint.totalIssues.length,
      spiltOverIssues: sprint.spiltOverIssues.length,
    }));

    // Count sprints by state
    const activeCount = sprintData.filter((sprint) => sprint.state === 'active').length;
    const closedCount = sprintData.filter((sprint) => sprint.state === 'closed').length;
    const futureCount = sprintData.filter((sprint) => sprint.state === 'future').length;

    // Calculate average cycle time and throughput
    const allCompletedIssues = sprintData.flatMap((sprint) => sprint.completedIssues);
    const avgThroughput = sprintData.length > 0 ? allCompletedIssues.length / sprintData.length : 0;

    // Process latest sprint metrics
    let active = undefined;
    if (latestSprint && latestSprint.state === 'active') {
      const estimatedCompletion = this.calculateEstimatedCompletion(latestSprint, avgVelocity);
      const predictabilityScore = this.calculatePredictabilityScore(velocityData, completionRates);
      const stabilityScore = this.calculateStabilityScore(velocityData);

      active = {
        name: latestSprint.name,
        progress: latestSprint.progress,
        committedPoints: latestSprint.committedPoints,
        completedPoints: latestSprint.completedPoints,
        completionRate: latestSprint.completionRate,
        remainingDays: latestSprint.remainingDays,
        startDate: latestSprint.startDate.toISOString(),
        endDate: latestSprint.endDate.toISOString(),
        estimatedCompletion,
        avgDailyVelocity: latestSprint.avgDailyVelocity,
        predictabilityScore,
        stabilityScore,
        committedIssues: latestSprint.committedIssues.length,
        completedIssues: latestSprint.completedIssues.length,
        committedCompletedPoints: latestSprint.committedCompletedPoints,
        addedCompletedPoints: latestSprint.addedCompletedPoints,
        committedAndCompleted: latestSprint.committedAndCompleted,
        addedDuringSprintAndCompleted: latestSprint.addedDuringSprintAndCompleted,
        storyPoints: latestSprint.storyPoints,
        issueTypes: latestSprint.issueTypes,
        priorities: latestSprint.priorities,
        totalIssues: latestSprint.totalIssues.length,
        spiltOverIssues: latestSprint.spiltOverIssues.length,
      };
    }

    return {
      active,
      count: sprintData.length,
      activeCount,
      closedCount,
      future: futureCount,
      avgVelocity,
      avgCompletionRate,
      avgCycleTime: {
        mean: 0,
        median: 0,
        distribution: {
          min: 0,
          max: 0,
          p25: 0,
          p75: 0,
          p90: 0,
        },
      },
      avgThroughput,
      closed: closedCount,
      velocityTrend: velocityData,
      completionRateTrend: completionRates,
      history,
    };
  }

  private calculateEstimatedCompletion(sprint: SprintData, avgVelocity: number): number {
    if (sprint.committedPoints === 0) return 0;

    const remainingPoints = sprint.committedPoints - sprint.completedPoints;
    if (remainingPoints <= 0) return 1; // All committed points completed

    // Calculate how many points we expect to complete based on velocity and remaining days
    const estimatedPointsToComplete = avgVelocity * sprint.remainingDays;

    // Calculate estimated completion percentage
    const estimatedCompletion =
      (sprint.completedPoints + Math.min(remainingPoints, estimatedPointsToComplete)) /
      sprint.committedPoints;

    this.logger.debug('Estimated completion calculation:', {
      committedPoints: sprint.committedPoints,
      completedPoints: sprint.completedPoints,
      remainingPoints,
      avgVelocity: `${avgVelocity.toFixed(1)} points/day`,
      remainingDays: sprint.remainingDays,
      estimatedPointsToComplete: estimatedPointsToComplete.toFixed(1),
      estimatedCompletion: `${(estimatedCompletion * 100).toFixed(1)}%`,
    });

    return Math.min(1, Math.max(0, estimatedCompletion));
  }

  private calculateScopeChange(metrics: JiraProjectMetrics, sprintIndex: number): string {
    if (!metrics.sprints?.velocityTrend) return '0';
    const initialScope = metrics.sprints.velocityTrend[sprintIndex] || 0;
    const finalScope = metrics.sprints.velocityTrend[sprintIndex + 1] || initialScope;
    const change = ((finalScope - initialScope) / initialScope) * 100;
    return change > 0 ? `+${change.toFixed(1)}` : change.toFixed(1);
  }

  private getSprintHealthIndicator(velocity: number, completionRate: number): string {
    const score = (velocity * 0.5) + (completionRate * 0.5);
    if (score >= 90) return colors.green('Excellent');
    if (score >= 75) return colors.blue('Good');
    if (score >= 60) return colors.yellow('Fair');
    return colors.red('Needs Attention');
  }

  private calculateTrendChange(values: number[]): string {
    if (!values || values.length < 2) {
      return 'No trend data';
    }

    const last = values[values.length - 1] || 0;
    const secondLast = values[values.length - 2] || 0;

    if (secondLast === 0) {
      return 'No baseline data';
    }

    const change = last - secondLast;
    const percentChange = (change / Math.abs(secondLast)) * 100;

    let indicator = '';
    if (percentChange > 0) {
      indicator = `${theme.symbols.status.success} Improving (+${percentChange.toFixed(1)}%)`;
    } else if (percentChange < 0) {
      indicator = `${theme.symbols.status.warning} Declining (${percentChange.toFixed(1)}%)`;
    } else {
      indicator = `${theme.symbols.status.neutral} Stable (0.0%)`;
    }

    return indicator;
  }

  private calculatePredictabilityScore(velocityData: number[], completionRates: number[]): string {
    if (velocityData.length < 2 || completionRates.length < 2) return 'Insufficient data';

    // Calculate velocity variance
    const avgVelocity = velocityData.reduce((sum, v) => sum + v, 0) / velocityData.length;
    const velocityVariance =
      velocityData.reduce((sum, v) => sum + Math.pow(v - avgVelocity, 2), 0) / velocityData.length;
    const velocityCV = Math.sqrt(velocityVariance) / avgVelocity;

    // Calculate completion rate consistency
    const avgCompletionRate = completionRates.reduce((sum, r) => sum + r, 0) /
      completionRates.length;
    const completionVariance =
      completionRates.reduce((sum, r) => sum + Math.pow(r - avgCompletionRate, 2), 0) /
      completionRates.length;
    const completionCV = Math.sqrt(completionVariance) / avgCompletionRate;

    // Combined score based on both metrics
    const combinedCV = (velocityCV + completionCV) / 2;

    if (combinedCV <= 0.1) return 'Very High';
    if (combinedCV <= 0.2) return 'High';
    if (combinedCV <= 0.3) return 'Medium';
    return 'Low';
  }

  private calculateStabilityScore(velocityData: number[]): string {
    if (velocityData.length < 2) return 'Insufficient data';

    // Calculate trend stability
    let increasingTrend = 0;
    let decreasingTrend = 0;

    for (let i = 1; i < velocityData.length; i++) {
      const change = velocityData[i] - velocityData[i - 1];
      if (change > 0) increasingTrend++;
      else if (change < 0) decreasingTrend++;
    }

    // Calculate coefficient of variation
    const avg = velocityData.reduce((sum, v) => sum + v, 0) / velocityData.length;
    const variance = velocityData.reduce((sum, v) => sum + Math.pow(v - avg, 2), 0) /
      velocityData.length;
    const cv = Math.sqrt(variance) / avg;

    // Combine trend and variation analysis
    if (cv <= 0.15 && Math.abs(increasingTrend - decreasingTrend) <= 1) return 'High';
    if (cv <= 0.25 && Math.abs(increasingTrend - decreasingTrend) <= 2) return 'Medium';
    return 'Low';
  }

  private calculateDeliveryScore(completionRates: number[]): string {
    const avgCompletionRate = completionRates.reduce((a, b) => a + b, 0) / completionRates.length;
    return this.getScoreIndicator(avgCompletionRate);
  }

  private getScoreIndicator(score: number): string {
    if (score >= 90) return colors.green('High');
    if (score >= 75) return colors.blue('Good');
    if (score >= 60) return colors.yellow('Fair');
    return colors.red('Low');
  }

  private calculateVariance(values: number[]): number {
    if (values.length === 0) return 0;
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const squareDiffs = values.map((value) => Math.pow(value - mean, 2));
    return squareDiffs.reduce((a, b) => a + b, 0) / values.length;
  }

  /**
   * Get team members for a project
   */
  private async getTeamMembers(projectKey: string): Promise<JiraTeamMember[]> {
    try {
      const response = await this.request<{ actors: JiraTeamMember[] }>(
        `/rest/api/2/project/${projectKey}/role/10002`,
      );
      return response.actors || [];
    } catch (error) {
      this.logger.error('Error fetching team members:', error);
      return [];
    }
  }

  /**
   * Get project timeline
   */
  private async getProjectTimeline(projectKey: string): Promise<JiraTimeline> {
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const recentIssues = await this.searchIssues(
      `project = "${projectKey}" AND updated >= -7d ORDER BY updated DESC`,
    );

    const timeline: JiraTimeline = {
      created: [{
        count: recentIssues.issues.filter((i) => new Date(i.fields.created) >= sevenDaysAgo).length,
      }],
      resolved: [{
        count: recentIssues.issues.filter((i) =>
          i.fields.resolutiondate && new Date(i.fields.resolutiondate) >= sevenDaysAgo
        ).length,
      }],
      updated: [{
        count: recentIssues.issues.filter((i) => new Date(i.fields.updated) >= sevenDaysAgo).length,
      }],
      comments: [{
        count: recentIssues.issues.reduce(
          (sum, issue) => sum + (issue.fields.comment?.comments?.length || 0),
          0,
        ),
      }],
    };

    return timeline;
  }

  private async ensureInitialized(): Promise<void> {
    if (!this.initialized) {
      await this.initialize(this.currentProjectKey);
    }
  }

  formatSprintAnalysis(sprintData: SprintData[]): string {
    // Calculate overall metrics
    const totalCommitted = sprintData.reduce(
      (sum, sprint) => sum + sprint.committedIssues.length,
      0,
    );
    const totalCompleted = sprintData.reduce(
      (sum, sprint) => sum + sprint.completedIssues.length,
      0,
    );
    const totalSpiltOver = sprintData.reduce(
      (sum, sprint) => sum + sprint.spiltOverIssues.length,
      0,
    );
    const avgCycleTime = sprintData.reduce((sum, sprint) => sum + sprint.averageCycleTime.mean, 0) /
      sprintData.length;

    // Get bottleneck analysis from the most recent sprint
    const latestSprint = sprintData[0];
    const { bottlenecks: _bottlenecks, blockedIssues } = this.identifyBottlenecks(
      latestSprint.stageTransitions,
    );

    // Format durations
    const formatDuration = (hours: number): string => {
      const weeks = Math.floor(hours / (24 * 7));
      const days = Math.floor((hours % (24 * 7)) / 24);
      const remainingHours = Math.floor(hours % 24);

      const parts = [];
      if (weeks > 0) parts.push(`${weeks}w`);
      if (days > 0) parts.push(`${days}d`);
      if (remainingHours > 0 && weeks === 0) parts.push(`${remainingHours}h`);

      return parts.join(' ') || '0h';
    };

    // Main sprint metrics table
    const sprintMetricsTable = new Table()
      .border(true)
      .padding(1);

    // Add title as a header row
    sprintMetricsTable.push([
      `${theme.symbols.metrics} Sprint Metrics (Last ${sprintData.length} Sprints)`,
    ]);

    // Commitment & delivery section
    const commitmentTable = new Table()
      .border(true)
      .padding(1)
      .header(['Metric', 'Value']);

    // Add title as a header row
    commitmentTable.push(['🎯 Commitment & Delivery', '']);

    commitmentTable.push([
      'Done vs Committed',
      `${(totalCompleted / totalCommitted * 100).toFixed(1)}%`,
    ]);
    commitmentTable.push(['Completed/Committed', `${totalCompleted}/${totalCommitted}`]);
    commitmentTable.push([
      'Performance Level',
      formatServiceStatus(this.rateCompletionRate(totalCompleted / totalCommitted)),
    ]);

    // Sprint spillover section
    const spilloverTable = new Table()
      .border(true)
      .padding(1)
      .header(['Metric', 'Value']);

    // Add title as a header row
    spilloverTable.push(['🔄 Sprint Spillover', '']);

    spilloverTable.push([
      'Spillover Rate',
      `${(totalSpiltOver / totalCommitted * 100).toFixed(1)}%`,
    ]);
    spilloverTable.push(['Spilled/Total Tickets', `${totalSpiltOver}/${totalCommitted}`]);
    spilloverTable.push([
      'Performance Level',
      formatServiceStatus(this.rateSpilloverRate(totalSpiltOver / totalCommitted)),
    ]);

    // Sprint velocity section
    const velocityTable = new Table()
      .border(true)
      .padding(1)
      .header(['Metric', 'Value']);

    // Add title as a header row
    velocityTable.push(['⚡ Sprint Velocity', '']);

    velocityTable.push(['Average Cycle Time', formatDuration(avgCycleTime)]);
    velocityTable.push([
      'Throughput (avg)',
      `${(totalCompleted / sprintData.length).toFixed(1)} tickets/sprint`,
    ]);
    velocityTable.push([
      'Performance Level',
      formatServiceStatus(this.rateVelocity(avgCycleTime, totalCompleted / sprintData.length)),
    ]);

    // Sprint-by-sprint analysis table
    const sprintAnalysisTable = new Table()
      .border(true)
      .padding(1)
      .header(['Sprint', 'Results']);

    // Add title as a header row
    sprintAnalysisTable.push(['📈 Sprint-by-Sprint Analysis', '']);

    // Format sprint-by-sprint analysis
    const sprintAnalysis = sprintData.map((sprint, index) =>
      `Period ${index + 1}`.padEnd(20) +
      `Committed: ${sprint.committedIssues.length}, ` +
      `Completed: ${sprint.completedIssues.length}, ` +
      `Spillover: ${sprint.spiltOverIssues.length}`
    ).join('\n');

    sprintAnalysisTable.push(['Analysis', sprintAnalysis]);

    // Outliers table
    const outliersTable = new Table()
      .border(true)
      .padding(1)
      .header(['Status', 'Duration']);

    // Add title as a header row
    outliersTable.push(['⚠️ Outliers by Status (>7 days)', '']);

    // Format status outliers
    const statusOutliers = latestSprint.stageTransitions.statusAnalytics
      .filter((stat) => stat.maxDuration > 24 * 7) // More than 7 days
      .map((stat) =>
        `${stat.status.padEnd(20)}Max: ${formatDuration(stat.maxDuration)} (${stat.maxIssue})`
      ).join('\n');

    if (statusOutliers) {
      outliersTable.push(['Outliers', statusOutliers]);
    } else {
      outliersTable.push(['Outliers', 'No outliers found']);
    }

    // Status analysis table
    const statusAnalysisTable = new Table()
      .border(true)
      .padding(1)
      .header(['Status', 'Average Time']);

    // Add title as a header row
    statusAnalysisTable.push(['🚦 Status Analysis', '']);

    // Format status analysis
    const statusAnalysis = latestSprint.stageTransitions.statusAnalytics
      .map((stat) =>
        `${stat.status.padEnd(20)}Avg: ${
          formatDuration(stat.avgDuration)
        } (${stat.issueCount} issues)`
      ).join('\n');

    statusAnalysisTable.push(['Analysis', statusAnalysis]);

    // Format blocked issues
    const blockedIssuesList = blockedIssues
      .map((issue) => `${issue.key.padEnd(20)}${issue.status}: ${formatDuration(issue.duration)}`)
      .join('\n');

    // Blocked issues table
    const blockedIssuesTable = new Table()
      .border(true)
      .padding(1)
      .header(['Issue', 'Status and Duration']);

    // Add title as a header row
    blockedIssuesTable.push(['⚠️ Blocked Issues (>30 days)', '']);

    if (blockedIssuesList) {
      blockedIssuesTable.push(['Issues', blockedIssuesList]);
    } else {
      blockedIssuesTable.push(['Issues', 'No blocked issues']);
    }

    return [
      commitmentTable.toString(),
      '',
      spilloverTable.toString(),
      '',
      velocityTable.toString(),
      '',
      sprintAnalysisTable.toString(),
      '',
      outliersTable.toString(),
      '',
      statusAnalysisTable.toString(),
      '',
      blockedIssuesTable.toString(),
    ].join('\n');
  }

  private formatSprintData(sprintData: SprintData[]): string {
    let output = '';
    for (const sprint of sprintData) {
      output += `Sprint: ${sprint.name}\n`;
      output += `Start Date: ${sprint.startDate.toLocaleDateString()}\n`;
      output += `End Date: ${sprint.endDate.toLocaleDateString()}\n`;
      output += `State: ${sprint.state}\n`;
      output += `Committed Issues: ${sprint.committedIssues.length}\n`;
      output += `Completed Issues: ${sprint.completedIssues.length}\n`;
      output += `Spillover Issues: ${sprint.spiltOverIssues.length}\n`;
      output += `Total Issues: ${sprint.totalIssues.length}\n`;
      output += `Completion Rate: ${(sprint.completionRate * 100).toFixed(1)}%\n`;
      output += `Progress: ${sprint.progress.toFixed(1)}%\n`;
      output += `Velocity: ${sprint.velocity.toFixed(1)}\n`;
      output += `Daily Velocity: ${sprint.avgDailyVelocity.toFixed(1)}\n`;
      output += `Remaining Days: ${sprint.remainingDays}\n`;
      output += '\n';
    }
    return output;
  }

  private formatDuration(hours: number): string {
    const days = Math.floor(hours / 24);
    const remainingHours = Math.round(hours % 24);
    return days > 0 ? `${days}d ${remainingHours}h` : `${remainingHours}h`;
  }

  private formatVelocityTrend(trend: number[]): string[][] {
    if (!trend || trend.length === 0) {
      return [['No velocity data available', '']];
    }

    const max = Math.max(...trend);
    const height = 8;

    return trend.map((value) => {
      const normalized = max === 0 ? 0 : (value / max) * height;
      const bar = '█'.repeat(Math.round(normalized)) + '░'.repeat(height - Math.round(normalized));
      return [`${value.toFixed(1)} ${bar}`, ''];
    });
  }

  private formatCompletionTrend(trend: number[]): string[][] {
    if (!trend || trend.length === 0) {
      return [['No completion rate data available', '']];
    }

    const height = 8;
    return trend.map((value) => {
      const normalized = (value / 100) * height;
      const bar = '█'.repeat(Math.round(normalized)) + '░'.repeat(height - Math.round(normalized));
      return [`${value.toFixed(1)}% ${bar}`, ''];
    });
  }

  private table(rows: string[][]): string {
    const table = new Table()
      .border(true)
      .padding(1);

    rows.forEach((row) => table.push(row));
    return table.toString();
  }

  private calculateSprintMetrics(issues: JiraIssue[]): {
    issueTypes: {
      story: number;
      task: number;
      bug: number;
      improvement: number;
      spike: number;
      epic: number;
      subtask: number;
    };
    priorities: {
      highest: number;
      high: number;
      medium: number;
      low: number;
      lowest: number;
    };
    storyPoints: number;
  } {
    const metrics = {
      issueTypes: {
        story: 0,
        task: 0,
        bug: 0,
        improvement: 0,
        spike: 0,
        epic: 0,
        subtask: 0,
      },
      priorities: {
        highest: 0,
        high: 0,
        medium: 0,
        low: 0,
        lowest: 0,
      },
      storyPoints: 0,
    };

    issues.forEach((issue) => {
      // Count issue types
      const type = issue.fields.issuetype.name.toLowerCase();
      if (type.includes('story') || type === 'user story') metrics.issueTypes.story++;
      else if (type === 'task') metrics.issueTypes.task++;
      else if (type === 'bug') metrics.issueTypes.bug++;
      else if (type === 'improvement') metrics.issueTypes.improvement++;
      else if (type === 'spike') metrics.issueTypes.spike++;
      else if (type === 'epic') metrics.issueTypes.epic++;
      else if (type === 'sub-task') metrics.issueTypes.subtask++;

      // Count priorities
      const priority = issue.fields.priority?.name?.toLowerCase() || 'medium';
      if (priority === 'highest' || priority === 'blocker' || priority === '1') {
        metrics.priorities.highest++;
      } else if (priority === 'high' || priority === '2') metrics.priorities.high++;
      else if (priority === 'medium' || priority === '3') metrics.priorities.medium++;
      else if (priority === 'low' || priority === '4') metrics.priorities.low++;
      else if (priority === 'lowest' || priority === '5') metrics.priorities.lowest++;

      // Sum story points
      metrics.storyPoints += issue.fields[this.storyPointsField] || 0;
    });

    this.logger.debug('Sprint metrics calculation:', {
      issueTypes: metrics.issueTypes,
      priorities: metrics.priorities,
      storyPoints: metrics.storyPoints,
    });

    return metrics;
  }

  // Add this method to calculate spillover issues
  /*
    Spillover issues are specifically issues that were:
    Committed to the sprint (part of the initial sprint planning)
    Not completed by the end of the sprint
    We don't want to count issues that were added during the sprint as "spillover" because they weren't part of the original commitment.
    The current implementation correctly:
    Takes only committed issues (committedIssues)
    Filters for those that are not done (status?.statusCategory?.key !== 'done')
    And have no resolution date (!issue.fields?.resolutiondate)
  */
  private calculateSpilloverIssues(
    _issues: JiraIssue[],
    committedIssues: JiraIssue[],
  ): JiraIssue[] {
    if (!committedIssues || !committedIssues.length) {
      return [];
    }

    return committedIssues.filter((issue) =>
      issue.fields?.status?.statusCategory?.key !== 'done' &&
      !issue.fields?.resolutiondate
    );
  }

  private getSprintData(sprint: JiraSprint, issues: JiraIssue[]): Promise<SprintData> {
    this.logger.debug(`Processing sprint data for ${sprint.name} (${sprint.id})`);

    // Filter issues that are relevant to this sprint
    const sprintIssues = issues.filter((issue) =>
      (issue.fields.customfield_10460 || [])
        .some((s: { id: string | number }) => s.id.toString() === sprint.id.toString())
    );

    this.logger.debug(`Found ${sprintIssues.length} total issues for sprint ${sprint.name}`);

    // Determine which issues were committed to the sprint at start
    const committedIssues = sprintIssues.filter((issue) =>
      this.wasIssueCommittedToSprint(issue, sprint.id)
    );

    this.logger.debug(
      `Of which ${committedIssues.length} were committed issues for sprint ${sprint.name}`,
    );

    // Get completed issues
    const {
      completedIssues,
      committedAndCompleted,
      addedDuringSprintAndCompleted,
    } = this.getCompletedSprintIssues(sprintIssues, sprint);

    // Calculate spillover issues - committed but not completed
    const spiltOverIssues = this.calculateSpilloverIssues(issues, committedIssues);

    this.logger.debug(`Sprint ${sprint.name} metrics:
      - Total issues: ${sprintIssues.length}
      - Committed issues: ${committedIssues.length}
      - Completed issues: ${completedIssues.length}
      - Spillover issues: ${spiltOverIssues.length}`);

    // Calculate sprint metrics on the issues
    const { issueTypes, priorities, storyPoints } = this.calculateSprintMetrics(sprintIssues);

    // Get stage transitions for the sprint issues
    const stageTransitions = this.calculateStageTransitions(sprintIssues);

    // Calculate cycle time for completed issues
    const averageCycleTime = this.calculateAverageCycleTime(completedIssues);

    // Calculate completion rate based only on committed issues
    const completionRate = committedIssues.length > 0
      ? committedAndCompleted.length / committedIssues.length
      : 0;

    // Calculate remaining days
    const now = new Date();
    const endDate = new Date(sprint.endDate);
    const remainingDays = Math.max(
      0,
      Math.ceil((endDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)),
    );

    // Calculate story points for different categories
    const committedPoints = committedIssues.reduce(
      (sum, issue) => sum + this.calculateStoryPoints(issue),
      0,
    );

    const completedPoints = completedIssues.reduce(
      (sum, issue) => sum + this.calculateStoryPoints(issue),
      0,
    );

    const committedCompletedPoints = committedAndCompleted.reduce(
      (sum, issue) => sum + this.calculateStoryPoints(issue),
      0,
    );

    const addedCompletedPoints = addedDuringSprintAndCompleted.reduce(
      (sum, issue) => sum + this.calculateStoryPoints(issue),
      0,
    );

    // Calculate scope change (percentage of work added/removed during sprint)
    const scopeChange = committedPoints > 0
      ? ((completedPoints - committedPoints) / Math.max(1, committedPoints)) * 100
      : 0;

    // Calculate sprint duration in days
    const startDate = new Date(sprint.startDate);
    const sprintDuration = Math.ceil(
      (endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24),
    );

    // Calculate velocity (points per day)
    const velocity = completedPoints / Math.max(1, sprintDuration);

    // Determine sprint state
    const state = now < startDate ? 'future' : (now > endDate ? 'closed' : 'active');

    // Create sprint data object
    const sprintData: SprintData = {
      id: sprint.id.toString(),
      name: sprint.name,
      startDate: new Date(sprint.startDate),
      endDate: new Date(sprint.endDate),
      state,
      committedIssues,
      completedIssues,
      spiltOverIssues,
      totalIssues: sprintIssues,
      stageTransitions,
      averageCycleTime,
      completionRate,
      progress: 0, // Will calculate below
      velocity,
      committedPoints,
      completedPoints,
      committedCompletedPoints,
      addedCompletedPoints,
      remainingDays,
      addedDuringSprintAndCompleted,
      committedAndCompleted,
      storyPoints,
      issueTypes,
      priorities,
      avgDailyVelocity: 0, // Will calculate below
    };

    this.logger.debug(`Sprint ${sprint.name} final metrics:
      - Total issues: ${sprintIssues.length}
      - Committed issues: ${committedIssues.length}
      - Completed from committed: ${committedAndCompleted.length}
      - Added and completed: ${addedDuringSprintAndCompleted.length}
      - Spillover issues: ${spiltOverIssues.length}
      - Story points: ${storyPoints}
      - Completed points: ${completedPoints}
      - Velocity: ${velocity.toFixed(1)} points/day
      - Completion rate: ${(completionRate * 100).toFixed(1)}%`);

    // Calculate sprint progress based on time elapsed and completion rate
    sprintData.progress = this.calculateSprintProgress(sprintData);

    // Calculate average daily velocity based on completed points and elapsed time
    const elapsedDays = Math.max(1, sprintDuration - remainingDays);
    sprintData.avgDailyVelocity = completedPoints / elapsedDays;

    // Calculate estimated completion based on velocity
    const estimatedCompletion = this.calculateEstimatedCompletion(sprintData, velocity);
    sprintData.estimatedCompletion = estimatedCompletion;

    // Calculate sprint health
    const healthStatus = this.getSprintHealthIndicator(velocity, completionRate);
    sprintData.healthStatus = healthStatus;

    // Calculate scope change by comparing initial committed points to final total points
    sprintData.scopeChange = scopeChange;

    // Calculate velocity trend indicator
    if (velocity > 0) {
      const velocityTrend = this.calculateTrendChange([velocity]);
      sprintData.velocityTrendIndicator = velocityTrend;
    }

    return Promise.resolve(sprintData);
  }

  private wasAddedDuringSprint(issue: JiraIssue, sprint: JiraSprint): boolean {
    const sprintStart = new Date(sprint.startDate);
    const issueCreated = new Date(issue.fields.created);
    return issueCreated > sprintStart;
  }

  private isIssueCompleted(issue: JiraIssue): boolean {
    return issue.fields.status.statusCategory.key === 'done';
  }

  private calculateStoryPoints(issue: JiraIssue): number {
    const points = issue.fields[this.storyPointsField];
    return typeof points === 'number' ? points : 0;
  }

  private calculateTotalStoryPoints(issues: JiraIssue[]): number {
    return issues.reduce((sum, issue) => sum + this.calculateStoryPoints(issue), 0);
  }

  public setStoryPointsField(field: string): void {
    this.logger.debug(`Setting story points field to: ${field}`);
    this.storyPointsField = field;
  }
}
