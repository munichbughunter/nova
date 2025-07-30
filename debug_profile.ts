#!/usr/bin/env -S deno run --allow-read --allow-write --allow-env

// Simple debug script to test profile functionality
import { ProfileManager } from './src/config/profile_manager.ts';
import { Logger } from './src/utils/logger.ts';

const logger = new Logger('Debug', true);

async function debugProfile() {
    const profileManager = ProfileManager.getInstance();
    
    try {
        logger.info('=== Creating test profile ===');
        const config = {
            ai: {
                default_provider: 'openai' as const,
            },
        };
        
        const profiles = await profileManager.createProfile('test-profile', config, 'Test profile');
        logger.info('Profile created successfully:', profiles);
        
        logger.info('=== Attempting to activate profile ===');
        await profileManager.setActiveProfile('test-profile');
        logger.info('Profile activated successfully');
        
        logger.info('=== Getting active profile ===');
        const activeProfile = await profileManager.getActiveProfile();
        logger.info('Active profile:', activeProfile);
        
    } catch (error) {
        logger.error('Error:', error);
    }
}

if (import.meta.main) {
    await debugProfile();
}
