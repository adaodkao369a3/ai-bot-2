-- GIF library for bot
-- GIFs that people post are remembered so the bot can reuse one later when it fits what it is
-- saying. Privacy: only the GIF link and a few keywords are stored. Nothing about who posted it
-- and none of the message text.
--
-- The bot works without this table (it then only remembers GIFs until it restarts), but run this
-- migration to keep them across restarts:
--   ./run-migration.sh migrations/006_gif_library.sql

CREATE TABLE IF NOT EXISTS gif_library (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  guild_id TEXT NOT NULL,
  url TEXT NOT NULL,
  url_key TEXT NOT NULL,                       -- link without query string, used to spot duplicates
  slug_words TEXT[] NOT NULL DEFAULT '{}',     -- words from the end of the link, e.g. {gojo,satoru,laugh}
  context_words TEXT[] NOT NULL DEFAULT '{}',  -- a few words typed with the GIF (weaker hints)
  times_seen INTEGER NOT NULL DEFAULT 1,
  times_used INTEGER NOT NULL DEFAULT 0,
  last_used_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(guild_id, url_key)
);

CREATE INDEX IF NOT EXISTS idx_gif_library_guild_updated ON gif_library(guild_id, updated_at DESC);

CREATE TRIGGER update_gif_library_updated_at BEFORE UPDATE ON gif_library
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Row Level Security: same policies as the other tables (the bot connects with the service role)
ALTER TABLE gif_library ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow service role to modify gif_library" ON gif_library
  FOR ALL USING (auth.role() = 'service_role');
