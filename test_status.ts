#!/usr/bin/env -S deno run --allow-read --allow-write --allow-env --allow-net

// Test script for status service
import { StatusService } from './src/services/status_service.ts';
import { ProfileManager } from './src/config/profile_manager.ts';

const profileManager = ProfileManager.getInstance();
const statusService = new StatusService();

try {
    // Get active profile
    const activeProfile = await profileManager.getActiveProfile();
    
    if (!activeProfile) {
        console.log('No active profile found');
        Deno.exit(1);
    }
    
    console.log(`Testing status for profile: ${activeProfile.name}`);
    console.log('Config:', JSON.stringify(activeProfile.config, null, 2));
    
    // Test status
    const statuses = await statusService.getAllStatuses(activeProfile.config);
    console.log('\nStatuses found:', statuses.length);
    
    for (const status of statuses) {
        console.log(`- ${status.name}: ${status.status}`);
    }
    
    console.log('\nDisplaying status table:');
    statusService.displayStatusTable(statuses);
    
} catch (error) {
    console.error('Error:', error);
    Deno.exit(1);
}
