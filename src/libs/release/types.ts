// Version bump type
export type VersionType = 'major' | 'minor' | 'patch' | 'prerelease' | 'none';

// Commit classification result
export interface VersionClassification {
  type: VersionType;
  reason: string;
}

// Badge style options
export type BadgeStyle = 'flat' | 'flat-square' | 'plastic';
export type BadgeType = 'html' | 'md';

// Impact threshold configuration
export interface ImpactThresholds {
  low: number;
  medium: number;
  high: number;
}

/**
 * Commit info structure
 */
export interface CommitInfo {
  hash: string;
  date: string;
  message: string;
  author: string;
}

/**
 * Impact threshold configuration
 */
export interface ImpactThresholds {
  low: number;
  medium: number;
  high: number;
}

/**
 * Badge configuration
 */
export interface BadgeConfig {
  style?: BadgeStyle;
  type?: BadgeType;
  includeStatBadges?: boolean;
  includeTypeBadges?: boolean;
  includeImpactBadges?: boolean;
  impactThresholds?: ImpactThresholds;
}

/**
 * Release configuration interface
 */
export interface ReleaseConfig {
  branches: {
    main: string[];
    prerelease: string[];
  };
  prerelease: {
    enabled: boolean;
    tag: string;
  };
  tagPrefix: string;
  blockIfChangesExist: boolean;
  autoCommit: boolean;
  commitMessage: string;
  changelog: {
    enabled: boolean;
    path: string;
    badges: {
      enabled: boolean;
      style: 'flat' | 'flat-square' | 'plastic';
      type: 'html' | 'md';
      includeStatBadges: boolean;
      includeTypeBadges: boolean;
      includeImpactBadges: boolean;
    };
    includeContributors: boolean;
  };
  gitlab?: {
    enabled: boolean;
    createRelease: boolean;
    token?: string;
    projectId?: string;
  };
}

/**
 * Full nova configuration interface
 */
export interface novaConfig {
  release: ReleaseConfig;
}
