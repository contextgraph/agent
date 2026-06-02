/**
 * Shared types for the `steward install` flow.
 */

/** Where configuration and skills are written. */
export type InstallScope = 'global' | 'project';

/** The MCP server name registered into every client config. */
export const MCP_SERVER_NAME = 'steward';
