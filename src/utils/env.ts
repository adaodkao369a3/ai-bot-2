/**
 * Environment variable validation
 * Ensures all required environment variables are present at startup
 */

import dotenv from 'dotenv';

// Load environment variables from .env file
dotenv.config();

interface EnvConfig {
  DISCORD_TOKEN: string;
  GROQ_API_KEY: string;
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  KLIPY_KEY?: string;
  YOUTUBE_API_KEY?: string;
}

const requiredEnvVars: (keyof EnvConfig)[] = [
  'DISCORD_TOKEN',
  'GROQ_API_KEY',
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY'
];

export function validateEnv(): EnvConfig {
  const missing: string[] = [];

  for (const envVar of requiredEnvVars) {
    if (!process.env[envVar]) {
      missing.push(envVar);
    }
  }

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(', ')}\n` +
      'Please set these in your .env file or environment.'
    );
  }

  return {
    DISCORD_TOKEN: process.env.DISCORD_TOKEN!,
    GROQ_API_KEY: process.env.GROQ_API_KEY!,
    SUPABASE_URL: process.env.SUPABASE_URL!,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY!,
    KLIPY_KEY: process.env.KLIPY_KEY,
    YOUTUBE_API_KEY: process.env.YOUTUBE_API_KEY
  };
}

export const env = validateEnv();
