#!/usr/bin/env -S deno run --allow-env --allow-read

/**
 * Demo script for dry-run functionality
 * 
 * Usage: deno run --allow-env --allow-read src/services/dry-run-demo.ts
 */

import { DryRunProcessor, DEFAULT_DRY_RUN_OPTIONS } from './dry-run-processor.ts';
import { Logger } from '../utils/logger.ts';

async function main() {
  const logger = new Logger('DryRunDemo', true);
  const processor = new DryRunProcessor(logger);

  console.log('🚀 Dry-Run Processor Demo\n');

  // Example 1: Analyze some real files
  console.log('📋 Example 1: Analyzing real project files');
  const realFiles = [
    'src/services/sequential_processor.ts',
    'src/services/dry-run-processor.ts',
    'src/utils/logger.ts'
  ];

  const plan1 = await processor.analyzePlan(realFiles, {
    ...DEFAULT_DRY_RUN_OPTIONS,
    showProcessingOrder: true
  });

  processor.showPlan(plan1);

  // Example 2: Mixed valid and invalid files
  console.log('\n📋 Example 2: Mixed valid and invalid files');
  const mixedFiles = [
    'src/services/sequential_processor.ts',
    'non-existent-file.ts',
    'src/utils/logger.ts',
    'another-missing-file.ts'
  ];

  const plan2 = await processor.analyzePlan(mixedFiles, {
    ...DEFAULT_DRY_RUN_OPTIONS,
    showFileDetails: true,
    estimateTime: true
  });

  processor.showPlan(plan2);

  // Example 3: File validation
  console.log('\n📋 Example 3: File validation');
  const validation = await processor.validateFiles(mixedFiles);
  
  console.log(`✅ Valid files: ${validation.valid.length}`);
  validation.valid.forEach(file => console.log(`   • ${file}`));
  
  console.log(`❌ Invalid files: ${validation.invalid.length}`);
  validation.invalid.forEach(({ file, reason }) => console.log(`   • ${file} (${reason})`));

  // Example 4: Time estimates
  console.log('\n📋 Example 4: Processing time estimates');
  const estimates = await processor.getTimeEstimates(validation.valid);
  
  console.log('⏱️  Time estimates:');
  for (const [file, time] of estimates) {
    console.log(`   • ${file}: ${time}ms`);
  }

  console.log('\n✨ Demo completed!');
}

if (import.meta.main) {
  await main();
}