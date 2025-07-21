#!/usr/bin/env -S deno run --allow-all

import { createProgressRenderer, FileStatus } from './index.ts';

/**
 * Demo script to showcase the terminal progress renderer
 */
async function demo() {
  const files = [
    'src/components/Button.tsx',
    'src/components/Modal.tsx',
    'src/services/api/userService.ts',
    'src/services/api/authService.ts',
    'src/utils/helpers.ts',
    'src/utils/validation.ts',
    'src/pages/Dashboard.tsx',
    'src/pages/Profile.tsx',
    'src/hooks/useAuth.ts',
    'src/hooks/useLocalStorage.ts'
  ];

  const renderer = createProgressRenderer({
    width: 40,
    showPercentage: true,
    showFileCount: true,
    showCurrentFile: true
  });

  console.log('🚀 Starting file analysis demo...\n');
  
  renderer.start(files.length);

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    
    // Update progress to show current file
    renderer.updateProgress(file, i, files.length);
    
    // Simulate processing time
    await new Promise(resolve => setTimeout(resolve, 800));
    
    // Simulate different outcomes
    const random = Math.random();
    let status: FileStatus;
    
    if (random < 0.1) {
      status = FileStatus.ERROR;
      renderer.error(file, 'Syntax error detected');
    } else if (random < 0.2) {
      status = FileStatus.WARNING;
    } else {
      status = FileStatus.SUCCESS;
    }
    
    renderer.updateFileStatus(file, status);
    
    // Brief pause to show status
    await new Promise(resolve => setTimeout(resolve, 200));
  }

  // Final update to show completion
  renderer.updateProgress(files[files.length - 1], files.length, files.length);
  
  // Complete the progress display
  renderer.complete();
  
  console.log('\n✅ Analysis complete!');
  console.log(`📊 Processed ${files.length} files`);
}

if (import.meta.main) {
  demo().catch(console.error);
}