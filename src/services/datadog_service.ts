import { Table } from '@cliffy/table';
import {
  client,
  v1,
  v2,
} from '@datadog/datadog-api-client';
import { exists } from '@std/fs/exists';
import { walk } from '@std/fs/walk';
import { join } from '@std/path/join';
import { Config } from '../config/mod.ts';
import { formatServiceStatus, formatTimestamp, theme } from '../utils.ts';
import { Logger } from '../utils/logger.ts';

export interface DatadogMetrics {
  series: Array<{
    metric: string;
    points: Array<[number, number]>;
    type?: string;
    interval?: number;
    tags?: string[];
  }>;
}

export interface DatadogMonitor {
  id: number;
  name: string;
  status: string;
  tags: string[];
  overall_state: string;
  query: string;
  message?: string;
  created_at: string;
  modified_at: string;
}

export interface DatadogDashboard {
  id: string;
  title: string;
  description?: string;
  layout_type: string;
  url: string;
  created_at: string;
  modified_at: string;
  author?: {
    name?: string;
    email?: string;
  };
}

export interface DatadogEvent {
  id: number;
  title: string;
  text: string;
  date_happened: number;
  priority?: string;
  tags?: string[];
  alert_type?: string;
}

interface TeamLinkResponse {
  data: Array<{
    id: string;
    type: string;
    attributes: {
      label: string;
      position: number;
      team_id: string;
      url: string;
    };
  }>;
}

export interface DatadogTeam {
  id: string;
  name: string;
  description?: string;
  handle: string;
  avatar?: string;
  banner?: number;
  created_at: string;
  modified_at: string;
  user_count: number;
  links?: Array<{
    id: string;
    label: string;
    url: string;
    position: number;
  }>;
}

interface ProjectVerificationResult {
  hasDatadogAgent: boolean;
  hasApiKey: boolean;
  hasAppKey: boolean;
  hasMetricsConfig: boolean;
  hasTracingConfig: boolean;
  recommendations: string[];
}

// Define API response types
interface MonitorResponse {
  data?: Array<{
    id?: string | number;
    name?: string;
    status?: string;
    tags?: string[];
    overallState?: string;
    query?: string;
    message?: string;
    created?: string;
    modified?: string;
  }>;
}

interface DashboardSummary {
  id?: string;
  title?: string;
  description?: string;
  layoutType?: string;
  url?: string;
  createdAt?: string | Date;
  modifiedAt?: string | Date;
  author?: {
    name?: string;
    email?: string;
  };
}

interface DashboardListResponse {
  dashboards?: DashboardSummary[];
}

interface TeamsResponse {
  data: Array<{
    id: string;
    type: string;
    attributes: {
      name: string;
      description?: string;
      handle: string;
      avatar?: string;
      banner?: string;
      createdAt: string;
      modifiedAt: string;
      userCount: number;
      linkCount: number;
      summary?: string;
      additionalProperties?: {
        is_managed: boolean;
      };
    };
    relationships: {
      teamLinks: {
        data: Array<{
          id: string;
          type: string;
        }>;
        links: {
          related: string;
        };
      };
      userTeamPermissions: {
        links: {
          related: string;
        };
      };
    };
  }>;
  included?: Array<{
    type: string;
    id: string;
    attributes: Record<string, unknown>;
    relationships: Record<string, unknown>;
  }>;
  links?: {
    first?: string;
    last?: string;
    next?: string;
    prev?: string;
    self?: string;
  };
  meta?: {
    pagination?: {
      offset: number;
      limit: number;
      total: number;
    };
  };
}

export class DatadogService {
  private config: Config;
  private logger: Logger;
  private monitorApi: v2.MonitorsApi;
  private metricsApi: v1.MetricsApi;
  private dashboardApi: v1.DashboardsApi;
  private eventsApi: v1.EventsApi;
  private teamsApi: v2.TeamsApi;

  constructor(config: Config) {
    this.logger = new Logger('Datadog', Deno.env.get('NOVA_DEBUG') === 'true');
    this.logger.debug('Initializing DatadogService with config:', {
      hasDatadog: !!config.datadog,
      hasApiKey: !!config.datadog?.api_key,
      hasAppKey: !!config.datadog?.app_key,
    });

    if (!config.datadog?.api_key || !config.datadog?.app_key) {
      throw new Error('Datadog is not configured properly. Please run: nova setup');
    }
    this.config = config;

    // Set environment variables for Datadog client
    Deno.env.set('DD_SITE', 'datadoghq.eu');
    Deno.env.set('DD_API_KEY', config.datadog.api_key);
    Deno.env.set('DD_APP_KEY', config.datadog.app_key);

    this.logger.debug('Creating Datadog client configuration...');
    const configuration = client.createConfiguration({
      authMethods: {
        apiKeyAuth: config.datadog.api_key,
        appKeyAuth: config.datadog.app_key,
      }
    });

    this.logger.debug('Created Datadog client configuration');

    this.logger.debug('Initializing API clients...');
    this.monitorApi = new v2.MonitorsApi(configuration);
    this.metricsApi = new v1.MetricsApi(configuration);
    this.dashboardApi = new v1.DashboardsApi(configuration);
    this.eventsApi = new v1.EventsApi(configuration);
    this.teamsApi = new v2.TeamsApi(configuration);
    this.logger.debug('Initialized Datadog API clients');
  }

  async getMonitors(): Promise<DatadogMonitor[]> {
    this.logger.debug('Starting getMonitors call');
    try {
      this.logger.debug('Calling monitors API...');
      // @ts-ignore: This is a valid response type
      const response = await this.monitorApi.listMonitors({}) as MonitorResponse;
      this.logger.debug('Got response from API:', {
        hasData: !!response.data,
        dataLength: response.data?.length || 0
      });

      const monitors = (response.data || []).map((monitor) => ({
        id: typeof monitor.id === 'number' ? monitor.id : Number(monitor.id) || 0,
        name: String(monitor.name || ''),
        status: String(monitor.status || ''),
        tags: monitor.tags || [],
        overall_state: String(monitor.overallState || ''),
        query: String(monitor.query || ''),
        message: monitor.message,
        created_at: String(monitor.created || ''),
        modified_at: String(monitor.modified || ''),
      }));

      this.logger.debug('Processed monitors:', {
        count: monitors.length,
        firstMonitor: monitors[0] ? {
          id: monitors[0].id,
          name: monitors[0].name,
          status: monitors[0].status
        } : null
      });

      return monitors;
    } catch (error) {
      this.logger.error('Failed to fetch monitors:', error);
      if (error instanceof Error) {
        this.logger.debug('Full error:', error);
        this.logger.debug('Stack trace:', error.stack);
      }
      throw error;
    }
  }

  async getMetrics(query: string, from: string, to: string): Promise<DatadogMetrics> {
    try {
      const fromTime = Math.floor(new Date(from).getTime() / 1000);
      const toTime = to === 'now' ? Math.floor(Date.now() / 1000) : Math.floor(new Date(to).getTime() / 1000);

      const response = await this.metricsApi.queryMetrics({
        from: fromTime,
        to: toTime,
        query: query,
      });

      return {
        series: response.series?.map((series) => {
          const s = series as Record<string, unknown>;
          return {
            metric: String(s.metric || ''),
            points: Array.isArray(s.pointlist) ? s.pointlist : [],
            type: String(s.expression || ''),
            interval: typeof s.interval === 'number' ? s.interval : undefined,
            tags: Array.isArray(s.tagSet) ? s.tagSet.map(String) : [],
          };
        }) || [],
      };
    } catch (error) {
      this.logger.error('Failed to fetch metrics:', error);
      throw error;
    }
  }

  async getDashboards(): Promise<DatadogDashboard[]> {
    try {
      const response = await this.dashboardApi.listDashboards() as DashboardListResponse;
      if (!response.dashboards) {
        return [];
      }

      return response.dashboards.map((dashboard) => ({
        id: String(dashboard.id || ''),
        title: String(dashboard.title || ''),
        description: dashboard.description,
        layout_type: String(dashboard.layoutType || 'ordered'),
        url: String(dashboard.url || ''),
        created_at: this.formatDate(dashboard.createdAt),
        modified_at: this.formatDate(dashboard.modifiedAt),
        author: dashboard.author ? {
          name: String(dashboard.author.name || ''),
          email: String(dashboard.author.email || ''),
        } : undefined,
      }));
    } catch (error) {
      this.logger.error('Failed to fetch dashboards:', error);
      throw error;
    }
  }

  async getDashboard(dashboardId: string): Promise<DatadogDashboard> {
    try {
      const response = await this.dashboardApi.getDashboard({ dashboardId }) as DashboardSummary;
      return {
        id: String(response.id || ''),
        title: String(response.title || ''),
        description: response.description,
        layout_type: String(response.layoutType || 'ordered'),
        url: String(response.url || ''),
        created_at: this.formatDate(response.createdAt),
        modified_at: this.formatDate(response.modifiedAt),
        author: response.author ? {
          name: String(response.author.name || ''),
          email: String(response.author.email || ''),
        } : undefined,
      };
    } catch (error) {
      this.logger.error('Failed to fetch dashboard:', error);
      throw error;
    }
  }

  private formatDate(date: unknown): string {
    if (typeof date === 'string') {
      return date;
    }
    if (date instanceof Date) {
      return date.toISOString();
    }
    return new Date(String(date || '')).toISOString();
  }

  async verifyProjectSetup(projectPath: string): Promise<ProjectVerificationResult> {
    const result: ProjectVerificationResult = {
      hasDatadogAgent: false,
      hasApiKey: false,
      hasAppKey: false,
      hasMetricsConfig: false,
      hasTracingConfig: false,
      recommendations: [],
    };

    try {
      // Check for Datadog agent configuration
      const agentConfigPaths = [
        join(projectPath, 'datadog.yaml'),
        join(projectPath, 'conf.d', 'datadog.yaml'),
        join(projectPath, 'conf.yaml'),
      ];

      for (const path of agentConfigPaths) {
        if (await exists(path)) {
          result.hasDatadogAgent = true;
          break;
        }
      }

      // Check for environment files
      const envFiles = ['.env', '.env.local', '.env.development', '.env.production'];
      let foundApiKey = false;
      let foundAppKey = false;

      for (const envFile of envFiles) {
        const envPath = join(projectPath, envFile);
        if (await exists(envPath)) {
          const content = await Deno.readTextFile(envPath);
          if (content.includes('DD_API_KEY') || content.includes('DATADOG_API_KEY')) {
            foundApiKey = true;
          }
          if (content.includes('DD_APP_KEY') || content.includes('DATADOG_APP_KEY')) {
            foundAppKey = true;
          }
        }
      }

      result.hasApiKey = foundApiKey;
      result.hasAppKey = foundAppKey;

      // Check for metrics configuration
      const metricsFiles = ['dd-trace.js', 'datadog-metrics.js', 'datadog.config.js'];
      for (const file of metricsFiles) {
        if (await exists(join(projectPath, file))) {
          result.hasMetricsConfig = true;
          break;
        }
      }

      // Check package.json for Datadog dependencies
      const packageJsonPath = join(projectPath, 'package.json');
      if (await exists(packageJsonPath)) {
        const packageJson = JSON.parse(await Deno.readTextFile(packageJsonPath));
        const dependencies = { ...packageJson.dependencies, ...packageJson.devDependencies };
        
        if (dependencies['dd-trace'] || dependencies['@datadog/tracer']) {
          result.hasTracingConfig = true;
        }
      }

      // Generate recommendations
      if (!result.hasDatadogAgent) {
        result.recommendations.push(
          'Add Datadog agent configuration file (datadog.yaml) with appropriate settings',
        );
      }

      if (!result.hasApiKey) {
        result.recommendations.push(
          'Add DD_API_KEY or DATADOG_API_KEY to your environment configuration',
        );
      }

      if (!result.hasAppKey) {
        result.recommendations.push(
          'Add DD_APP_KEY or DATADOG_APP_KEY to your environment configuration',
        );
      }

      if (!result.hasMetricsConfig) {
        result.recommendations.push(
          'Add metrics configuration file (dd-trace.js or datadog-metrics.js)',
        );
      }

      if (!result.hasTracingConfig) {
        result.recommendations.push(
          'Install and configure Datadog tracing package (dd-trace or @datadog/tracer)',
        );
      }

      // Check for serverless.yml or similar configuration files
      const serverlessPath = join(projectPath, 'serverless.yml');
      if (await exists(serverlessPath)) {
        const content = await Deno.readTextFile(serverlessPath);
        if (!content.includes('datadog:') && !content.includes('serverless-datadog')) {
          result.recommendations.push(
            'Add Datadog plugin to serverless.yml for proper Lambda function monitoring',
          );
        }
      }

      // Check for common configuration patterns
      for await (const entry of walk(projectPath, {
        includeDirs: false,
        exts: ['.js', '.ts', '.yaml', '.yml'],
        skip: [/node_modules/, /\.git/],
      })) {
        const content = await Deno.readTextFile(entry.path);
        
        // Check for hardcoded API keys (security issue)
        if (content.match(/['"]([a-f0-9]{32})['"]/) && !entry.path.includes('.env')) {
          result.recommendations.push(
            `Potential hardcoded API key found in ${entry.path}. Move it to environment variables.`,
          );
        }

        // Check for missing error handling in Datadog initialization
        if (content.includes('new Datadog(') && !content.includes('try {')) {
          result.recommendations.push(
            `Add error handling for Datadog initialization in ${entry.path}`,
          );
        }
      }

      return result;
    } catch (error) {
      this.logger.error('Error verifying project setup:', error);
      throw error;
    }
  }

  async fixProjectSetup(projectPath: string): Promise<string[]> {
    const fixes: string[] = [];

    try {
      // Create basic Datadog agent configuration if missing
      const agentConfigPath = join(projectPath, 'datadog.yaml');
      if (!await exists(agentConfigPath)) {
        const basicConfig = `
api_key: ${this.config.datadog?.api_key || '${DD_API_KEY}'}
app_key: ${this.config.datadog?.app_key || '${DD_APP_KEY}'}
site: datadoghq.com
logs_enabled: true
apm_config:
  enabled: true
`;
        await Deno.writeTextFile(agentConfigPath, basicConfig);
        fixes.push('Created basic Datadog agent configuration (datadog.yaml)');
      }

      // Create .env file with Datadog variables if missing
      const envPath = join(projectPath, '.env');
      if (!await exists(envPath)) {
        const envContent = `
# Datadog Configuration
DD_API_KEY=${this.config.datadog?.api_key || 'your-api-key-here'}
DD_APP_KEY=${this.config.datadog?.app_key || 'your-app-key-here'}
DD_SITE=datadoghq.com
DD_ENV=development
DD_SERVICE=your-service-name
DD_VERSION=1.0.0
`;
        await Deno.writeTextFile(envPath, envContent);
        fixes.push('Created .env file with Datadog environment variables');
      }

      // Create basic metrics configuration if missing
      const metricsConfigPath = join(projectPath, 'dd-trace.js');
      if (!await exists(metricsConfigPath)) {
        const metricsConfig = `
const tracer = require('dd-trace').init({
  env: process.env.DD_ENV,
  service: process.env.DD_SERVICE,
  version: process.env.DD_VERSION,
  logInjection: true
});

module.exports = tracer;
`;
        await Deno.writeTextFile(metricsConfigPath, metricsConfig);
        fixes.push('Created basic Datadog tracer configuration (dd-trace.js)');
      }

      // Update package.json if it exists
      const packageJsonPath = join(projectPath, 'package.json');
      if (await exists(packageJsonPath)) {
        const packageJson = JSON.parse(await Deno.readTextFile(packageJsonPath));
        let modified = false;

        if (!packageJson.dependencies) {
          packageJson.dependencies = {};
        }

        if (!packageJson.dependencies['dd-trace']) {
          packageJson.dependencies['dd-trace'] = '^3.0.0';
          modified = true;
        }

        if (modified) {
          await Deno.writeTextFile(packageJsonPath, JSON.stringify(packageJson, null, 2));
          fixes.push('Added Datadog dependencies to package.json');
        }
      }

      // Update serverless.yml if it exists
      const serverlessPath = join(projectPath, 'serverless.yml');
      if (await exists(serverlessPath)) {
        let content = await Deno.readTextFile(serverlessPath);
        let modified = false;

        if (!content.includes('serverless-datadog')) {
          const plugins = content.includes('plugins:') 
            ? content.replace('plugins:', 'plugins:\n  - serverless-datadog')
            : content + '\nplugins:\n  - serverless-datadog';
          
          content = plugins + `

custom:
  datadog:
    apiKey: \${env:DD_API_KEY}
    service: \${self:service}
    env: \${opt:stage, 'dev'}
    version: \${env:DD_VERSION, '1.0.0'}
    forwarder: # Optional: your Datadog forwarder ARN
    flushMetricsToLogs: true
    addLayers: true
    logLevel: debug
`;
          await Deno.writeTextFile(serverlessPath, content);
          modified = true;
        }

        if (modified) {
          fixes.push('Updated serverless.yml with Datadog configuration');
        }
      }

      return fixes;
    } catch (error) {
      this.logger.error('Error fixing project setup:', error);
      throw error;
    }
  }

  formatMonitorList(monitors: DatadogMonitor[]): string {
    if (monitors.length === 0) {
      return 'No monitors found.';
    }

    const sections: string[] = [];
    
    for (const monitor of monitors) {
      sections.push(theme.emphasis(`${formatServiceStatus(monitor.overall_state)} Monitor: ${monitor.name}`));
      
      const monitorTable = new Table()
        .border(true)
        .padding(1);
      
      monitorTable.push([`${theme.symbols.info} ID`, monitor.id.toString()]);
      monitorTable.push([`${theme.symbols.metrics} Status`, formatServiceStatus(monitor.status)]);
      
      if (monitor.message) {
        monitorTable.push([`${theme.symbols.documentation} Message`, monitor.message]);
      }
      
      if (monitor.tags.length > 0) {
        monitorTable.push([`${theme.symbols.documentation} Tags`, monitor.tags.join(', ')]);
      }
      
      monitorTable.push([`${theme.symbols.time} Created`, formatTimestamp(monitor.created_at)]);
      monitorTable.push([`${theme.symbols.time} Modified`, formatTimestamp(monitor.modified_at)]);
      
      sections.push(monitorTable.toString());
      sections.push('');
    }

    return sections.join('\n');
  }

  formatDashboardList(dashboards: DatadogDashboard[]): string {
    if (dashboards.length === 0) {
      return 'No dashboards found.';
    }

    const sections: string[] = [];
    
    for (const dashboard of dashboards) {
      sections.push(theme.emphasis(`${theme.symbols.metrics} Dashboard: ${dashboard.title}`));
      
      const dashboardTable = new Table()
        .border(true)
        .padding(1);
      
      dashboardTable.push([`${theme.symbols.info} ID`, dashboard.id]);
      
      if (dashboard.description) {
        dashboardTable.push([`${theme.symbols.documentation} Description`, dashboard.description]);
      }
      
      dashboardTable.push([`${theme.symbols.documentation} Type`, dashboard.layout_type]);
      dashboardTable.push([`${theme.symbols.documentation} URL`, dashboard.url]);
      
      if (dashboard.author) {
        dashboardTable.push([`${theme.symbols.team} Author`, dashboard.author.name || dashboard.author.email || 'Unknown']);
      }
      
      dashboardTable.push([`${theme.symbols.time} Created`, formatTimestamp(dashboard.created_at)]);
      dashboardTable.push([`${theme.symbols.time} Modified`, formatTimestamp(dashboard.modified_at)]);
      
      sections.push(dashboardTable.toString());
      sections.push('');
    }

    return sections.join('\n');
  }

  formatEventList(events: DatadogEvent[]): string {
    if (events.length === 0) {
      return 'No events found.';
    }

    const getPriorityEmoji = (priority?: string): string => {
      switch (priority?.toLowerCase()) {
        case 'normal':
          return '📝';
        case 'low':
          return '⬇️';
        case 'high':
          return '⬆️';
        default:
          return '📌';
      }
    };

    const getAlertTypeEmoji = (type?: string): string => {
      switch (type?.toLowerCase()) {
        case 'error':
          return '❌';
        case 'warning':
          return '⚠️';
        case 'info':
          return 'ℹ️';
        case 'success':
          return '✅';
        default:
          return '📢';
      }
    };

    const sections: string[] = [];
    
    for (const event of events) {
      sections.push(theme.emphasis(`${getAlertTypeEmoji(event.alert_type)} Event: ${event.title}`));
      
      const eventTable = new Table()
        .border(true)
        .padding(1);
      
      eventTable.push(['🆔 ID', event.id.toString()]);
      eventTable.push(['📝 Text', event.text]);
      
      if (event.priority) {
        eventTable.push([`${getPriorityEmoji(event.priority)} Priority`, event.priority]);
      }
      
      if (event.alert_type) {
        eventTable.push(['🚨 Type', event.alert_type]);
      }
      
      if (event.tags && event.tags.length > 0) {
        eventTable.push(['🏷️ Tags', event.tags.join(', ')]);
      }
      
      eventTable.push(['🕒 Date', new Date(event.date_happened * 1000).toLocaleString()]);
      
      sections.push(eventTable.toString());
      sections.push('');
    }

    return sections.join('\n');
  }

  async getTeams(): Promise<DatadogTeam[]> {
    this.logger.debug('Starting getTeams call');
    try {
      this.logger.debug('Calling teams API...');
      const response = await this.teamsApi.listTeams({
        include: ['team_links', 'user_team_permissions']
      });

      if (!response.data) {
        return [];
      }

      // Process teams in parallel to fetch their links
      const teamsPromises = response.data.map(async (team) => {
        // Fetch team links if available
        const teamLinks: Array<{
          id: string;
          label: string;
          url: string;
          position: number;
        }> = [];

        try {
          const linksResponse = await this.teamsApi.getTeamLinks({ teamId: team.id }) as TeamLinkResponse;
          if (linksResponse.data) {
            teamLinks.push(...linksResponse.data.map(link => ({
              id: link.id,
              label: String(link.attributes.label || ''),
              url: String(link.attributes.url || ''),
              position: link.attributes.position || 0
            })));
          }
        } catch (error) {
          this.logger.warn(`Failed to fetch links for team ${team.id}:`, error);
        }
        
        return {
          id: team.id,
          name: team.attributes.name,
          description: team.attributes.description,
          handle: team.attributes.handle,
          avatar: team.attributes.avatar,
          banner: team.attributes.banner,
          created_at: team.attributes.createdAt ? new Date(team.attributes.createdAt).toISOString() : '',
          modified_at: team.attributes.modifiedAt ? new Date(team.attributes.modifiedAt).toISOString() : '',
          user_count: team.attributes.userCount || 0,
          links: teamLinks,
        };
      });

      const teams = await Promise.all(teamsPromises);

      return teams;
    } catch (error) {
      this.logger.error('Failed to fetch teams:', error);
      if (error instanceof Error) {
        this.logger.debug('Full error:', error);
        this.logger.debug('Stack trace:', error.stack);
      }
      throw error;
    }
  }

  formatTeamList(teams: DatadogTeam[]): string {
    if (teams.length === 0) {
      return 'No teams found.';
    }

    const sections: string[] = [];
    
    for (const team of teams) {
      sections.push(theme.emphasis(`${theme.symbols.team} Team: ${team.name}`));
      
      const teamTable = new Table()
        .border(true)
        .padding(1);
      
      teamTable.push([`${theme.symbols.info} ID`, team.id]);
      
      if (team.description) {
        teamTable.push([`${theme.symbols.documentation} Description`, team.description]);
      }
      
      teamTable.push([`${theme.symbols.team} Handle`, team.handle]);
      teamTable.push([`${theme.symbols.team} Members`, team.user_count.toString()]);
      
      if (team.links && team.links.length > 0) {
        teamTable.push([`${theme.symbols.documentation} Links`, team.links.length.toString()]);
      }
      
      teamTable.push([`${theme.symbols.time} Created`, formatTimestamp(team.created_at)]);
      teamTable.push([`${theme.symbols.time} Modified`, formatTimestamp(team.modified_at)]);
      
      sections.push(teamTable.toString());
      sections.push('');
    }

    return sections.join('\n');
  }

  async searchMetrics(query: string, timeRange: string): Promise<Array<{
    name: string;
    id: string;
    type: string;
    value: number;
  }>> {
    try {
      const end = Math.floor(Date.now() / 1000);
      const start = end - this.parseTimeRange(timeRange);

      const response = await this.request<{
        metrics: Array<{
          metric: string;
          id: string;
          type: string;
          values: Array<[number, number]>;
        }>;
      }>('/api/v1/metrics', {
        method: 'POST',
        body: JSON.stringify({
          query,
          from: start,
          to: end
        })
      });

      return response.metrics.map(metric => ({
        name: metric.metric,
        id: metric.id,
        type: metric.type,
        value: metric.values[metric.values.length - 1]?.[1] || 0
      }));
    } catch (error) {
      this.logger.error('Failed to search metrics:', error);
      return [];
    }
  }

  async searchLogs(query: string, timeRange: string): Promise<Array<{
    id: string;
    name: string;
    type: string;
    value: string;
  }>> {
    try {
      const end = Math.floor(Date.now() / 1000);
      const start = end - this.parseTimeRange(timeRange);

      const response = await this.request<{
        logs: Array<{
          id: string;
          content: string;
          service: string;
          timestamp: number;
        }>;
      }>('/api/v1/logs-queries/list', {
        method: 'POST',
        body: JSON.stringify({
          query,
          time: { from: start, to: end }
        })
      });

      return response.logs.map(log => ({
        id: log.id,
        name: log.service,
        type: 'log',
        value: log.content
      }));
    } catch (error) {
      this.logger.error('Failed to search logs:', error);
      return [];
    }
  }

  private parseTimeRange(timeRange: string): number {
    const value = parseInt(timeRange);
    const unit = timeRange.slice(-1);
    switch (unit) {
      case 'h': return value * 3600;
      case 'd': return value * 86400;
      case 'w': return value * 604800;
      default: return 3600; // Default to 1 hour
    }
  }

  private async request<T>(endpoint: string, options: {
    method?: string;
    body?: string;
  } = {}): Promise<T> {
    const baseUrl = 'https://api.datadoghq.eu';
    const url = `${baseUrl}${endpoint}`;
    
    try {
      const response = await fetch(url, {
        method: options.method || 'GET',
        headers: {
          'Content-Type': 'application/json',
          'DD-API-KEY': this.config.datadog!.api_key,
          'DD-APPLICATION-KEY': this.config.datadog!.app_key
        },
        body: options.body
      });

      if (!response.ok) {
        throw new Error(`Datadog API error: ${response.status} ${response.statusText}`);
      }

      return response.json();
    } catch (error) {
      this.logger.error('Request failed:', error);
      throw error;
    }
  }
}
