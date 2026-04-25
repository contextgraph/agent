# steward

Local CLI for steward.foo.

## Quick Start

```bash
npm install -g @contextgraph/agent
steward auth
steward --help
steward backlog --help
steward backlog top
```

`steward auth` opens a browser login and stores credentials locally in `~/.steward/credentials.json`.

For non-interactive environments, set `STEWARD_API_TOKEN` instead of using browser auth.

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
