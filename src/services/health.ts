/**
 * Health and readiness tracking for Bot Kun v2
 * Provides internal readiness mechanism for monitoring
 */

import { logger } from '../utils/logger';

export interface HealthStatus {
  discord: boolean;
  supabase: boolean;
  initialized: boolean;
}

class HealthTracker {
  private status: HealthStatus = {
    discord: false,
    supabase: false,
    initialized: false
  };

  setDiscordReady(ready: boolean): void {
    this.status.discord = ready;
    logger.debug('Discord health status updated', { ready });
    this.checkFullReadiness();
  }

  setSupabaseReady(ready: boolean): void {
    this.status.supabase = ready;
    logger.debug('Supabase health status updated', { ready });
    this.checkFullReadiness();
  }

  setInitialized(initialized: boolean): void {
    this.status.initialized = initialized;
    logger.debug('Initialization status updated', { initialized });
    this.checkFullReadiness();
  }

  private checkFullReadiness(): void {
    if (this.isFullyReady()) {
      logger.info('Bot Kun is fully ready');
    }
  }

  getStatus(): HealthStatus {
    return { ...this.status };
  }

  isDiscordReady(): boolean {
    return this.status.discord;
  }

  isSupabaseReady(): boolean {
    return this.status.supabase;
  }

  isFullyReady(): boolean {
    return this.status.discord && this.status.supabase && this.status.initialized;
  }

  getReadinessReport(): string {
    const { discord, supabase, initialized } = this.status;
    return `Discord: ${discord ? 'READY' : 'NOT READY'}, Supabase: ${supabase ? 'READY' : 'NOT READY'}, Initialized: ${initialized ? 'YES' : 'NO'}`;
  }
}

export const healthTracker = new HealthTracker();
