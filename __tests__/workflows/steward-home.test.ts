import { afterEach, describe, expect, it } from '@jest/globals';

const originalStewardHome = process.env.STEWARD_HOME;
const originalStewardConfigDir = process.env.STEWARD_CONFIG_DIR;
const originalContextGraphCredentialsDir = process.env.CONTEXTGRAPH_CREDENTIALS_DIR;

const { getStewardHomeDir } = await import('../../src/steward-home.js');

describe('getStewardHomeDir', () => {
  afterEach(() => {
    if (originalStewardHome === undefined) {
      delete process.env.STEWARD_HOME;
    } else {
      process.env.STEWARD_HOME = originalStewardHome;
    }

    if (originalStewardConfigDir === undefined) {
      delete process.env.STEWARD_CONFIG_DIR;
    } else {
      process.env.STEWARD_CONFIG_DIR = originalStewardConfigDir;
    }

    if (originalContextGraphCredentialsDir === undefined) {
      delete process.env.CONTEXTGRAPH_CREDENTIALS_DIR;
    } else {
      process.env.CONTEXTGRAPH_CREDENTIALS_DIR = originalContextGraphCredentialsDir;
    }
  });

  it('rejects an empty steward home override', () => {
    process.env.STEWARD_HOME = '   ';

    expect(() => getStewardHomeDir()).toThrow('STEWARD_HOME must not be empty');
  });

  it('rejects a relative steward home override', () => {
    process.env.STEWARD_HOME = 'relative/path';

    expect(() => getStewardHomeDir()).toThrow('STEWARD_HOME must be an absolute path');
  });

  it('accepts an absolute steward home override', () => {
    process.env.STEWARD_HOME = '/tmp/steward-home';

    expect(getStewardHomeDir()).toBe('/tmp/steward-home');
  });
});
