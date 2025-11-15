# Changelog

All notable changes to this project will be documented in this file.

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
