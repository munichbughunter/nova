import { Table } from '@cliffy/table';
import { DOMParser, Element } from 'https://deno.land/x/deno_dom/deno-dom-wasm.ts';
import { Config } from '../config/mod.ts';
import { formatTimestamp, theme } from '../utils.ts';
import { Logger } from '../utils/logger.ts';
import { DBService } from './db_service.ts';

// Remove all interface definitions and start with the class
export class ConfluenceService {
    private config: Config;
    private logger: Logger;
    private initialized = false;
    private baseUrl: string;
    private rateLimitDelay = 100; // ms between requests
    private lastRequestTime = 0;
    private maxRetries = 3;

    constructor(config: Config, debug = false) {
        if (
            !config.atlassian?.confluence_url || !config.atlassian?.confluence_token ||
            !config.atlassian?.username
        ) {
            throw new Error('Confluence is not configured properly.');
        }
        this.config = config;
        this.baseUrl = config.atlassian.confluence_url.replace(/\/wiki$/, '');
        this.logger = new Logger('Confluence', debug);
    }

    private async initialize(): Promise<void> {
        if (this.initialized) {
            return;
        }

        try {
            this.logger.debug('Initializing Confluence service...');

            // Verify connection and credentials
            await this.request<{ type: string }>('/space?limit=1');

            // Initialize database for caching if needed
            const db = await DBService.getInstance();
            await db.initializeConfluenceTables();

            this.initialized = true;
            this.logger.debug('Confluence service initialized successfully');
        } catch (error) {
            this.logger.error('Failed to initialize Confluence service:', error);
            throw new Error(
                `Failed to initialize Confluence service: ${
                    error instanceof Error ? error.message : String(error)
                }`,
            );
        }
    }

    private async rateLimit(): Promise<void> {
        const now = Date.now();
        const timeSinceLastRequest = now - this.lastRequestTime;

        if (timeSinceLastRequest < this.rateLimitDelay) {
            await new Promise((resolve) =>
                setTimeout(resolve, this.rateLimitDelay - timeSinceLastRequest)
            );
        }

        this.lastRequestTime = Date.now();
    }

    private async request<T>(path: string, options: {
        method?: string;
        params?: Record<string, unknown>;
        body?: string;
    } = {}): Promise<T> {
        await this.rateLimit();

        const credentials = btoa(
            `${this.config.atlassian!.username}:${this.config.atlassian!.confluence_token}`,
        );

        // Construct the full URL with the correct path
        const url = new URL(`${this.baseUrl}/wiki/rest/api${path}`);
        if (options.params) {
            Object.entries(options.params).forEach(([key, value]) => {
                url.searchParams.append(key, String(value));
            });
        }

        this.logger.debug(`Making request to URL: ${url.toString()}`);

        let lastError: Error | null = null;

        for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
            try {
                this.logger.debug(
                    `Making request to ${url} (attempt ${attempt}/${this.maxRetries})`,
                );

                const response = await fetch(url.toString(), {
                    method: options.method || 'GET',
                    headers: {
                        'Authorization': `Basic ${credentials}`,
                        'Accept': 'application/json',
                        'Content-Type': 'application/json',
                    },
                    ...(options.body && { body: options.body }),
                });

                if (!response.ok) {
                    // Handle rate limiting
                    if (response.status === 429) {
                        const retryAfter = parseInt(response.headers.get('Retry-After') || '60');
                        this.logger.warn(
                            `Rate limited. Waiting ${retryAfter} seconds before retry...`,
                        );
                        await new Promise((resolve) => setTimeout(resolve, retryAfter * 1000));
                        continue;
                    }

                    // Log the response body for better error diagnosis
                    const errorBody = await response.text();
                    this.logger.error(`API Error Response: ${errorBody}`);
                    throw new Error(
                        `Confluence API error: ${response.status} ${response.statusText}`,
                    );
                }

                const data = await response.json();
                this.logger.debug('Request successful');
                return data;
            } catch (error) {
                lastError = error instanceof Error ? error : new Error(String(error));
                this.logger.error(`Request attempt ${attempt} failed:`, lastError);

                if (attempt < this.maxRetries) {
                    const delay = Math.pow(2, attempt) * 1000; // Exponential backoff
                    this.logger.debug(`Retrying in ${delay}ms...`);
                    await new Promise((resolve) => setTimeout(resolve, delay));
                }
            }
        }

        throw lastError || new Error('Request failed after all retries');
    }

    /**
     * Get all spaces
     */
    async getSpaces(): Promise<ConfluenceSpace[]> {
        try {
            const db = await DBService.getInstance();

            // Try to get cached spaces
            const cached = await db.getCachedConfluenceSpaces();
            if (cached) {
                this.logger.info('Using cached spaces');
                return cached;
            }

            // Fetch fresh data if no cache
            let start = 0;
            const limit = 100;
            const allSpaces: ConfluenceSpace[] = [];

            while (true) {
                const response = await this.request<{
                    results: ConfluenceSpace[];
                    _links?: { next?: string };
                    size: number;
                    limit: number;
                }>(
                    `/space?limit=${limit}&start=${start}&expand=description.plain,metadata.labels,homepage`,
                );

                if (response.results) {
                    allSpaces.push(...response.results);
                }

                // If no more results or no next page, break
                if (!response.results?.length || !response._links?.next) {
                    break;
                }

                start += limit;
                this.logger.debug(`Fetched ${allSpaces.length} spaces so far...`);
            }

            // Cache the results
            await db.cacheConfluenceSpaces(allSpaces);

            return allSpaces;
        } catch (error) {
            this.logger.error('Error fetching spaces:', error);
            throw error;
        }
    }

    /**
     * Get a specific space
     */
    async getSpace(spaceKey: string): Promise<ConfluenceSpace> {
        await this.initialize();
        const response = await this.request<ConfluenceSpace>(
            `/space/${spaceKey}?expand=description.plain,metadata.labels,homepage`,
        );
        return response;
    }

    /**
     * Get all pages in a space, including pages in subfolders
     */
    async getPagesInSpace(spaceKey: string): Promise<ConfluencePage[]> {
        await this.initialize();

        try {
            // First verify if the space exists
            try {
                await this.getSpace(spaceKey);
            } catch (error) {
                if (error instanceof Error && error.message.includes('404')) {
                    throw new Error(
                        `Space "${spaceKey}" not found. Please check the space key and try again.`,
                    );
                }
                throw error;
            }

            // Try to get from cache first
            const db = await DBService.getInstance();
            const cached = await db.getCachedConfluencePages(spaceKey);

            if (cached) {
                this.logger.info(`Using cached pages (${cached.length} pages found)`);
                return cached;
            }

            let start = 0;
            const limit = 100;
            const allPages: ConfluencePage[] = [];

            this.logger.debug(`Fetching pages for space ${spaceKey}`);

            // Get pages from root space
            while (true) {
                const response = await this.request<{
                    results: ConfluencePage[];
                    _links?: { next?: string };
                    size: number;
                    limit: number;
                }>(
                    `/content?spaceKey=${spaceKey}&type=page&limit=${limit}&start=${start}&expand=version,body.storage,history,_links,children.page`,
                );

                this.logger.debug(
                    `Response from API: ${response.results?.length || 0} pages in this batch`,
                );

                if (response.results) {
                    allPages.push(...response.results);
                }

                // If no more results or no next page, break
                if (!response.results?.length || !response._links?.next) {
                    break;
                }

                start += limit;
                this.logger.debug(`Fetched ${allPages.length} pages so far...`);
            }

            // Get child pages recursively
            for (const page of allPages) {
                if (page.children?.page?.results) {
                    for (const childPage of page.children.page.results) {
                        if (!allPages.some((p) => p.id === childPage.id)) {
                            allPages.push(childPage);
                        }
                    }
                }
            }

            this.logger.info(`Total pages found: ${allPages.length}`);

            // Cache the results
            await db.cacheConfluencePages(spaceKey, allPages);
            this.logger.debug(`Cached ${allPages.length} pages for space ${spaceKey}`);

            return allPages;
        } catch (error) {
            this.logger.error('Error fetching pages:', error);
            throw error;
        }
    }

    /**
     * Get a specific page with all its content and metadata
     */
    async getPage(pageId: string, forceRefresh = false): Promise<ConfluencePage> {
        await this.initialize();

        try {
            this.logger.debug(`Fetching page ${pageId}`);

            // Try to get from cache first if not forcing refresh
            const db = await DBService.getInstance();
            const cached = !forceRefresh ? await db.getCachedConfluencePage(pageId) : null;

            if (cached) {
                this.logger.info('Using cached page');
                return cached;
            }

            // Fetch fresh data with all expansions
            const page = await this.request<ConfluencePage>(
                `/content/${pageId}?expand=body.storage,version,history,ancestors,children.page,space,_links,metadata.labels`,
            );

            if (!page) {
                throw new Error(`Page ${pageId} not found`);
            }

            // Cache the result
            try {
                await db.cacheConfluencePage(pageId, page);
            } catch (error) {
                this.logger.warn('Failed to cache page:', error);
                // Don't throw - caching is not critical
            }

            return page;
        } catch (error) {
            this.logger.error(`Failed to fetch page ${pageId}:`, error);
            throw error;
        }
    }

    /**
     * Search for content in Confluence
     */
    public async search(query: string, space?: string): Promise<
        Array<{
            id: string;
            title: string;
            space: { key: string; name: string };
            lastModified: string;
            url: string;
        }>
    > {
        const params = new URLSearchParams({
            cql: `text ~ "${query}"${space ? ` AND space = "${space}"` : ''}`,
            expand: 'space,version',
        });

        const response = await this.request<{
            results: Array<{
                id: string;
                title: string;
                space: { key: string; name: string };
                version: { when: string };
                _links: { webui: string };
            }>;
        }>(`/content/search?${params}`);

        return response.results.map((result) => ({
            id: result.id,
            title: result.title,
            space: result.space,
            lastModified: result.version.when,
            url: result._links.webui,
        }));
    }

    /**
     * Get comments for a page
     */
    async getComments(pageId: string): Promise<ConfluenceComment[]> {
        const response = await this.request<{
            results: ConfluenceComment[];
        }>(`/content/${pageId}/child/comment?expand=body.storage,version`);

        return response.results || [];
    }

    /**
     * Get space statistics
     */
    async getSpaceStatistics(spaceKey: string): Promise<ConfluenceSpaceStats> {
        await this.initialize();

        try {
            // Try to get cached data first
            const db = await DBService.getInstance();
            const cached = await db.getCachedConfluenceDashboard(spaceKey);

            if (cached) {
                this.logger.info('Using cached dashboard data from:', cached.timestamp);
                // Add to recent spaces even when using cached data
                const space = cached.stats.space;
                await this.addToRecentSpaces(space);
                return cached.stats;
            }

            this.logger.info('No cached data found or cache expired, fetching fresh data...');

            // Get space details
            const space = await this.getSpace(spaceKey);

            // Add to recent spaces immediately
            await this.addToRecentSpaces(space);

            // Get pages and other content
            const [pages, blogs, comments] = await Promise.all([
                this.getPagesInSpace(spaceKey),
                this.request<{ results: ContentResult[] }>(
                    `/space/${spaceKey}/content?type=blogpost&limit=100`,
                ).then((r) => r.results || []),
                this.request<{ results: ContentResult[] }>(
                    `/space/${spaceKey}/content?type=comment&limit=100`,
                ).then((r) => r.results || []),
            ]);

            // Get contributors (unique users who contributed to pages)
            const contributors = new Set<string>();
            let lastUpdated = '';

            pages.forEach((page) => {
                // Add page creator
                contributors.add(page.history?.createdBy?.displayName || '');

                // Add page last editor
                contributors.add(page.version?.by?.displayName || '');

                // Check for most recent update
                if (
                    !lastUpdated || new Date(page.version?.createdAt || '') > new Date(lastUpdated)
                ) {
                    lastUpdated = page.version?.createdAt || '';
                }
            });

            // Collect recent activity (last 30 days)
            const thirtyDaysAgo = new Date();
            thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

            const recentActivity = pages
                .filter((page) => new Date(page.version?.createdAt || '') >= thirtyDaysAgo)
                .map((page) => ({
                    type: page.version?.number === 1 ? 'create' as const : 'update' as const,
                    date: page.version?.createdAt || '',
                    content: {
                        id: page.id,
                        title: page.title,
                    },
                    user: {
                        displayName: page.version.by.displayName,
                    },
                }))
                .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

            // Count contributor contributions (simplified for now)
            const contributorCounts: Record<string, number> = {};
            pages.forEach((page) => {
                const creator = page.history?.createdBy?.displayName || '';
                contributorCounts[creator] = (contributorCounts[creator] || 0) + 1;
            });

            const topContributors = Object.entries(contributorCounts)
                .map(([displayName, contributionCount]) => ({ displayName, contributionCount }))
                .sort((a, b) => b.contributionCount - a.contributionCount)
                .slice(0, 5);

            // Extract tags/labels
            const tags: Record<string, number> = {};
            if (space.metadata?.label?.labels) {
                space.metadata.label.labels.forEach((label) => {
                    tags[label.name] = (tags[label.name] || 0) + 1;
                });
            }

            const tagsList = Object.entries(tags)
                .map(([name, count]) => ({ name, count }))
                .sort((a, b) => b.count - a.count);

            // Create the space statistics object
            const stats: ConfluenceSpaceStats = {
                space,
                pageCount: pages.length,
                blogCount: blogs.length,
                commentCount: comments.length,
                contributorCount: contributors.size,
                lastUpdated,
                topContributors,
                recentActivity,
                tags: tagsList,
            };

            // Cache the statistics
            try {
                await db.cacheConfluenceDashboard(spaceKey, stats);
            } catch (error) {
                this.logger.error('Error caching dashboard:', error);
            }

            return stats;
        } catch (error) {
            this.logger.error('Error fetching space statistics:', error);
            throw error;
        }
    }

    /**
     * Format space statistics for display
     */
    formatSpaceStatistics(stats: ConfluenceSpaceStats): string {
        const { space, pageCount, blogCount, commentCount, contributorCount, lastUpdated } = stats;

        const sections: string[] = [];

        sections.push(
            theme.emphasis(
                `${theme.symbols.documentation} Confluence Space Dashboard: ${space.name} (${space.key})`,
            ),
        );

        // Main space info table
        const spaceTable = new Table()
            .border(true)
            .padding(1);

        spaceTable.push([
            `${theme.symbols.documentation} URL`,
            `${this.baseUrl}/wiki/spaces/${space.key}`,
        ]);
        spaceTable.push([`${theme.symbols.documentation} Type`, space.type || 'Unknown']);

        sections.push(spaceTable.toString());

        // Content statistics table
        sections.push(theme.emphasis('\n📊 Content Statistics'));

        const statsTable = new Table()
            .border(true)
            .padding(1)
            .header(['Metric', 'Value']);

        statsTable.push(['Pages', pageCount.toString()]);
        statsTable.push(['Blog Posts', blogCount.toString()]);
        statsTable.push(['Comments', commentCount.toString()]);
        statsTable.push(['Contributors', contributorCount.toString()]);
        statsTable.push(['Last Updated', formatTimestamp(lastUpdated)]);

        sections.push(statsTable.toString());

        // Top contributors table
        if (stats.topContributors && stats.topContributors.length > 0) {
            sections.push(theme.emphasis('\n👥 Top Contributors'));

            const contributorsTable = new Table()
                .border(true)
                .padding(1)
                .header(['Name', 'Contributions']);

            stats.topContributors.forEach((contributor) => {
                contributorsTable.push([
                    contributor.displayName,
                    `${contributor.contributionCount} contributions`,
                ]);
            });

            sections.push(contributorsTable.toString());
        }

        // Recent activity table
        if (stats.recentActivity && stats.recentActivity.length > 0) {
            sections.push(theme.emphasis('\n🕒 Recent Activity'));

            const activityTable = new Table()
                .border(true)
                .padding(1)
                .header(['Date', 'Activity']);

            stats.recentActivity.slice(0, 5).forEach((activity) => {
                const date = formatTimestamp(activity.date);
                const action = activity.type === 'create' ? 'Created' : 'Updated';
                activityTable.push([
                    date,
                    `${action}: ${activity.content.title} (by ${activity.user.displayName})`,
                ]);
            });

            sections.push(activityTable.toString());
        }

        // Tags section
        if (stats.tags && stats.tags.length > 0) {
            sections.push(theme.emphasis('\n🏷️ Top Tags'));
            sections.push(stats.tags.map((tag) => tag.name).slice(0, 5).join(', '));
        }

        // Description section
        sections.push(theme.emphasis('\n📝 Space Description'));
        sections.push(space.description?.plain?.value || 'No description provided');

        return sections.join('\n');
    }

    /**
     * Format page information for display
     */
    formatPageInfo(page: ConfluencePage): string {
        // Get full content and parse HTML
        const content = page.body?.storage?.value || 'No content available';

        // Create a temporary div to parse HTML
        const parser = new DOMParser();
        const doc = parser.parseFromString(content, 'text/html');

        // Function to format table
        const formatTable = (table: Element): string => {
            const rows: string[][] = [];

            // Get headers
            const headers = Array.from(table.querySelectorAll('th')).map((th: Element) =>
                th.textContent?.trim() || ''
            );
            if (headers.length > 0) {
                rows.push(headers);
            }

            // Get data rows
            table.querySelectorAll('tr').forEach((tr: Element) => {
                const cells = Array.from(tr.querySelectorAll('td')).map((td: Element) =>
                    td.textContent?.trim() || ''
                );
                if (cells.length > 0) {
                    rows.push(cells);
                }
            });

            // Create table string
            if (rows.length === 0) return '';

            const tableStr = new Table()
                .border(true)
                .padding(1);

            rows.forEach((row) => tableStr.push(row));

            return tableStr.toString();
        };

        // Format ancestry path
        const ancestryPath = page.ancestors && page.ancestors.length > 0
            ? page.ancestors.map((a) => a.title).join(' > ') + ' > ' + page.title
            : page.title;

        const sections: string[] = [];

        // Title section
        sections.push(theme.emphasis(`${theme.symbols.documentation} ${page.title}`));

        // Basic info table
        const pageTable = new Table()
            .border(true)
            .padding(1);

        if (ancestryPath) {
            pageTable.push([`${theme.symbols.documentation} Path`, ancestryPath]);
        }

        // URL - handle missing links property
        const pageUrl = page.links?.webui
            ? `${this.baseUrl}/wiki${page.links.webui}`
            : `${this.baseUrl}/wiki/spaces/${page.space?.key || 'unknown'}/pages/${page.id}`;
        pageTable.push([`${theme.symbols.documentation} URL`, pageUrl]);

        // Add command to view this page
        pageTable.push([
            `${theme.symbols.documentation} Command`,
            `nova confluence page ${page.id}`,
        ]);

        sections.push(pageTable.toString());

        // Page details table
        sections.push(theme.emphasis('\n📊 Page Details'));

        const detailsTable = new Table()
            .border(true)
            .padding(1)
            .header(['Metric', 'Value']);

        detailsTable.push([
            'Space',
            `${page.space?.name || 'Unknown'} (${page.space?.key || 'Unknown'})`,
        ]);
        detailsTable.push(['Version', `v${page.version?.number || 'Unknown'}`]);

        // Format dates with proper error handling
        const createdDate = page.history?.createdDate
            ? formatTimestamp(page.history.createdDate)
            : 'Unknown';
        const updatedDate = page.version?.createdAt
            ? formatTimestamp(page.version.createdAt)
            : 'Unknown';

        detailsTable.push([
            'Created',
            `${createdDate} by ${page.history?.createdBy?.displayName || 'Unknown'}`,
        ]);
        detailsTable.push([
            'Updated',
            `${updatedDate} by ${page.version?.by?.displayName || 'Unknown'}`,
        ]);

        sections.push(detailsTable.toString());

        // Child pages section
        if (page.children?.page?.results && page.children.page.results.length > 0) {
            sections.push(theme.emphasis('\n📑 Child Pages'));
            const childPagesTable = new Table()
                .border(true)
                .padding(1)
                .header(['Title', 'Version']);

            page.children.page.results.forEach((child) => {
                childPagesTable.push([
                    child.title,
                    `v${child.version?.number || 'Unknown'}`,
                ]);
            });

            sections.push(childPagesTable.toString());
            sections.push(theme.dim(`\nTotal child pages: ${page.children.page.results.length}`));
        }

        // Content section
        sections.push(theme.emphasis('\n📝 Content'));

        // Process tables first
        doc.querySelectorAll('table').forEach((table) => {
            const tableStr = formatTable(table as Element);
            if (tableStr) {
                sections.push(tableStr);
            }
        });

        // Process other content (excluding tables)
        const otherContent = Array.from(doc.body.children)
            .filter((el) => el.tagName !== 'TABLE')
            .map((el) => el.textContent?.trim())
            .filter((text) => text && text.length > 0)
            .join('\n');

        if (otherContent) {
            sections.push(otherContent);
        }

        return sections.join('\n');
    }

    /**
     * Format search results
     */
    formatSearchResults(results: ConfluenceSearchResult): string {
        if (results.size === 0) {
            return 'No results found.';
        }

        const sections: string[] = [];

        for (const result of results.results) {
            sections.push(
                theme.emphasis(
                    `${theme.symbols.documentation} ${
                        result.type.charAt(0).toUpperCase() + result.type.slice(1)
                    }: ${result.title}`,
                ),
            );

            const resultTable = new Table()
                .border(true)
                .padding(1);

            resultTable.push(['Space', `${result.space.name} (${result.space.key})`]);

            if (result.lastModified) {
                resultTable.push([
                    'Last Modified',
                    `${formatTimestamp(result.lastModified.when)}${
                        result.lastModified.by?.displayName
                            ? ` by ${result.lastModified.by.displayName}`
                            : ''
                    }`,
                ]);
            }

            resultTable.push(['URL', `${this.baseUrl}/wiki${result._links.webui}`]);

            sections.push(resultTable.toString());

            if (result.excerpt) {
                sections.push(theme.emphasis('\n📝 Excerpt'));
                sections.push(result.excerpt);
            }

            sections.push(''); // Add a blank line between results
        }

        sections.push(`\nTotal Results: ${results.size}`);

        return sections.join('\n');
    }

    /**
     * Add a space to the recent spaces list
     */
    private async addToRecentSpaces(space: ConfluenceSpace): Promise<void> {
        try {
            const db = await DBService.getInstance();
            await db.addRecentConfluenceSpace(space.key, space.name);
        } catch (error) {
            this.logger.error('Error adding to recent spaces:', error);
            // Don't throw - this is a non-critical operation
        }
    }

    /**
     * Get recently accessed spaces
     */
    public async getRecentSpaces(): Promise<RecentSpace[]> {
        try {
            const response = await this.request<{
                results: Array<{
                    id: string;
                    key: string;
                    name: string;
                    description: string;
                    lastModified: string;
                    labels: string[];
                }>;
            }>(`/space`, {
                method: 'GET',
                params: {
                    expand: 'description.plain,metadata.labels',
                    limit: 10,
                    orderBy: 'lastModified',
                },
            });

            // @ts-ignore: lastModified is not a property of ConfluenceSpace
            return response.results.map((space: ConfluenceSpace) => ({
                key: space.key,
                name: space.name,
            }));
        } catch (error) {
            this.logger.error('Error getting recent spaces:', error);
            return [];
        }
    }

    /**
     * Advanced search with filtering options
     */
    async advancedSearch(options: {
        query: string;
        spaceKey?: string;
        type?: 'page' | 'blogpost' | 'comment';
        label?: string;
        contributor?: string;
        limit?: number;
    }): Promise<ConfluenceSearchResult> {
        await this.initialize();

        try {
            let cql = `text ~ "${encodeURIComponent(options.query)}"`;

            if (options.spaceKey) {
                cql += ` AND space = "${options.spaceKey}"`;
            }
            if (options.type) {
                cql += ` AND type = "${options.type}"`;
            }
            if (options.label) {
                cql += ` AND label = "${options.label}"`;
            }
            if (options.contributor) {
                cql += ` AND contributor = "${options.contributor}"`;
            }

            const limit = options.limit || 10;
            this.logger.debug('Executing CQL search:', cql);

            const response = await this.request<ConfluenceSearchResult>(
                `/content/search?cql=${
                    encodeURIComponent(cql)
                }&limit=${limit}&expand=space,_links,lastModified`,
            );

            this.logger.info(`Found ${response.results?.length || 0} results`);
            return response;
        } catch (error) {
            this.logger.error('Advanced search error:', error);
            throw error;
        }
    }

    /**
     * Get page content in a specific format
     */
    async getPageContent(
        pageId: string,
        format: 'storage' | 'view' | 'export_view' = 'storage',
    ): Promise<string> {
        await this.initialize();

        try {
            const response = await this.request<{
                value: string;
                representation: string;
            }>(`/content/${pageId}/body?expand=body.${format}`);

            return response.value;
        } catch (error) {
            this.logger.error(`Error getting page content in ${format} format:`, error);
            throw error;
        }
    }

    /**
     * Get page history with detailed version information
     */
    async getPageHistory(pageId: string): Promise<
        Array<{
            version: number;
            by: {
                displayName: string;
                email?: string;
            };
            createdAt: string;
            changes?: Array<{
                field: string;
                oldValue: string;
                newValue: string;
            }>;
        }>
    > {
        await this.initialize();

        try {
            const response = await this.request<{
                results: Array<{
                    number: number;
                    by: {
                        displayName: string;
                        email?: string;
                    };
                    createdAt: string;
                    changes?: Array<{
                        field: string;
                        oldValue: string;
                        newValue: string;
                    }>;
                }>;
            }>(`/content/${pageId}/history?expand=version`);

            return (response.results || []).map((item) => ({
                version: item.number,
                by: item.by,
                createdAt: item.createdAt,
                changes: item.changes,
            }));
        } catch (error) {
            this.logger.error('Error getting page history:', error);
            throw error;
        }
    }

    /**
     * Get page labels
     */
    async getPageLabels(pageId: string): Promise<
        Array<{
            prefix: string;
            name: string;
            id: string;
        }>
    > {
        await this.initialize();

        try {
            const response = await this.request<{
                results: Array<{
                    prefix: string;
                    name: string;
                    id: string;
                }>;
            }>(`/content/${pageId}/label`);

            return response.results || [];
        } catch (error) {
            this.logger.error('Error getting page labels:', error);
            throw error;
        }
    }

    /**
     * Force refresh space statistics cache
     */
    async refreshSpaceStatistics(spaceKey: string): Promise<ConfluenceSpaceStats> {
        // Clear existing cache
        const db = await DBService.getInstance();
        await db.clearConfluenceDashboardCache(spaceKey);
        this.logger.info('Cleared dashboard cache for:', spaceKey);
        // Fetch fresh statistics
        return this.getSpaceStatistics(spaceKey);
    }

    /**
     * Format multiple pages for display
     */
    formatPageList(pages: ConfluencePage[]): string {
        if (pages.length === 0) {
            return 'No pages found.';
        }

        const formatPage = (page: ConfluencePage): string => {
            const pageTable = new Table()
                .border(true)
                .padding(1);

            // Add a header row instead of using .title()
            pageTable.push([`${theme.symbols.documentation} ${theme.emphasis(page.title)}`]);
            pageTable.push(['Last Updated', formatTimestamp(page.version.createdAt)]);
            pageTable.push(['By', page.version.by.displayName]);
            pageTable.push(['Version', `v${page.version.number}`]);

            return pageTable.toString();
        };

        return [
            ...pages.map(formatPage),
            theme.dim(`\nTotal pages: ${pages.length}`),
        ].join('\n\n');
    }

    async searchContent(query: string, space?: string): Promise<
        Array<{
            id: string;
            title: string;
            space: { key: string; name: string };
            lastModified: string;
        }>
    > {
        try {
            const params = new URLSearchParams({
                cql: `text ~ "${query}"${space ? ` AND space = "${space}"` : ''}`,
                expand: 'space,version',
            });

            const response = await this.request<{
                results: Array<{
                    id: string;
                    title: string;
                    space: { key: string; name: string };
                    version: { when: string };
                }>;
            }>(`/rest/api/content/search?${params}`);

            return response.results.map((result) => ({
                id: result.id,
                title: result.title,
                space: result.space,
                lastModified: result.version.when,
            }));
        } catch (error) {
            this.logger.error('Failed to search content:', error);
            return [];
        }
    }

    async createPage(params: {
        space: string;
        title: string;
        content: string;
        parentId?: string;
    }): Promise<{
        id: string;
        title: string;
        url: string;
    }> {
        try {
            const response = await this.request<{
                id: string;
                title: string;
                _links: { webui: string };
            }>('/rest/api/content', {
                method: 'POST',
                body: JSON.stringify({
                    type: 'page',
                    space: { key: params.space },
                    title: params.title,
                    body: {
                        storage: {
                            value: params.content,
                            representation: 'storage',
                        },
                    },
                    ...(params.parentId && { ancestors: [{ id: params.parentId }] }),
                }),
            });

            return {
                id: response.id,
                title: response.title,
                url: response._links.webui,
            };
        } catch (error) {
            this.logger.error('Failed to create page:', error);
            throw error;
        }
    }
}
