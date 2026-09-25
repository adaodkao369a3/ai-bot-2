-- Feature Toggles Schema for Bocchi
-- This migration adds support for per-guild feature enable/disable states

-- Feature toggles table
CREATE TABLE IF NOT EXISTS feature_toggles (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  guild_id TEXT NOT NULL,
  feature_name TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(guild_id, feature_name)
);

-- Index for feature toggle lookups
CREATE INDEX IF NOT EXISTS idx_feature_toggles_guild_feature ON feature_toggles(guild_id, feature_name);

-- Trigger to auto-update updated_at
CREATE TRIGGER update_feature_toggles_updated_at BEFORE UPDATE ON feature_toggles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Row Level Security (RLS) policies
ALTER TABLE feature_toggles ENABLE ROW LEVEL SECURITY;

-- Allow read access for authenticated users
CREATE POLICY "Allow read access to feature_toggles" ON feature_toggles
  FOR SELECT USING (auth.role() = 'authenticated');

-- Allow insert/update for service role (admin operations)
CREATE POLICY "Allow service role to modify feature_toggles" ON feature_toggles
  FOR ALL USING (auth.role() = 'service_role');
