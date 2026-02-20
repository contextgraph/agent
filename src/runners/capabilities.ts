/**
 * Standard Agent Capability Vocabulary
 *
 * This module defines the canonical set of agent capabilities and their semantic meanings.
 * All agent runners should declare capabilities using these standardized values.
 */

/**
 * Canonical agent capability identifiers
 */
export const AGENT_CAPABILITIES = {
  /** Agent can execute code with full filesystem and network access (bypasses sandbox restrictions) */
  FULL_ACCESS_EXECUTION: 'full_access_execution',

  /** Agent can perform git operations (commit, push, branch creation, etc.) */
  GIT_OPERATIONS: 'git_operations',

  /** Agent can create and manage GitHub pull requests */
  GITHUB_PR_OPERATIONS: 'github_pr_operations',

  /** Agent can prompt user for interactive input during execution */
  INTERACTIVE_PROMPTS: 'interactive_prompts',

  /** Agent can install and manage package dependencies (npm, yarn, pnpm, etc.) */
  PACKAGE_MANAGEMENT: 'package_management',

  /** Agent can run build tools and test suites */
  BUILD_AND_TEST: 'build_and_test',

  /** Agent can read and modify files in the workspace */
  FILE_OPERATIONS: 'file_operations',

  /** Agent can execute shell commands */
  SHELL_EXECUTION: 'shell_execution',

  /** Agent can make HTTP requests to external services */
  NETWORK_ACCESS: 'network_access',

  /** Agent can search and analyze code across the codebase */
  CODE_SEARCH: 'code_search',

  /** Agent can access and use MCP (Model Context Protocol) tools */
  MCP_TOOLS: 'mcp_tools',

  /** Agent supports multi-turn conversations with context preservation */
  MULTI_TURN_EXECUTION: 'multi_turn_execution',

  /** Agent can operate in background/async mode without blocking */
  ASYNC_EXECUTION: 'async_execution',

  /** Agent can stream real-time execution progress and logs */
  STREAMING_LOGS: 'streaming_logs',
} as const;

/**
 * Union type of all valid capability identifiers
 */
export type AgentCapability = (typeof AGENT_CAPABILITIES)[keyof typeof AGENT_CAPABILITIES];

/**
 * Metadata describing a capability's purpose and requirements
 */
export interface CapabilityMetadata {
  /** Unique identifier for this capability */
  id: AgentCapability;

  /** Human-readable name */
  name: string;

  /** Detailed description of what this capability enables */
  description: string;

  /** Security level: 'safe' (read-only, isolated), 'moderate' (can modify workspace), 'elevated' (unrestricted access) */
  securityLevel: 'safe' | 'moderate' | 'elevated';

  /** Whether this capability requires explicit user approval */
  requiresApproval?: boolean;

  /** Capabilities that this one depends on (must also be present) */
  dependencies?: AgentCapability[];
}

/**
 * Complete capability metadata catalog
 */
export const CAPABILITY_METADATA: Record<AgentCapability, CapabilityMetadata> = {
  [AGENT_CAPABILITIES.FULL_ACCESS_EXECUTION]: {
    id: AGENT_CAPABILITIES.FULL_ACCESS_EXECUTION,
    name: 'Full Access Execution',
    description: 'Execute code with full filesystem and network access, bypassing sandbox restrictions',
    securityLevel: 'elevated',
    requiresApproval: true,
    dependencies: [
      AGENT_CAPABILITIES.FILE_OPERATIONS,
      AGENT_CAPABILITIES.SHELL_EXECUTION,
      AGENT_CAPABILITIES.NETWORK_ACCESS,
    ],
  },

  [AGENT_CAPABILITIES.GIT_OPERATIONS]: {
    id: AGENT_CAPABILITIES.GIT_OPERATIONS,
    name: 'Git Operations',
    description: 'Perform git operations including commit, push, branch creation, and status checks',
    securityLevel: 'moderate',
    dependencies: [AGENT_CAPABILITIES.SHELL_EXECUTION],
  },

  [AGENT_CAPABILITIES.GITHUB_PR_OPERATIONS]: {
    id: AGENT_CAPABILITIES.GITHUB_PR_OPERATIONS,
    name: 'GitHub PR Operations',
    description: 'Create and manage GitHub pull requests using the gh CLI',
    securityLevel: 'moderate',
    requiresApproval: true,
    dependencies: [AGENT_CAPABILITIES.SHELL_EXECUTION, AGENT_CAPABILITIES.NETWORK_ACCESS],
  },

  [AGENT_CAPABILITIES.INTERACTIVE_PROMPTS]: {
    id: AGENT_CAPABILITIES.INTERACTIVE_PROMPTS,
    name: 'Interactive Prompts',
    description: 'Prompt user for interactive input during execution',
    securityLevel: 'safe',
  },

  [AGENT_CAPABILITIES.PACKAGE_MANAGEMENT]: {
    id: AGENT_CAPABILITIES.PACKAGE_MANAGEMENT,
    name: 'Package Management',
    description: 'Install and manage package dependencies (npm, yarn, pnpm, etc.)',
    securityLevel: 'moderate',
    dependencies: [AGENT_CAPABILITIES.SHELL_EXECUTION, AGENT_CAPABILITIES.FILE_OPERATIONS],
  },

  [AGENT_CAPABILITIES.BUILD_AND_TEST]: {
    id: AGENT_CAPABILITIES.BUILD_AND_TEST,
    name: 'Build and Test',
    description: 'Run build tools and test suites',
    securityLevel: 'moderate',
    dependencies: [AGENT_CAPABILITIES.SHELL_EXECUTION],
  },

  [AGENT_CAPABILITIES.FILE_OPERATIONS]: {
    id: AGENT_CAPABILITIES.FILE_OPERATIONS,
    name: 'File Operations',
    description: 'Read and modify files in the workspace',
    securityLevel: 'moderate',
  },

  [AGENT_CAPABILITIES.SHELL_EXECUTION]: {
    id: AGENT_CAPABILITIES.SHELL_EXECUTION,
    name: 'Shell Execution',
    description: 'Execute shell commands and scripts',
    securityLevel: 'moderate',
  },

  [AGENT_CAPABILITIES.NETWORK_ACCESS]: {
    id: AGENT_CAPABILITIES.NETWORK_ACCESS,
    name: 'Network Access',
    description: 'Make HTTP requests to external services and APIs',
    securityLevel: 'moderate',
  },

  [AGENT_CAPABILITIES.CODE_SEARCH]: {
    id: AGENT_CAPABILITIES.CODE_SEARCH,
    name: 'Code Search',
    description: 'Search and analyze code across the codebase using grep, ripgrep, etc.',
    securityLevel: 'safe',
    dependencies: [AGENT_CAPABILITIES.FILE_OPERATIONS],
  },

  [AGENT_CAPABILITIES.MCP_TOOLS]: {
    id: AGENT_CAPABILITIES.MCP_TOOLS,
    name: 'MCP Tools',
    description: 'Access and use Model Context Protocol (MCP) tools',
    securityLevel: 'moderate',
  },

  [AGENT_CAPABILITIES.MULTI_TURN_EXECUTION]: {
    id: AGENT_CAPABILITIES.MULTI_TURN_EXECUTION,
    name: 'Multi-turn Execution',
    description: 'Support multi-turn conversations with context preservation across turns',
    securityLevel: 'safe',
  },

  [AGENT_CAPABILITIES.ASYNC_EXECUTION]: {
    id: AGENT_CAPABILITIES.ASYNC_EXECUTION,
    name: 'Async Execution',
    description: 'Operate in background/async mode without blocking the main thread',
    securityLevel: 'safe',
  },

  [AGENT_CAPABILITIES.STREAMING_LOGS]: {
    id: AGENT_CAPABILITIES.STREAMING_LOGS,
    name: 'Streaming Logs',
    description: 'Stream real-time execution progress and logs as they occur',
    securityLevel: 'safe',
  },
};

/**
 * Backward compatibility: Map legacy boolean flags to capability sets
 */
export interface LegacyCapabilityFlags {
  /** @deprecated Use capability array with FULL_ACCESS_EXECUTION instead */
  fullAccessExecution?: boolean;
}

/**
 * Convert legacy capability flags to modern capability array
 *
 * @param legacy - Legacy capability flags (e.g., { fullAccessExecution: true })
 * @returns Array of modern capability identifiers
 */
export function legacyToCapabilities(legacy: LegacyCapabilityFlags): AgentCapability[] {
  const capabilities: AgentCapability[] = [];

  if (legacy.fullAccessExecution) {
    capabilities.push(AGENT_CAPABILITIES.FULL_ACCESS_EXECUTION);
  }

  return capabilities;
}

/**
 * Convert modern capability array to legacy flags for backward compatibility
 *
 * @param capabilities - Array of modern capability identifiers
 * @returns Legacy capability flags
 */
export function capabilitiesToLegacy(capabilities: AgentCapability[]): LegacyCapabilityFlags {
  return {
    fullAccessExecution: capabilities.includes(AGENT_CAPABILITIES.FULL_ACCESS_EXECUTION),
  };
}

/**
 * Check if a capability set includes a specific capability
 *
 * @param capabilities - Array of capability identifiers
 * @param required - Required capability
 * @returns True if the capability is present
 */
export function hasCapability(capabilities: AgentCapability[], required: AgentCapability): boolean {
  return capabilities.includes(required);
}

/**
 * Check if a capability set satisfies all required capabilities
 *
 * @param available - Available capabilities
 * @param required - Required capabilities
 * @returns True if all required capabilities are available
 */
export function satisfiesCapabilities(available: AgentCapability[], required: AgentCapability[]): boolean {
  return required.every((cap) => available.includes(cap));
}

/**
 * Get missing capabilities from a required set
 *
 * @param available - Available capabilities
 * @param required - Required capabilities
 * @returns Array of missing capabilities
 */
export function getMissingCapabilities(available: AgentCapability[], required: AgentCapability[]): AgentCapability[] {
  return required.filter((cap) => !available.includes(cap));
}

/**
 * Validate that all dependencies for a capability are present
 *
 * @param capabilities - Capability set to validate
 * @returns Array of validation errors (empty if valid)
 */
export function validateCapabilityDependencies(capabilities: AgentCapability[]): string[] {
  const errors: string[] = [];

  for (const capability of capabilities) {
    const metadata = CAPABILITY_METADATA[capability];
    if (metadata.dependencies) {
      const missing = getMissingCapabilities(capabilities, metadata.dependencies);
      if (missing.length > 0) {
        const missingNames = missing.map((cap) => CAPABILITY_METADATA[cap].name).join(', ');
        errors.push(`Capability "${metadata.name}" requires: ${missingNames}`);
      }
    }
  }

  return errors;
}
