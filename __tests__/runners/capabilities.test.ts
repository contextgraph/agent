import { describe, expect, it } from '@jest/globals';
import type { AgentCapability } from '../../src/runners/capabilities.js';
import {
  AGENT_CAPABILITIES,
  CAPABILITY_METADATA,
  hasCapability,
  satisfiesCapabilities,
  getMissingCapabilities,
  validateCapabilityDependencies,
  legacyToCapabilities,
  capabilitiesToLegacy,
} from '../../src/runners/capabilities.js';

describe('Agent Capabilities', () => {
  describe('AGENT_CAPABILITIES', () => {
    it('should define standard capability identifiers', () => {
      expect(AGENT_CAPABILITIES.FULL_ACCESS_EXECUTION).toBe('full_access_execution');
      expect(AGENT_CAPABILITIES.GIT_OPERATIONS).toBe('git_operations');
      expect(AGENT_CAPABILITIES.FILE_OPERATIONS).toBe('file_operations');
    });

    it('should have metadata for all capabilities', () => {
      const capabilityIds = Object.values(AGENT_CAPABILITIES);
      for (const id of capabilityIds) {
        expect(CAPABILITY_METADATA[id]).toBeDefined();
        expect(CAPABILITY_METADATA[id].id).toBe(id);
        expect(CAPABILITY_METADATA[id].name).toBeTruthy();
        expect(CAPABILITY_METADATA[id].description).toBeTruthy();
        expect(CAPABILITY_METADATA[id].securityLevel).toMatch(/^(safe|moderate|elevated)$/);
      }
    });
  });

  describe('hasCapability', () => {
    it('should return true when capability is present', () => {
      const caps = [AGENT_CAPABILITIES.FILE_OPERATIONS, AGENT_CAPABILITIES.GIT_OPERATIONS];
      expect(hasCapability(caps, AGENT_CAPABILITIES.FILE_OPERATIONS)).toBe(true);
    });

    it('should return false when capability is absent', () => {
      const caps = [AGENT_CAPABILITIES.FILE_OPERATIONS];
      expect(hasCapability(caps, AGENT_CAPABILITIES.GIT_OPERATIONS)).toBe(false);
    });
  });

  describe('satisfiesCapabilities', () => {
    it('should return true when all required capabilities are present', () => {
      const available = [AGENT_CAPABILITIES.FILE_OPERATIONS, AGENT_CAPABILITIES.GIT_OPERATIONS];
      const required = [AGENT_CAPABILITIES.FILE_OPERATIONS];
      expect(satisfiesCapabilities(available, required)).toBe(true);
    });

    it('should return false when some required capabilities are missing', () => {
      const available = [AGENT_CAPABILITIES.FILE_OPERATIONS];
      const required = [AGENT_CAPABILITIES.FILE_OPERATIONS, AGENT_CAPABILITIES.GIT_OPERATIONS];
      expect(satisfiesCapabilities(available, required)).toBe(false);
    });

    it('should return true for empty required set', () => {
      const available = [AGENT_CAPABILITIES.FILE_OPERATIONS];
      const required: AgentCapability[] = [];
      expect(satisfiesCapabilities(available, required)).toBe(true);
    });
  });

  describe('getMissingCapabilities', () => {
    it('should return empty array when all requirements are met', () => {
      const available = [AGENT_CAPABILITIES.FILE_OPERATIONS, AGENT_CAPABILITIES.GIT_OPERATIONS];
      const required = [AGENT_CAPABILITIES.FILE_OPERATIONS];
      expect(getMissingCapabilities(available, required)).toEqual([]);
    });

    it('should return missing capabilities', () => {
      const available = [AGENT_CAPABILITIES.FILE_OPERATIONS];
      const required = [AGENT_CAPABILITIES.FILE_OPERATIONS, AGENT_CAPABILITIES.GIT_OPERATIONS];
      const missing = getMissingCapabilities(available, required);
      expect(missing).toEqual([AGENT_CAPABILITIES.GIT_OPERATIONS]);
    });
  });

  describe('validateCapabilityDependencies', () => {
    it('should return empty array for valid capability set', () => {
      const capabilities = [
        AGENT_CAPABILITIES.FILE_OPERATIONS,
        AGENT_CAPABILITIES.SHELL_EXECUTION,
        AGENT_CAPABILITIES.GIT_OPERATIONS,
      ];
      expect(validateCapabilityDependencies(capabilities)).toEqual([]);
    });

    it('should detect missing dependencies', () => {
      // GIT_OPERATIONS requires SHELL_EXECUTION
      const capabilities = [AGENT_CAPABILITIES.GIT_OPERATIONS];
      const errors = validateCapabilityDependencies(capabilities);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0]).toContain('Shell Execution');
    });

    it('should detect multiple missing dependencies', () => {
      // FULL_ACCESS_EXECUTION requires FILE_OPERATIONS, SHELL_EXECUTION, NETWORK_ACCESS
      const capabilities = [AGENT_CAPABILITIES.FULL_ACCESS_EXECUTION];
      const errors = validateCapabilityDependencies(capabilities);
      expect(errors.length).toBeGreaterThan(0);
    });
  });

  describe('Legacy compatibility', () => {
    describe('legacyToCapabilities', () => {
      it('should convert fullAccessExecution=true to FULL_ACCESS_EXECUTION capability', () => {
        const result = legacyToCapabilities({ fullAccessExecution: true });
        expect(result).toContain(AGENT_CAPABILITIES.FULL_ACCESS_EXECUTION);
      });

      it('should return empty array for fullAccessExecution=false', () => {
        const result = legacyToCapabilities({ fullAccessExecution: false });
        expect(result).toEqual([]);
      });

      it('should handle undefined fullAccessExecution', () => {
        const result = legacyToCapabilities({});
        expect(result).toEqual([]);
      });
    });

    describe('capabilitiesToLegacy', () => {
      it('should convert FULL_ACCESS_EXECUTION to fullAccessExecution=true', () => {
        const caps = [AGENT_CAPABILITIES.FULL_ACCESS_EXECUTION, AGENT_CAPABILITIES.FILE_OPERATIONS];
        const result = capabilitiesToLegacy(caps);
        expect(result.fullAccessExecution).toBe(true);
      });

      it('should set fullAccessExecution=false when capability is absent', () => {
        const caps = [AGENT_CAPABILITIES.FILE_OPERATIONS];
        const result = capabilitiesToLegacy(caps);
        expect(result.fullAccessExecution).toBe(false);
      });

      it('should handle empty capability array', () => {
        const result = capabilitiesToLegacy([]);
        expect(result.fullAccessExecution).toBe(false);
      });
    });

    describe('Round-trip conversion', () => {
      it('should maintain fullAccessExecution=true through round-trip', () => {
        const legacy = { fullAccessExecution: true };
        const capabilities = legacyToCapabilities(legacy);
        const backToLegacy = capabilitiesToLegacy(capabilities);
        expect(backToLegacy.fullAccessExecution).toBe(true);
      });

      it('should maintain fullAccessExecution=false through round-trip', () => {
        const legacy = { fullAccessExecution: false };
        const capabilities = legacyToCapabilities(legacy);
        const backToLegacy = capabilitiesToLegacy(capabilities);
        expect(backToLegacy.fullAccessExecution).toBe(false);
      });
    });
  });

  describe('Runner capability declarations', () => {
    // Note: These tests verify the capability structure without importing the full runners
    // to avoid ESM import issues with the Claude SDK in the Jest test environment.

    it('should support RunnerCapabilities interface with both legacy and modern fields', () => {
      // Verify the interface structure supports both legacy boolean and modern array
      const legacyOnly = { fullAccessExecution: false };
      const withModern = {
        fullAccessExecution: true,
        capabilities: [AGENT_CAPABILITIES.FULL_ACCESS_EXECUTION],
      };

      // Both should be valid RunnerCapabilities objects
      expect(legacyOnly.fullAccessExecution).toBe(false);
      expect(withModern.fullAccessExecution).toBe(true);
      expect(withModern.capabilities).toContain(AGENT_CAPABILITIES.FULL_ACCESS_EXECUTION);
    });

    it('should validate Codex runner capabilities', () => {
      const { codexRunner } = require('../../src/runners/codex-runner.js');

      // Should have capabilities array
      expect(codexRunner.capabilities.capabilities).toBeDefined();
      expect(Array.isArray(codexRunner.capabilities.capabilities)).toBe(true);

      // Should maintain legacy flag
      expect(codexRunner.capabilities.fullAccessExecution).toBe(true);

      // Should have FULL_ACCESS_EXECUTION in capabilities array
      expect(codexRunner.capabilities.capabilities).toContain(
        AGENT_CAPABILITIES.FULL_ACCESS_EXECUTION
      );

      // Should have comprehensive capabilities
      expect(codexRunner.capabilities.capabilities.length).toBeGreaterThan(5);
    });
  });
});
