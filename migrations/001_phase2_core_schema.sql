-- Phase 2 Core Schema for Bot Kun v2
-- This migration establishes the foundation for:
-- - Global bot state (enabled/disabled)
-- - Blacklist system
-- - User profiles and memory eligibility
-- - Long-term memory storage

-- Enable UUID extension if not already enabled
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Guild settings table for bot enabled/disabled state
CREATE TABLE IF NOT EXISTS guild_settings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  guild_id TEXT NOT NULL UNIQUE,
  bot_enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Index for faster guild lookups
CREATE INDEX IF NOT EXISTS idx_guild_settings_guild_id ON guild_settings(guild_id);

-- Blacklist table for users blacklisted from Bot Kun
CREATE TABLE IF NOT EXISTS blacklist (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id TEXT NOT NULL,
  guild_id TEXT NOT NULL,
  blacklisted_by TEXT NOT NULL,
  reason TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(user_id, guild_id)
);

-- Index for blacklist lookups
CREATE INDEX IF NOT EXISTS idx_blacklist_user_guild ON blacklist(user_id, guild_id);

-- User profiles table for memory eligibility and user data
CREATE TABLE IF NOT EXISTS user_profiles (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id TEXT NOT NULL,
  guild_id TEXT NOT NULL,
  username TEXT,
  display_name TEXT,
  memory_eligible BOOLEAN NOT NULL DEFAULT false,
  extra_role_id TEXT,
  is_extra BOOLEAN NOT NULL DEFAULT false,
  is_featured_extra BOOLEAN NOT NULL DEFAULT false,
  is_supporting_cast BOOLEAN NOT NULL DEFAULT false,
  last_interaction_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(user_id, guild_id)
);

-- Index for user profile lookups
CREATE INDEX IF NOT EXISTS idx_user_profiles_user_guild ON user_profiles(user_id, guild_id);
CREATE INDEX IF NOT EXISTS idx_user_profiles_memory_eligible ON user_profiles(memory_eligible);

-- User memories table for long-term memory storage
CREATE TABLE IF NOT EXISTS user_memories (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id TEXT NOT NULL,
  guild_id TEXT NOT NULL,
  memory_content TEXT NOT NULL,
  confidence DECIMAL(3,2) NOT NULL DEFAULT 0.50, -- 0.00 to 1.00
  frequency INTEGER NOT NULL DEFAULT 1,
  source TEXT NOT NULL, -- e.g., 'conversation', 'explicit_tell', 'inference'
  last_accessed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Index for memory retrieval
CREATE INDEX IF NOT EXISTS idx_user_memories_user_guild ON user_memories(user_id, guild_id);
CREATE INDEX IF NOT EXISTS idx_user_memories_confidence ON user_memories(confidence DESC);
CREATE INDEX IF NOT EXISTS idx_user_memories_frequency ON user_memories(frequency DESC);

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';

-- Triggers to auto-update updated_at
CREATE TRIGGER update_guild_settings_updated_at BEFORE UPDATE ON guild_settings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_user_profiles_updated_at BEFORE UPDATE ON user_profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_user_memories_updated_at BEFORE UPDATE ON user_memories
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Row Level Security (RLS) policies
-- Note: These are basic policies. For production, you may want to add more specific policies.

ALTER TABLE guild_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE blacklist ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_memories ENABLE ROW LEVEL SECURITY;

-- Allow read access for authenticated users
CREATE POLICY "Allow read access to guild_settings" ON guild_settings
  FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "Allow read access to blacklist" ON blacklist
  FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "Allow read access to user_profiles" ON user_profiles
  FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "Allow read access to user_memories" ON user_memories
  FOR SELECT USING (auth.role() = 'authenticated');

-- Allow insert/update for service role (admin operations)
CREATE POLICY "Allow service role to modify guild_settings" ON guild_settings
  FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "Allow service role to modify blacklist" ON blacklist
  FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "Allow service role to modify user_profiles" ON user_profiles
  FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "Allow service role to modify user_memories" ON user_memories
  FOR ALL USING (auth.role() = 'service_role');
