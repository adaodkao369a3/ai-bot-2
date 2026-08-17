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
  SUPABASE_DATABASE_URL: string;
  KLIPY_KEY?: string;
  YOUTUBE_API_KEY?: string;
}

const requiredEnvVars: (keyof EnvConfig)[] = [
  'DISCORD_TOKEN',
  'GROQ_API_KEY',
  'SUPABASE_DATABASE_URL'
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
    SUPABASE_DATABASE_URL: process.env.SUPABASE_DATABASE_URL!,
    KLIPY_KEY: process.env.KLIPY_KEY,
    YOUTUBE_API_KEY: process.env.YOUTUBE_API_KEY
  };
}

export const env = validateEnv();
