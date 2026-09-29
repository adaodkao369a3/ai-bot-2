# Bocchi Discord Bot - Complete Project Overview

This document provides comprehensive context about the Bocchi Discord bot project for AI assistants to understand the codebase architecture, patterns, and extension points.

## Project Overview

**Bocchi** is a TypeScript-based Discord bot with a "gangster McDonald's worker" personality. It's hosted on Railway and uses Supabase PostgreSQL for persistence. The bot features AI-powered conversations, memory systems, media requests (memes, GIFs, YouTube), and social features like confession booths.

## Tech Stack

- **Language**: TypeScript (Node.js >= 22.0.0)
- **Runtime**: Node.js
- **Discord Library**: discord.js v14
- **Database**: PostgreSQL (hosted on Supabase)
- **Database Driver**: `pg` (direct PostgreSQL connection, NOT Supabase JS client)
- **AI Provider**: Groq API (model: `openai/gpt-oss-20b`, overridable via `GROQ_MODEL`)
- **Deployment**: Railway
- **Package Manager**: npm

## Project Structure

```
bot_kun_2/
├── src/
│   ├── index.ts                    # Main entry point
│   ├── config/
│   │   ├── index.ts                # Centralized configuration (constants, role IDs)
│   │   └── nicknames.ts            # Nickname generation logic
│   ├── discord/
│   │   └── client.ts               # Discord client setup and event handlers
│   ├── database/
│   │   └── pool.ts                 # PostgreSQL connection pool (Supabase)
│   ├── services/                   # Core business logic
│   │   ├── messageRouter.ts        # Central message routing pipeline
│   │   ├── ai.ts                   # AI service abstraction (Groq API)
│   │   ├── memory.ts               # Memory system (user profiles, long-term memory)
│   │   ├── memoryExtraction.ts     # AI-powered memory extraction
│   │   ├── personality.ts          # Bocchi's personality system prompt
│   │   ├── conversationContext.ts  # Short-term conversation context
│   │   ├── addressing.ts           # Bot mention/addressing detection
│   │   ├── blacklist.ts            # User blacklist management
│   │   ├── botState.ts             # Per-guild bot enabled/disabled state
│   │   ├── rateLimit.ts            # Rate limiting
│   │   ├── permissions.ts          # Role-based permission system
│   │   ├── featureToggle.ts        # Per-guild feature enable/disable
│   │   ├── responseSanitizer.ts   # Response sanitization (security)
│   │   ├── responseMemory.ts       # Response deduplication
│   │   ├── meme.ts                 # Meme fetching (meme-api.com)
│   │   ├── media.ts                # YouTube search
│   │   ├── interactionPools.ts     # GIF reaction pools
│   │   ├── nickname.ts             # Nickname assignment system
│   │   ├── confession.ts          # Confession booth feature
│   │   └── health.ts               # Health tracking
│   └── utils/
│       ├── env.ts                  # Environment variable validation
│       ├── logger.ts               # Structured logging
│       ├── shutdown.ts             # Graceful shutdown handling
│       └── validation.ts           # Utility validation
├── migrations/                     # Database schema migrations
│   ├── 001_phase2_core_schema.sql
│   ├── 002_phase3_memory_intelligence.sql
│   └── 003_feature_toggles.sql
├── tests/                          # Test files
├── package.json
├── tsconfig.json
├── railway.toml                    # Railway deployment config
└── .env.example                    # Environment variable template
```

## Database Schema

### Core Tables

**guild_settings**
- `guild_id` (TEXT, UNIQUE): Discord server ID
- `bot_enabled` (BOOLEAN): Whether bot is enabled for this guild
- `created_at`, `updated_at`: Timestamps

**blacklist**
- `user_id` (TEXT): Discord user ID
- `guild_id` (TEXT): Discord server ID
- `blacklisted_by` (TEXT): Who blacklisted this user
- `reason` (TEXT): Optional reason
- UNIQUE(user_id, guild_id)

**user_profiles**
- `user_id` (TEXT): Discord user ID
- `guild_id` (TEXT): Discord server ID
- `username`, `display_name`: User names
- `memory_eligible` (BOOLEAN): Whether user qualifies for memory features
- `is_extra`, `is_featured_extra`, `is_supporting_cast` (BOOLEAN): Role flags
- `extra_role_id` (TEXT): The specific role that grants eligibility
- `last_interaction_at`: Last time user interacted with bot
- UNIQUE(user_id, guild_id)

**user_memories**
- `user_id`, `guild_id`: Keys
- `memory_content` (TEXT): The actual memory
- `normalized_content` (TEXT): For duplicate detection
- `confidence` (DECIMAL): 0.00-1.00 confidence score
- `frequency` (INTEGER): How often mentioned
- `confirmation_count` (INTEGER): Independent confirmations
- `memory_type` (TEXT): 'preference', 'interest', 'hobby', 'identity', 'relationship', 'project', 'habit', 'dislike', 'other'
- `source` (TEXT): How memory was acquired
- `first_observed_at`, `last_accessed_at`: Tracking
- `is_active` (BOOLEAN): Soft deletion flag

**feature_toggles**
- `guild_id` (TEXT): Discord server ID
- `feature_name` (TEXT): 'youtube', 'confession', 'gif', 'meme'
- `enabled` (BOOLEAN): Feature state
- UNIQUE(guild_id, feature_name)

**confession_sessions**
- `id` (SERIAL): Session ID
- `guild_id` (TEXT): Server ID
- `user_id` (TEXT): User in confession booth
- `booth_channel_id` (TEXT): Private channel for confession
- `confession_text` (TEXT): The confession content
- `expires_at` (TIMESTAMP): When session expires
- `created_at`, `updated_at`

**confessions**
- `id` (SERIAL): Confession number
- `guild_id` (TEXT): Server ID
- `confession_text` (TEXT): Published confession
- `created_at`: Timestamp

## Key Services & Responsibilities

### messageRouter.ts (Central Pipeline)
The heart of the bot - all messages flow through here:

**Message Flow:**
1. Ignore bots and DMs
2. Check for commands (`~` prefix)
3. Check for special triggers (Order 66, `.confess`)
4. Check if bot is enabled for guild
5. Check if user is blacklisted (staff bypass)
6. Check if message addresses the bot
7. Check rate limits (staff bypass)
8. Add to conversation context
9. Extract clean content (remove bot mention)
10. Security check (prevent injection attacks)
11. Get/create user profile
12. Update memory eligibility based on roles
13. Extract memory candidates (if eligible)
14. Retrieve relevant memories
15. Handle explicit media requests (meme, GIF, YouTube)
16. Generate AI response with full context
17. Sanitize response and send

**Commands:**
- `~bot on/off` - Enable/disable bot (staff only)
- `~features [feature] [on|off]` - Toggle features (staff only)
- `~bl [@user]` - Blacklist user (Extra+ only)
- `~unbl [@user]` - Unblacklist user (Extra+ only)
- `~guide` - Post guide embed (staff only, specific channel)
- `~nickname [@user]` - Generate nickname for user (staff only)
- `~nickname all` - Generate nicknames for all members without them (staff only)
- `~nickname reset [@user]` - Remove user's nickname (staff only)
- `~nickname reset all` - Remove all nicknames (staff only)

### ai.ts (AI Service)
- Wraps Groq API with retry logic and timeout handling
- Builds message arrays with system prompts, conversation context, memory context, reply context
- Model: `openai/gpt-oss-20b` (overridable via `GROQ_MODEL` env var)
- Temperature: 0.9, max_tokens: 500
- Exponential backoff on failures (max 2 retries)

### personality.ts (Bocchi's Persona)
- Gangster McDonald's worker personality
- System prompt defines voice, slang, boundaries
- Provides variant messages for cooldowns, errors, disabled state
- Key traits: confident but minimum-wage job, self-aware, roasts but not cruel, no slurs

### memory.ts (Memory System)
- User profiles with memory eligibility based on Discord roles
- Long-term memory with confidence scoring and duplicate detection
- Active memory pool (cap: 25 users, 30-day window)
- Identity memories always available, preference/interest memories role-gated
- Memory types: preference, interest, hobby, identity, relationship, project, habit, dislike, other
- Confidence scoring: starts at 0.30, increments by 0.15 per confirmation, max 1.00

### permissions.ts (Role-Based Access)
- Discord role IDs defined in config/index.ts:
  - `EXTRA_ROLE_ID`: "1535285274832277514"
  - `FEATURED_EXTRA_ROLE_ID`: "1535285299410771988"
  - `SUPPORTING_CAST_ROLE_ID`: "1535285344952651829"
- `isStaff()`: Checks if user has staff-level permissions
- `hasMemoryEligibility()`: Checks if user qualifies for memory features
- `isExtra()`, `isFeaturedExtra()`, `isSupportingCast()`: Role-specific checks

### featureToggle.ts (Feature Management)
- Per-guild feature enable/disable states
- Features: youtube, confession, gif, meme
- Cached in memory for performance, persisted to PostgreSQL
- Defaults to enabled if no setting exists

### confession.ts (Confession Booth)
- Creates private channel for user confessions
- Modal-based confession submission
- Timer-based session expiration
- Publishes confessions to designated channel
- Handles session recovery on bot restart

## Configuration (src/config/index.ts)

```typescript
BOT_NAME = "bocchi"

// Discord Role IDs
EXTRA_ROLE_ID = "1535285274832277514"
FEATURED_EXTRA_ROLE_ID = "1535285299410771988"
SUPPORTING_CAST_ROLE_ID = "1535285344952651829"

// Channel IDs
GUIDE_CHANNEL_ID = "" // To be configured

// Rate limiting
RATE_LIMIT_MAX_INTERACTIONS = 10
RATE_LIMIT_WINDOW_MS = 3 * 60 * 1000 // 3 minutes

// Meme configuration
MEME_API_URL = "https://meme-api.com/gimme"
MEME_IDLE_ENABLED = true
MEME_IDLE_COOLDOWN_MINUTES = 15

// Memory configuration
MEMORY_ACTIVE_MEMBER_CAP = 25
MEMORY_CONFIDENCE_THRESHOLD = 0.50
MEMORY_INITIAL_CONFIDENCE = 0.30
MEMORY_MAX_CONFIDENCE = 1.00
MEMORY_CONFIDENCE_INCREMENT = 0.15
MEMORY_RETRIEVAL_LIMIT = 10

// Conversation context
CONVERSATION_CONTEXT_MAX_MESSAGES = 10

// AI configuration
AI_MAX_RETRIES = 2
AI_TIMEOUT_MS = 30000
```

## Environment Variables

Required:
- `DISCORD_TOKEN`: Discord bot token
- `GROQ_API_KEY`: Groq API key for AI
- `SUPABASE_DATABASE_URL`: PostgreSQL connection string (Supabase pooler URL)
- `KLIPY_KEY`: Klipy API key
- `YOUTUBE_API_KEY`: YouTube Data API key

Optional:
- `GROQ_MODEL`: Override default AI model (default: `openai/gpt-oss-20b`)
- `SUPABASE_DB_CA_CERT`: CA certificate for full TLS verification
- `SUPABASE_DB_CA_CERT_PATH`: Path to CA certificate file

## Deployment (Railway)

**railway.toml:**
```toml
[build]
builder = "NIXPACKS"

[build.env]
NPM_CONFIG_PRODUCTION = "false"

[deploy]
startCommand = "npm start"
restartPolicyType = "ON_FAILURE"
restartPolicyMaxRetries = 5
```

**Build process:**
1. Railway runs `npm run build` (TypeScript compilation)
2. Railway runs `npm start` (runs compiled JavaScript from `dist/`)
3. Environment variables set in Railway dashboard
4. No HTTP healthcheck (bot is a worker process)

## Extension Points for New Features

### Adding a New Command
1. Add command handler in `messageRouter.ts` `handleCommand()` method
2. Follow existing pattern: check permissions, execute logic, send response
3. Use `~` prefix convention
4. Add permission checks using `permissionService`

### Adding a New Feature Toggle
1. Add feature name to `Feature` type in `featureToggle.ts`
2. Add to feature list in `handleFeaturesCommand()`
3. Check toggle state before feature execution using `featureToggleService.isEnabled()`

### Adding Database Tables
1. Create new migration file in `migrations/`
2. Follow naming convention: `004_feature_name.sql`
3. Include indexes, RLS policies, and triggers
4. Run migration: `./run-migration.sh` (or Railway deployment)

### Adding a New Service
1. Create file in `src/services/`
2. Export class and singleton instance
3. Initialize in `src/index.ts` main()
4. Inject into `messageRouter` if needed
5. Add cleanup handler in shutdown manager

### Adding AI-Powered Features
1. Use existing `AIService` from `ai.ts`
2. Add custom system prompt if needed (via `personality.ts` or separate)
3. Follow message building pattern in `ai.ts`
4. Handle timeouts and retries automatically

### Adding Media Integrations
1. Follow pattern in `mediaService.ts` and `memeService.ts`
2. Add to `handleExplicitMediaRequest()` in `messageRouter.ts`
3. Add feature toggle check
4. Handle errors gracefully with fallback messages

## Important Patterns & Conventions

### Error Handling
- Never crash on individual message errors - log and continue
- Use structured logging via `logger` from `utils/logger.ts`
- Staff users bypass many restrictions (blacklist, rate limits)
- Graceful degradation on service failures

### Security
- Response sanitization prevents mention abuse (`@everyone`, `@here`, user mentions)
- Security checks on user input before AI processing
- Environment variables never logged
- SQL injection prevention via parameterized queries

### Database Access
- Always use connection pool from `database/pool.ts`
- Parameterized queries only (no string concatenation)
- Use `getPool()` singleton, don't create new pools
- Handle connection errors gracefully

### TypeScript Style
- Strict TypeScript configuration
- Interface definitions for all data structures
- Type guards for external data
- No `any` types except where unavoidable (Discord.js types)

### Discord API Patterns
- Check channel sendability before sending
- Use `allowedMentions` to control ping behavior
- Handle rate limits with delays
- Fetch guild members explicitly when needed (don't rely on cache)

## Testing the Bot

**Local development:**
```bash
npm install
cp .env.example .env
# Edit .env with your values
npm run build
npm start
# or for development with hot-reload:
npm run dev
```

**Running migrations:**
```bash
./run-migration.sh
```

**Type checking:**
```bash
npm run typecheck
```

## Current Feature Set

### Core Features
- AI-powered conversations with Bocchi personality
- Long-term memory system (role-gated)
- User profiles and interaction tracking
- Per-guild bot enable/disable
- User blacklist system
- Rate limiting

### Media Features
- Meme fetching (via meme-api.com)
- GIF reactions (hug, kiss, punch, etc.)
- YouTube video search
- Time-based meme drops (15-minute intervals)

### Social Features
- Confession booth (private channel for anonymous confessions)
- Nickname assignment system
- Welcome messages for new members
- Order 66 command (times out recent users)

### Admin Features
- Feature toggles per guild
- Blacklist management
- Guide embed posting
- Bulk nickname operations

## Common Tasks

### Adding a New Memory Type
1. Add to `MemoryType` union in `memoryExtraction.ts`
2. Add to check constraint in migration
3. Update extraction prompts if needed

### Modifying Personality
1. Edit system prompt in `personality.ts`
2. Test various interaction scenarios
3. Ensure security rules remain intact

### Adding New Role-Based Permissions
1. Add role ID to `config/index.ts`
2. Add permission check method in `permissions.ts`
3. Update memory eligibility logic if needed

### Database Maintenance
- Use migrations for all schema changes
- Never manually modify production database
- Test migrations locally first
- Keep migration files sequential

## Performance Considerations

- Connection pooling (max 10 connections)
- Feature toggle caching (in-memory)
- Conversation context limits (10 messages)
- Memory pool caps (25 active users)
- Rate limiting (10 interactions per 3 minutes)
- AI timeout (30 seconds)
- Meme fetch timeout (5 seconds)

## Monitoring & Logging

- Structured JSON logging suitable for Railway
- Automatic secret redaction from logs
- Health tracking for Discord and database connections
- Error tracking with context
- Performance metrics in logs

## Security Notes

- No slurs or hate speech in personality
- Response sanitization prevents mention abuse
- SQL injection prevention via parameterization
- Environment variables never logged
- Rate limiting prevents abuse
- Staff bypass for emergency access
- Row Level Security (RLS) on PostgreSQL tables

This overview provides complete context for understanding the Bocchi Discord bot architecture and should enable AI assistants to generate accurate implementation prompts for new features.