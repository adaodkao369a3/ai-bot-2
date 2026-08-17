# Bot Kun v2

Bot Kun v2 is a TypeScript-based Discord bot backed by Supabase-hosted PostgreSQL, rebuilt from scratch with a clean architecture.

## Phase 1 Status

Phase 1 establishes the foundation with:
- ✅ TypeScript project with strict configuration (Node16 module resolution)
- ✅ Discord.js client with appropriate intents
- ✅ Direct PostgreSQL connection (via `pg`) to Supabase-hosted Postgres
- ✅ Environment variable validation
- ✅ Centralized configuration management
- ✅ Structured logging (Railway-compatible)
- ✅ Graceful shutdown handling (SIGINT, SIGTERM)
- ✅ Health/readiness tracking
- ✅ Clean project architecture

## Prerequisites

- Node.js >= 22.0.0
- npm or yarn
- Discord bot token
- Supabase PostgreSQL connection string (pooler URL)
- Required API keys (Groq, Klipy, YouTube)

## Local Setup

1. **Install dependencies:**
   ```bash
   cd bot_kun_2
   npm install
   ```

2. **Configure environment variables:**
   ```bash
   cp .env.example .env
   ```
   
   Edit `.env` and fill in the required values:
   ```env
   DISCORD_TOKEN=your_discord_bot_token
   GROQ_API_KEY=your_groq_api_key
   KLIPY_KEY=your_klipy_key
   SUPABASE_DATABASE_URL=your_supabase_postgres_connection_string
   YOUTUBE_API_KEY=your_youtube_api_key
   ```

3. **Build the project:**
   ```bash
   npm run build
   ```

4. **Run the bot:**
   ```bash
   npm start
   ```

   For development with hot-reload:
   ```bash
   npm run dev
   ```

## Railway Deployment

1. **Create a new Railway project** and connect this repository.

2. **Set environment variables** in Railway:
   - `DISCORD_TOKEN`
   - `GROQ_API_KEY`
   - `KLIPY_KEY`
   - `SUPABASE_DATABASE_URL`
   - `YOUTUBE_API_KEY`

3. **Configure build settings:**
   - Build command: `npm run build`
   - Start command: `npm start`

4. **Deploy** - Railway will automatically build and deploy the bot.

## Project Structure

```
bot_kun_2/
├── src/
│   ├── index.ts              # Main entry point
│   ├── config/
│   │   └── index.ts          # Centralized configuration
│   ├── discord/
│   │   └── client.ts         # Discord client setup
│   ├── database/
│   │   └── pool.ts           # PostgreSQL connection pool (Supabase-hosted)
│   ├── services/
│   │   └── health.ts         # Health/readiness tracking
│   ├── commands/             # Discord commands (Phase 2+)
│   └── utils/
│       ├── env.ts            # Environment validation
│       ├── logger.ts         # Structured logging
│       └── shutdown.ts       # Graceful shutdown
├── migrations/               # Database migrations (Phase 2+)
├── tests/                    # Tests (Phase 2+)
├── .env.example              # Environment variable template
├── .gitignore
├── package.json
├── tsconfig.json
└── README.md
```

## Available Scripts

- `npm run build` - Compile TypeScript to JavaScript
- `npm start` - Run the compiled bot
- `npm run dev` - Run the bot with ts-node (development)
- `npm run clean` - Remove build artifacts
- `npm run typecheck` - Type-check without emitting files

## Logging

The bot uses structured logging suitable for Railway. Logs include:
- Timestamp
- Log level (INFO, WARN, ERROR, DEBUG)
- Message
- Context (sanitized to prevent leaking secrets)

Secrets (tokens, API keys, credentials) are automatically redacted from logs.

## Graceful Shutdown

The bot handles graceful shutdown on:
- SIGINT (Ctrl+C)
- SIGTERM (Railway deployment signals)
- Uncaught exceptions
- Unhandled promise rejections

Connections are properly closed before shutdown.

## Health Status

The bot tracks internal readiness for:
- Discord connection
- Supabase connection
- Full initialization

This can be used for monitoring in future phases.

## Configuration

Behavioral constants are centralized in `src/config/index.ts`:
- Bot name
- Discord role IDs
- Future: interaction limits, memory limits, cooldowns, channel configuration

## Important Notes

- **Do not commit `.env`** - it contains secrets
- **Use strict TypeScript** - all type errors must be resolved
- **Supabase is the database** - no JSON file persistence
- **The parent Python project is untouched** - this is a complete rebuild

## Phase 2 Planning

Future phases will add:
- Discord commands and interactions
- Database schema and migrations
- Memory system
- User profiles
- Guild settings
- Rate limiting
- And more...

## License

MIT
