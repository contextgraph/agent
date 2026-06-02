# steward

Local CLI for steward.foo.

## Install (one command)

```bash
npx -y @contextgraph/agent@latest install
```

`steward install` is an interactive wizard: it authenticates you, detects which
coding agents you have (Claude Code, Cursor, Codex CLI, VS Code, Gemini CLI,
Windsurf, …), and configures the steward **MCP server** plus the steward
**skills** for each one.

- It asks whether to install **globally** (`~/`, follows you across every
  project) or for **this project** (committable, shared with your team).
- Skills are written to the [Agent Skills](https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills)
  open-standard location (`.agents/skills`) **and** mirrored into `.claude/skills`,
  so they work across the whole ecosystem.
- For Claude Code it installs the plugin (MCP + skills + `/steward:` commands).
- For UI-only destinations (claude.ai, ChatGPT) it prints the connector steps.

Useful flags:

```bash
steward install --print                  # show copy-paste config, write nothing
steward install --scope project          # skip the scope prompt
steward install --client cursor codex    # target specific agents
steward install --no-mirror              # write skills only to .agents/skills
```

For non-interactive environments, set `STEWARD_API_TOKEN` and pass `--scope`/`--client`.

## Other commands

```bash
steward --help
steward backlog --help
steward backlog top
steward review <repository> <sha>
steward consult <repository> --message "..."
```

`steward auth` opens a browser login and stores credentials locally in `~/.steward/credentials.json`.

## Tell Your Agent

Append this to `CLAUDE.md` or `AGENTS.md` in your project:

```bash
echo "Use the \`steward\` CLI for steward.foo work. Learn the workflow from \`steward --help\` and \`steward backlog --help\`." >> CLAUDE.md
```

## Releases

Versioning and npm publishing are automated by [release-please](https://github.com/googleapis/release-please). Use [Conventional Commits](https://www.conventionalcommits.org/) on `main` so the right semver bump and changelog entries are picked up:

- `fix: ...` → patch bump
- `feat: ...` → minor bump
- `feat!: ...` or a `BREAKING CHANGE:` footer → major bump (minor while pre-1.0.0)
- `chore:`, `docs:`, `refactor:`, `test:`, `ci:` → no release on their own

When releasable commits land on `main`, release-please opens a rolling "Release PR" with the proposed version bump and changelog. Review and edit that PR's notes if you want to adjust user-facing wording — merging it tags the release and publishes to npm via [Trusted Publishers](https://docs.npmjs.com/trusted-publishers) (OIDC, no token).
