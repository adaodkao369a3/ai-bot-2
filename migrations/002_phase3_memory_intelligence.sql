-- Phase 3 Memory Intelligence Schema for Bot Kun v2
-- This migration adds fields for advanced memory management:
-- - Memory type categorization
-- - Normalized content for duplicate detection
-- - Confirmation tracking for confidence scoring
-- - Active state for soft deletion

-- Add memory_type column to categorize memories
ALTER TABLE user_memories 
ADD COLUMN IF NOT EXISTS memory_type TEXT DEFAULT 'other';

-- Add normalized_content column for duplicate/similar memory detection
ALTER TABLE user_memories 
ADD COLUMN IF NOT EXISTS normalized_content TEXT;

-- Add confirmation_count to track independent confirmations
ALTER TABLE user_memories 
ADD COLUMN IF NOT EXISTS confirmation_count INTEGER NOT NULL DEFAULT 1;

-- Add first_observed_at to track when memory was first noticed
ALTER TABLE user_memories 
ADD COLUMN IF NOT EXISTS first_observed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();

-- Add is_active for soft deletion without losing history
ALTER TABLE user_memories 
ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true;

-- Create index on memory_type for filtering
CREATE INDEX IF NOT EXISTS idx_user_memories_type ON user_memories(memory_type);

-- Create index on normalized_content for duplicate detection
CREATE INDEX IF NOT EXISTS idx_user_memories_normalized ON user_memories(normalized_content);

-- Create index on is_active for filtering active memories
CREATE INDEX IF NOT EXISTS idx_user_memories_active ON user_memories(is_active);

-- Create index on confirmation_count for confidence scoring
CREATE INDEX IF NOT EXISTS idx_user_memories_confirmation ON user_memories(confirmation_count DESC);

-- Update existing records to set first_observed_at from created_at
UPDATE user_memories 
SET first_observed_at = created_at 
WHERE first_observed_at IS NULL OR first_observed_at > created_at;

-- Add check constraint for memory_type values
ALTER TABLE user_memories 
ADD CONSTRAINT check_memory_type 
CHECK (memory_type IN ('preference', 'interest', 'hobby', 'identity', 'relationship', 'project', 'habit', 'dislike', 'other'));

-- Add check constraint for confidence range
ALTER TABLE user_memories 
ADD CONSTRAINT check_confidence_range 
CHECK (confidence >= 0.00 AND confidence <= 1.00);

-- Add check constraint for confirmation_count
ALTER TABLE user_memories 
ADD CONSTRAINT check_confirmation_count 
CHECK (confirmation_count >= 1);
