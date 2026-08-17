# Bot Kun Database Reset Procedure

## Overview
This document describes the procedure for resetting the Bot Kun database to a clean production baseline. Since the actual database access was not available during this audit, this procedure should be followed when database access is available.

## Pre-Reset Audit Steps

### 1. Inspect Current Database State
Before making any changes, inspect the connected Supabase project/database to determine:

- All tables and their columns
- Data types, primary keys, indexes
- Unique constraints, check constraints, foreign keys
- RLS enabled/disabled state and RLS policies
- Triggers and functions relevant to Bot Kun
- Views relevant to Bot Kun
- Migration history if available
- Row counts for each table
- Whether migrations 001_phase2_core_schema.sql and 002_phase3_memory_intelligence.sql are applied

### 2. Categorize Database Objects
Categorize objects/data as:
1. **Legacy Bot Kun** - Old bot versions that should be removed
2. **Phase 2 Bot Kun** - Current core schema that should be preserved
3. **Phase 3 Bot Kun** - Memory intelligence features that should be preserved
4. **Unrelated data** - Data from other applications that must be protected

## Reset Procedure

### Phase 1: Backup Current State
```sql
-- Create backup of current state
-- This should be done through Supabase dashboard or pg_dump
```

### Phase 2: Remove Obsolete Bot Kun Data
```sql
-- Remove stale legacy users
DELETE FROM user_profiles WHERE last_interaction_at < NOW() - INTERVAL '90 days';

-- Remove stale legacy memories  
DELETE FROM user_memories WHERE last_accessed_at < NOW() - INTERVAL '90 days';

-- Remove stale guild settings (optional - keep if guild preferences should persist)
-- DELETE FROM guild_settings WHERE updated_at < NOW() - INTERVAL '180 days';

-- Remove stale blacklist entries
DELETE FROM blacklist WHERE created_at < NOW() - INTERVAL '365 days';
```

### Phase 3: Verify Schema Migration Status
Check if migrations are applied:
```sql
-- Check if Phase 2 tables exist
SELECT table_name FROM information_schema.tables 
WHERE table_schema = 'public' 
AND table_name IN ('guild_settings', 'blacklist', 'user_profiles', 'user_memories');

-- Check if Phase 3 columns exist
SELECT column_name, data_type FROM information_schema.columns 
WHERE table_name = 'user_memories' 
AND column_name IN ('memory_type', 'normalized_content', 'confirmation_count', 'first_observed_at', 'is_active');
```

### Phase 4: Apply Migrations in Correct Order
If migrations are not applied, run them in order:

1. **001_phase2_core_schema.sql** - Core schema for bot state, blacklist, user profiles, and memories
2. **002_phase3_memory_intelligence.sql** - Memory intelligence features

### Phase 5: Verify Final State
After reset, verify:
- Expected tables exist: `guild_settings`, `blacklist`, `user_profiles`, `user_memories`
- Expected columns exist in each table
- Expected indexes exist
- Expected constraints exist
- Expected foreign keys exist
- Expected RLS policies exist
- Expected triggers/functions exist
- Phase 3 columns exist in `user_memories`
- No obsolete Bot Kun schema remains
- Migration ordering works from a clean database

## Cleanup Verification

### Expected Tables
- `guild_settings` - Bot enabled/disabled state per guild
- `blacklist` - Users blacklisted from Bot Kun
- `user_profiles` - User profiles and memory eligibility
- `user_memories` - Long-term memory storage

### Expected Phase 3 Columns in user_memories
- `memory_type` - TEXT with check constraint for valid types
- `normalized_content` - TEXT for duplicate detection
- `confirmation_count` - INTEGER with check constraint (>= 1)
- `first_observed_at` - TIMESTAMP with time zone
- `is_active` - BOOLEAN for soft deletion

### Expected Indexes
- `idx_guild_settings_guild_id`
- `idx_blacklist_user_guild`
- `idx_user_profiles_user_guild`
- `idx_user_profiles_memory_eligible`
- `idx_user_memories_user_guild`
- `idx_user_memories_confidence`
- `idx_user_memories_frequency`
- `idx_user_memories_type` (Phase 3)
- `idx_user_memories_normalized` (Phase 3)
- `idx_user_memories_active` (Phase 3)
- `idx_user_memories_confirmation` (Phase 3)

### Expected Constraints
- `check_memory_type` - Validates memory_type values
- `check_confidence_range` - Validates confidence between 0.00 and 1.00
- `check_confirmation_count` - Validates confirmation_count >= 1

### Expected RLS Policies
- Read access for authenticated users on all tables
- Service role can modify all tables

## Important Notes

1. **Never drop unrelated tables** - Protect data from other applications
2. **Never modify unrelated RLS policies** - Protect security policies from other apps
3. **Never delete unrelated users/data** - Preserve user data from other applications
4. **Always backup before destructive operations** - Ensure rollback capability
5. **Test migrations on a staging environment first** - Verify migrations work correctly
6. **Document any custom modifications** - Keep track of any schema changes

## Rollback Procedure

If the reset causes issues, restore from the backup created in Phase 1.

## Completion

After successful reset:
1. Update this document with actual database state observed
2. Note any deviations from expected schema
3. Document any custom modifications that were preserved
4. Update migration records if needed
