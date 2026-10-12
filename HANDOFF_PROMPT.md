> STATUS (2026-10-13): ALL PHASES BELOW ARE DONE and tested. Kept only for reference.

# HANDOFF: finish the Discord AI bot feature work

Project: TypeScript Discord bot (discord.js, Groq, Postgres/Supabase, Railway). Work from `src/`. Do NOT use the AI/Groq for any of these features (rate limits!). Run `npx tsc --noEmit` after each phase. Do not deploy; report back.

## What the owner asked for
1. The bot must never keep posting the same message, media, meme, GIF or emoji.
2. Use the server's custom emojis where they fit: not too much, not too little, never repeating.
3. Idle meme bug: memes were posted where people texted last. Correct behavior: after someone CALLS the bot in a channel and then stops, wait ~5 min, post ONE meme in THAT channel, as a plain image (no embed), then post nothing more until someone calls the bot again.
4. GIF copycat + library: store GIFs people post, read their context (the description at the end of Tenor/Giphy links plus the words around it), occasionally post the same GIF, and reuse stored GIFs in replies only when the context fits what the bot is saying.

## DONE already (verify, don't redo)
- `config/index.ts`: new MEME_IDLE_*, GIF_LIBRARY_*, GIF_COPY_*, CUSTOM_EMOJI_*, repeat-protection settings.
- `services/recentMedia.ts` (shared "recently posted" memory), `services/variety.ts` (no back-to-back canned lines), `services/responseMemory.ts` (per-channel similar-reply check).
- `services/meme.ts`: idle "session" logic (markBotCalled / noteActivity / getDueIdleMemes / finishSession) + de-dup via recentMedia.
- `services/idleMeme.ts` + `discord/client.ts`: runner every minute, all guards (bot enabled, channel allowed, meme toggle, not NSFW, not confession booth, permissions).
- `utils/discordMedia.ts`: imageFileName, randomDelayMs, sleep.
- `services/gifContext.ts`: GIF detection, slug reading, mood tags, scoreGif.
- `services/gifCopy.ts`: GifLibrary (memory + Postgres), GifCopyService (collect, copycat rules, pickForReply). `migrations/006_gif_library.sql`.
- `services/customEmoji.ts`: offer() + process() (1 custom emoji max, 2 emojis max, no repeats).
- `services/ai.ts`: `emojiContext` + "don't repeat yourself" note.
- `services/messageRouter.ts`: wired (noteActivity, markBotCalled, GIF hook before the isAddressing return, emoji offer/process, repeat retry, library GIF follow-up message, plain-image explicit memes, variety for canned lines).
- `services/media.ts`: searchGif/searchYoutube take an `isUsed` predicate.
- `services/interactionPools.ts`: getInteractionResponse(interaction, guildId) patched, NEEDS imports (`variety`, `recentMedia as sharedRecentMedia`) and a typecheck.

## PHASE 1: make it compile
- Fix imports in `interactionPools.ts`; run `npx tsc --noEmit` until clean.
- Remove now-unused imports (e.g. EmbedBuilder if unused).

## PHASE 2: personality lines
- `services/personalityManager.ts`: cooldown/disabled/blacklisted/error message picks use `variety.pick(scope, list)` (scope like `error:${guildId}`) instead of Math.random.

## PHASE 3: tests (jest, no network, inject clocks/random)
- Replace stale `tests/meme.test.ts` (tests an API that no longer exists) with tests for: no session without a call; noteActivity never creates a session; due only after 5 min + jitter of quiet; only one meme per call; new call re-arms and moves to the new channel; stale session (>60 min) ignored; fetchMeme skips recently posted memes.
- New tests: `gifContext` (extract from Tenor/Giphy/.gif link, attachment, gifv embed; slug words; expiring Discord URLs not persistent; scoreGif mood match), `gifCopy` (cooldowns, chance, addressed bot, duplicate within recent memory, pickForReply picks fitting GIF and none when nothing fits), `customEmoji` (offer gaps/chance/rotation, :name: to real emoji, strips not-offered emoji, 1 custom max, 2 total, unicode repeat window), `recentMedia`, `variety`, `responseMemory`.
- Known-broken before this work (ignore): tests/addressing, conversationContext, security. Don't add new failures.

## PHASE 4: end-to-end check
- Build to a temp dir and run a small script with mocked Discord objects: addressed message -> session; 5 min later fake clock -> exactly one meme in the called channel; second tick -> nothing; GIF link message -> stored; later reply text that fits -> that GIF; repeated reply text -> retry path; emoji output cleaned.

## PHASE 5: docs + package
- `.env.example`: GIF_COPY_ENABLED, GIF_COPY_CHANCE, GIF_LIBRARY_ENABLED, CUSTOM_EMOJI_ENABLED, CUSTOM_EMOJI_OFFER_CHANCE, MEME_IDLE_ENABLED.
- Tell the owner to run `./run-migration.sh migrations/006_gif_library.sql` (the bot works without it, GIFs just reset on restart).
- Zip the project without node_modules and produce a patch.

## Rules
- No AI calls in the new features. Never store who posted a GIF or message text (keywords only).
- Never throw out of message handlers. Never ping anyone (allowedMentions parse: []).
- Final report: files changed, what to test manually in Discord, any limitation.
