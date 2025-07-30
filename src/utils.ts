import { colors } from '@cliffy/ansi/colors';
import { Temporal } from 'npm:@js-temporal/polyfill';
import { logger } from './utils/logger.ts';
// Theme definition
export const theme = {
    // Headers and titles
    header: colors.bold.blue,
    subheader: colors.bold.cyan,
    title: colors.bold.underline,

    // Status indicators
    success: colors.bold.green,
    warning: colors.bold.yellow,
    error: colors.bold.red,
    info: colors.bold.blue,

    // Progress indicators
    progress: colors.cyan,
    done: colors.green,

    // Health status
    healthGood: colors.green,
    healthWarning: colors.yellow,
    healthBad: colors.red,

    // Text styles
    emphasis: colors.bold.white,
    subtle: colors.dim,
    highlight: colors.bold.underline,
    dim: colors.dim,
    muted: colors.dim.gray,

    // Status symbols and emojis (unified from all files)
    symbols: {
        // Status indicators
        success: '✅',
        warning: '⚠️',
        error: '❌',
        info: 'ℹ️',

        // Progress indicators
        bullet: '•',
        progress: '🔄',
        loading: '⌛️',

        // Setup and configuration
        setup: '🛠',
        config: '⚙️',
        new: '🆕',
        update: '🔄',
        configured: '✨',

        // Actions
        check: '🔍',
        run: '🚀',
        download: '📥',

        // Metrics and analysis
        metrics: '📊',
        quality: '🔎',
        performance: '🚀',
        analyze: '🔍',

        // Development
        review: '👨‍💻',
        code: '👨‍💻',
        test: '🧪',
        bug: '🐞',

        // Project management
        documentation: '📝',
        feature: '🌟',
        improvement: '📊',
        report: '📋',
        project: '📱',
        team: '👥',
        time: '⏰',
        deploy: '🚀',
        insight: '💡',

        // Security
        security: '🔐',

        // Status levels
        strength: '💪',
        weakness: '🎯',
        recommendation: '💭',
        action: '✨',
        success_celebration: '🎉',

        // Priority levels
        priority: {
            high: '🔴',
            medium: '🟡',
            low: '🟢',
        },

        // Service status
        service: {
            open: '🔴',
            acknowledged: '🟡',
            closed: '✅',
            unknown: '⚪',
        },

        status: {
            error: '🔴',
            warning: '🟡',
            success: '✅',
            neutral: '⚪',
        },
    },
} as const;

// Helper functions for formatting
export const getHealthColor = (score: number) => {
    if (score >= 8) return theme.healthGood;
    if (score >= 6) return theme.healthWarning;
    return theme.healthBad;
};

export const formatList = (items: string[], symbol = theme.symbols.bullet) =>
    items.map((item) => `  ${theme.emphasis(symbol)} ${item}`).join('\n');

export const formatProgress = (message: string) =>
    logger.passThrough('log', theme.progress(`${theme.symbols.loading} ${message}`));

export const formatSuccess = (message: string) =>
    logger.passThrough('log', theme.done(`${theme.symbols.success} ${message}`));

export const formatError = (message: string) =>
    logger.passThrough('log', theme.error(`${theme.symbols.error} ${message}`));

export const formatInfo = (message: string) =>
    logger.passThrough('log', theme.info(`${theme.symbols.info} ${message}`));

export const formatWarning = (message: string) =>
    logger.passThrough('log', theme.warning(`${theme.symbols.warning} ${message}`));

export const formatDim = (message: string) => logger.passThrough('log', theme.dim(message));

export const getTerminalWidth = () => {
    try {
        const { columns } = Deno.consoleSize();
        return columns;
    } catch {
        return 80;
    }
};

// Box drawing characters for consistent UI
export const box = {
    topLeft: '╭',
    topRight: '╮',
    bottomLeft: '╰',
    bottomRight: '╯',
    horizontal: '─',
    vertical: '│',
    verticalRight: '├',
    verticalLeft: '┤',
    horizontalDown: '┬',
    horizontalUp: '┴',
    cross: '┼',
};

// Common formatting utilities
export const formatBox = (content: string, width = getTerminalWidth() - 4): string => {
    const lines = content.split('\n');
    const horizontalLine = box.horizontal.repeat(width);

    return `${box.topLeft}${horizontalLine}
${lines.map((line) => `${box.vertical} ${line}`).join('\n')}
${box.bottomLeft}${horizontalLine}`;
};

export const formatMetric = (label: string, value: string | number): string =>
    `${label.padEnd(25)} ${value}`;

export const formatSection = (title: string, content: string): string =>
    `${theme.emphasis(title)}
${content}`;

export const formatSectionWithSpacing = (title: string, content: string): string =>
    `\n${theme.emphasis(title)}
${content}\n`;

export const formatServiceStatus = (status: string): string => {
    switch (status.toLowerCase()) {
        case 'error':
        case 'critical':
        case 'failed':
            return colors.red(theme.symbols.status.error + ' ' + status);
        case 'warning':
        case 'needs improvement':
            return colors.yellow(theme.symbols.status.warning + ' ' + status);
        case 'success':
        case 'good':
        case 'excellent':
            return colors.green(theme.symbols.status.success + ' ' + status);
        default:
            return colors.white(theme.symbols.status.neutral + ' ' + status);
    }
};

export const formatTimestamp = (date: string | Date): string => {
    const d = typeof date === 'string' ? new Date(date) : date;
    return d?.toLocaleString() || 'N/A';
};

export const formatDuration = (hours: number): string => {
    if (hours < 1) {
        return `${Math.round(hours * 60)} minutes`;
    }
    if (hours < 24) {
        return `${hours.toFixed(1)} hours`;
    }
    const days = Math.floor(hours / 24);
    const weeks = Math.floor(days / 7);
    const remainingDays = days % 7;

    if (weeks > 0) {
        return remainingDays > 0 ? `${weeks}w ${remainingDays}d` : `${weeks}w`;
    }
    return `${days}d`;
};

/**
 * Format trend value with color and arrow
 */
export const formatTrendValue = (value: number, isPositive: boolean): string => {
    if (value === 0) return colors.blue('●');
    const arrow = value > 0 ? '▲' : '▼';
    const color = (value > 0) === isPositive ? colors.green : colors.red;
    return color(`${arrow} ${Math.abs(value).toFixed(1)}%`);
};

export const formatMetricsTable = (metrics: Record<string, unknown>, title: string): string => {
    const formatValue = (value: unknown): string => {
        if (typeof value === 'number') {
            if (value % 1 === 0) return value.toString();
            return value.toFixed(2);
        }
        return String(value);
    };

    const lines = Object.entries(metrics)
        .map(([key, value]) => {
            // Add extra spacing if key starts with newline
            if (key.startsWith('\n')) {
                const cleanKey = key.substring(1);
                const label = cleanKey
                    .split('_')
                    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
                    .join(' ');
                return `\n${formatMetric(label, formatValue(value))}`;
            }

            const label = key
                .split('_')
                .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
                .join(' ');

            // Handle multi-line values
            const formattedValue = formatValue(value);
            if (formattedValue.includes('\n')) {
                const valueLines = formattedValue.split('\n');
                return valueLines.map((line, i) =>
                    i === 0 ? formatMetric(label, line) : formatMetric('', line)
                ).join('\n');
            }

            return formatMetric(label, formattedValue);
        })
        .join('\n');

    return title ? formatSection(title, lines) : lines;
};

export class ProgressIndicator {
    private static progressChars = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
    private progressIndex = 0;
    private interval?: number;
    private encoder = new TextEncoder();

    start(message: string, intervalMs = 80) {
        this.interval = setInterval(() => {
            const char = ProgressIndicator.progressChars[this.progressIndex];
            Deno.stdout.writeSync(
                this.encoder.encode(`\r${char} ${message}`),
            );
            this.progressIndex = (this.progressIndex + 1) % ProgressIndicator.progressChars.length;
        }, intervalMs);
    }

    stop() {
        if (this.interval) {
            clearInterval(this.interval);
            this.interval = undefined;
            // Clear the line
            Deno.stdout.writeSync(
                this.encoder.encode(
                    '\r                                                              \r',
                ),
            );
        }
    }

    update(message: string) {
        // Clear the current line and move cursor to beginning
        Deno.stdout.writeSync(
            this.encoder.encode('\x1b[2K\r'),
        );
        // Write the new message
        Deno.stdout.writeSync(
            this.encoder.encode(
                `${ProgressIndicator.progressChars[this.progressIndex]} ${message}`,
            ),
        );
    }
}

export class FileAnalysisProgress {
    private totalFiles: number;
    private currentFile: number;
    private progressIndicator: ProgressIndicator;

    constructor(totalFiles: number) {
        this.totalFiles = totalFiles;
        this.currentFile = 0;
        this.progressIndicator = new ProgressIndicator();
    }

    start() {
        this.progressIndicator.start(`Analyzing files (0/${this.totalFiles})`);
    }

    incrementFile() {
        this.currentFile++;
        this.progressIndicator.update(`Analyzing files (${this.currentFile}/${this.totalFiles})`);
    }

    stop() {
        this.progressIndicator.stop();
    }
}

export const formatTableRow = (label: string, value: string | number): string =>
    `├─────────────────────────┬────────────────────────────────────────┤\n│ ${
        label.padEnd(23)
    } │ ${String(value).padEnd(36)}│`;

export const formatTableHeader = (text: string): string => `${box.vertical} ${text}`;

export const formatTableSection = (title: string, rows: [string, string | number][]): string => {
    const formattedRows = rows.map(([label, value]) => {
        return `${label}: ${value}`;
    }).join('\n');
    return formatSection(title, formattedRows);
};

export const formatMetricsBox = (title: string, sections: string[]): string => {
    return formatBox([
        title,
        `${box.verticalRight}${box.horizontal.repeat(60)}`,
        ...sections,
    ].join('\n'));
};

export const formatTrendChart = (
    values: number[],
    height = 5,
    showPercentages = true,
    timeLabels?: string[],
): string => {
    if (!values || values.length === 0) return 'No trend data available';

    const max = Math.max(...values);
    const min = Math.min(...values);
    const range = max - min || 1; // Avoid division by zero

    // Define grayscale blocks for different intensities
    const blocks = {
        full: '█',
        high: '▓',
        medium: '▒',
        low: '░',
        empty: ' ',
    };

    // Calculate column width for better alignment
    const maxLabelWidth = timeLabels ? Math.max(...timeLabels.map((l) => l.length)) : 3;
    const columnWidth = Math.max(maxLabelWidth + 2, 5);

    // Draw chart from top to bottom
    const chart: string[] = [];
    for (let i = 0; i < height; i++) {
        const threshold = max - (range * (i / (height - 1)));
        const percentage = showPercentages ? `${Math.round(threshold)}%`.padStart(4) : '';
        let line = `${percentage} `;

        values.forEach((value) => {
            // Calculate how "filled" this column should be at this height
            const intensity = (value - threshold) / (range / height);
            let block;

            if (value >= threshold) {
                if (intensity >= 0.75) block = blocks.full.repeat(3);
                else if (intensity >= 0.5) block = blocks.high.repeat(3);
                else if (intensity >= 0.25) block = blocks.medium.repeat(3);
                else block = blocks.low.repeat(3);
            } else {
                block = blocks.empty.repeat(3);
            }

            // Add extra spacing between columns for readability
            line += block.padEnd(columnWidth);
        });
        chart.push(line);
    }

    // Add time labels with proper alignment
    if (timeLabels && timeLabels.length === values.length) {
        const alignedLabels = timeLabels.map((label) => label.padEnd(columnWidth)).join('');
        chart.push('    ' + alignedLabels);
    } else {
        const defaultLabels = ['4w', '3w', '2w', '1w', 'Now'];
        const alignedLabels = defaultLabels.map((label) => label.padEnd(columnWidth)).join('');
        chart.push('    ' + alignedLabels);
    }

    return chart.join('\n');
};

// Add this helper function before the GitLabService class
export function formatTimeAgo(date: Date): string {
    const now = Temporal.Now.instant();
    const then = Temporal.Instant.fromEpochMilliseconds(date.getTime());
    const duration = now.since(then);

    if (duration.years > 0) {
        return `${duration.years}y ago`;
    } else if (duration.months > 0) {
        return `${duration.months}mo ago`;
    } else if (duration.days > 0) {
        return `${duration.days}d ago`;
    } else if (duration.hours > 0) {
        return `${duration.hours}h ago`;
    } else if (duration.minutes > 0) {
        return `${duration.minutes}m ago`;
    } else {
        return 'just now';
    }
}

// Jira-specific formatting utilities
export const formatProgressBar = (progress: number): string => {
    const width = 20;
    const filled = Math.round(progress * width);
    const empty = width - filled;
    return '█'.repeat(filled) + '░'.repeat(empty);
};

export const formatVelocityTrend = (trend: number[]): string[][] => {
    const max = Math.max(...trend);
    const min = Math.min(...trend);
    const range = max - min;
    const height = 8;

    return trend.map((value) => {
        const normalized = range === 0 ? 0 : ((value - min) / range) * height;
        const bar = '█'.repeat(Math.round(normalized)) +
            '░'.repeat(height - Math.round(normalized));
        return [`${value.toFixed(1)} ${bar}`, ''];
    });
};

export const formatCompletionTrend = (trend: number[]): string[][] => {
    const max = 100;
    const min = 0;
    const height = 8;

    return trend.map((value) => {
        const normalized = ((value - min) / (max - min)) * height;
        const bar = '█'.repeat(Math.round(normalized)) +
            '░'.repeat(height - Math.round(normalized));
        return [`${value.toFixed(1)}% ${bar}`, ''];
    });
};

export const getCompletionRateIndicator = (rate: number): string => {
    if (rate >= 0.9) return '✅ Good';
    if (rate >= 0.8) return '⚠️ Needs Improvement';
    return '❌ Off track';
};

export const getHealthIndicator = (score: number | null): string => {
    if (score === null) return `${theme.symbols.status.neutral} No data`;
    if (score >= 8) return `${theme.symbols.status.success} Healthy (${score.toFixed(1)}/10)`;
    if (score >= 6) return `${theme.symbols.status.warning} Fair (${score.toFixed(1)}/10)`;
    return `${theme.symbols.status.error} At Risk (${score.toFixed(1)}/10)`;
};

export const getTrendIndicator = (trend: number[]): string => {
    if (trend.length < 2) return `${theme.symbols.status.neutral} No data`;

    const change = trend[trend.length - 1] - trend[trend.length - 2];
    const percentChange = (change / trend[trend.length - 2]) * 100;

    if (Math.abs(percentChange) < 5) return `${theme.symbols.status.neutral} Stable`;
    if (percentChange > 0) {
        return `${theme.symbols.status.success} Improving (+${percentChange.toFixed(1)}%)`;
    }
    return `${theme.symbols.status.warning} Declining (${percentChange.toFixed(1)}%)`;
};

export const getCycleTimeTrendIndicator = (
    cycleTime: { mean: number; median: number; distribution: { p75: number; p90: number } },
): string => {
    const p75ToMedianRatio = cycleTime.distribution.p75 / cycleTime.median;
    const p90ToMedianRatio = cycleTime.distribution.p90 / cycleTime.median;

    if (p90ToMedianRatio > 3) return '❌ Very unpredictable';
    if (p90ToMedianRatio > 2) return '⚠️ Unpredictable';
    if (p75ToMedianRatio > 1.5) return '⚠️ Somewhat unpredictable';
    return '✅ Predictable';
};

export const getStatusEmoji = (statusCategory: string): string => {
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
};

export const getDaysAgo = (date: Date | string | undefined): number => {
    if (!date) return 0;

    const targetDate = typeof date === 'string' ? new Date(date) : date;
    if (isNaN(targetDate.getTime())) return 0;

    const now = new Date();
    const diffTime = Math.abs(now.getTime() - targetDate.getTime());
    return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
};

/**
 * Format a date to a consistent format for tests and other outputs
 * This ensures snapshot tests don't fail due to locale differences
 *
 * @param date The date to format
 * @returns A consistently formatted date string
 */
export function formatLocaleDate(date: Date | string | number): string {
    const dateObj = date instanceof Date ? date : new Date(date);

    // Format: MM/DD/YYYY, hh:mm:ss AM/PM
    return dateObj.toLocaleDateString('en-US', {
        month: 'numeric',
        day: 'numeric',
        year: 'numeric',
    }) + (dateObj.getHours() || dateObj.getMinutes() || dateObj.getSeconds()
        ? ', ' + dateObj.toLocaleTimeString('en-US', {
            hour: 'numeric',
            minute: '2-digit',
            second: '2-digit',
            hour12: true,
        })
        : '');
}
