import { describe, it, expect } from '@jest/globals';
import { spawn } from 'child_process';
import { join } from 'path';

/**
 * Integration tests for the cg CLI binary.
 * These tests spawn the actual CLI process to verify exit behavior.
 */
describe('cg CLI integration', () => {
  // Path to the built CLI binary relative to project root
  const cgPath = join(process.cwd(), 'dist/cg.js');

  /**
   * Helper to spawn the cg CLI and capture output/exit code
   */
  function runCg(args: string[]): Promise<{
    exitCode: number | null;
    stdout: string;
    stderr: string;
  }> {
    return new Promise((resolve) => {
      const proc = spawn('node', [cgPath, ...args]);
      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      proc.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      proc.on('close', (exitCode) => {
        resolve({ exitCode, stdout, stderr });
      });

      proc.on('error', (err) => {
        // If spawn itself fails, treat it as exit code 1 with error in stderr
        resolve({ exitCode: 1, stdout: '', stderr: err.message });
      });
    });
  }

  describe('--help flag', () => {
    it('should exit with code 0', async () => {
      const result = await runCg(['--help']);
      expect(result.exitCode).toBe(0);
    });

    it('should output help text to stdout', async () => {
      const result = await runCg(['--help']);
      expect(result.stdout).toContain('Usage: cg');
      expect(result.stdout).toContain('Commands:');
    });

    it('should not output JSON errors to stderr', async () => {
      const result = await runCg(['--help']);
      // stderr should be empty or not contain JSON error structures
      if (result.stderr) {
        expect(result.stderr).not.toContain('"error"');
        expect(result.stderr).not.toContain('"code"');
      }
    });
  });

  describe('--version flag', () => {
    it('should exit with code 0', async () => {
      const result = await runCg(['--version']);
      expect(result.exitCode).toBe(0);
    });

    it('should output version to stdout', async () => {
      const result = await runCg(['--version']);
      // Version should be semver format
      expect(result.stdout).toMatch(/\d+\.\d+\.\d+/);
    });

    it('should not output JSON errors to stderr', async () => {
      const result = await runCg(['--version']);
      // stderr should be empty or not contain JSON error structures
      if (result.stderr) {
        expect(result.stderr).not.toContain('"error"');
        expect(result.stderr).not.toContain('"code"');
      }
    });
  });

  describe('-h short flag', () => {
    it('should exit with code 0', async () => {
      const result = await runCg(['-h']);
      expect(result.exitCode).toBe(0);
    });

    it('should output help text to stdout', async () => {
      const result = await runCg(['-h']);
      expect(result.stdout).toContain('Usage: cg');
    });
  });

  describe('-V short flag', () => {
    it('should exit with code 0', async () => {
      const result = await runCg(['-V']);
      expect(result.exitCode).toBe(0);
    });

    it('should output version to stdout', async () => {
      const result = await runCg(['-V']);
      expect(result.stdout).toMatch(/\d+\.\d+\.\d+/);
    });
  });

  describe('subcommand help', () => {
    it('should exit with code 0 for fetch --help', async () => {
      const result = await runCg(['fetch', '--help']);
      expect(result.exitCode).toBe(0);
    });

    it('should output fetch-specific help to stdout', async () => {
      const result = await runCg(['fetch', '--help']);
      expect(result.stdout).toContain('fetch');
    });
  });
});
