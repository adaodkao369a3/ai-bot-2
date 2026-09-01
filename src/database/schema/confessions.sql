-- Confession booth database schema for Bocchi

-- Active confession session table
CREATE TABLE IF NOT EXISTS confession_sessions (
    id SERIAL PRIMARY KEY,
    guild_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    booth_channel_id TEXT NOT NULL,
    started_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    status TEXT NOT NULL DEFAULT 'active',
    confession_text TEXT,
    ended_at TIMESTAMP WITH TIME ZONE,

    CONSTRAINT confession_session_status_check
        CHECK (status IN ('active', 'ended'))
);

-- Only ONE active confession session per guild.
CREATE UNIQUE INDEX IF NOT EXISTS idx_one_active_confession_per_guild
    ON confession_sessions(guild_id)
    WHERE status = 'active';

-- Index for quick active session lookup
CREATE INDEX IF NOT EXISTS idx_confession_sessions_active
    ON confession_sessions(guild_id)
    WHERE status = 'active';


-- Completed confessions table
CREATE TABLE IF NOT EXISTS confessions (
    id SERIAL PRIMARY KEY,
    guild_id TEXT NOT NULL,
    confession_number INTEGER NOT NULL,
    confession_text TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),

    CONSTRAINT unique_confession_number
        UNIQUE (guild_id, confession_number)
);

-- Index for confession number lookup
CREATE INDEX IF NOT EXISTS idx_confessions_number
    ON confessions(guild_id, confession_number);


-- Function to get the next confession number atomically
CREATE OR REPLACE FUNCTION get_next_confession_number(p_guild_id TEXT)
RETURNS INTEGER AS $$
DECLARE
    next_num INTEGER;
BEGIN
    SELECT COALESCE(MAX(confession_number), 0) + 1
    INTO next_num
    FROM confessions
    WHERE guild_id = p_guild_id;

    RETURN next_num;
END;
$$ LANGUAGE plpgsql;
