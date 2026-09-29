-- Personality Selection Schema for Bocchi
-- This migration adds support for per-guild personality selection with avatar tracking

-- Personality selection table
CREATE TABLE IF NOT EXISTS personality_selection (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  guild_id TEXT NOT NULL UNIQUE,
  personality_id TEXT NOT NULL,
  selected_avatar_filename TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Index for personality selection lookups
CREATE INDEX IF NOT EXISTS idx_personality_selection_guild_id ON personality_selection(guild_id);

-- Trigger to auto-update updated_at
-- Note: update_updated_at_column() function already exists from migration 001
CREATE TRIGGER update_personality_selection_updated_at BEFORE UPDATE ON personality_selection
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Row Level Security (RLS) policies
ALTER TABLE personality_selection ENABLE ROW LEVEL SECURITY;

-- Allow read access for authenticated users
CREATE POLICY "Allow read access to personality_selection" ON personality_selection
  FOR SELECT USING (auth.role() = 'authenticated');

-- Allow insert/update for service role (admin operations)
CREATE POLICY "Allow service role to modify personality_selection" ON personality_selection
  FOR ALL USING (auth.role() = 'service_role');