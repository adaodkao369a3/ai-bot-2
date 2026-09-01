/**
 * Confession booth service for Bocchi
 * Manages private confession sessions with database persistence
 */

import { Guild, GuildMember, TextChannel, ChannelType, Message, EmbedBuilder } from 'discord.js';
import { query } from '../database/pool';
import { logger } from '../utils/logger';

const CONFESSION_DURATION_MS = 5 * 60 * 1000; // 5 minutes
const CONFESSIONS_CHANNEL_ID = '1544357086996209824';
const BOOTH_CHANNEL_NAME = 'confession-booth';

interface ConfessionSession {
  id: number;
  guild_id: string;
  user_id: string;
  booth_channel_id: string;
  started_at: Date;
  status: 'active' | 'ended';
  confession_text: string | null;
  ended_at: Date | null;
}

export class ConfessionService {
  private activeTimers: Map<string, NodeJS.Timeout> = new Map();

  /**
   * Get the active confession session for a guild
   */
  async getActiveSession(guildId: string): Promise<ConfessionSession | null> {
    try {
      const result = await query<ConfessionSession>(
        'SELECT * FROM confession_sessions WHERE guild_id = $1 AND status = $2',
        [guildId, 'active']
      );
      return result.rows[0] || null;
    } catch (error) {
      logger.error('Failed to get active confession session', {
        guildId,
        error: error instanceof Error ? error.message : String(error)
      });
      return null;
    }
  }

  /**
   * Create a new confession session with atomic locking
   */
  async createSession(guildId: string, userId: string, boothChannelId: string): Promise<ConfessionSession | null> {
    const pool = (await import('../database/pool.js')).getPool();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Check if there's already an active session
      const existingResult = await client.query(
        'SELECT * FROM confession_sessions WHERE guild_id = $1 AND status = $2 FOR UPDATE',
        [guildId, 'active']
      );

      if (existingResult.rows.length > 0) {
        await client.query('ROLLBACK');
        return null; // Session already exists
      }

      // Create new session
      const result = await client.query(
        `INSERT INTO confession_sessions (guild_id, user_id, booth_channel_id, status)
         VALUES ($1, $2, $3, 'active')
         RETURNING *`,
        [guildId, userId, boothChannelId]
      );

      await client.query('COMMIT');
      return result.rows[0] as ConfessionSession;
    } catch (error) {
      await client.query('ROLLBACK');
      logger.error('Failed to create confession session', {
        guildId,
        userId,
        error: error instanceof Error ? error.message : String(error)
      });
      return null;
    } finally {
      client.release();
    }
  }

  /**
   * End a confession session
   */
  async endSession(sessionId: number, confessionText: string | null = null): Promise<void> {
    try {
      await query(
        `UPDATE confession_sessions 
         SET status = 'ended', confession_text = $2, ended_at = NOW()
         WHERE id = $1`,
        [sessionId, confessionText]
      );
      
      // Clear any active timer for this session
      const session = await query<ConfessionSession>('SELECT * FROM confession_sessions WHERE id = $1', [sessionId]);
      if (session.rows[0]) {
        const timerKey = `${session.rows[0].guild_id}:${session.rows[0].user_id}`;
        const timer = this.activeTimers.get(timerKey);
        if (timer) {
          clearTimeout(timer);
          this.activeTimers.delete(timerKey);
        }
      }
    } catch (error) {
      logger.error('Failed to end confession session', {
        sessionId,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  /**
   * Update confession text for an active session
   */
  async updateConfessionText(sessionId: number, text: string): Promise<void> {
    try {
      await query(
        'UPDATE confession_sessions SET confession_text = $2 WHERE id = $1',
        [sessionId, text]
      );
    } catch (error) {
      logger.error('Failed to update confession text', {
        sessionId,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  /**
   * Get the next confession number for a guild
   */
  async getNextConfessionNumber(guildId: string): Promise<number> {
    try {
      const result = await query(
        'SELECT get_next_confession_number($1) as number',
        [guildId]
      );
      return result.rows[0].number as number;
    } catch (error) {
      logger.error('Failed to get next confession number', {
        guildId,
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  /**
   * Save a completed confession to the archive
   */
  async saveConfession(guildId: string, confessionNumber: number, confessionText: string): Promise<void> {
    try {
      await query(
        'INSERT INTO confessions (guild_id, confession_number, confession_text) VALUES ($1, $2, $3)',
        [guildId, confessionNumber, confessionText]
      );
    } catch (error) {
      logger.error('Failed to save confession', {
        guildId,
        confessionNumber,
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  /**
   * Get or create the confession booth channel
   */
  async getOrCreateBoothChannel(guild: Guild): Promise<TextChannel | null> {
    try {
      // Try to find existing booth channel
      const existingChannel = guild.channels.cache.find(
        channel => channel.name === BOOTH_CHANNEL_NAME && channel.type === ChannelType.GuildText
      );

      if (existingChannel) {
        return existingChannel as TextChannel;
      }

      // Create new booth channel
      const boothChannel = await guild.channels.create({
        name: BOOTH_CHANNEL_NAME,
        type: ChannelType.GuildText,
        permissionOverwrites: [
          {
            id: guild.roles.everyone,
            deny: ['ViewChannel', 'ReadMessageHistory']
          },
          {
            id: guild.client.user.id,
            allow: ['ViewChannel', 'SendMessages', 'ReadMessageHistory']
          }
        ]
      });

      logger.info('Created confession booth channel', {
        guildId: guild.id,
        channelId: boothChannel.id
      });

      return boothChannel;
    } catch (error) {
      logger.error('Failed to get or create confession booth channel', {
        guildId: guild.id,
        error: error instanceof Error ? error.message : String(error)
      });
      return null;
    }
  }

  /**
   * Grant user access to the booth channel
   */
  async grantBoothAccess(channel: TextChannel, userId: string): Promise<boolean> {
    try {
      await channel.permissionOverwrites.edit(userId, {
        ViewChannel: true,
        SendMessages: true,
        ReadMessageHistory: true
      });
      logger.info('Granted booth access', { userId, channelId: channel.id });
      return true;
    } catch (error) {
      logger.error('Failed to grant booth access', {
        userId,
        channelId: channel.id,
        error: error instanceof Error ? error.message : String(error)
      });
      return false;
    }
  }

  /**
   * Revoke user access to the booth channel
   */
  async revokeBoothAccess(channel: TextChannel, userId: string): Promise<void> {
    try {
      await channel.permissionOverwrites.delete(userId);
      logger.info('Revoked booth access', { userId, channelId: channel.id });
    } catch (error) {
      logger.error('Failed to revoke booth access', {
        userId,
        channelId: channel.id,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  /**
   * Start the 5-minute timer for a session
   */
  startTimer(sessionId: number, guildId: string, userId: string, callback: () => void): void {
    const timerKey = `${guildId}:${userId}`;
    
    // Clear any existing timer
    const existingTimer = this.activeTimers.get(timerKey);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    const timer = setTimeout(() => {
      logger.info('Confession timer expired', { sessionId, guildId, userId });
      callback();
      this.activeTimers.delete(timerKey);
    }, CONFESSION_DURATION_MS);

    this.activeTimers.set(timerKey, timer);
  }

  /**
   * Publish confession to the public confessions channel
   */
  async publishConfession(guild: Guild, confessionNumber: number, confessionText: string): Promise<boolean> {
    try {
      const confessionsChannel = await guild.channels.fetch(CONFESSIONS_CHANNEL_ID);
      
      if (!confessionsChannel || confessionsChannel.type !== ChannelType.GuildText) {
        logger.error('Confessions channel not found or invalid type', {
          guildId: guild.id,
          channelId: CONFESSIONS_CHANNEL_ID
        });
        return false;
      }

      const embed = new EmbedBuilder()
        .setTitle(`confession #${confessionNumber}`)
        .setDescription(`"${confessionText}"`)
        .setColor(0x5865F2);

      await confessionsChannel.send({ embeds: [embed] });
      
      logger.info('Published confession', {
        guildId: guild.id,
        confessionNumber
      });

      return true;
    } catch (error) {
      logger.error('Failed to publish confession', {
        guildId: guild.id,
        confessionNumber,
        error: error instanceof Error ? error.message : String(error)
      });
      return false;
    }
  }

  /**
   * Recover active sessions on startup
   */
  async recoverActiveSessions(guild: Guild, onSessionExpired: (session: ConfessionSession) => void): Promise<void> {
    try {
      const result = await query<ConfessionSession>(
        'SELECT * FROM confession_sessions WHERE status = $1',
        ['active']
      );

      for (const session of result.rows) {
        const elapsed = Date.now() - new Date(session.started_at).getTime();
        
        if (elapsed >= CONFESSION_DURATION_MS) {
          // Session already expired, clean it up
          logger.info('Recovering expired confession session', {
            sessionId: session.id,
            guildId: session.guild_id,
            userId: session.user_id
          });
          await this.endSession(session.id, session.confession_text);
          
          // Try to publish if there's confession text
          if (session.confession_text) {
            try {
              const confessionNumber = await this.getNextConfessionNumber(session.guild_id);
              await this.saveConfession(session.guild_id, confessionNumber, session.confession_text);
              await this.publishConfession(guild, confessionNumber, session.confession_text);
            } catch (error) {
              logger.error('Failed to publish recovered confession', {
                sessionId: session.id,
                error: error instanceof Error ? error.message : String(error)
              });
            }
          }

          // Revoke access
          try {
            const boothChannel = await guild.channels.fetch(session.booth_channel_id);
            if (boothChannel && boothChannel.type === ChannelType.GuildText) {
              await this.revokeBoothAccess(boothChannel, session.user_id);
            }
          } catch (error) {
            logger.error('Failed to revoke access during recovery', {
              sessionId: session.id,
              error: error instanceof Error ? error.message : String(error)
            });
          }
        } else {
          // Session still active, restore timer
          const remainingTime = CONFESSION_DURATION_MS - elapsed;
          logger.info('Restoring timer for active confession session', {
            sessionId: session.id,
            guildId: session.guild_id,
            userId: session.user_id,
            remainingTime
          });

          const timerKey = `${session.guild_id}:${session.user_id}`;
          const timer = setTimeout(async () => {
            logger.info('Restored confession timer expired', { sessionId: session.id });
            onSessionExpired(session);
            this.activeTimers.delete(timerKey);
          }, remainingTime);

          this.activeTimers.set(timerKey, timer);
        }
      }

      logger.info('Confession session recovery completed', {
        totalSessions: result.rows.length
      });
    } catch (error) {
      logger.error('Failed to recover active confession sessions', {
        guildId: guild.id,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  /**
   * Clean up all timers (for shutdown)
   */
  cleanup(): void {
    for (const [key, timer] of this.activeTimers) {
      clearTimeout(timer);
    }
    this.activeTimers.clear();
  }
}

// Singleton instance
let confessionService: ConfessionService | null = null;

export function initConfessionService(): void {
  if (!confessionService) {
    confessionService = new ConfessionService();
  }
}

export function getConfessionService(): ConfessionService {
  if (!confessionService) {
    throw new Error('ConfessionService not initialized. Call initConfessionService first.');
  }
  return confessionService;
}
