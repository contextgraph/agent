# Changelog

All notable changes to this project will be documented in this file.

## [0.2.0] - 2025-11-22

### Changed
- **BREAKING**: Migrated from Claude CLI spawn to Claude Agent SDK
  - Removed legacy CLI spawn implementation (`src/claude-cli.ts`)
  - Removed `USE_CLAUDE_SDK` feature flag - SDK is now the only implementation
  - Updated all workflows to use SDK exclusively
  - Improved observability with native SDK hook system
  - Better session management and error handling

### Removed
- Removed `spawnClaude()` function and CLI spawn code
- Removed feature flag environment variable `USE_CLAUDE_SDK`
- Removed CLI fallback mode documentation

### Technical Details
- SDK provides native TypeScript integration eliminating process spawning overhead
- Hook system enables better observability than stdout parsing
- Session management and resumption built into SDK
- All tests updated to use SDK implementation

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
- Initial release of @context-graph/agent
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
