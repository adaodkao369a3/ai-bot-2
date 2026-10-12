/**
 * Picks a random line from a list but skips the ones used most recently, so canned
 * messages ("found one", "nahhh couldn't find one", error lines...) don't repeat
 * back to back. History is kept per scope (for example a channel or a server).
 */

import { CANNED_NO_REPEAT_COUNT } from '../config';

export class VarietyPicker {
  private history: Map<string, string[]> = new Map();
  private readonly MAX_SCOPES = 2000;

  constructor(private readonly random: () => number = () => Math.random()) {}

  /**
   * @param scope   what "recently" is measured in, e.g. `meme-ok:<channelId>`
   * @param options the lines to choose from
   * @param avoid   how many of the latest picks to skip (default CANNED_NO_REPEAT_COUNT)
   */
  pick<T>(scope: string, options: T[], avoid: number = CANNED_NO_REPEAT_COUNT, keyOf: (item: T) => string = String): T {
    if (options.length === 0) {
      throw new Error('VarietyPicker.pick needs at least one option');
    }
    if (options.length === 1) {
      return options[0];
    }

    const recent = this.history.get(scope) ?? [];
    // Never skip so many that nothing is left
    const skipCount = Math.min(avoid, options.length - 1);
    const skipped = new Set(skipCount > 0 ? recent.slice(-skipCount) : []);

    let candidates = options.filter(option => !skipped.has(keyOf(option)));
    if (candidates.length === 0) {
      candidates = options;
    }

    const choice = candidates[Math.min(candidates.length - 1, Math.floor(this.random() * candidates.length))];

    recent.push(keyOf(choice));
    if (recent.length > Math.max(avoid, 1) * 2) {
      recent.splice(0, recent.length - Math.max(avoid, 1) * 2);
    }

    this.history.delete(scope);
    this.history.set(scope, recent);
    while (this.history.size > this.MAX_SCOPES) {
      const oldest = this.history.keys().next().value as string;
      this.history.delete(oldest);
    }

    return choice;
  }

  clear(): void {
    this.history.clear();
  }
}

export const variety = new VarietyPicker();
