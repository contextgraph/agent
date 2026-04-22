#!/bin/bash
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-$(dirname "$0")/../..}"

# npm is required both for the `npm ci` below and for resolving/installing the
# steward CLI. Surface a missing npm immediately rather than letting `set -e`
# fail at `npm ci` with a less obvious error.
if ! command -v npm >/dev/null 2>&1; then
  echo "session-start hook: npm is required but was not found on PATH" >&2
  exit 1
fi

if [ ! -d node_modules ]; then
  npm ci
fi

install_steward_cli() {
  # Resolve the latest published version from the npm registry so sessions
  # auto-roll-forward without a hook bump. Wrap with `timeout` so a hung
  # registry request cannot block session start.
  local version
  version="$(timeout 20s npm view @contextgraph/agent version 2>/dev/null || true)"
  if [ -z "$version" ]; then
    echo "session-start hook: could not resolve latest steward CLI version — skipping install" >&2
    return 0
  fi
  # Defensive: reject anything that doesn't look like semver before
  # interpolating into the install command.
  if ! [[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+([.+-][A-Za-z0-9.+-]+)?$ ]]; then
    echo "session-start hook: resolved steward CLI version '$version' is not semver — skipping install" >&2
    return 0
  fi

  if command -v steward >/dev/null 2>&1; then
    local installed_version
    installed_version="$(steward --version 2>/dev/null | awk '{print $NF}' || true)"
    if [ "$installed_version" = "$version" ]; then
      return 0
    fi
  fi

  npm install -g "@contextgraph/agent@${version}" >/dev/null

  echo "session-start hook: installed steward CLI v${version} (@contextgraph/agent)"
}

install_steward_cli
