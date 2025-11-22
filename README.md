# @context-graph/agent

Autonomous agent for contextgraph action execution.

## Installation

No installation required! Use npx to run commands directly:

```bash
npx @context-graph/agent <command>
```

Or install globally for convenience:

```bash
npm install -g @context-graph/agent
```

## Prerequisites

- Node.js 18 or higher
- Active contextgraph.dev account

The agent uses the Claude Agent SDK for execution.

## Quick Start

1. Authenticate with contextgraph.dev:

```bash
npx @context-graph/agent auth
```

2. Run an action:

```bash
npx @context-graph/agent run <action-id>
```

Get your action ID from https://contextgraph.dev

## Commands

### `auth`
Authenticate with contextgraph.dev using OAuth:

```bash
npx @context-graph/agent auth
```

Opens your browser to complete authentication. Credentials are securely stored in `~/.contextgraph/`.

### `whoami`
Check your current authentication status:

```bash
npx @context-graph/agent whoami
```

Shows your user ID and token expiration.

### `run <action-id>`
Run the autonomous agent loop:

```bash
npx @context-graph/agent run <action-id>
```

The agent will:
1. Fetch the action tree
2. Find the next unprepared/incomplete leaf action
3. Prepare it (if needed) - assess if it should be broken down
4. Execute it - implement the work using Claude
5. Repeat until all actions are complete

### `prepare <action-id>`
Prepare a single action:

```bash
npx @context-graph/agent prepare <action-id>
```

Spawns Claude to assess whether the action should be broken down into child actions or is ready to execute.

### `execute <action-id>`
Execute a single prepared action:

```bash
npx @context-graph/agent execute <action-id>
```

Spawns Claude to implement the action and mark it complete.

### `auth:git`
Authenticate with git providers (GitHub or GitLab):

```bash
npx @context-graph/agent auth:git
```

The agent will attempt to acquire credentials using multiple strategies:
1. **GitHub CLI** - Automatically uses `gh auth token` if you're authenticated
2. **Environment variables** - Checks for `GITHUB_TOKEN` or `GITLAB_TOKEN`
3. **Manual prompt** - Prompts you to enter a token if other methods fail

Credentials are securely stored in `~/.contextgraph/credentials.json` and reused for future operations.

## Repository Access

The agent supports automatic repository cloning and workspace preparation when actions specify repository context. This enables the agent to work across multiple repositories and branches.

### Setting Up Git Authentication

Before the agent can clone repositories, authenticate with your git provider:

```bash
npx @context-graph/agent auth:git
```

This command will:
- Try to use your existing GitHub CLI authentication (`gh auth token`)
- Fall back to environment variables (`GITHUB_TOKEN`, `GITLAB_TOKEN`)
- Prompt you for a token if neither is available

Check your authentication status with:

```bash
npx @context-graph/agent whoami
```

### Configuring Repository Context

Actions can specify repository context on [contextgraph.dev](https://contextgraph.dev):

1. **repository_url** - The git repository URL (HTTPS or SSH)
2. **branch** - The target branch to work on

When you set these fields on an action, the agent will:
- Automatically clone the repository (or reuse a cached workspace)
- Check out the specified branch
- Execute the action in that workspace
- Clean up the workspace when complete

### Repository Inheritance

Actions inherit repository context from their parent chain. This means you can set `repository_url` and `branch` on a parent action, and all child actions will automatically use those values unless overridden.

The inherited values are available as:
- `resolved_repository_url` - The effective repository URL (from the action or its ancestors)
- `resolved_branch` - The effective branch (from the action or its ancestors)

**Example hierarchy:**
```
Parent Action
  repository_url: https://github.com/user/repo.git
  branch: feature/new-feature

  ├─ Child Action 1
  │  (inherits parent's repository_url and branch)
  │
  └─ Child Action 2
     branch: feature/variant
     (uses parent's repository_url but overrides branch)
```

### Multi-Repository Workflows

The agent can work across multiple repositories in a single action tree:

1. **Repository A** - Parent action targets first repository
   - Set `repository_url` to Repository A
   - Set `branch` to target branch

2. **Repository B** - Sibling action targets second repository
   - Set `repository_url` to Repository B
   - Set `branch` to target branch

Each action executes in its own workspace, with the agent managing cloning and cleanup automatically.

### Workspace Caching

The agent uses persistent workspace caching for better performance:

- Workspaces are stored in `~/.contextgraph/workspaces/`
- Repeated operations on the same repository reuse the cached workspace
- LRU eviction policy automatically manages disk space
- Cleanup happens asynchronously to avoid blocking operations

**Performance benefits:**
- First clone: ~1-15 seconds (depending on repository size)
- Cached operations: ~1-2 seconds (10-19.6x faster for large repositories)

## How It Works

The agent implements a prepare/execute workflow:

**Prepare Phase:**
- Fetches action details including parent chain, siblings, and dependencies
- Analyzes whether the action is atomic or should be broken down
- If complex, creates child actions with proper dependencies
- Marks the action as prepared

**Execute Phase:**
- Implements the work described in the action
- Runs tests and builds to verify changes
- Commits and pushes changes to the appropriate branch
- Marks the action as complete with detailed completion context

**Autonomous Loop:**
- The `run` command traverses the action tree depth-first
- Automatically prepares and executes actions in dependency order
- Continues until all actions in the tree are complete

The agent integrates with contextgraph.dev's MCP server to:
- Fetch action details and relationships
- Create and update actions
- Track completion context and learnings

## Troubleshooting

### Authentication failures

If authentication fails or tokens expire:

```bash
npx @context-graph/agent auth
```

This will open a new browser session to re-authenticate.

### Expired credentials

Tokens expire after a period of time. Re-authenticate with:

```bash
npx @context-graph/agent whoami  # Check expiration
npx @context-graph/agent auth    # Re-authenticate if expired
```

### Network errors

Ensure you have internet connectivity and can reach:
- https://www.contextgraph.dev (API endpoint)
- https://contextgraph.dev (authentication)

### Repository access issues

#### Git authentication required

If you see errors like "Authentication required" or "repository not found":

```bash
npx @context-graph/agent auth:git
```

The agent needs credentials to clone private repositories. Use one of these methods:
- Authenticate with GitHub CLI: `gh auth login`
- Set environment variable: `export GITHUB_TOKEN=ghp_...`
- Run `auth:git` and enter token manually

#### Invalid repository URL

Ensure the repository URL is in one of these formats:
- HTTPS: `https://github.com/user/repo.git`
- SSH: `git@github.com:user/repo.git`
- Git protocol: `git://github.com/user/repo.git`

#### Branch does not exist

If the specified branch doesn't exist:
- The agent will attempt to create it locally or fall back to the default branch
- Verify the branch name is correct on contextgraph.dev
- Check that the branch exists in the remote repository

#### Network timeouts

For large repositories or slow connections:
- First clone may take several minutes
- Subsequent operations use cached workspace (much faster)
- Check your internet connection speed
- Consider using SSH instead of HTTPS for better performance

#### Permission denied

If you get "permission denied" errors:
- Verify your token has appropriate repository access
- For GitHub: Token needs `repo` scope for private repositories
- For GitLab: Token needs `read_repository` scope minimum
- Check that you have access to the repository

#### Workspace cleanup errors

If you see workspace-related errors:
- Workspaces are automatically cleaned up asynchronously
- Manual cleanup: Remove `~/.contextgraph/workspaces/` directory
- Check disk space: `df -h ~/.contextgraph/workspaces/`

## Links

- [contextgraph.dev](https://contextgraph.dev) - Main platform
- [GitHub Repository](https://github.com/context-graph/agent) - Source code and issues
- [Issue Tracker](https://github.com/context-graph/agent/issues) - Report bugs or request features

## Configuration

Credentials are stored in `~/.contextgraph/credentials.json`

The agent uses the Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`) for execution, providing:
- Native TypeScript integration
- Better observability through hook system
- Built-in session management and resumption
- Improved performance and reliability

## Development

```bash
# Install dependencies
pnpm install

# Build
pnpm build

# Development mode
pnpm dev
```

## License

MIT
