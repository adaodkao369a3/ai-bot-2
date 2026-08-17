/**
 * Tests for permission system
 */

import { PermissionService } from '../src/services/permissions';
import { PERMISSIONS } from '../src/config';

// Mock GuildMember
class MockGuildMember {
  roles: {
    cache: Map<string, any>;
  };
  permissions: {
    has: (flag: any) => boolean;
  };

  constructor(roleIds: string[] = [], isAdmin: boolean = false) {
    this.roles = {
      cache: new Map(roleIds.map(id => [id, { id }]))
    };
    this.permissions = {
      has: () => isAdmin
    };
  }
}

describe('PermissionService', () => {
  let permissionService: PermissionService;

  beforeEach(() => {
    permissionService = new PermissionService();
  });

  describe('hasRole', () => {
    it('should return true when member has the role', () => {
      const member = new MockGuildMember(['123456']);
      expect(permissionService.hasRole(member as any, '123456')).toBe(true);
    });

    it('should return false when member does not have the role', () => {
      const member = new MockGuildMember(['123456']);
      expect(permissionService.hasRole(member as any, '789012')).toBe(false);
    });
  });

  describe('isExtra', () => {
    it('should return true for Extra role', () => {
      const member = new MockGuildMember(['1535285274832277514']);
      expect(permissionService.isExtra(member as any)).toBe(true);
    });

    it('should return false for non-Extra role', () => {
      const member = new MockGuildMember(['123456']);
      expect(permissionService.isExtra(member as any)).toBe(false);
    });
  });

  describe('isFeaturedExtra', () => {
    it('should return true for Featured Extra role', () => {
      const member = new MockGuildMember(['1535285299410771988']);
      expect(permissionService.isFeaturedExtra(member as any)).toBe(true);
    });

    it('should return false for non-Featured Extra role', () => {
      const member = new MockGuildMember(['123456']);
      expect(permissionService.isFeaturedExtra(member as any)).toBe(false);
    });
  });

  describe('isSupportingCast', () => {
    it('should return true for Supporting Cast role', () => {
      const member = new MockGuildMember(['1535285344952651829']);
      expect(permissionService.isSupportingCast(member as any)).toBe(true);
    });

    it('should return false for non-Supporting Cast role', () => {
      const member = new MockGuildMember(['123456']);
      expect(permissionService.isSupportingCast(member as any)).toBe(false);
    });
  });

  describe('hasMemoryEligibility', () => {
    it('should return true for Extra role', () => {
      const member = new MockGuildMember(['1535285274832277514']);
      expect(permissionService.hasMemoryEligibility(member as any)).toBe(true);
    });

    it('should return true for Featured Extra role', () => {
      const member = new MockGuildMember(['1535285299410771988']);
      expect(permissionService.hasMemoryEligibility(member as any)).toBe(true);
    });

    it('should return true for Supporting Cast role', () => {
      const member = new MockGuildMember(['1535285344952651829']);
      expect(permissionService.hasMemoryEligibility(member as any)).toBe(true);
    });

    it('should return false for regular user', () => {
      const member = new MockGuildMember(['123456']);
      expect(permissionService.hasMemoryEligibility(member as any)).toBe(false);
    });
  });

  describe('canUse', () => {
    it('should allow memory permission for Extra+', () => {
      const member = new MockGuildMember(['1535285274832277514']);
      expect(permissionService.canUse(member as any, PERMISSIONS.MEMORY)).toBe(true);
    });

    it('should deny memory permission for regular users', () => {
      const member = new MockGuildMember(['123456']);
      expect(permissionService.canUse(member as any, PERMISSIONS.MEMORY)).toBe(false);
    });

    it('should deny unimplemented permissions', () => {
      const member = new MockGuildMember(['1535285274832277514']);
      expect(permissionService.canUse(member as any, PERMISSIONS.MEME)).toBe(false);
      expect(permissionService.canUse(member as any, PERMISSIONS.GIF)).toBe(false);
      expect(permissionService.canUse(member as any, PERMISSIONS.YOUTUBE)).toBe(false);
    });
  });

  describe('getUserRoleTier', () => {
    it('should return supporting_cast for Supporting Cast', () => {
      const member = new MockGuildMember(['1535285344952651829']);
      expect(permissionService.getUserRoleTier(member as any)).toBe('supporting_cast');
    });

    it('should return featured_extra for Featured Extra', () => {
      const member = new MockGuildMember(['1535285299410771988']);
      expect(permissionService.getUserRoleTier(member as any)).toBe('featured_extra');
    });

    it('should return extra for Extra', () => {
      const member = new MockGuildMember(['1535285274832277514']);
      expect(permissionService.getUserRoleTier(member as any)).toBe('extra');
    });

    it('should return regular for regular user', () => {
      const member = new MockGuildMember(['123456']);
      expect(permissionService.getUserRoleTier(member as any)).toBe('regular');
    });

    it('should return staff for an admin with no Extra-tier role', () => {
      const member = new MockGuildMember([], true);
      expect(permissionService.getUserRoleTier(member as any)).toBe('staff');
    });
  });

  describe('isStaff', () => {
    it('should return true for a member with Administrator permission', () => {
      const member = new MockGuildMember([], true);
      expect(permissionService.isStaff(member as any)).toBe(true);
    });

    it('should return false for a member without Administrator permission', () => {
      const member = new MockGuildMember(['123456'], false);
      expect(permissionService.isStaff(member as any)).toBe(false);
    });
  });

  describe('hasMemoryEligibility for staff', () => {
    it('should return true for an admin with no Extra-tier role', () => {
      const member = new MockGuildMember([], true);
      expect(permissionService.hasMemoryEligibility(member as any)).toBe(true);
    });
  });
});
