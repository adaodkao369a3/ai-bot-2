/**
 * Validation script to verify project structure and setup
 * This can be run without actual credentials to validate the foundation
 */

import * as fs from 'fs';
import * as path from 'path';

function log(message: string, level: 'info' | 'error' = 'info'): void {
  const timestamp = new Date().toISOString();
  const prefix = level === 'error' ? '[ERROR]' : '[INFO]';
  console.log(`${timestamp} ${prefix} ${message}`);
}

export function validateProjectStructure(): boolean {
  const requiredFiles = [
    'src/index.ts',
    'src/config/index.ts',
    'src/discord/client.ts',
    'src/database/supabase.ts',
    'src/services/health.ts',
    'src/utils/env.ts',
    'src/utils/logger.ts',
    'src/utils/shutdown.ts',
    'package.json',
    'tsconfig.json',
    '.env.example',
    '.gitignore',
    'README.md'
  ];

  const missingFiles: string[] = [];

  for (const file of requiredFiles) {
    const filePath = path.join(process.cwd(), file);
    if (!fs.existsSync(filePath)) {
      missingFiles.push(file);
    }
  }

  if (missingFiles.length > 0) {
    log('Project structure validation failed', 'error');
    log(`Missing files: ${missingFiles.join(', ')}`, 'error');
    return false;
  }

  log('Project structure validation passed');
  return true;
}

export function validateEnvironmentSchema(): boolean {
  // Check that .env.example has all required variables
  const envExamplePath = path.join(process.cwd(), '.env.example');
  
  if (!fs.existsSync(envExamplePath)) {
    log('.env.example not found', 'error');
    return false;
  }

  const envExampleContent = fs.readFileSync(envExamplePath, 'utf-8');
  const requiredVars = [
    'DISCORD_TOKEN',
    'GROQ_API_KEY',
    'SUPABASE_URL',
    'SUPABASE_SERVICE_ROLE_KEY'
  ];

  const optionalVars = [
    'KLIPY_KEY',
    'YOUTUBE_API_KEY'
  ];

  const missingVars: string[] = [];

  for (const varName of requiredVars) {
    if (!envExampleContent.includes(varName)) {
      missingVars.push(varName);
    }
  }

  if (missingVars.length > 0) {
    log('Environment schema validation failed', 'error');
    log(`Missing required variables: ${missingVars.join(', ')}`, 'error');
    return false;
  }

  // Check optional vars are documented (optional, so just warn if missing)
  const missingOptionalVars: string[] = [];
  for (const varName of optionalVars) {
    if (!envExampleContent.includes(varName)) {
      missingOptionalVars.push(varName);
    }
  }

  if (missingOptionalVars.length > 0) {
    log(`Optional variables not documented: ${missingOptionalVars.join(', ')}`);
  }

  log('Environment schema validation passed');
  return true;
}

export function validateBuildOutput(): boolean {
  const distPath = path.join(process.cwd(), 'dist');
  
  if (!fs.existsSync(distPath)) {
    log('Build output directory not found', 'error');
    return false;
  }

  const requiredBuildFiles = [
    'dist/index.js',
    'dist/config/index.js',
    'dist/discord/client.js',
    'dist/database/supabase.js',
    'dist/services/health.js',
    'dist/utils/env.js',
    'dist/utils/logger.js',
    'dist/utils/shutdown.js'
  ];

  const missingBuildFiles: string[] = [];

  for (const file of requiredBuildFiles) {
    const filePath = path.join(process.cwd(), file);
    if (!fs.existsSync(filePath)) {
      missingBuildFiles.push(file);
    }
  }

  if (missingBuildFiles.length > 0) {
    log('Build output validation failed', 'error');
    log(`Missing build files: ${missingBuildFiles.join(', ')}`, 'error');
    return false;
  }

  log('Build output validation passed');
  return true;
}

export function runAllValidations(): boolean {
  log('Starting project validations...');
  
  const structureValid = validateProjectStructure();
  const envSchemaValid = validateEnvironmentSchema();
  const buildValid = validateBuildOutput();

  const allValid = structureValid && envSchemaValid && buildValid;

  if (allValid) {
    log('All validations passed');
  } else {
    log('Some validations failed', 'error');
  }

  return allValid;
}

// Run validations if this file is executed directly
if (require.main === module) {
  const success = runAllValidations();
  process.exit(success ? 0 : 1);
}
