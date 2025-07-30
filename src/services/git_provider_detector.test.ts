import { assertEquals } from '@std/assert';
import { GitProviderDetector } from './git_provider_detector.ts';

Deno.test('GitProviderDetector - parseRemoteUrl', async (t) => {
    await t.step('should detect GitHub.com HTTPS URL', () => {
        const result = GitProviderDetector.parseRemoteUrl('https://github.com/owner/repo.git');
        assertEquals(result.provider, 'github');
        assertEquals(result.host, 'github.com');
        assertEquals(result.owner, 'owner');
        assertEquals(result.repository, 'repo');
        assertEquals(result.isEnterprise, false);
    });

    await t.step('should detect GitHub.com SSH URL', () => {
        const result = GitProviderDetector.parseRemoteUrl('git@github.com:owner/repo.git');
        assertEquals(result.provider, 'github');
        assertEquals(result.host, 'github.com');
        assertEquals(result.owner, 'owner');
        assertEquals(result.repository, 'repo');
        assertEquals(result.isEnterprise, false);
    });

    await t.step('should detect GitLab.com HTTPS URL', () => {
        const result = GitProviderDetector.parseRemoteUrl('https://gitlab.com/group/project.git');
        assertEquals(result.provider, 'gitlab');
        assertEquals(result.host, 'gitlab.com');
        assertEquals(result.owner, 'group');
        assertEquals(result.repository, 'project');
        assertEquals(result.isEnterprise, false);
    });

    await t.step('should detect GitLab.com SSH URL', () => {
        const result = GitProviderDetector.parseRemoteUrl('git@gitlab.com:group/project.git');
        assertEquals(result.provider, 'gitlab');
        assertEquals(result.host, 'gitlab.com');
        assertEquals(result.owner, 'group');
        assertEquals(result.repository, 'project');
        assertEquals(result.isEnterprise, false);
    });

    await t.step('should detect GitHub Enterprise', () => {
        const result = GitProviderDetector.parseRemoteUrl(
            'https://github.enterprise.com/owner/repo.git',
        );
        assertEquals(result.provider, 'github');
        assertEquals(result.host, 'github.enterprise.com');
        assertEquals(result.owner, 'owner');
        assertEquals(result.repository, 'repo');
        assertEquals(result.isEnterprise, true);
    });

    await t.step('should detect self-hosted GitLab', () => {
        const result = GitProviderDetector.parseRemoteUrl(
            'https://gitlab.company.com/group/project.git',
        );
        assertEquals(result.provider, 'gitlab');
        assertEquals(result.host, 'gitlab.company.com');
        assertEquals(result.owner, 'group');
        assertEquals(result.repository, 'project');
        assertEquals(result.isEnterprise, true);
    });

    await t.step('should handle URLs without .git suffix', () => {
        const result = GitProviderDetector.parseRemoteUrl('https://github.com/owner/repo');
        assertEquals(result.provider, 'github');
        assertEquals(result.host, 'github.com');
        assertEquals(result.owner, 'owner');
        assertEquals(result.repository, 'repo');
    });

    await t.step('should return unknown for invalid URLs', () => {
        const result = GitProviderDetector.parseRemoteUrl('invalid-url');
        assertEquals(result.provider, 'unknown');
    });

    await t.step('should return unknown for URLs with insufficient path parts', () => {
        const result = GitProviderDetector.parseRemoteUrl('https://github.com/owner');
        assertEquals(result.provider, 'unknown');
    });

    await t.step('should parse GitHub SSH URL from git config', () => {
        const config = `[core]
    repositoryformatversion = 0
[remote "origin"]
    url = git@github.com:munichbughunter/nova.git
    fetch = +refs/heads/*:refs/remotes/origin/*
[branch "main"]
    remote = origin
    merge = refs/heads/main`;

        const result = GitProviderDetector.parseRemoteUrl(
            'git@github.com:munichbughunter/nova.git',
        );
        assertEquals(result.provider, 'github');
        assertEquals(result.host, 'github.com');
        assertEquals(result.owner, 'munichbughunter');
        assertEquals(result.repository, 'nova');
        assertEquals(result.isEnterprise, false);
    });

    await t.step('should parse GitLab SSH URL from git config', () => {
        const config = `[core]
    repositoryformatversion = 0
[remote "origin"]
    url = git@gitlab.p7s1.io:homebrew/joyia-cli.git
    fetch = +refs/heads/*:refs/remotes/origin/*`;

        const result = GitProviderDetector.parseRemoteUrl(
            'git@gitlab.p7s1.io:homebrew/joyia-cli.git',
        );
        assertEquals(result.provider, 'gitlab');
        assertEquals(result.host, 'gitlab.p7s1.io');
        assertEquals(result.owner, 'homebrew');
        assertEquals(result.repository, 'joyia-cli');
        assertEquals(result.isEnterprise, true);
    });
});
