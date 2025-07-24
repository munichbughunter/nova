import { colors } from '@cliffy/ansi/colors';
import { Table } from '@cliffy/table';
import { Config } from '../config/mod.ts';
import { formatDuration, formatServiceStatus, formatTrendChart, formatTrendValue, theme } from '../utils.ts';
import { DevCache } from '../utils/devcache.ts';
import { logger, Logger } from '../utils/logger.ts';
import { DatabaseService } from './db_service.ts';
import { GitLabService } from './gitlab_service.ts';
import { JiraService } from './jira_service.ts';

/**
 * Service for DORA metrics calculation and analysis
 */
export class DoraService {
  private config: Config;
  private jiraService: JiraService;
  private gitlabService: GitLabService;
  private logger: Logger;
  private initialized = false;
  private cache: DevCache;
  private db: DatabaseService;
  private cacheDir: string;
  private isDebugMode: boolean;
  private cacheDuration: number;

  constructor(
    config: Config, 
    jiraService: JiraService, 
    gitlabService: GitLabService,
    logger: Logger,
    db: DatabaseService
  ) {
    this.config = config;
    this.jiraService = jiraService;
    this.gitlabService = gitlabService;
    this.logger = logger;
    this.db = db;
    this.isDebugMode = Deno.env.get('NOVA_DEBUG') === 'true';
    this.cacheDuration = 6 * 60 * 60 * 1000; // 6 hours
    this.cacheDir = `${Deno.env.get('HOME')}/.nova/cache/dora`;

    // Create cache directory if it doesn't exist
    try {
      Deno.mkdirSync(this.cacheDir, { recursive: true });
    } catch (error) {
      if (!(error instanceof Deno.errors.AlreadyExists)) {
        this.logger.error('Failed to create cache directory:', error);
      }
    }

    // Initialize cache
    this.cache = new DevCache({
      basePath: `${Deno.env.get('HOME')}/.nova/cache`,
      serviceName: 'dora',
      logger: this.logger
    });
  }

  private extractQueryType(key: string): string {
    if (key.includes('metrics_')) {
      const parts = key.split('_');
      if (parts.length > 1) {
        return parts[1];
      }
    }
    
    if (key.includes('raw_')) {
      return 'raw';
    }
    
    return 'other';
  }

  private async request<T>(key: string, dataFetcher: () => Promise<T>): Promise<T> {
    const queryType = this.extractQueryType(key);
    const cached = await this.cache.get<T>(key, queryType);
    if (cached) {
      return cached;
    }

    const data = await dataFetcher();
    await this.cache.set(key, data, queryType);
    return data;
  }

  public async clearCache(pattern?: string): Promise<void> {
    await this.cache.clear(pattern);
  }

  private initialize(): void {
    if (!this.initialized) {
      this.initialized = true;
    }
  }

  private async getCacheFilePath(key: string): Promise<string> {
    const data = new TextEncoder().encode(key);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hash = Array.from(
      new Uint8Array(hashBuffer)
    ).map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 32);

    const queryType = this.extractQueryType(key);
    const subDir = queryType ? `${this.cacheDir}/${queryType}` : this.cacheDir;
    
    try {
      await Deno.mkdir(subDir, { recursive: true });
    } catch (error) {
      if (!(error instanceof Deno.errors.AlreadyExists)) {
        throw error;
      }
    }

    return `${subDir}/${hash}.json`;
  }

  private async getCachedData<T>(key: string): Promise<T | null> {
    if (!this.isDebugMode) {
      return null;
    }

    try {
      const cacheFile = await this.getCacheFilePath(key);
      const content = await Deno.readTextFile(cacheFile);
      const cached = JSON.parse(content);
      
      if (Date.now() - cached.timestamp < this.cacheDuration) {
        this.logger.debug(`Using cached data for ${this.extractQueryType(key)}_${key.slice(0, 50)}...`);
        return cached.data as T;
      }
    } catch {
      // Cache miss or expired
    }
    return null;
  }

  private async setCachedData<T>(key: string, data: T): Promise<void> {
    if (!this.isDebugMode) {
      return;
    }

    try {
      const cacheFile = await this.getCacheFilePath(key);
      await Deno.writeTextFile(cacheFile, JSON.stringify({
        timestamp: Date.now(),
        data
      }));
      this.logger.debug(`Cached data for ${this.extractQueryType(key)}_${key.slice(0, 50)}...`);
    } catch (error) {
      this.logger.error(`Failed to cache data for ${key}:`, error);
    }
  }

  /**
   * Get DORA metrics for linked Jira and GitLab projects
   */
  public async getDoraMetrics(
    jiraProjectKey: string,
    gitlabProjectPath: string,
    timeRange: TimeRange,
  ): Promise<ExtendedDoraMetricsResult> {
    try {
      this.logger.debug('Starting DORA metrics calculation');

      // Use cache key that includes all parameters
      const cacheKey = `dora_metrics_${jiraProjectKey}_${gitlabProjectPath}_${timeRange}`;
      const cached = await this.cache.get<ExtendedDoraMetricsResult>(cacheKey, 'metrics');
      if (cached) {
        this.logger.debug('Using cached DORA metrics');
        return cached;
      }

      // Get raw data from services (in parallel)
      const [jiraProject, gitlabProject, jiraMetrics, gitlabMetrics] = await Promise.all([
        this.jiraService.getProject(jiraProjectKey),
        this.gitlabService.getProjectDetails(gitlabProjectPath),
        this.jiraService.getProjectMetrics(jiraProjectKey),
        this.gitlabService.getProjectMetrics(gitlabProjectPath, timeRange, false)
      ]);

      // Calculate trends first since other metrics depend on it
      const trends = await this.calculateTrends(jiraProjectKey, gitlabProjectPath, timeRange);

      // Calculate metrics that don't depend on trends first (in parallel)
      const [leadTimeForChanges, changeFailureRate, timeToRestore] = await Promise.all([
        this.calculateLeadTimeForChanges(jiraMetrics, gitlabMetrics, trends),
        this.calculateChangeFailureRate(jiraMetrics, gitlabMetrics, trends),
        this.calculateTimeToRestore(jiraMetrics, timeRange)
      ]);

      // Now calculate deployment frequency using the trends data
      const deploymentFrequency = await this.calculateDeploymentFrequency(
        gitlabMetrics.codeQuality.environments?.nodes || [],
        gitlabProjectPath,
        trends
      );

      // Calculate custom metrics in parallel
      const [
        sprintCommitment,
        sprintSpillover,
        sprintVelocity,
        workTypeBreakdown,
        addedTickets,
        epicTracking
      ] = await Promise.all([
        this.calculateSprintCommitment(jiraMetrics),
        this.calculateSprintSpillover(jiraMetrics),
        this.calculateSprintVelocity(jiraMetrics),
        this.calculateWorkTypeBreakdown(jiraMetrics),
        this.calculateAddedTickets(jiraMetrics),
        this.calculateEpicTracking(jiraMetrics)
      ]);

      const result: ExtendedDoraMetricsResult = {
        jiraProject: {
          key: jiraProject.key,
          name: jiraProject.name,
          url: `${this.config.atlassian!.jira_url}/projects/${jiraProject.key}`,
        },
        gitlabProject: {
          path: gitlabProject.path_with_namespace,
          name: gitlabProject.name,
          url: gitlabProject.web_url,
        },
        metrics: {
          deploymentFrequency,
          leadTimeForChanges,
          changeFailureRate,
          timeToRestore,
        },
        customMetrics: {
          sprintCommitment: {
            doneVsCommitted: sprintCommitment.doneVsCommitted,
            committedTickets: sprintCommitment.committedTickets,
            completedTickets: sprintCommitment.completedTickets,
            trend: sprintCommitment.trend,
            rating: sprintCommitment.rating,
            averageTotalPerSprint: sprintCommitment.averageTotalPerSprint,
            perSprintValues: sprintCommitment.perSprintValues
          },
          sprintSpillover: {
            spilloverRate: sprintSpillover.spilloverRate,
            spilledTickets: sprintSpillover.spilledTickets,
            totalTickets: sprintSpillover.totalTickets,
            trend: sprintSpillover.trend,
            rating: sprintSpillover.rating
          },
          sprintVelocity: {
            cycleTime: sprintVelocity.cycleTime,
            throughput: sprintVelocity.throughput,
            cycleTimeTrend: sprintVelocity.cycleTimeTrend,
            cycleTimeDistribution: sprintVelocity.cycleTimeDistribution,
            throughputTrend: sprintVelocity.throughputTrend,
            bottlenecks: sprintVelocity.bottlenecks,
            rating: sprintVelocity.rating,
            perSprintValues: sprintVelocity.perSprintValues
          },
          workTypeBreakdown: {
            technical: workTypeBreakdown.technical,
            operational: workTypeBreakdown.operational,
            valueCreation: workTypeBreakdown.valueCreation,
            perSprintValues: workTypeBreakdown.perSprintValues,
            trend: workTypeBreakdown.trend
          },
          addedTickets: {
            percentage: addedTickets.percentage,
            addedCount: addedTickets.addedCount,
            totalCount: addedTickets.totalCount,
            byType: addedTickets.byType,
            byTypePercentage: addedTickets.byTypePercentage,
            trend: addedTickets.trend,
            rating: addedTickets.rating
          },
          epicTracking: {
            averageParallelEpics: epicTracking.averageParallelEpics,
            currentParallelEpics: epicTracking.currentParallelEpics,
            perSprintValues: epicTracking.perSprintValues,
            quarterlyAverage: epicTracking.quarterlyAverage,
            trend: epicTracking.trend,
            rating: epicTracking.rating
          }
        },
        trends: {
          deploymentFrequencyTrend: trends.deploymentFrequencyTrend,
          leadTimeTrend: trends.leadTimeTrend,
          changeFailureRateTrend: trends.changeFailureRateTrend,
          timeToRestoreTrend: trends.timeToRestoreTrend,
          compareWithPrevious: trends.compareWithPrevious
        },
        timestamp: new Date()
      };

      // Cache the result
      await this.cache.set(cacheKey, result, 'metrics');
      this.logger.debug('DORA metrics calculation completed');
      return result;
    } catch (error) {
      this.logger.error('Error getting DORA metrics:', error);
      throw new Error(
        `Failed to get DORA metrics: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  /**
   * Calculate lead time for changes
   */
  private calculateLeadTimeForChanges(
    jiraMetrics: JiraProjectMetrics,
    gitlabMetrics: GitLabProjectMetrics,
    trends: DoraTrends
  ): DoraMetrics['leadTimeForChanges'] {
    try {
      // Get sprint data and filter out future sprints
      const sprintHistory = jiraMetrics.sprintHistory?.filter(sprint => 
        sprint.state !== 'future' && 
        new Date(sprint.endDate) <= new Date()
      ) || [];

      // Calculate average cycle time from completed sprints
      const sprintCycleTimes = sprintHistory.map(sprint => {
        const startDate = new Date(sprint.startDate);
        const endDate = new Date(sprint.endDate);
        const daysInSprint = Math.round((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
        
        // Calculate completion rate and velocity
        const completionRate = sprint.completionRate || 0;
        const velocity = sprint.completedPoints / Math.max(1, daysInSprint);
        
        this.logger.debug(`Sprint "${sprint.name}" metrics:`, {
          dates: `${startDate.toLocaleDateString()} → ${endDate.toLocaleDateString()}`,
          daysInSprint,
          completionRate: `${(completionRate * 100).toFixed(1)}%`,
          velocity: `${velocity.toFixed(1)} points/day`
        });

        return {
          name: sprint.name,
          cycleTime: daysInSprint * 24, // Convert to hours
          completionRate,
          velocity
        };
      });

      // Calculate average and median cycle times
      const cycleTimes = sprintCycleTimes.map(s => s.cycleTime);
      const averageInHours = cycleTimes.length > 0 
        ? cycleTimes.reduce((a, b) => a + b, 0) / cycleTimes.length 
        : gitlabMetrics.teamMetrics.averageTimeToMerge || 0;

      const sortedCycleTimes = [...cycleTimes].sort((a, b) => a - b);
      const medianInHours = sortedCycleTimes.length > 0
        ? sortedCycleTimes[Math.floor(sortedCycleTimes.length / 2)]
        : averageInHours;

      // Add MR review time from GitLab
      const mrReviewTime = gitlabMetrics.teamMetrics.averageTimeToMerge || 0;
      const totalLeadTime = averageInHours + mrReviewTime;

      // Update trend with the new value
      trends.leadTimeTrend.push(totalLeadTime);

      // Calculate rating
      const rating = this.getRating('leadTime', totalLeadTime);

      // Log detailed metrics for debugging
      this.logger.debug('Lead Time Metrics:', {
        sprintHistory: sprintCycleTimes.map(s => ({
          name: s.name,
          cycleTime: `${(s.cycleTime / 24).toFixed(1)} days`,
          completionRate: `${(s.completionRate * 100).toFixed(1)}%`,
          velocity: `${s.velocity.toFixed(1)} points/day`
        })),
        averageCycleTime: `${(averageInHours / 24).toFixed(1)} days`,
        medianCycleTime: `${(medianInHours / 24).toFixed(1)} days`,
        mrReviewTime: `${(mrReviewTime / 24).toFixed(1)} days`,
        totalLeadTime: `${(totalLeadTime / 24).toFixed(1)} days`,
        rating
      });

      return {
        averageInHours: totalLeadTime,
        medianInHours: medianInHours + mrReviewTime,
        rating
      };
    } catch (error) {
      this.logger.error('Error calculating lead time:', error);
      return {
        averageInHours: 0,
        medianInHours: 0,
        rating: 'low'
      };
    }
  }

  /**
   * Calculate change failure rate using incidents
   */
  private calculateChangeFailureRate(
    jiraMetrics: JiraProjectMetrics,
    gitlabMetrics: GitLabProjectMetrics,
    trends: DoraTrends
  ): DoraMetrics['changeFailureRate'] {
    try {
      const deployments = gitlabMetrics.deploymentCount;
      const failures = jiraMetrics.bugCount; // Assuming bugs are failures for now
      const rate = deployments > 0 ? (failures / deployments) * 100 : 0;

      return {
        value: parseFloat(rate.toFixed(2)),
        rating: rate <= 15 ? 'high' : rate <= 30 ? 'medium' : 'low',
        trend: trends.changeFailureRate,
      };
    } catch (error) {
      this.logger.error('Error calculating change failure rate:', error);
      return {
        value: 0,
        rating: 'low',
        trend: 'neutral',
      };
    }
  }

  /**
   * Calculate time to restore service
   */
  private async calculateTimeToRestore(
    _jiraMetrics: JiraProjectMetrics,
    timeRange: TimeRange
  ): Promise<DoraMetrics['timeToRestore']> {
    // This is a placeholder. Implementation requires incident data.
    this.logger.warn('Time to restore calculation is a placeholder and not yet implemented.');
    return {
      averageInHours: 0,
      medianInHours: 0,
      rating: 'low',
      trend: 'neutral',
    };
  }

  /**
   * Calculate trends for DORA metrics
   */
  private async calculateTrends(
    jiraProjectKey: string,
    gitlabProjectPath: string,
    timeRange: TimeRange,
  ): Promise<DoraTrends> {
    const cacheKey = `trends_${jiraProjectKey}_${gitlabProjectPath}_${timeRange}`;
    const cached = await this.cache.get<DoraTrends>(cacheKey, 'trends');
    if (cached) {
      this.logger.debug('Using cached trends data');
      return cached;
    }

    const periods = 5;
    const periodLength = parseInt(timeRange.replace('d', '')) / periods;
    
    this.logger.debug('Calculating trends:', {
      timeRange,
      periods,
      periodLength
    });

    // Pre-fetch all required data once
    const [gitlabMetrics, jiraMetrics, incidents] = await Promise.all([
      this.gitlabService.getProjectMetrics(gitlabProjectPath, '30d', false),
      this.jiraService.getProjectMetrics(jiraProjectKey),
      // this.gitlabService.getIssues(),
    ]);

    // Calculate all periods in parallel
    const periodMetrics = await Promise.all(
      Array.from({ length: periods }).map((_, i) => {
        const endDate = new Date();
        if (i === 0) {
          endDate.setHours(23, 59, 59, 999);
        } else {
          endDate.setDate(endDate.getDate() - (i * periodLength));
        }
        const startDate = new Date(endDate);
        startDate.setDate(startDate.getDate() - periodLength);

        this.logger.debug(`Calculating metrics for period ${i + 1}:`, {
          startDate: startDate.toISOString(),
          endDate: endDate.toISOString()
        });

        // Calculate metrics for this period using the pre-fetched data
        const periodDeployments = gitlabMetrics.codeQuality.environments.nodes
          .reduce((total, env) => {
            if (env.lastDeployment && 
                env.lastDeployment.status === 'SUCCESS' &&
                new Date(env.lastDeployment.createdAt) >= startDate && 
                new Date(env.lastDeployment.createdAt) <= endDate) {
              return total + 1;
            }
            return total;
          }, 0);

        const daysInPeriod = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
        const deploymentsPerDay = periodDeployments / Math.max(1, daysInPeriod);

        const jiraCycleTime = jiraMetrics.sprints?.avgCycleTime?.mean || 0;
        const mrReviewTime = gitlabMetrics.teamMetrics.averageTimeToMerge || 0;
        const leadTimeHours = (jiraCycleTime * 24) + mrReviewTime;

        let timeToRestore = 0;
        let failureRate = 0;

        // Calculate incident metrics using pre-fetched data
        if (incidents.length > 0) {
          const periodIncidents = incidents.filter(incident => {
            const createdAt = new Date(incident.createdAt);
            return createdAt >= startDate && createdAt <= endDate;
          });

          const resolutionTimes = periodIncidents
            .map(incident => {
              if (incident.status === 'closed' && incident.createdAt) {
                const createdTime = new Date(incident.createdAt).getTime();
                const resolvedTime = new Date(incident.updatedAt).getTime();
                return (resolvedTime - createdTime) / (1000 * 60 * 60);
              }
              return null;
            })
            .filter((time): time is number => time !== null);

          timeToRestore = resolutionTimes.length > 0
            ? resolutionTimes.reduce((sum, time) => sum + time, 0) / resolutionTimes.length
            : 0;

          const deploymentIncidents = periodIncidents.filter(incident =>
            incident.tags.some(tag => 
              tag.toLowerCase().includes('deployment') || 
              tag.toLowerCase().includes('release')
            )
          );

          failureRate = periodDeployments > 0 
            ? (deploymentIncidents.length / periodDeployments) * 100 
            : 0;
        } else {
          // Fallback to pipeline metrics if no data
          const failedDeployments = gitlabMetrics.pipelines?.nodes
            ?.filter(p => {
              const deployDate = new Date(p.createdAt);
              return deployDate >= startDate && deployDate <= endDate && p.status === 'FAILED';
            })
            ?.length || 0;
          failureRate = periodDeployments > 0 
            ? (failedDeployments / periodDeployments) * 100 
            : 0;
        }

        return {
          deploymentFrequency: deploymentsPerDay,
          leadTime: leadTimeHours,
          changeFailureRate: failureRate,
          timeToRestore
        };
      })
    );

    // Extract trend data (reverse to show oldest to newest)
    const deploymentFrequencyTrend = periodMetrics.map(m => m.deploymentFrequency).reverse();
    const leadTimeTrend = periodMetrics.map(m => m.leadTime).reverse();
    const changeFailureRateTrend = periodMetrics.map(m => m.changeFailureRate).reverse();
    const timeToRestoreTrend = periodMetrics.map(m => m.timeToRestore).reverse();

    // Calculate percentage changes
    const calcPercentChange = (current: number, previous: number): number => {
      if (previous === 0) return current > 0 ? 100 : 0;
      return ((current - previous) / previous) * 100;
    };

    const result = {
      deploymentFrequencyTrend,
      leadTimeTrend,
      changeFailureRateTrend,
      timeToRestoreTrend,
      compareWithPrevious: {
        deploymentFrequency: calcPercentChange(
          deploymentFrequencyTrend[deploymentFrequencyTrend.length - 1],
          deploymentFrequencyTrend[deploymentFrequencyTrend.length - 2],
        ),
        leadTime: calcPercentChange(
          leadTimeTrend[leadTimeTrend.length - 1],
          leadTimeTrend[leadTimeTrend.length - 2],
        ),
        changeFailureRate: calcPercentChange(
          changeFailureRateTrend[changeFailureRateTrend.length - 1],
          changeFailureRateTrend[changeFailureRateTrend.length - 2],
        ),
        timeToRestore: calcPercentChange(
          timeToRestoreTrend[timeToRestoreTrend.length - 1],
          timeToRestoreTrend[timeToRestoreTrend.length - 2],
        ),
      },
    };

    // Cache the trends
    await this.cache.set(cacheKey, result, 'trends');
    this.logger.debug('Trend calculation completed');
    return result;
  }

  /**
   * Format DORA metrics for display
   */
  public async formatDoraMetrics(result: ExtendedDoraMetricsResult): Promise<string> {
    try {
      // Format standard DORA metrics
      const standardMetricsDisplay = this.formatStandardMetrics(result);
      // Format custom metrics
      const customMetricsDisplay = this.formatCustomMetrics(result.customMetrics);

      // Get sprint data and format sprint metrics
      const sprintData = await this.jiraService.getLastNSprintsData(6, result.jiraProject.key, 1);
      const sprintMetricsDisplay = await this.formatSprintMetrics(sprintData);

      // Format trend analysis
      const trendAnalysisDisplay = this.formatTrendAnalysis(result.trends);

      // Return the combined display
      return `${standardMetricsDisplay}\n\n${trendAnalysisDisplay}\n\n${customMetricsDisplay}\n\n${sprintMetricsDisplay}`;
    } catch (error) {
      this.logger.error('Error formatting DORA metrics:', error);
      throw new Error(
        `Failed to format DORA metrics: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`,
      );
    }
  }

  /**
   * Format standard DORA metrics
   */
  private formatStandardMetrics(result: ExtendedDoraMetricsResult): string {
    const { metrics, trends } = result;
    // const hasGitLabOrGitHub = this.gitLabService.isConfigured() || this.gitHubService.isConfigured();

    // Header section
    const headerTable = new Table()
      .border(true)
      .padding(1);
    
    // Add title as a header row instead of using .title()
    headerTable.push([`📊 DORA Metrics Dashboard: ${result.jiraProject.key} + ${result.gitlabProject.name}`]);
    
    headerTable.push(['📎 Jira Project', `${result.jiraProject.name} (${result.jiraProject.key})`]);
    headerTable.push(['🦊 GitLab Project', `${result.gitlabProject.name} (${result.gitlabProject.path})`]);
    headerTable.push(['📆 Generated', result.timestamp.toISOString()]);
    
    // if (!gitLabOrGitHub) {
    //   headerTable.push(['⚠️ Warning', colors.yellow('Not configured - some incident metrics may be limited')]);
    // }

    // Calculate time range for display
    const timeRangeDisplay = (() => {
      const weeks = Math.floor(trends.deploymentFrequencyTrend.length);
      return weeks === 1 ? 'Last week' : `Last ${weeks} weeks`;
    })();

    // Format deployment metrics
    const deploymentMetrics = metrics.deploymentFrequency;
    const deploymentsPerDay = deploymentMetrics?.deploymentsPerDay || 0;
    const totalDeployments = deploymentMetrics?.deploymentsTotal || 0;
    const deploymentRating = deploymentMetrics?.rating || 'low';

    // Calculate percentage change for display
    const percentageChange = trends.compareWithPrevious.deploymentFrequency;
    const changeDisplay = Math.abs(percentageChange) < 0.1 
      ? 'No significant change'
      : `${Math.abs(percentageChange).toFixed(1)}% ${percentageChange > 0 ? '↑' : '↓'} vs previous week`;

    // Deployment section
    const deploymentTable = new Table()
      .border(true)
      .padding(1)
      .header(['Metric', 'Value']);
    
    // Add title as a header row instead of using .title()
    deploymentTable.push([`${theme.symbols.deploy} Deployment Frequency (${timeRangeDisplay})`, '']);
    
    deploymentTable.push(['📊 Sources', 'GitLab Pipelines']);
    deploymentTable.push(['Deployments per day', deploymentsPerDay.toFixed(2)]);
    deploymentTable.push(['Total deployments', totalDeployments.toString()]);
    deploymentTable.push(['Success rate', `${((deploymentMetrics?.deploymentsTotal || 0) / (deploymentMetrics?.deploymentsTotal || 1) * 100).toFixed(1)}%`]);
    deploymentTable.push(['Performance level', formatServiceStatus(deploymentRating)]);
    
    // Trend visualization
    const trendData = [
      formatTrendChart(
        trends.deploymentFrequencyTrend.map(value => 
          // Scale the values to be between 0 and 4 for better visualization
          Math.min(4, Math.max(0, value / Math.max(...trends.deploymentFrequencyTrend) * 4))
        ),
        5,
        false,
        ['4w', '3w', '2w', '1w', 'Now']
      ),
      `Min: ${deploymentMetrics?.trendStats?.min.toFixed(1) || '0.0'}/day`,
      `Max: ${deploymentMetrics?.trendStats?.max.toFixed(1) || '0.0'}/day`,
      `Avg: ${deploymentMetrics?.trendStats?.avg.toFixed(1) || '0.0'}/day`
    ].join('\n');
    
    deploymentTable.push(['Trend (deploys/day)', trendData]);
    deploymentTable.push(['Change vs Previous', changeDisplay]);
    deploymentTable.push(['\nEnvironment Breakdown', '']);
    
    // Environment breakdowns
    deploymentTable.push(['Production', deploymentMetrics?.environmentBreakdown?.production.environments.length > 0 
      ? this.formatProductionEnvironments(deploymentMetrics.environmentBreakdown.production)
      : 'No deployments']);
    
    deploymentTable.push(['Staging', deploymentMetrics?.environmentBreakdown?.staging.environments.length > 0
      ? this.formatStagingEnvironments(deploymentMetrics.environmentBreakdown.staging)
      : 'No deployments']);
    
    deploymentTable.push(['Development', deploymentMetrics?.environmentBreakdown?.development.environments.length > 0
      ? this.formatDevelopmentEnvironments(deploymentMetrics.environmentBreakdown.development)
      : 'No deployments']);

    // Calculate lead time metrics
    const leadTimeMetrics = metrics.leadTimeForChanges;
    const avgLeadTime = leadTimeMetrics?.averageInHours || 0;
    const medianLeadTime = leadTimeMetrics?.medianInHours || 0;
    const leadTimeRating = leadTimeMetrics?.rating || 'low';

    // Lead time section
    const leadTimeTable = new Table()
      .border(true)
      .padding(1)
      .header(['Metric', 'Value']);
    
    // Add title as a header row
    leadTimeTable.push([`${theme.symbols.time} Lead Time for Changes (${timeRangeDisplay})`, '']);
    
    leadTimeTable.push(['📊 Sources', `Jira ${colors.dim('(Development)')} + GitLab ${colors.dim('(Review & Deploy)')}`]);
    leadTimeTable.push(['Average lead time', this.formatDurationForDisplay(avgLeadTime)]);
    leadTimeTable.push(['Median lead time', this.formatDurationForDisplay(medianLeadTime)]);
    leadTimeTable.push(['Performance level', formatServiceStatus(leadTimeRating)]);
    leadTimeTable.push(['Breakdown', this.formatLeadTimeBreakdown(avgLeadTime)]);
    leadTimeTable.push(['Trend', formatTrendChart(trends.leadTimeTrend, 5, true, ['4w', '3w', '2w', '1w', 'Now'])]);
    leadTimeTable.push(['Change vs Previous', formatTrendValue(-trends.compareWithPrevious.leadTime, false)]);

    // Calculate change failure metrics
    const failureMetrics = metrics.changeFailureRate;
    const failureRate = failureMetrics?.percentage || 0;
    const failedCount = failureMetrics?.failedDeployments || 0;
    const totalCount = failureMetrics?.totalDeployments || 0;
    const failureRating = failureMetrics?.rating || 'low';

    // Format failure breakdown
    const formatFailureBreakdown = () => {
      if (totalCount === 0) return 'No deployments in period';
      
      const pipelineFailures = Math.floor(failedCount * 0.7); // Approximate pipeline failures
      const incidentFailures = failedCount - pipelineFailures; // Remaining are incident-related
      
      return [
        `Pipeline Failures: ${pipelineFailures}`,
        `Incident-related: ${incidentFailures}`,
        `Success Rate: ${((totalCount - failedCount) / totalCount * 100).toFixed(1)}%`
      ].join('\n');
    };

    // Change failure rate section
    const failureRateTable = new Table()
      .border(true)
      .padding(1)
      .header(['Metric', 'Value']);
    
    // Add title as a header row
    failureRateTable.push([`${theme.symbols.error} Change Failure Rate (${timeRangeDisplay})`, '']);
    
    // failureRateTable.push(['📊 Sources', `${hasGitLab ? 'GitLab/GitHub Incidents + ' : ''}GitLab Pipeline Failures`]);
    failureRateTable.push(['Failure rate', `${failureRate.toFixed(1)}%`]);
    failureRateTable.push(['Failed/Total', `${failedCount}/${totalCount}`]);
    failureRateTable.push(['Performance level', formatServiceStatus(failureRating)]);
    failureRateTable.push(['Breakdown', formatFailureBreakdown()]);
    failureRateTable.push(['Trend', formatTrendChart(trends.changeFailureRateTrend, 5, true, ['4w', '3w', '2w', '1w', 'Now'])]);
    failureRateTable.push(['Change vs Previous', formatTrendValue(-trends.compareWithPrevious.changeFailureRate, false)]);

    // Calculate time to restore metrics
    const restoreMetrics = metrics.timeToRestore;
    const avgRestoreTime = restoreMetrics?.averageInHours || 0;
    const medianRestoreTime = restoreMetrics?.medianInHours || 0;
    const incidentCount = restoreMetrics?.incidents || 0;
    const restoreRating = restoreMetrics?.rating || 'low';

    // Format incident breakdown
    const formatIncidentBreakdown = () => {
      if (incidentCount === 0) return 'No incidents in period';
      
      // Approximate severity distribution
      const critical = Math.floor(incidentCount * 0.1);
      const high = Math.floor(incidentCount * 0.3);
      const medium = Math.floor(incidentCount * 0.4);
      const low = incidentCount - critical - high - medium;
      
      return [
        `Critical: ${critical} (avg: ${this.formatDurationForDisplay(avgRestoreTime * 0.5)})`,
        `High: ${high} (avg: ${this.formatDurationForDisplay(avgRestoreTime * 0.8)})`,
        `Medium: ${medium} (avg: ${this.formatDurationForDisplay(avgRestoreTime * 1.2)})`,
        `Low: ${low} (avg: ${this.formatDurationForDisplay(avgRestoreTime * 1.5)})`
      ].join('\n');
    };

    // Time to restore section
    const restoreTable = new Table()
      .border(true)
      .padding(1)
      .header(['Metric', 'Value']);
    
    // Add title as a header row
    restoreTable.push([`${theme.symbols.metrics} Time to Restore Service (${timeRangeDisplay})`, '']);
    
    // restoreTable.push(['📊 Sources', `${hasGitLab ? 'GitLab Incidents' : 'GitLab Pipeline Recovery'}`]);
    restoreTable.push(['Average restore time', this.formatDurationForDisplay(avgRestoreTime)]);
    restoreTable.push(['Median restore time', this.formatDurationForDisplay(medianRestoreTime)]);
    restoreTable.push(['Total incidents', incidentCount.toString()]);
    restoreTable.push(['Performance level', formatServiceStatus(restoreRating)]);
    restoreTable.push(['Breakdown', formatIncidentBreakdown()]);
    restoreTable.push(['Trend', formatTrendChart(trends.timeToRestoreTrend, 5, true, ['4w', '3w', '2w', '1w', 'Now'])]);
    restoreTable.push(['Change vs Previous', formatTrendValue(-trends.compareWithPrevious.timeToRestore, false)]);

    return [
      headerTable.toString(),
      '',
      deploymentTable.toString(),
      '',
      leadTimeTable.toString(),
      '',
      failureRateTable.toString(),
      '',
      restoreTable.toString()
    ].join('\n');
  }

  private formatStatusBreakdown(breakdown: Record<string, number>): string {
    return Object.entries(breakdown)
      .map(([status, count]) => `${status}: ${count}`)
      .join(', ');
  }

  /**
   * Calculate overall rating based on individual metrics
   */
  private calculateOverallRating(metrics: DoraMetrics): string {
    const ratings = {
      'elite': 4,
      'high': 3,
      'medium': 2,
      'low': 1,
    };

    const scoreMap = {
      4: colors.green('Elite'),
      3: colors.blue('High'),
      2: colors.yellow('Medium'),
      1: colors.red('Low'),
    };

    const scores = [
      ratings[metrics.deploymentFrequency.rating],
      ratings[metrics.leadTimeForChanges.rating],
      ratings[metrics.changeFailureRate.rating],
      ratings[metrics.timeToRestore.rating],
    ];

    const avgScore = scores.reduce((a, b) => a + b, 0) / scores.length;
    const roundedScore = Math.round(avgScore) as 1 | 2 | 3 | 4;

    return scoreMap[roundedScore];
  }

  /**
   * Determine the strongest DORA metric
   */
  private determineStrongestMetric(metrics: DoraMetrics): string {
    const ratings = {
      'elite': 4,
      'high': 3,
      'medium': 2,
      'low': 1,
    };

    const metricScores = [
      { name: 'Deployment Frequency', score: ratings[metrics.deploymentFrequency.rating] },
      { name: 'Lead Time for Changes', score: ratings[metrics.leadTimeForChanges.rating] },
      { name: 'Change Failure Rate', score: ratings[metrics.changeFailureRate.rating] },
      { name: 'Time to Restore Service', score: ratings[metrics.timeToRestore.rating] },
    ];

    metricScores.sort((a, b) => b.score - a.score);

    return metricScores[0].name;
  }

  /**
   * Determine the weakest DORA metric
   */
  private determineWeakestMetric(metrics: DoraMetrics): string {
    const ratings = {
      'elite': 4,
      'high': 3,
      'medium': 2,
      'low': 1,
    };

    const metricScores = [
      { name: 'Deployment Frequency', score: ratings[metrics.deploymentFrequency.rating] },
      { name: 'Lead Time for Changes', score: ratings[metrics.leadTimeForChanges.rating] },
      { name: 'Change Failure Rate', score: ratings[metrics.changeFailureRate.rating] },
      { name: 'Time to Restore Service', score: ratings[metrics.timeToRestore.rating] },
    ];

    metricScores.sort((a, b) => a.score - b.score);

    return metricScores[0].name;
  }

  /**
   * Calculate sprint commitment metrics
   */
  private async calculateSprintCommitment(
    jiraMetrics: JiraProjectMetrics,
  ): Promise<CustomTeamMetrics['sprintCommitment']> {
    try {
      // Get last 6 sprints data
      const { sprintData } = await this.jiraService.getLastNSprintsData(6, jiraMetrics.project.key, 1);

      // Handle case where no sprint data is available
      if (!sprintData || sprintData.length === 0) {
        return {
          doneVsCommitted: 0,
          committedTickets: 0,
          completedTickets: 0,
          trend: [],
          rating: 'poor' as const
        };
      }

      // Calculate current sprint metrics
      const currentSprint = sprintData[0];
      if (!currentSprint || !currentSprint.committedIssues || !currentSprint.completedIssues) {
        this.logger.error('Invalid sprint data structure:', currentSprint);
        return {
          doneVsCommitted: 0,
          committedTickets: 0,
          completedTickets: 0,
          trend: [],
          rating: 'poor' as const
        };
      }

      const committedTickets = currentSprint.committedIssues.length;
      const completedTickets = currentSprint.completedIssues.length;
      const doneVsCommitted = committedTickets > 0 ? (completedTickets / committedTickets) * 100 : 0;

      // Calculate trend over last 6 sprints
      const trend = sprintData.map((sprint) => {
        if (!sprint.committedIssues || !sprint.completedIssues) return 0;
        const committed = sprint.committedIssues.length;
        return committed > 0 ? (sprint.completedIssues.length / committed) * 100 : 0;
      });

      // Determine rating
      let rating: 'excellent' | 'good' | 'needs-improvement' | 'poor';
      if (doneVsCommitted >= 90) {
        rating = 'excellent';
      } else if (doneVsCommitted >= 80) {
        rating = 'good';
      } else if (doneVsCommitted >= 70) {
        rating = 'needs-improvement';
      } else {
        rating = 'poor';
      }

      return {
        doneVsCommitted,
        committedTickets,
        completedTickets,
        trend,
        rating,
      };
    } catch (error) {
      this.logger.error('Error calculating sprint commitment:', error);
      return {
        doneVsCommitted: 0,
        committedTickets: 0,
        completedTickets: 0,
        trend: [],
        rating: 'poor' as const
      };
    }
  }

  /**
   * Calculate sprint spillover metrics
   */
  private async calculateSprintSpillover(
    jiraMetrics: JiraProjectMetrics,
  ): Promise<CustomTeamMetrics['sprintSpillover']> {
    try {
      // Get last 6 sprints data
      const { sprintData } = await this.jiraService.getLastNSprintsData(6, jiraMetrics.project.key, 1);

      // Handle case where no sprint data is available
      if (!sprintData || sprintData.length === 0) {
        return {
          spilloverRate: 0,
          spilledTickets: 0,
          totalTickets: 0,
          trend: [],
          rating: 'poor' as const
        };
      }

      // Calculate current sprint metrics
      const currentSprint = sprintData[0];
      if (!currentSprint || !currentSprint.spiltOverIssues || !currentSprint.totalIssues) {
        this.logger.error('Invalid sprint data structure:', currentSprint);
        return {
          spilloverRate: 0,
          spilledTickets: 0,
          totalTickets: 0,
          trend: [],
          rating: 'poor' as const
        };
      }

      const spilledTickets = currentSprint.spiltOverIssues.length;
      const totalTickets = currentSprint.totalIssues.length;
      const spilloverRate = totalTickets > 0 ? (spilledTickets / totalTickets) * 100 : 0;

      // Calculate trend over last 6 sprints
      const trend = sprintData.map((sprint) => {
        if (!sprint.spiltOverIssues || !sprint.totalIssues) return 0;
        const total = sprint.totalIssues.length;
        return total > 0 ? (sprint.spiltOverIssues.length / total) * 100 : 0;
      });

      // Determine rating
      let rating: 'excellent' | 'good' | 'needs-improvement' | 'poor';
      if (spilloverRate <= 10) {
        rating = 'excellent';
      } else if (spilloverRate <= 20) {
        rating = 'good';
      } else if (spilloverRate <= 30) {
        rating = 'needs-improvement';
      } else {
        rating = 'poor';
      }

      return {
        spilloverRate,
        spilledTickets,
        totalTickets,
        trend,
        rating,
      };
    } catch (error) {
      this.logger.error('Error calculating sprint spillover:', error);
      return {
        spilloverRate: 0,
        spilledTickets: 0,
        totalTickets: 0,
        trend: [],
        rating: 'poor' as const
      };
    }
  }

  /**
   * Identify bottlenecks in the workflow
   */
  private identifyBottlenecks(
    stageTransitions:
      | { transitions: StageTransition[]; statusAnalytics: StatusAnalytics[] }
      | undefined,
  ): {
    bottlenecks: { status: string; avgDuration: number; issueCount: number }[];
    blockedIssues: { status: string; key: string; duration: number }[];
  } {
    const THRESHOLD_HOURS = 24 * 7; // Consider a stage a bottleneck if average time > 7 days
    const BLOCKED_THRESHOLD = 24 * 30; // Flag issues blocked > 30 days

    // If stageTransitions is undefined or missing statusAnalytics, calculate them from transitions
    if (!stageTransitions?.statusAnalytics && stageTransitions?.transitions) {
      // Group transitions by status
      const statusMap = new Map<
        string,
        { totalDuration: number; maxDuration: number; maxIssue: string; count: number }
      >();

      stageTransitions.transitions.forEach((transition) => {
        const status = transition.fromStatus;
        const current = statusMap.get(status) ||
          { totalDuration: 0, maxDuration: 0, maxIssue: '', count: 0 };

        current.totalDuration += transition.timeSpentHours;
        current.count++;

        if (transition.timeSpentHours > current.maxDuration) {
          current.maxDuration = transition.timeSpentHours;
          current.maxIssue = transition.issueKey;
        }

        statusMap.set(status, current);
      });

      // Convert map to StatusAnalytics array
      const statusAnalytics: StatusAnalytics[] = Array.from(statusMap.entries()).map((
        [status, data],
      ) => ({
        status,
        avgDuration: data.totalDuration / data.count,
        maxDuration: data.maxDuration,
        maxIssue: data.maxIssue,
        issueCount: data.count,
      }));

      stageTransitions = { ...stageTransitions, statusAnalytics };
    }

    // If still no analytics available, return empty arrays
    if (!stageTransitions?.statusAnalytics) {
      logger.debug('No status analytics available for bottleneck analysis');
      return { bottlenecks: [], blockedIssues: [] };
    }

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

    logger.debug('Bottleneck Analysis:', {
      bottlenecks: bottlenecks.map((b) =>
        `${b.status}: ${b.avgDuration.toFixed(1)} hours (${b.issueCount} issues)`
      ),
      blockedIssues: blockedIssues.map((i) =>
        `${i.key} in ${i.status} for ${i.duration.toFixed(1)} hours`
      ),
    });

    return { bottlenecks, blockedIssues };
  }

  /**
   * Calculate sprint velocity metrics (cycle time and throughput)
   */
  private async calculateSprintVelocity(
    jiraMetrics: JiraProjectMetrics,
  ): Promise<CustomTeamMetrics['sprintVelocity']> {
    try {
      // Get last 6 sprints data
      const { sprintData } = await this.jiraService.getLastNSprintsData(6, jiraMetrics.project.key, 1);

      // Handle case where no sprint data is available
      if (!sprintData || sprintData.length === 0) {
        return {
          cycleTime: 0,
          throughput: 0,
          cycleTimeTrend: [],
          cycleTimeDistribution: [0, 0, 0, 0],
          throughputTrend: [],
          bottlenecks: [],
          rating: 'poor' as const
        };
      }

      // Calculate current sprint metrics
      const currentSprint = sprintData[0];
      if (!currentSprint || !currentSprint.averageCycleTime || !currentSprint.completedIssues) {
        this.logger.error('Invalid sprint data structure:', currentSprint);
        return {
          cycleTime: 0,
          throughput: 0,
          cycleTimeTrend: [],
          cycleTimeDistribution: [0, 0, 0, 0],
          throughputTrend: [],
          bottlenecks: [],
          rating: 'poor' as const
        };
      }

      const cycleTime = currentSprint.averageCycleTime.mean;
      
      // Store both cycle time distribution and trend
      const cycleTimeDistribution = [
        currentSprint.averageCycleTime.median || 0,
        currentSprint.averageCycleTime.distribution.p25 || 0,
        currentSprint.averageCycleTime.distribution.p75 || 0,
        currentSprint.averageCycleTime.distribution.p90 || 0,
      ];
      
      // Convert cycle time to days for trend visualization
      const cycleTimeTrend = sprintData.map((sprint) => 
        sprint.averageCycleTime?.mean || 0
      );

      const throughput = currentSprint.completedIssues.length;
      const throughputTrend = sprintData.map((sprint) => 
        sprint.completedIssues?.length || 0
      );

      // Identify bottlenecks
      const { bottlenecks } = this.identifyBottlenecks(currentSprint.stageTransitions || { transitions: [], statusAnalytics: [] });

      // Determine rating based on cycle time and throughput correlation
      let rating: 'excellent' | 'good' | 'needs-improvement' | 'poor';
      const previousSprint = sprintData[1];
      const previousCycleTime = previousSprint?.averageCycleTime?.mean || cycleTime;
      const previousThroughput = previousSprint?.completedIssues?.length || throughput;

      if (throughput >= previousThroughput && cycleTime <= previousCycleTime * 1.1) {
        rating = 'excellent';
      } else if (throughput >= previousThroughput * 0.9 && cycleTime <= previousCycleTime * 1.2) {
        rating = 'good';
      } else if (throughput < previousThroughput || cycleTime > previousCycleTime * 1.2) {
        rating = 'needs-improvement';
      } else {
        rating = 'poor';
      }

      return {
        cycleTime,
        throughput,
        cycleTimeTrend,
        cycleTimeDistribution,
        throughputTrend,
        bottlenecks: bottlenecks.map(b => b.status),
        rating,
      };
    } catch (error) {
      this.logger.error('Error calculating sprint velocity:', error);
      return {
        cycleTime: 0,
        throughput: 0,
        cycleTimeTrend: [],
        cycleTimeDistribution: [0, 0, 0, 0],
        throughputTrend: [],
        bottlenecks: [],
        rating: 'poor' as const
      };
    }
  }

  /**
   * Calculate work type breakdown (technical/operational/value creation)
   */
  private async calculateWorkTypeBreakdown(
    jiraMetrics: JiraProjectMetrics,
  ): Promise<CustomTeamMetrics['workTypeBreakdown']> {
    try {
      const { sprintData } = await this.jiraService.getLastNSprintsData(6, jiraMetrics.project.key, 1);

      if (!sprintData || !Array.isArray(sprintData) || sprintData.length === 0) {
        this.logger.warn('No sprint data available for work type breakdown');
        return {
          technical: 0,
          operational: 0,
          valueCreation: 0,
          perSprintValues: [],
          trend: {
            technical: [],
            operational: [],
            valueCreation: []
          }
        };
      }

      const categorizeIssue = (issue: JiraIssue) => {
        const technicalLabels = ['technical-debt', 'refactoring', 'infrastructure', 'tech-improvement'];
        const operationalLabels = ['bug', 'incident', 'maintenance', 'operations'];
        
        const labels = issue.fields.labels || [];
        const issueType = issue.fields.issuetype?.name || 'Unknown';
        
        this.logger.debug(`Categorizing issue ${issue.key} with type ${issueType} and labels ${labels.join(', ')}`);
        
        if (labels.some(label => technicalLabels.includes(label.toLowerCase()))) {
          return 'technical';
        }
        
        if (labels.some(label => operationalLabels.includes(label.toLowerCase()))) {
          return 'operational';
        }
        
        if (['Bug', 'Incident', 'Problem'].includes(issueType)) {
          return 'operational';
        }
        if (['Technical Task', 'Refactoring'].includes(issueType)) {
          return 'technical';
        }

        return 'valueCreation';
      };

      // Calculate per-sprint breakdown
      const perSprintValues = sprintData.map(sprint => {
        const issues = sprint.completedIssues || [];
        const categorizedIssues = {
          technical: 0,
          operational: 0,
          valueCreation: 0,
          total: issues.length
        };

        issues.forEach(issue => {
          const category = categorizeIssue(issue);
          categorizedIssues[category as keyof Pick<typeof categorizedIssues, 'technical' | 'operational' | 'valueCreation'>]++;
        });

        return {
          sprint: sprint.name,
          technical: categorizedIssues.technical,
          operational: categorizedIssues.operational,
          valueCreation: categorizedIssues.valueCreation,
          total: categorizedIssues.total
        };
      });
      
      // Calculate overall percentages from the most recent sprint
      const currentSprint = perSprintValues[0];
      const technical = currentSprint.total > 0 ? (currentSprint.technical / currentSprint.total) * 100 : 0;
      const operational = currentSprint.total > 0 ? (currentSprint.operational / currentSprint.total) * 100 : 0;
      const valueCreation = currentSprint.total > 0 ? (currentSprint.valueCreation / currentSprint.total) * 100 : 0;
      
      // Calculate trends
      const technicalTrend = perSprintValues.map(s => 
        s.total > 0 ? (s.technical / s.total) * 100 : 0
      );
      const operationalTrend = perSprintValues.map(s => 
        s.total > 0 ? (s.operational / s.total) * 100 : 0
      );
      const valueCreationTrend = perSprintValues.map(s => 
        s.total > 0 ? (s.valueCreation / s.total) * 100 : 0
      );

      return {
        technical,
        operational,
        valueCreation,
        perSprintValues,
        trend: {
          technical: technicalTrend,
          operational: operationalTrend,
          valueCreation: valueCreationTrend
        }
      };
    } catch (error) {
      this.logger.error('Error calculating work type breakdown:', error);
      return {
        technical: 0,
        operational: 0,
        valueCreation: 0,
        perSprintValues: [],
        trend: {
          technical: [],
          operational: [],
          valueCreation: []
        }
      };
    }
  }

  /**
   * Calculate metrics for tickets added during sprint
   */
  private async calculateAddedTickets(
    jiraMetrics: JiraProjectMetrics,
  ): Promise<CustomTeamMetrics['addedTickets']> {
    try {
      const { sprintData } = await this.jiraService.getLastNSprintsData(6, jiraMetrics.project.key, 1);

      if (!sprintData || !Array.isArray(sprintData) || sprintData.length === 0) {
        this.logger.warn('No sprint data available for added tickets calculation');
        return {
          percentage: 0,
          addedCount: 0,
          totalCount: 0,
          byType: {},
          byTypePercentage: {},
          trend: [],
          rating: 'poor' as const
        };
      }

      const currentSprint = sprintData[0];
      const totalIssues = currentSprint.totalIssues || [];
      const committedIssues = new Set(currentSprint.committedIssues?.map((i: JiraIssue) => i.key) || []);
      
      // Calculate added issues (those in totalIssues but not in committedIssues)
      const addedIssues = totalIssues.filter(issue => !committedIssues.has(issue.key));
      const addedCount = addedIssues.length;
      const totalCount = totalIssues.length;
      const percentage = totalCount > 0 ? (addedCount / totalCount) * 100 : 0;
      
      // Calculate breakdown by type
      const byType: Record<string, number> = {};
      addedIssues.forEach(issue => {
        const type = issue.fields.issuetype?.name || 'Unknown';
        byType[type] = (byType[type] || 0) + 1;
      });
      
      // Calculate percentages by type
      const byTypePercentage: Record<string, number> = {};
      Object.keys(byType).forEach(type => {
        byTypePercentage[type] = addedCount > 0 ? (byType[type] / addedCount) * 100 : 0;
      });
      
      // Calculate trend across sprints
      const trend = sprintData.map(sprint => {
        const sprintCommittedIssues = new Set(sprint.committedIssues?.map(i => i.key) || []);
        const sprintTotalIssues = sprint.totalIssues || [];
        const sprintAddedIssues = sprintTotalIssues.filter(issue => !sprintCommittedIssues.has(issue.key));
        return sprintTotalIssues.length > 0 ? (sprintAddedIssues.length / sprintTotalIssues.length) * 100 : 0;
      });
      
      // Determine rating
      let rating: 'excellent' | 'good' | 'needs-improvement' | 'poor';
      if (percentage <= 10) {
        rating = 'excellent';
      } else if (percentage <= 20) {
        rating = 'good';
      } else if (percentage <= 30) {
        rating = 'needs-improvement';
      } else {
        rating = 'poor';
      }

      return {
        percentage,
        addedCount,
        totalCount,
        byType,
        byTypePercentage,
        trend,
        rating
      };
    } catch (error) {
      this.logger.error('Error calculating added tickets:', error);
      return {
        percentage: 0,
        addedCount: 0,
        totalCount: 0,
        byType: {},
        byTypePercentage: {},
        trend: [],
        rating: 'poor' as const
      };
    }
  }

  /**
   * Calculate epic tracking metrics
   */
  private async calculateEpicTracking(
    jiraMetrics: JiraProjectMetrics,
  ): Promise<CustomTeamMetrics['epicTracking']> {
    try {
      const { sprintData } = await this.jiraService.getLastNSprintsData(6, jiraMetrics.project.key, 1);

      // Handle case where no sprint data is available
      if (!sprintData || !Array.isArray(sprintData) || sprintData.length === 0) {
        this.logger.warn('No sprint data available for epic tracking');
        return {
          averageParallelEpics: 0,
          currentParallelEpics: 0,
          perSprintValues: [],
          quarterlyAverage: 0,
          trend: [],
          rating: 'poor' as const
        };
      }

      const currentSprint = sprintData[0];
      if (!currentSprint || !currentSprint.totalIssues) {
        this.logger.error('Invalid sprint data structure:', currentSprint);
        return {
          averageParallelEpics: 0,
          currentParallelEpics: 0,
          perSprintValues: [],
          quarterlyAverage: 0,
          trend: [],
          rating: 'poor' as const
        };
      }

      // Track unique epic keys
      const epicKeys = new Set<string>();
      
      // Process all issues in the current sprint
      const allIssues = [...(currentSprint.totalIssues || []), ...(currentSprint.committedIssues || [])];
      
      allIssues.forEach(issue => {
        // Look for epic link in custom fields
        const epicLink = this.findEpicLink(issue);
        if (epicLink && !currentSprint.completedIssues.some(i => i.key === epicLink)) {
          epicKeys.add(epicLink);
        }
      });

      // Calculate current and average
      const currentParallelEpics = epicKeys.size;
      const averageParallelEpics = epicKeys.size / Math.max(1, sprintData.length);

      // Calculate quarterly average (assume 4 sprints per quarter)
      const quarterlyAverage = epicKeys.size / Math.min(4, sprintData.length);

      // Calculate trend - initialize with current value for historical data
      const trend = Array(6).fill(currentParallelEpics);

      // Determine rating based on parallel epics
      let rating: 'excellent' | 'good' | 'needs-improvement' | 'poor';
      if (averageParallelEpics <= 3) {
        rating = 'excellent';
      } else if (averageParallelEpics <= 5) {
        rating = 'good';
      } else if (averageParallelEpics <= 8) {
        rating = 'needs-improvement';
      } else {
        rating = 'poor';
      }

      // Create per-sprint values array
      const perSprintValues = sprintData.map(sprint => ({
        sprint: sprint.name,
        parallelEpics: epicKeys.size // Using current size as historical data isn't available
      }));

      return {
        averageParallelEpics,
        currentParallelEpics,
        perSprintValues,
        quarterlyAverage,
        trend,
        rating
      };
    } catch (error) {
      this.logger.error('Error calculating epic tracking:', error);
      return {
        averageParallelEpics: 0,
        currentParallelEpics: 0,
        perSprintValues: [],
        quarterlyAverage: 0,
        trend: [],
        rating: 'poor' as const
      };
    }
  }

  /**
   * Helper method to find epic link in issue custom fields
   */
  private findEpicLink(issue: JiraIssue): string | undefined {
    // Common custom field names for epic links
    const epicFieldNames = [
      'customfield_10014', // Common epic link field
      'customfield_10015', // Alternative epic field
      'customfield_10016', // Another possible epic field
    ];

    for (const fieldName of epicFieldNames) {
      const fields = issue.fields as Record<string, unknown>;
      const epicLink = fields[fieldName];
      if (typeof epicLink === 'string' && epicLink) {
        return epicLink;
      }
    }

    return undefined;
  }

  /**
   * Format custom metrics for display
   */
  private formatCustomMetrics(metrics: CustomTeamMetrics): string {
    // Custom metrics table with sections
    const customMetricsTable = new Table()
      .border(true)
      .padding(1);
    
    // Add title as header row
    customMetricsTable.push([`${theme.symbols.metrics} Custom Team Metrics`]);
    
    // Sprint commitment section
    const commitmentTable = new Table()
      .border(true)
      .padding(1)
      .header(['Metric', 'Value']);
    
    // Add title as a header row
    commitmentTable.push(['🎯 Sprint Commitment', '']);
    
    commitmentTable.push(['Current Progress', `${metrics.sprintCommitment.doneVsCommitted.toFixed(1)}% (${metrics.sprintCommitment.completedTickets}/${metrics.sprintCommitment.committedTickets})`]);
    commitmentTable.push(['Projected at Sprint End', `${(metrics.sprintCommitment.doneVsCommitted * 2).toFixed(1)}% (${metrics.sprintCommitment.completedTickets * 2}/${metrics.sprintCommitment.committedTickets})`]);
    commitmentTable.push(['Daily Velocity', `${(metrics.sprintCommitment.completedTickets / 7).toFixed(1)} tickets/day`]);
    commitmentTable.push(['Status', formatServiceStatus(metrics.sprintCommitment.rating)]);
    commitmentTable.push(['Trend', formatTrendChart(metrics.sprintCommitment.trend, 5, true, ['S-5', 'S-4', 'S-3', 'S-2', 'Now'])]);
    
    // Sprint spillover section
    const spilloverTable = new Table()
      .border(true)
      .padding(1)
      .header(['Metric', 'Value']);
    
    // Add title as a header row
    spilloverTable.push(['🔄 Sprint Spillover', '']);
    
    spilloverTable.push(['Spillover Rate', `${metrics.sprintSpillover.spilloverRate.toFixed(1)}%`]);
    spilloverTable.push(['Spilled/Total Tickets', `${metrics.sprintSpillover.spilledTickets}/${metrics.sprintSpillover.totalTickets}`]);
    spilloverTable.push(['Status', formatServiceStatus(metrics.sprintSpillover.rating)]);
    spilloverTable.push(['Trend', formatTrendChart(metrics.sprintSpillover.trend, 5, true, ['S-5', 'S-4', 'S-3', 'S-2', 'Now'])]);
    
    // Velocity metrics section
    const velocityTable = new Table()
      .border(true)
      .padding(1)
      .header(['Metric', 'Value']);
    
    // Add title as a header row
    velocityTable.push(['⏱️ Sprint Velocity & Cycle Time', '']);
    
    velocityTable.push(['Average Cycle Time', formatDuration(metrics.sprintVelocity.cycleTime)]);
    velocityTable.push(['Median Cycle Time', formatDuration(metrics.sprintVelocity.cycleTimeTrend[0] || 0)]);
    velocityTable.push(['25th Percentile', metrics.sprintVelocity.cycleTimeDistribution[1] ? formatDuration(metrics.sprintVelocity.cycleTimeDistribution[1]) : 'N/A']);
    velocityTable.push(['75th Percentile', metrics.sprintVelocity.cycleTimeDistribution[2] ? formatDuration(metrics.sprintVelocity.cycleTimeDistribution[2]) : 'N/A']);
    velocityTable.push(['90th Percentile', metrics.sprintVelocity.cycleTimeDistribution[3] ? formatDuration(metrics.sprintVelocity.cycleTimeDistribution[3]) : 'N/A']);
    velocityTable.push(['Throughput', `${metrics.sprintVelocity.throughput} tickets`]);
    velocityTable.push(['Status', formatServiceStatus(metrics.sprintVelocity.rating)]);
    
    // Cycle time trend with detailed stats
    const cycleTimeTrendData = [
      formatTrendChart(metrics.sprintVelocity.cycleTimeTrend, 5, true, ['S-5', 'S-4', 'S-3', 'S-2', 'Now']),
      `Current: ${(metrics.sprintVelocity.cycleTime / 24).toFixed(1)}d (${this.getTrendChange(metrics.sprintVelocity.cycleTimeTrend).toFixed(1)}% vs prev)`
    ].join('\n');
    
    velocityTable.push(['Cycle Time Trend', cycleTimeTrendData]);
    velocityTable.push(['Throughput Trend', formatTrendChart(metrics.sprintVelocity.throughputTrend, 5, true, ['S-5', 'S-4', 'S-3', 'S-2', 'Now'])]);
    velocityTable.push(['Bottlenecks', metrics.sprintVelocity.bottlenecks.join(', ') || 'None']);
    
    // Work type breakdown section
    const workTypeTable = new Table()
      .border(true)
      .padding(1)
      .header(['Metric', 'Value']);
    
    // Add title as a header row
    workTypeTable.push(['📊 Work Type Breakdown', '']);
    
    // Current distribution stats
    const currentDistributionData = [
      `Technical: ${metrics.workTypeBreakdown.technical.toFixed(1)}% ${this.getTrendArrow(metrics.workTypeBreakdown.trend.technical)} (Target: 20-30%)`,
      `Operational: ${metrics.workTypeBreakdown.operational.toFixed(1)}% ${this.getTrendArrow(metrics.workTypeBreakdown.trend.operational)} (Target: 15-25%)`,
      `Value Creation: ${metrics.workTypeBreakdown.valueCreation.toFixed(1)}% ${this.getTrendArrow(metrics.workTypeBreakdown.trend.valueCreation)} (Target: 45-65%)`
    ].join('\n');
    
    workTypeTable.push(['Current Distribution', currentDistributionData]);
    workTypeTable.push(['\nTrend Analysis', '']);
    
    // Technical work trend
    const technicalTrendData = [
      formatTrendChart(metrics.workTypeBreakdown.trend.technical, 5, true, ['S-5', 'S-4', 'S-3', 'S-2', 'Now']),
      `Average: ${this.calculateAverage(metrics.workTypeBreakdown.trend.technical).toFixed(1)}% | Peak: ${Math.max(...metrics.workTypeBreakdown.trend.technical).toFixed(1)}% | Change: ${this.getTrendArrow(metrics.workTypeBreakdown.trend.technical)}`
    ].join('\n');
    
    workTypeTable.push(['Technical Work Trend', technicalTrendData]);
    
    // Operational work trend
    const operationalTrendData = [
      formatTrendChart(metrics.workTypeBreakdown.trend.operational, 5, true, ['S-5', 'S-4', 'S-3', 'S-2', 'Now']),
      `Average: ${this.calculateAverage(metrics.workTypeBreakdown.trend.operational).toFixed(1)}% | Peak: ${Math.max(...metrics.workTypeBreakdown.trend.operational).toFixed(1)}% | Change: ${this.getTrendArrow(metrics.workTypeBreakdown.trend.operational)}`
    ].join('\n');
    
    workTypeTable.push(['\nOperational Work Trend', operationalTrendData]);
    
    // Value creation trend
    const valueTrendData = [
      formatTrendChart(metrics.workTypeBreakdown.trend.valueCreation, 5, true, ['S-5', 'S-4', 'S-3', 'S-2', 'Now']),
      `Average: ${this.calculateAverage(metrics.workTypeBreakdown.trend.valueCreation).toFixed(1)}% | Peak: ${Math.max(...metrics.workTypeBreakdown.trend.valueCreation).toFixed(1)}% | Change: ${this.getTrendArrow(metrics.workTypeBreakdown.trend.valueCreation)}`
    ].join('\n');
    
    workTypeTable.push(['\nValue Creation Trend', valueTrendData]);
    
    // Sprint details
    workTypeTable.push(['\nSprint Details', '']);
    
    // Sprint-by-sprint breakdown
    const sprintDetailsData = metrics.workTypeBreakdown.perSprintValues.map((period, i) => 
      `Sprint ${i + 1}:`.padEnd(20) + `T: ${period.technical.toString().padStart(2)}  O: ${period.operational.toString().padStart(2)}  V: ${period.valueCreation.toString().padStart(2)}`
    ).join('\n');
    
    workTypeTable.push(['Sprint-by-Sprint Details', sprintDetailsData]);
    
    return [
      commitmentTable.toString(),
      '',
      spilloverTable.toString(),
      '',
      velocityTable.toString(),
      '',
      workTypeTable.toString()
    ].join('\n');
  }

  private calculateAverage(values: number[]): number {
    return values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : 0;
  }

  /**
   * Format sprint metrics for display
   */
  private formatSprintMetrics(sprintDataObj: { sprintData: SprintData[]; duplicateSprints: Array<{ dateRange: string; sprints: string[] }> }): string {
    const { sprintData } = sprintDataObj;

    if (!sprintData || !Array.isArray(sprintData) || sprintData.length === 0) {
      this.logger.warn('No sprint data available for metrics formatting');
      return 'No sprint data available';
    }

    // Calculate overall metrics
    const totalCommitted = sprintData.reduce(
      (sum, sprint) => sum + (sprint.committedIssues?.length || 0),
      0,
    );
    const totalCompleted = sprintData.reduce(
      (sum, sprint) => sum + (sprint.completedIssues?.length || 0),
      0,
    );
    const totalSpiltOver = sprintData.reduce(
      (sum, sprint) => sum + (sprint.spiltOverIssues?.length || 0),
      0,
    );
    const avgCycleTime = sprintData.reduce((sum, sprint) => sum + (sprint.averageCycleTime?.mean || 0), 0) /
      Math.max(1, sprintData.length);

    // Get bottleneck analysis from the most recent sprint
    const latestSprint = sprintData[0];
    const { bottlenecks, blockedIssues } = this.identifyBottlenecks(
      latestSprint?.stageTransitions || { transitions: [], statusAnalytics: [] }
    );

    // Format durations
    const formatDuration = (hours: number): string => {
      const days = Math.floor(hours / 24);
      const remainingHours = Math.round(hours % 24);
      return days > 0 ? `${days}d ${remainingHours}h` : `${remainingHours}h`;
    };

    // Main sprint metrics table
    const sprintMetricsTable = new Table()
      .border(true)
      .padding(1);
    
    // Add title as a header row
    sprintMetricsTable.push([`${theme.symbols.metrics} Sprint Metrics (Last ${sprintData.length} Sprints)`]);
    
    // Commitment & delivery section
    const commitmentTable = new Table()
      .border(true)
      .padding(1)
      .header(['Metric', 'Value']);
    
    // Add title as a header row
    commitmentTable.push(['🎯 Commitment & Delivery', '']);
    
    commitmentTable.push(['Done vs Committed', `${(totalCompleted / totalCommitted * 100).toFixed(1)}%`]);
    commitmentTable.push(['Completed/Committed', `${totalCompleted}/${totalCommitted}`]);
    commitmentTable.push(['Performance Level', formatServiceStatus(this.rateCompletionRate(totalCompleted / totalCommitted))]);
    
    // Sprint spillover section
    const spilloverTable = new Table()
      .border(true)
      .padding(1)
      .header(['Metric', 'Value']);
    
    // Add title as a header row
    spilloverTable.push(['🔄 Sprint Spillover', '']);
    
    spilloverTable.push(['Spillover Rate', `${(totalSpiltOver / totalCommitted * 100).toFixed(1)}%`]);
    spilloverTable.push(['Spilled/Total Tickets', `${totalSpiltOver}/${totalCommitted}`]);
    spilloverTable.push(['Performance Level', formatServiceStatus(this.rateSpilloverRate(totalSpiltOver / totalCommitted))]);
    
    // Sprint velocity section
    const velocityTable = new Table()
      .border(true)
      .padding(1)
      .header(['Metric', 'Value']);
    
    // Add title as a header row
    velocityTable.push(['⏱️ Sprint Velocity', '']);
    
    velocityTable.push(['Average Cycle Time', formatDuration(avgCycleTime)]);
    velocityTable.push(['Throughput (avg)', `${(totalCompleted / sprintData.length).toFixed(1)} tickets/sprint`]);
    velocityTable.push(['Performance Level', formatServiceStatus(this.rateVelocity(avgCycleTime, totalCompleted / sprintData.length))]);
    
    // Process bottlenecks section
    const bottlenecksTable = new Table()
      .border(true)
      .padding(1)
      .header(['Metric', 'Value']);
    
    // Add title as a header row
    bottlenecksTable.push(['🚧 Process Bottlenecks', '']);
    
    bottlenecksTable.push(['Current Bottlenecks', bottlenecks.length > 0 
      ? bottlenecks.map(b => `${b.status} (${formatDuration(b.avgDuration)} avg)`).join('\n')
      : 'No significant bottlenecks']);
    
    bottlenecksTable.push(['Affected Issues', bottlenecks.length > 0
      ? bottlenecks.map(b => `${b.status}: ${b.issueCount} issues`).join('\n')
      : 'N/A']);
    
    // Format sprint-by-sprint analysis
    const sprintAnalysis = sprintData.map((sprint, index) => 
      `Period ${index + 1}`.padEnd(20) + 
      `Committed: ${sprint.committedIssues?.length || 0}, ` +
      `Completed: ${sprint.completedIssues?.length || 0}, ` +
      `Spillover: ${sprint.spiltOverIssues?.length || 0}`
    ).join('\n');
    
    // Sprint analysis table
    const sprintAnalysisTable = new Table()
      .border(true)
      .padding(1)
      .header(['Sprint', 'Results']);
    
    // Add title as a header row
    sprintAnalysisTable.push(['📈 Sprint-by-Sprint Analysis', '']);
    
    sprintAnalysisTable.push(['Analysis', sprintAnalysis]);
    
    // Format status outliers
    const statusOutliers = latestSprint?.stageTransitions?.statusAnalytics
      ?.filter(stat => stat.maxDuration > 24 * 7) // More than 7 days
      ?.map(stat => 
        `${stat.status.padEnd(20)}Max: ${formatDuration(stat.maxDuration)} (${stat.maxIssue})`
      )?.join('\n') || '';
    
    // Outliers table
    const outliersTable = new Table()
      .border(true)
      .padding(1)
      .header(['Status', 'Duration']);
    
    // Add title as a header row
    outliersTable.push(['⚠️ Outliers by Status (>7 days)', '']);
    
    if (statusOutliers) {
      outliersTable.push(['Outliers', statusOutliers]);
    } else {
      outliersTable.push(['Outliers', 'No outliers found']);
    }
    
    // Format status analysis
    const statusAnalysis = latestSprint?.stageTransitions?.statusAnalytics
      ?.map(stat => 
        `${stat.status.padEnd(20)}Avg: ${formatDuration(stat.avgDuration)} (${stat.issueCount} issues)`
      )?.join('\n') || '';
    
    // Status analysis table
    const statusAnalysisTable = new Table()
      .border(true)
      .padding(1)
      .header(['Status', 'Average Time']);
    
    // Add title as a header row
    statusAnalysisTable.push(['🚦 Status Analysis', '']);
    
    statusAnalysisTable.push(['Analysis', statusAnalysis || 'No status analysis available']);
    
    // Format blocked issues
    const blockedIssuesList = blockedIssues
      ?.map(issue => 
        `${issue.key.padEnd(20)}${issue.status}: ${formatDuration(issue.duration)}`
      )?.join('\n') || '';
    
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
      bottlenecksTable.toString(),
      '',
      sprintAnalysisTable.toString(),
      '',
      outliersTable.toString(),
      '',
      statusAnalysisTable.toString(),
      '',
      blockedIssuesTable.toString()
    ].join('\n');
  }

  /**
   * Rate completion rate with more constructive terminology
   */
  private rateCompletionRate(rate: number): string {
    if (rate >= 0.9) return colors.green('On Target');
    if (rate >= 0.8) return colors.blue('Near Target');
    if (rate >= 0.7) return colors.yellow('Needs Focus');
    return colors.red('At Risk');
  }

  /**
   * Rate spillover rate with more constructive terminology
   */
  private rateSpilloverRate(rate: number): string {
    if (rate <= 0.1) return colors.green('On Target');
    if (rate <= 0.2) return colors.blue('Near Target');
    if (rate <= 0.3) return colors.yellow('Needs Focus');
    return colors.red('At Risk');
  }

  /**
   * Rate velocity with more constructive terminology
   */
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
   * Format trend analysis
   */
  private formatTrendAnalysis(trends: DoraTrends): string {
    // Trend analysis main table
    const trendTable = new Table()
      .border(true)
      .padding(1);
    
    // Add title as a header row
    trendTable.push(['📈 Trend Analysis (Last 5 Periods)']);
    
    // Deployment frequency trends
    const deploymentTable = new Table()
      .border(true)
      .padding(1)
      .header(['Metric', 'Value']);
    
    // Add title as a header row
    deploymentTable.push(['Deployment Frequency', '']);
    
    deploymentTable.push(['Trend', formatTrendChart(trends.deploymentFrequencyTrend, 5, true, ['4w', '3w', '2w', '1w', 'Now'])]);
    deploymentTable.push(['Change vs Previous', formatTrendValue(trends.compareWithPrevious.deploymentFrequency, true)]);
    
    // Lead time trends
    const leadTimeTable = new Table()
      .border(true)
      .padding(1)
      .header(['Metric', 'Value']);
    
    // Add title as a header row
    leadTimeTable.push(['Lead Time for Changes', '']);
    
    leadTimeTable.push(['Trend', formatTrendChart(trends.leadTimeTrend, 5, true, ['4w', '3w', '2w', '1w', 'Now'])]);
    leadTimeTable.push(['Change vs Previous', formatTrendValue(-trends.compareWithPrevious.leadTime, false)]);
    
    // Change failure rate trends
    const failureRateTable = new Table()
      .border(true)
      .padding(1)
      .header(['Metric', 'Value']);
    
    // Add title as a header row
    failureRateTable.push(['Change Failure Rate', '']);
    
    failureRateTable.push(['Trend', formatTrendChart(trends.changeFailureRateTrend, 5, true, ['4w', '3w', '2w', '1w', 'Now'])]);
    failureRateTable.push(['Change vs Previous', formatTrendValue(-trends.compareWithPrevious.changeFailureRate, false)]);
    
    // Time to restore trends
    const restoreTable = new Table()
      .border(true)
      .padding(1)
      .header(['Metric', 'Value']);
    
    // Add title as a header row
    restoreTable.push(['Time to Restore', '']);
    
    restoreTable.push(['Trend', formatTrendChart(trends.timeToRestoreTrend, 5, true, ['4w', '3w', '2w', '1w', 'Now'])]);
    restoreTable.push(['Change vs Previous', formatTrendValue(-trends.compareWithPrevious.timeToRestore, false)]);
    
    return [
      deploymentTable.toString(),
      '',
      leadTimeTable.toString(),
      '',
      failureRateTable.toString(),
      '',
      restoreTable.toString()
    ].join('\n');
  }

  // Helper function to get trend arrow
  private getTrendArrow = (values: number[]): string => {
    if (values.length < 2) return '';
    const change = values[values.length - 1] - values[values.length - 2];
    if (Math.abs(change) < 1) return colors.blue('→');
    return change > 0 ? colors.green('↑') : colors.red('↓');
  };

  // Helper function to calculate trend change percentage
  private getTrendChange = (values: number[]): number => {
    if (values.length < 2) return 0;
    const current = values[values.length - 1];
    const previous = values[values.length - 2];
    return previous !== 0 ? ((current - previous) / previous) * 100 : 0;
  };

  /**
   * Calculate deployment frequency rating based on DORA metrics standards
   * @see https://cloud.google.com/blog/products/devops-sre/using-the-four-keys-to-measure-your-devops-performance
   */
  private calculateDeploymentRating(deploymentsPerDay: number): 'elite' | 'high' | 'medium' | 'low' {
    if (deploymentsPerDay >= 1) return 'elite';     // Multiple deploys per day
    if (deploymentsPerDay >= 0.14) return 'high';   // Between once per day and once per week
    if (deploymentsPerDay >= 0.03) return 'medium'; // Between once per week and once per month
    return 'low';                                   // Less than once per month
  }

  /**
   * Format environment deployments for display
   */
  private formatEnvironmentDeployments(env?: { environments: Array<{ name: string; deployments: number }>; total: number }): string {
    if (!env) return 'No data';
    
    const envDetails = env.environments
      .map(e => `${e.name}: ${e.deployments}`)
      .join(', ');
    
    return `${env.total} total (${envDetails})`;
  }

  /**
   * Refresh DORA metrics for linked Jira and GitLab projects
   */
  public async refreshDoraMetrics(
    jiraProjectKey: string,
    gitlabProjectPath: string,
    timeRange: TimeRange,
  ): Promise<ExtendedDoraMetricsResult> {
    try {
      this.logger.info('Refreshing DORA metrics...');
      
      // Clear caches before fetching fresh data
      await this.clearCache();
      await this.jiraService.clearCache();
      await this.gitlabService.clearCache();
      
      // Get fresh metrics
      return await this.getDoraMetrics(jiraProjectKey, gitlabProjectPath, timeRange);
    } catch (error) {
      this.logger.error('Error refreshing DORA metrics:', error);
      throw new Error(
        `Failed to refresh DORA metrics: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`,
      );
    }
  }

  private async calculateDeploymentFrequency(_environments: GitLabEnvironment[], gitlabProjectPath: string, trends: DoraTrends): Promise<DoraMetrics['deploymentFrequency']> {
    // Cache key for environment deployments
    const cacheKey = `deployments_${gitlabProjectPath}`;
    const cached = await this.cache.get<Array<{ name: string; deployments: number }>>(cacheKey, 'deployments');
    
    // Process environments and get their deployments
    const envMetrics = cached || await (async () => {
      this.logger.debug('Fetching environment deployments from GitLab');
      const metrics = await this.gitlabService.getEnvironmentDeployments(gitlabProjectPath);
      await this.cache.set(cacheKey, metrics, 'deployments');
      return metrics;
    })();

    // Filter for production environments only
    const prodEnvs = envMetrics.filter((env: { name: string }) => this.isProductionEnvironment(env.name));
    const totalDeployments = prodEnvs.reduce((sum: number, env: { deployments: number }) => sum + env.deployments, 0);

    // Calculate deployments per day using the trend data
    const deploymentsPerDay = trends.deploymentFrequencyTrend.length > 0 
      ? trends.deploymentFrequencyTrend[trends.deploymentFrequencyTrend.length - 1]
      : totalDeployments / (5 * 7); // fallback to total deployments divided by timerange (5 weeks)

    // Calculate trend statistics from the actual trend data
    const trendStats = {
      min: Math.min(...trends.deploymentFrequencyTrend),
      max: Math.max(...trends.deploymentFrequencyTrend),
      avg: trends.deploymentFrequencyTrend.reduce((a, b) => a + b, 0) / trends.deploymentFrequencyTrend.length
    };

    // Log debug information
    this.logger.debug('Deployment Frequency Metrics:', {
      totalDeployments,
      deploymentsPerDay,
      trendStats,
      environments: {
        production: prodEnvs.length
      }
    });

    return {
      deploymentsPerDay,
      deploymentsTotal: totalDeployments,
      rating: this.calculateDeploymentRating(deploymentsPerDay),
      trendStats,
      environmentBreakdown: {
        production: {
          environments: prodEnvs.map((env: { name: string; deployments: number }) => ({
            name: env.name,
            deployments: env.deployments
          })),
          total: prodEnvs.reduce((sum: number, env: { deployments: number }) => sum + env.deployments, 0)
        },
        staging: {
          environments: [],
          total: 0
        },
        development: {
          environments: [],
          total: 0
        }
      }
    };
  }

  /**
   * Helper function to check if environment name indicates production
   */
  private isProductionEnvironment(name: string): boolean {
    const lowercaseName = name.toLowerCase();
    // Expanded production environment patterns
    const productionPatterns = [
      '^prd$',                  // Exact match for 'prd'
      '^prod$',                 // Exact match for 'prod'
      '^production$',           // Exact match for 'production'
      '^prod-[a-z0-9-]+$',     // prod-anything
      '^prod_[a-z0-9_]+$',     // prod_anything
      '^live$',                // Exact match for 'live'
      '^main$',                // Exact match for 'main'
      'production',            // Contains production
      'live-[a-z0-9-]+'       // live-anything
    ];
    
    return productionPatterns.some(pattern => 
      new RegExp(pattern).test(lowercaseName)
    );
  }

  /**
   * Helper function to check if environment name indicates staging
   */
  private isStagingEnvironment(name: string): boolean {
    const lowercaseName = name.toLowerCase();
    // Expanded staging environment patterns
    const stagingPatterns = [
      '^stg$',                // Exact match for 'stg'
      '^stage$',              // Exact match for 'stage'
      '^staging$',            // Exact match for 'staging'
      '^stg-[a-z0-9-]+$',    // stg-anything
      '^stage-[a-z0-9-]+$',  // stage-anything
      '^uat$',               // User Acceptance Testing
      '^qa$',                // Quality Assurance
      '^test$',              // Test environment
      'staging',             // Contains staging
      'preprod'              // Pre-production
    ];
    return stagingPatterns.some(pattern => 
      new RegExp(pattern).test(lowercaseName)
    );
  }

  private formatProductionEnvironments(env: { environments: Array<{ name: string; deployments: number }>; total: number }): string {
    if (!env.environments.length) return 'No deployments';
    
    // For production, show all environments with their deployment counts
    return env.environments
      .map(e => `${e.name}: ${e.deployments} deployments`)
      .join('\n') + 
      `\nTotal: ${env.total} deployments`;
  }

  private formatStagingEnvironments(env: { environments: Array<{ name: string; deployments: number }>; total: number }): string {
    if (!env.environments.length) return 'No deployments';
    
    // For staging, show all environments with their deployment counts
    return env.environments
      .map(e => `${e.name}: ${e.deployments} deployments`)
      .join('\n') + 
      `\nTotal: ${env.total} deployments`;
  }

  private formatDevelopmentEnvironments(env: { environments: Array<{ name: string; deployments: number }>; total: number }): string {
    if (!env.environments.length) return 'No deployments';
    
    // For development, show summary and top 5 most active environments
    const sortedEnvs = [...env.environments].sort((a, b) => b.deployments - a.deployments);
    const topEnvs = sortedEnvs.slice(0, 5);
    
    let output = `${env.environments.length} environments, ${env.total} total deployments\n`;
    output += 'Most active:\n';
    output += topEnvs
      .map(e => `${e.name}: ${e.deployments} deployments`)
      .join('\n');
    
    if (sortedEnvs.length > 5) {
      const remainingDeployments = sortedEnvs
        .slice(5)
        .reduce((sum, e) => sum + e.deployments, 0);
      output += `\n... and ${sortedEnvs.length - 5} more environments (${remainingDeployments} deployments)`;
    }
    
    return output;
  }

  private formatLeadTimeBreakdown(leadTimeHours: number): string {
    // Approximate breakdown based on typical ratios
    const developmentTime = leadTimeHours * 0.6; // 60% in development
    const reviewTime = leadTimeHours * 0.3;      // 30% in review
    const deployTime = leadTimeHours * 0.1;      // 10% in deployment
    
    return [
      `Development: ${formatDuration(developmentTime)}`,
      `Review: ${formatDuration(reviewTime)}`,
      `Deploy: ${formatDuration(deployTime)}`
    ].join('\n');
  }

  private formatDurationForDisplay(hours: number): string {
    if (hours < 1) {
      return `${Math.round(hours * 60)} minutes`;
    }
    if (hours < 24) {
      return `${hours.toFixed(1)} hours`;
    }
    const days = hours / 24;
    if (days < 7) {
      return `${days.toFixed(1)} days`;
    }
    const weeks = Math.floor(days / 7);
    const remainingDays = Math.round(days % 7);
    return `${weeks}w ${remainingDays}d`;
  }

  private getRating(metric: 'leadTime' | 'changeFailureRate' | 'deploymentFrequency' | 'timeToRestore', value: number): 'elite' | 'high' | 'medium' | 'low' {
    switch (metric) {
      case 'leadTime':
        if (value <= 24) return 'elite';     // Less than 1 day
        if (value <= 168) return 'high';     // Less than 1 week
        if (value <= 672) return 'medium';   // Less than 4 weeks
        return 'low';                        // More than 4 weeks

      case 'changeFailureRate':
        if (value <= 15) return 'elite';     // 0-15%
        if (value <= 30) return 'high';      // 16-30%
        if (value <= 45) return 'medium';    // 31-45%
        return 'low';                        // >45%

      case 'deploymentFrequency':
        if (value >= 1) return 'elite';      // Multiple deploys per day
        if (value >= 0.14) return 'high';    // Between once per day and once per week
        if (value >= 0.03) return 'medium';  // Between once per week and once per month
        return 'low';                        // Less than once per month

      case 'timeToRestore':
        if (value <= 1) return 'elite';      // Less than 1 hour
        if (value <= 24) return 'high';      // Less than 1 day
        if (value <= 168) return 'medium';   // Less than 1 week
        return 'low';                        // More than 1 week
    }
  }

  public async getMetrics(project: string, timeRange: string): Promise<{
    deploymentFrequency: number;
    leadTimeForChanges: number;
    changeFailureRate: number;
    meanTimeToRecovery: number;
  }> {
    const metrics = await this.getDoraMetrics(project, project, timeRange as TimeRange);
    return {
      deploymentFrequency: metrics.metrics.deploymentFrequency.deploymentsPerDay,
      leadTimeForChanges: metrics.metrics.leadTimeForChanges.averageInHours,
      changeFailureRate: metrics.metrics.changeFailureRate.percentage,
      meanTimeToRecovery: metrics.metrics.timeToRestore.averageInHours
    };
  }
}

export type { ExtendedDoraMetricsResult, TimeRange };
