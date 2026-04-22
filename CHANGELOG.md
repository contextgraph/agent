# Changelog

All notable changes to this project will be documented in this file.

## Unreleased

### Removed
- Legacy local-integrations model. The CLI no longer fetches an "integration
  surfaces" catalog from the platform, matches surfaces against local env vars,
  or injects an "Available Integrations" section into claim output / step
  prompts. The server endpoint `/api/integrations/surfaces` it relied on no
  longer exists, so every `steward backlog claim` was already printing a
  `failed to load integration surfaces: API error 404` warning. This removes
  `ApiClient.getIntegrationSurfaces`, the `IntegrationSurfaceResource` type, the
  `steward configure` / `steward configure validate` commands (and the
  `~/.steward/config.json` scaffold they maintained), the orphan
  `steward-heartbeat` workflow, and the `.steward/integrations/...` tooling
  guidance that only made sense under the local model. Workspace-scoped
  integrations now live on the platform side (steward.foo workspace settings);
  there is no CLI-side replacement.

## [0.1.1] - 2025-11-16

### Fixed
- Fixed 400 error on iteration 2 by using local findNextLeaf instead of nonexistent API endpoint
- Fixed auth command hanging after successful authentication by properly awaiting server close

### Changed
- Updated README to prioritize npx usage over global installation
- Removed unused ApiClient.findNextLeaf() method
- Simplified agent workflow to use local tree traversal

## [0.1.0] - 2025-11-15

### Added
- Initial release of @contextgraph/agent
- OAuth authentication with contextgraph.dev
- CLI commands: auth, whoami, run, prepare, execute
- Autonomous agent loop with tree traversal
- Dependency-aware action execution
- Claude CLI integration for agent execution
- MCP server integration
- Secure credential storage in ~/.contextgraph/

### Technical Details
- ESM-only package for Node.js 18+
- Built with TypeScript and tsup
- Commander framework for CLI
- Extracted from actionbias repository
