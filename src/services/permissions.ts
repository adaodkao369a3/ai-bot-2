/**
 * Permission system for Bocchi
 * Handles role-based feature access control
 */

import { GuildMember, PermissionsBitField } from 'discord.js';
import { EXTRA_ROLE_ID, FEATURED_EXTRA_ROLE_ID, SUPPORTING_CAST_ROLE_ID, PERMISSIONS } from '../config';
import { logger } from '../utils/logger';

type PermissionName = typeof PERMISSIONS[keyof typeof PERMISSIONS];

export class PermissionService {
  /**
   * Check if a user has a specific role
   */
  hasRole(member: GuildMember, roleId: string): boolean {
    return member.roles.cache.has(roleId);
  }

  /**
   * Check if user is an Extra (memory eligible)
   */
  isExtra(member: GuildMember): boolean {
    return this.hasRole(member, EXTRA_ROLE_ID);
  }

  /**
   * Check if user is a Featured Extra
   */
  isFeaturedExtra(member: GuildMember): boolean {
    return this.hasRole(member, FEATURED_EXTRA_ROLE_ID);
  }

  /**
   * Check if user is Supporting Cast
   */
  isSupportingCast(member: GuildMember): boolean {
    return this.hasRole(member, SUPPORTING_CAST_ROLE_ID);
  }

  /**
   * Check if user is staff (server Administrator).
   * Staff bypass things like rate limiting and are always memory eligible.
   */
  isStaff(member: GuildMember): boolean {
    return member.permissions.has(PermissionsBitField.Flags.Administrator);
  }

  /**
   * Check if user has any Extra-tier role (memory eligible), or is staff
   */
  hasMemoryEligibility(member: GuildMember): boolean {
    return this.isStaff(member) ||
           this.isExtra(member) || 
           this.isFeaturedExtra(member) || 
           this.isSupportingCast(member);
  }

  /**
   * Check if user can use a specific feature
   * For Phase 2, only memory permission is implemented
   */
  canUse(member: GuildMember, permission: PermissionName): boolean {
    // Administrators/staff are never feature-gated.
    if (this.isStaff(member)) {
      return true;
    }

    switch (permission) {
      case PERMISSIONS.MEMORY:
        return this.hasMemoryEligibility(member);
      case PERMISSIONS.MEME:
      case PERMISSIONS.GIF:
      case PERMISSIONS.YOUTUBE:
        // These will be implemented in later phases
        logger.debug(`Permission check for ${permission} - not yet implemented`);
        return false;
      default:
        logger.warn(`Unknown permission requested: ${permission}`);
        return false;
    }
  }

  /**
   * Get user's role tier for display/logging purposes
   */
  getUserRoleTier(member: GuildMember): string {
    if (this.isStaff(member)) return 'staff';
    if (this.isSupportingCast(member)) return 'supporting_cast';
    if (this.isFeaturedExtra(member)) return 'featured_extra';
    if (this.isExtra(member)) return 'extra';
    return 'regular';
  }
}

export const permissionService = new PermissionService();
