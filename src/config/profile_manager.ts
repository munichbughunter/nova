import { exists } from '@std/fs/exists';
import { Config, ProfileConfig, Profiles, ProfilesSchema } from './types.ts';
import { logger } from '../utils/logger.ts';
import { colors } from '@cliffy/ansi/colors';
import { theme } from '../utils.ts';

export class ProfileManager {
    private static instance: ProfileManager;
    private profilesDir = `${Deno.env.get('HOME')}/.nova/profiles`;
    private profilesPath = `${Deno.env.get('HOME')}/.nova/profiles.json`;

    private constructor() {}

    public static getInstance(): ProfileManager {
        if (!ProfileManager.instance) {
            ProfileManager.instance = new ProfileManager();
        }
        return ProfileManager.instance;
    }

    /**
     * Ensure profiles directory exists
     */
    private async ensureProfilesDir(): Promise<void> {
        try {
            await Deno.mkdir(this.profilesDir, { recursive: true });
        } catch (error) {
            if (!(error instanceof Deno.errors.AlreadyExists)) {
                throw error;
            }
        }
    }

    /**
     * Load all profiles - with better error handling
     */
    public async loadProfiles(): Promise<Profiles> {
        await this.ensureProfilesDir();

        let profiles: Profiles;
        
        try {
            if (await exists(this.profilesPath)) {
                const content = await Deno.readTextFile(this.profilesPath);
                const parsed = JSON.parse(content);
                
                // Try to parse with schema validation
                try {
                    profiles = ProfilesSchema.parse(parsed);
                } catch (validationError) {
                    // Schema validation failed - the file is corrupted or in old format
                    logger.warn('Profile schema validation failed. Backing up and creating new profiles file.');
                    
                    // Backup the corrupted file
                    const backupPath = `${this.profilesPath}.backup.${Date.now()}`;
                    try {
                        await Deno.copyFile(this.profilesPath, backupPath);
                        logger.info(`Corrupted profiles file backed up to: ${backupPath}`);
                    } catch (backupError) {
                        logger.warn('Could not create backup of corrupted profiles file');
                    }
                    
                    // Create fresh empty profiles structure
                    profiles = {
                        active_profile: 'default',
                        profiles: {},
                    };
                    
                    // Save the fresh structure immediately
                    await this.saveProfiles(profiles);
                }
            } else {
                // Create default profile structure
                profiles = {
                    active_profile: 'default',
                    profiles: {},
                };
            }
        } catch (error) {
            logger.error('Error loading profiles:', error);
            profiles = {
                active_profile: 'default',
                profiles: {},
            };
        }

        return profiles;
    }

    /**
     * Save profiles to disk
     */
    public async saveProfiles(profiles: Profiles): Promise<void> {
        await this.ensureProfilesDir();
        
        try {
            const content = JSON.stringify(profiles, null, 2);
            await Deno.writeTextFile(this.profilesPath, content);
            logger.debug('Profiles saved successfully');
        } catch (error) {
            logger.error('Error saving profiles:', error);
            throw error;
        }
    }

    /**
     * Create a new profile
     */
    public async createProfile(name: string, config: Config, description?: string): Promise<Profiles> {
        const profiles = await this.loadProfiles();

        if (profiles.profiles[name]) {
            throw new Error(`Profile '${name}' already exists`);
        }

        const profile: ProfileConfig = {
            name,
            description: description || `Profile ${name}`,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            config,
        };

        profiles.profiles[name] = profile;
        await this.saveProfiles(profiles);
        
        logger.passThrough('log', theme.success(` Profile '${name}' created successfully`));
        return profiles; // Return the updated profiles object
    }

    /**
     * Update an existing profile
     */
    public async updateProfile(name: string, config: Config): Promise<void> {
        const profiles = await this.loadProfiles();

        if (!profiles.profiles[name]) {
            throw new Error(`Profile '${name}' does not exist`);
        }

        profiles.profiles[name].config = config;
        profiles.profiles[name].updated_at = new Date().toISOString();
        
        await this.saveProfiles(profiles);
        logger.passThrough('log', theme.success(` Profile '${name}' updated successfully`));
    }

    /**
     * Delete a profile
     */
    public async deleteProfile(name: string): Promise<void> {
        const profiles = await this.loadProfiles();

        if (!profiles.profiles[name]) {
            throw new Error(`Profile '${name}' does not exist`);
        }

        if (name === 'default') {
            throw new Error('Cannot delete the default profile');
        }

        if (profiles.active_profile === name) {
            profiles.active_profile = 'default';
        }

        delete profiles.profiles[name];
        await this.saveProfiles(profiles);
        
        logger.passThrough('log', theme.success(` Profile '${name}' deleted successfully`));
    }

    /**
     * Set active profile using existing profiles object (avoids race condition)
     */
    public async setActiveProfileWithProfiles(name: string, profiles: Profiles): Promise<void> {
        logger.debug(`Attempting to set active profile: ${name}`);
        logger.debug(`Available profiles: ${Object.keys(profiles.profiles).join(', ')}`);
        
        if (!profiles.profiles[name]) {
            logger.error(`Profile '${name}' not found in profiles object`);
            logger.debug(`Profiles object: ${JSON.stringify(profiles, null, 2)}`);
            throw new Error(`Profile '${name}' does not exist`);
        }

        profiles.active_profile = name;
        await this.saveProfiles(profiles);
        
        logger.passThrough('log', theme.success(` Active profile set to '${name}'`));
    }

    /**
     * Set active profile
     */
    public async setActiveProfile(name: string): Promise<void> {
        logger.debug(`Attempting to set active profile: ${name}`);
        const profiles = await this.loadProfiles();
        logger.debug(`Loaded profiles: ${Object.keys(profiles.profiles).join(', ')}`);

        if (!profiles.profiles[name]) {
            logger.warn(`Profile '${name}' not found, attempting reload...`);
            // Double-check by reloading from disk in case of timing issues
            const reloadedProfiles = await this.loadProfiles();
            logger.debug(`Reloaded profiles: ${Object.keys(reloadedProfiles.profiles).join(', ')}`);
            
            if (!reloadedProfiles.profiles[name]) {
                logger.error(`Profile '${name}' does not exist after reload`);
                throw new Error(`Profile '${name}' does not exist`);
            }
            
            reloadedProfiles.active_profile = name;
            await this.saveProfiles(reloadedProfiles);
        } else {
            profiles.active_profile = name;
            await this.saveProfiles(profiles);
        }
        
        logger.passThrough('log', `Active profile set to '${name}'`);
    }

    /**
     * Get active profile
     */
    public async getActiveProfile(): Promise<ProfileConfig | null> {
        const profiles = await this.loadProfiles();
        return profiles.profiles[profiles.active_profile] || null;
    }

    /**
     * Get all profile names
     */
    public async getProfileNames(): Promise<string[]> {
        const profiles = await this.loadProfiles();
        return Object.keys(profiles.profiles);
    }

    /**
     * Get specific profile
     */
    public async getProfile(name: string): Promise<ProfileConfig | null> {
        const profiles = await this.loadProfiles();
        return profiles.profiles[name] || null;
    }

    /**
     * List all profiles with details
     */
    public async listProfiles(): Promise<{ name: string; active: boolean; profile: ProfileConfig }[]> {
        const profiles = await this.loadProfiles();
        
        return Object.entries(profiles.profiles).map(([name, profile]) => ({
            name,
            active: name === profiles.active_profile,
            profile,
        }));
    }

    /**
     * Import configuration as new profile
     */
    public async importProfile(name: string, configPath: string, description?: string): Promise<void> {
        try {
            const content = await Deno.readTextFile(configPath);
            const config = JSON.parse(content) as Config;
            await this.createProfile(name, config, description);
        } catch (error) {
            throw new Error(`Failed to import profile from ${configPath}: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    /**
     * Export profile to file
     */
    public async exportProfile(name: string, outputPath: string): Promise<void> {
        const profile = await this.getProfile(name);
        
        if (!profile) {
            throw new Error(`Profile '${name}' does not exist`);
        }

        try {
            const content = JSON.stringify(profile.config, null, 2);
            await Deno.writeTextFile(outputPath, content);
            logger.passThrough('log', theme.success(` Profile '${name}' exported to ${outputPath}`));
        } catch (error) {
            throw new Error(`Failed to export profile to ${outputPath}: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    /**
     * Clone an existing profile
     */
    public async cloneProfile(sourceName: string, targetName: string, description?: string): Promise<void> {
        const sourceProfile = await this.getProfile(sourceName);
        
        if (!sourceProfile) {
            throw new Error(`Source profile '${sourceName}' does not exist`);
        }

        await this.createProfile(
            targetName, 
            sourceProfile.config, 
            description || `Cloned from ${sourceName}`
        );
    }
}