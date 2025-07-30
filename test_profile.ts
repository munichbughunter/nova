import { ProfileManager } from './src/config/profile_manager.ts';

const manager = ProfileManager.getInstance();

const config = {
    ai: {
        default_provider: 'openai' as const,
    },
};

console.log('Creating profile...');
const profiles = await manager.createProfile('test', config, 'Test profile');
console.log('Profile created:', Object.keys(profiles.profiles));

console.log('Setting active profile...');
await manager.setActiveProfile('test');
console.log('Profile activated');

console.log('Getting active profile...');
const active = await manager.getActiveProfile();
console.log('Active profile name:', active?.name);
