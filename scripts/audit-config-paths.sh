#!/usr/bin/env bash
# Systematic audit of configuration file path references against actual filesystem
# Addresses lesson: "Config entries outlive their referenced artifacts"
#
# Usage: ./scripts/audit-config-paths.sh
# Exit codes: 0 = all paths valid, 1 = stale references found

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

echo "=== Config Path Audit ==="
echo "Repository: $(basename "$PWD")"
echo

ISSUES_FOUND=0

# Audit tsconfig.json
if [ -f tsconfig.json ]; then
  echo "📋 Auditing tsconfig.json..."

  # Extract and verify 'include' paths
  if command -v jq &> /dev/null; then
    INCLUDES=$(jq -r '.include[]? // empty' tsconfig.json)
    if [ -n "$INCLUDES" ]; then
      while IFS= read -r pattern; do
        # Convert glob pattern to base directory
        base_dir=$(echo "$pattern" | sed 's|/\*\*.*||' | sed 's|/\*.*||')
        if [ -n "$base_dir" ] && [ ! -e "$base_dir" ]; then
          echo "  ❌ STALE: include pattern '$pattern' references missing path '$base_dir'"
          ISSUES_FOUND=$((ISSUES_FOUND + 1))
        else
          echo "  ✓ include: $pattern"
        fi
      done <<< "$INCLUDES"
    fi
  else
    echo "  ℹ️  jq not found - skipping tsconfig.json detailed parsing"
  fi

  # Extract and verify 'exclude' paths (skip node_modules/dist as they're build artifacts)
  if command -v jq &> /dev/null; then
    EXCLUDES=$(jq -r '.exclude[]? // empty' tsconfig.json)
    if [ -n "$EXCLUDES" ]; then
      while IFS= read -r pattern; do
        # Skip checking build artifacts that are expected to not exist in source
        if [[ "$pattern" == "node_modules" ]] || [[ "$pattern" == "dist" ]] || [[ "$pattern" == "build" ]]; then
          echo "  ✓ exclude: $pattern (build artifact, OK to not exist)"
        else
          base_dir=$(echo "$pattern" | sed 's|/\*\*.*||' | sed 's|/\*.*||')
          if [ -n "$base_dir" ] && [ ! -e "$base_dir" ]; then
            echo "  ❌ STALE: exclude pattern '$pattern' references missing path '$base_dir'"
            ISSUES_FOUND=$((ISSUES_FOUND + 1))
          else
            echo "  ✓ exclude: $pattern"
          fi
        fi
      done <<< "$EXCLUDES"
    fi
  fi

  echo
fi

# Audit jest.config.js
if [ -f jest.config.js ]; then
  echo "📋 Auditing jest.config.js..."

  # Check for common path-related patterns in jest config
  # testMatch, collectCoverageFrom, etc.
  echo "  ℹ️  Checking jest.config.js path patterns..."

  # Extract testMatch patterns
  TEST_PATTERNS=$(grep -o "testMatch.*\[.*\]" jest.config.js | grep -o "'[^']*'" | tr -d "'" || true)
  if [ -n "$TEST_PATTERNS" ]; then
    while IFS= read -r pattern; do
      base_dir=$(echo "$pattern" | sed 's|/\*\*.*||' | sed 's|^\*\*/||')
      if [ -n "$base_dir" ] && [[ "$base_dir" != "*" ]] && [ ! -e "$base_dir" ]; then
        echo "  ❌ STALE: testMatch pattern '$pattern' references missing path '$base_dir'"
        ISSUES_FOUND=$((ISSUES_FOUND + 1))
      elif [ -n "$base_dir" ] && [[ "$base_dir" != "*" ]]; then
        echo "  ✓ testMatch: $pattern"
      fi
    done <<< "$TEST_PATTERNS"
  fi

  # Extract collectCoverageFrom patterns
  COVERAGE_PATTERNS=$(grep -o "collectCoverageFrom.*\[" jest.config.js -A 5 | grep -o "'[^']*'" | tr -d "'" || true)
  if [ -n "$COVERAGE_PATTERNS" ]; then
    while IFS= read -r pattern; do
      # Skip negation patterns
      if [[ "$pattern" == !* ]]; then
        continue
      fi
      base_dir=$(echo "$pattern" | sed 's|/\*\*.*||')
      if [ -n "$base_dir" ] && [ ! -e "$base_dir" ]; then
        echo "  ❌ STALE: collectCoverageFrom pattern '$pattern' references missing path '$base_dir'"
        ISSUES_FOUND=$((ISSUES_FOUND + 1))
      elif [ -n "$base_dir" ]; then
        echo "  ✓ collectCoverageFrom: $pattern"
      fi
    done <<< "$COVERAGE_PATTERNS"
  fi

  echo
fi

# Audit eslint.config.js (if exists)
if [ -f eslint.config.js ] || [ -f eslint.config.mjs ]; then
  ESLINT_CONFIG=$([ -f eslint.config.js ] && echo "eslint.config.js" || echo "eslint.config.mjs")
  echo "📋 Auditing $ESLINT_CONFIG..."

  # Extract ignorePatterns (this is simplified - full parsing would need js evaluation)
  IGNORE_PATTERNS=$(grep -o "ignorePatterns.*\[.*\]" "$ESLINT_CONFIG" || true)
  if [ -n "$IGNORE_PATTERNS" ]; then
    echo "  ℹ️  Found ignorePatterns - manual review recommended for:"
    echo "     $IGNORE_PATTERNS"
  fi

  echo
fi

# Summary
echo "=== Audit Complete ==="
if [ $ISSUES_FOUND -eq 0 ]; then
  echo "✅ No stale path references found"
  exit 0
else
  echo "❌ Found $ISSUES_FOUND stale path reference(s)"
  echo ""
  echo "Recommendation: Remove stale configuration entries to prevent confusion"
  exit 1
fi
