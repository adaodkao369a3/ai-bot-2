-- Channel restrictions for Bot Kun v2
-- Allows restricting bot to specific channels per guild

CREATE TABLE IF NOT EXISTS channel_restrictions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  guild_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(guild_id, channel_id)
);

-- Index for fast lookups
CREATE INDEX IF NOT EXISTS idx_channel_restrictions_guild_id ON channel_restrictions(guild_id);
CREATE INDEX IF NOT EXISTS idx_channel_restrictions_channel_id ON channel_restrictions(channel_id);

-- Trigger to auto-update updated_at (though we don't have updated_at, adding for consistency)
CREATE TRIGGER update_channel_restrictions_updated_at BEFORE UPDATE ON channel_restrictions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- RLS policies
ALTER TABLE channel_restrictions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow read access to channel_restrictions" ON channel_restrictions
  FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "Allow service role to modify channel_restrictions" ON channel_restrictions
  FOR ALL USING (auth.role() = 'service_role');
