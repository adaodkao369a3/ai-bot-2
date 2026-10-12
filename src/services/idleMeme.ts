/**
 * Idle meme runner.
 *
 * Called once a minute. Asks the meme service which servers have a "bot was called here, then the
 * channel went quiet" session that is due, and drops ONE meme in exactly that channel.
 *
 * The session is finished BEFORE anything is fetched or sent, so whatever happens next (no meme
 * found, a failed send, a disabled feature) the bot can never try again or spam: the next idle
 * meme only happens after somebody calls the bot again.
 */

import type { Client } from 'discord.js';
import { memeService } from './meme';
import { botStateService } from './botState';
import { channelRestrictionsService } from './channelRestrictions';
import { featureToggleService } from './featureToggle';
import { conversationContextService } from './conversationContext';
import { getConfessionService } from './confession';
import { imageFileName, randomDelayMs, sleep } from '../utils/discordMedia';
import { logger } from '../utils/logger';

export async function runIdleMemeCheck(client: Client): Promise<void> {
  for (const { guildId, channelId } of memeService.getDueIdleMemes()) {
    memeService.finishSession(guildId); // one meme per call, no matter what happens below

    try {
      await dropIdleMeme(client, guildId, channelId);
    } catch (error) {
      logger.debug('Idle meme skipped after an error', {
        guildId,
        channelId,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }
}

async function dropIdleMeme(client: Client, guildId: string, channelId: string): Promise<void> {
  const guild = client.guilds.cache.get(guildId);
  const channel = guild?.channels.cache.get(channelId);

  if (!guild || !channel || !channel.isTextBased() || channel.isThread() || !('send' in channel)) {
    return;
  }

  // Never drop memes in age-restricted channels
  if ('nsfw' in channel && channel.nsfw) {
    return;
  }

  const botUser = client.user;
  if (botUser && 'permissionsFor' in channel) {
    const permissions = channel.permissionsFor(botUser);
    if (!permissions?.has(['ViewChannel', 'SendMessages', 'AttachFiles'])) {
      return;
    }
  }

  if (!(await botStateService.isEnabled(guildId))) return;
  if (!(await channelRestrictionsService.isChannelAllowed(guildId, channelId))) return;
  if (!(await featureToggleService.isEnabled(guildId, 'meme'))) return;

  // Leave the confession booth alone
  try {
    const session = await getConfessionService().getActiveSession(guildId);
    if (session && session.booth_channel_id === channelId) {
      return;
    }
  } catch {
    // confession service not available: nothing to protect
  }

  const conversationText = conversationContextService.getFormattedContext(channelId);
  const meme = await memeService.fetchMeme(conversationText, undefined, guildId);
  if (!meme) {
    logger.debug('Idle meme: nothing suitable found', { guildId, channelId });
    return;
  }

  // Look like a person: "typing..." for a moment, then just the image (no embed, no caption)
  try {
    await channel.sendTyping();
    await sleep(randomDelayMs(1500, 3500));
  } catch {
    // typing is cosmetic
  }

  try {
    await channel.send({
      files: [{ attachment: meme.imageUrl, name: imageFileName(meme.imageUrl) }],
      allowedMentions: { parse: [] }
    });
  } catch {
    // Upload failed (too big, host blocked...): fall back to the plain link, which Discord previews
    await channel.send({ content: meme.imageUrl, allowedMentions: { parse: [] } });
  }

  logger.info('Idle meme dropped', { guildId, channelId, subreddit: meme.subreddit });
}
