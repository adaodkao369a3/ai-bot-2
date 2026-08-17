/**
 * Supabase database connection for Bot Kun v2
 * Establishes clean database connection for future feature support
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { logger } from '../utils/logger';

let supabaseClient: SupabaseClient | null = null;

export function createSupabaseClient(supabaseUrl: string, anonKey: string): SupabaseClient {
  if (supabaseClient) {
    logger.warn('Supabase client already initialized, returning existing instance');
    return supabaseClient;
  }

  try {
    logger.info('Initializing Supabase client...');
    supabaseClient = createClient(supabaseUrl, anonKey);
    logger.info('Supabase client initialized successfully');
    return supabaseClient;
  } catch (error) {
    logger.error('Failed to initialize Supabase client', { 
      error: error instanceof Error ? error.message : String(error) 
    });
    throw error;
  }
}

export function getSupabaseClient(): SupabaseClient {
  if (!supabaseClient) {
    throw new Error('Supabase client not initialized. Call createSupabaseClient first.');
  }
  return supabaseClient;
}

export async function testSupabaseConnection(client: SupabaseClient): Promise<boolean> {
  try {
    logger.info('Testing Supabase connection...');
    
    // Simple health check - we'll do a basic query to verify connectivity
    // In Phase 2, this will be replaced with proper table queries
    const { error } = await client.from('_test_connection_').select('*').limit(1);
    
    // We expect this to fail since the table doesn't exist yet,
    // but it proves the connection works
    if (error && error.code !== 'PGRST116') {
      // PGRST116 = relation not found, which is expected
      throw error;
    }
    
    logger.info('Supabase connection test successful');
    return true;
  } catch (error) {
    logger.error('Supabase connection test failed', { 
      error: error instanceof Error ? error.message : String(error) 
    });
    return false;
  }
}

export async function disconnectSupabase(): Promise<void> {
  // Supabase JS client doesn't have an explicit disconnect method
  // We just clear the reference for cleanup
  if (supabaseClient) {
    logger.info('Clearing Supabase client reference...');
    supabaseClient = null;
    logger.info('Supabase client reference cleared');
  }
}

// Database schema will be defined in migrations during Phase 2
// Future tables will include:
// - guild_settings (Bot Kun enabled/disabled state per guild)
// - blacklist (users/guilds blacklisted from Bot Kun)
// - user_profiles (user-specific data)
// - user_memories (Bot Kun's memory of users)
// - conversations (conversation history)
// - interaction_tracking (rate limiting and interaction history)
