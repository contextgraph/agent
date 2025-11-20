# Git Authentication Spike

**Action ID:** d9ca248d-7cb7-4a05-80ec-3dda475f0f4d
**Date:** 2025-11-20
**Status:** Complete

## Objective

Validate authentication strategy for Claude CLI to access git repositories with credentials. This spike tests different credential passing methods and documents findings to inform the production implementation.

## Test Environment

- **Platform:** macOS (Darwin 24.6.0)
- **Node.js:** Available
- **Git:** Available in system
- **Claude CLI:** Available in PATH

## Methods to Test

### 1. GitHub CLI (`gh`) Credentials
- **Approach:** Leverage existing `gh` authentication
- **Rationale:** Users may already have `gh auth login` configured

### 2. Environment Variable (GITHUB_TOKEN)
- **Approach:** Pass token via environment variable
- **Rationale:** Simple, widely supported

### 3. GIT_ASKPASS with Credential Helper Script
- **Approach:** Custom credential helper script
- **Rationale:** Works for all git operations

### 4. SSH Agent Forwarding
- **Approach:** Use SSH keys from host
- **Rationale:** No tokens needed, secure

### 5. Git Credential Helper
- **Approach:** Use git's built-in credential system
- **Rationale:** Native git support

## Test Results

### Test 1: GitHub CLI (`gh`) Credentials

**Method:** Check if `gh` is installed and authenticated

**Test Commands:**
```bash
# Check if gh is installed
which gh

# Check gh authentication status
gh auth status

# Test with gh api
gh api user
```

**Results:**

✓ **SUCCESS** - GitHub CLI is installed at `/opt/homebrew/bin/gh`
- User is authenticated to github.com
- Token has appropriate scopes: `admin:public_key`, `gist`, `read:org`, `repo`
- Can retrieve token with `gh auth token`
- Git operations protocol is set to SSH by default

### Test 2: Token in URL (HTTPS)

**Method:** Embed token directly in git URL

**Test Commands:**
```bash
TOKEN=$(gh auth token)
git clone https://x-access-token:$TOKEN@github.com/contextgraph/agent test-clone
```

**Results:**

✓ **SUCCESS** - Token embedded in URL works perfectly
- Clone operations succeed
- Subsequent fetch/pull operations work
- No additional environment variables needed
- Works from Node.js child processes with `execSync`

**Security Note:** Token appears in process list and git command history. Git may warn about credentials in URL.

### Test 3: GIT_ASKPASS Method

**Method:** Use GIT_ASKPASS environment variable with helper script

**Test Commands:**
```bash
# Create helper script
cat > git-askpass-helper.sh << 'EOF'
#!/bin/sh
echo "$GITHUB_TOKEN"
EOF
chmod +x git-askpass-helper.sh

# Use with git
GITHUB_TOKEN=$(gh auth token) \
GIT_ASKPASS=/path/to/git-askpass-helper.sh \
git clone https://github.com/contextgraph/agent test-clone
```

**Results:**

✓ **SUCCESS** - GIT_ASKPASS works reliably
- Clone, fetch, and pull operations succeed
- Requires both GITHUB_TOKEN and GIT_ASKPASS env vars
- Helper script can be temporary file
- Works from Node.js child processes when env vars are passed
- Credentials not visible in process list

**Implementation Note:** Need to manage temporary helper script lifecycle.

### Test 4: SSH Agent

**Method:** Use SSH keys from the host system

**Test Commands:**
```bash
git clone git@github.com:contextgraph/agent.git test-clone
```

**Results:**

✓ **SUCCESS** - SSH authentication works seamlessly
- Clone, fetch, and pull operations succeed
- No token management needed
- Relies on existing SSH key configuration
- SSH agent automatically forwards to child processes
- Most secure option (no token exposure)

**Requirements:** User must have SSH keys configured with GitHub

### Test 5: GITHUB_TOKEN Environment Variable (Standalone)

**Method:** Pass GITHUB_TOKEN alone without other configuration

**Test Commands:**
```bash
GITHUB_TOKEN=$(gh auth token) git clone https://github.com/contextgraph/agent test-clone
```

**Results:**

✗ **FAILED** - GITHUB_TOKEN alone is not sufficient
- Git does not automatically use GITHUB_TOKEN for authentication
- Requires GIT_ASKPASS or git credential helper to actually use the token

## Node.js Child Process Testing

**Critical Test:** Verify authentication methods work when Claude CLI spawns child processes

**Test Script:** Created Node.js script that simulates how the agent would spawn git commands

**Results:**
- ✓ GIT_ASKPASS + GITHUB_TOKEN: Works when env vars passed to child
- ✓ SSH: Works automatically (agent forwarded)
- ✓ Token in URL: Works when URL constructed with token
- ✗ GITHUB_TOKEN alone: Does not work

## Security Analysis

### Method 1: Token in URL
**Pros:**
- Simple to implement
- No additional files needed
- Works everywhere

**Cons:**
- Token visible in process list (`ps aux`)
- Token stored in git config's remote URL (can be read with `git remote -v`)
- Git may log warnings about credentials in URL
- Token appears in shell history if not careful

**Security Rating:** ⚠️ Medium risk

### Method 2: GIT_ASKPASS
**Pros:**
- Token not visible in process list
- Clean separation of concerns
- Standard git mechanism
- Can use temporary helper script

**Cons:**
- Requires creating and managing helper script
- Need to ensure proper cleanup of helper script
- Slightly more complex setup

**Security Rating:** ✓ Good

### Method 3: SSH
**Pros:**
- No token management required
- Most secure method (private keys never transmitted)
- Standard developer workflow
- Automatic agent forwarding

**Cons:**
- Requires user to have SSH keys set up
- May not work in all environments (firewalls, etc.)
- Not all users configure SSH

**Security Rating:** ✓ Excellent

## Credential Acquisition Strategy

### Recommended Approach: Tiered Strategy

**Tier 1: Try SSH First**
```typescript
// Check if repo URL is SSH format or user prefers SSH
if (repoUrl.startsWith('git@') || userPrefersSSH()) {
  // Try SSH clone - will work if user has keys configured
  return { method: 'ssh', url: convertToSSH(repoUrl) };
}
```

**Tier 2: Check for GitHub CLI**
```typescript
// Check if gh is installed and authenticated
const ghInstalled = await checkCommand('gh');
if (ghInstalled) {
  const ghAuth = await exec('gh auth status');
  if (ghAuth.success) {
    const token = await exec('gh auth token');
    return { method: 'gh-token', token: token.stdout.trim() };
  }
}
```

**Tier 3: Prompt User for Token**
```typescript
// No existing credentials found
console.log('No git credentials found. Please provide a GitHub token.');
console.log('Create one at: https://github.com/settings/tokens');
const token = await promptUser('Enter GitHub token:');
return { method: 'user-token', token };
```

### Implementation Recommendation: GIT_ASKPASS

**Why:** Best balance of security and compatibility

**Implementation:**
1. Create temporary helper script in system temp directory
2. Set execute permissions
3. Pass GITHUB_TOKEN and GIT_ASKPASS to child process env
4. Clean up helper script after operation
5. Never log or display the token

**Example Code:**
```typescript
import { mkdtemp, writeFile, chmod, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { execSync } from 'child_process';

async function createGitAskpassHelper(token: string): Promise<string> {
  const tempDir = await mkdtemp(join(tmpdir(), 'git-helper-'));
  const helperPath = join(tempDir, 'askpass.sh');

  await writeFile(helperPath, `#!/bin/sh\necho "${token}"\n`);
  await chmod(helperPath, 0o700);

  return helperPath;
}

async function gitClone(repoUrl: string, targetDir: string, token: string) {
  const helperPath = await createGitAskpassHelper(token);

  try {
    execSync(`git clone ${repoUrl} ${targetDir}`, {
      env: {
        ...process.env,
        GITHUB_TOKEN: token,
        GIT_ASKPASS: helperPath
      }
    });
  } finally {
    await rm(helperPath, { force: true });
  }
}
```

## Recommendations

### For Production Implementation

1. **Use GIT_ASKPASS as primary method**
   - Most secure credential passing
   - Works with any git operation
   - Clean process list

2. **Support SSH as alternative**
   - Allow users who prefer SSH to use it
   - Check for SSH URL format
   - Fallback to HTTPS if SSH fails

3. **Credential acquisition priority:**
   ```
   1. Try SSH (if URL is SSH format)
   2. Check for `gh auth token`
   3. Prompt user for token
   4. Consider implementing OAuth flow
   ```

4. **Add credential caching**
   - Store retrieved token securely (OS keychain)
   - Don't require re-entry for each operation
   - Respect token expiration

5. **User experience considerations:**
   - Clear error messages when credentials fail
   - Helpful guidance on how to authenticate
   - Support for common CI/CD environments (GITHUB_TOKEN pre-set)

### For Claude CLI Integration

The agent should:

1. **On first run:** Detect available credentials using tiered approach
2. **Create helper script:** Generate temporary GIT_ASKPASS helper
3. **Set environment:** Pass GITHUB_TOKEN and GIT_ASKPASS to spawned processes
4. **Clean up:** Remove helper script after operation completes
5. **Error handling:** Provide clear guidance if authentication fails

### Security Best Practices

- Never log tokens
- Use temporary files with restrictive permissions (0o700)
- Clean up helper scripts in finally blocks
- Consider using OS keychain for token storage
- Validate token has required scopes before using

## Conclusion

**Primary Recommendation: GIT_ASKPASS Method with GitHub CLI Token**

This approach provides:
- ✓ Secure credential passing
- ✓ Compatibility with existing GitHub CLI setup
- ✓ Works from Node.js child processes
- ✓ Clean process list (no token exposure)
- ✓ Simple cleanup

**Alternative: SSH for advanced users**

Users who prefer SSH should be able to use it by ensuring their repository URLs are in SSH format.

## Next Steps

1. Implement credential detection (check for `gh`, SSH keys)
2. Build GIT_ASKPASS helper infrastructure
3. Add credential caching to reduce prompts
4. Test with private repositories
5. Add error handling and user guidance
6. Document setup for users
