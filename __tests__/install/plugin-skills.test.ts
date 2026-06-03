import { describe, it, expect, jest } from '@jest/globals';
import {
  fetchPluginSkills,
  KNOWN_SKILL_NAMES,
  PLUGIN_SKILLS_REPO,
} from '../../src/install/plugin-skills.js';

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => body,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  } as unknown as Response;
}

function textResponse(body: string, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => JSON.parse(body),
    text: async () => body,
  } as unknown as Response;
}

describe('fetchPluginSkills', () => {
  it('lists skill dirs via the contents API and fetches each SKILL.md verbatim', async () => {
    const fetchImpl = jest.fn(async (url: string) => {
      if (url.includes('api.github.com')) {
        return jsonResponse([
          { name: 'define-steward', type: 'dir' },
          { name: 'plan-review', type: 'dir' },
          { name: 'README.md', type: 'file' }, // ignored (not a dir)
        ]);
      }
      const name = url.includes('define-steward') ? 'define-steward' : 'plan-review';
      return textResponse(`---\nname: ${name}\n---\nbody`);
    }) as unknown as typeof fetch;

    const skills = await fetchPluginSkills({ ref: 'main', fetchImpl });

    expect(skills.map((s) => s.name)).toEqual(['define-steward', 'plan-review']);
    expect(skills[0].markdown).toBe('---\nname: define-steward\n---\nbody');
    // listing + one raw fetch per dir
    expect((fetchImpl as any).mock.calls.length).toBe(3);
  });

  it('targets the canonical plugin repo and the requested ref', async () => {
    const seen: string[] = [];
    const fetchImpl = jest.fn(async (url: string) => {
      seen.push(url);
      if (url.includes('api.github.com')) return jsonResponse([{ name: 'plan-review', type: 'dir' }]);
      return textResponse('content');
    }) as unknown as typeof fetch;

    await fetchPluginSkills({ ref: 'v1.2.3', fetchImpl });
    expect(seen.some((u) => u.includes(PLUGIN_SKILLS_REPO) && u.includes('v1.2.3'))).toBe(true);
    expect(seen.some((u) => u.includes('raw.githubusercontent.com') && u.endsWith('plan-review/SKILL.md'))).toBe(
      true
    );
  });

  it('falls back to KNOWN_SKILL_NAMES when the listing API fails', async () => {
    const fetchImpl = jest.fn(async (url: string) => {
      if (url.includes('api.github.com')) return jsonResponse({ message: 'rate limited' }, false, 403);
      return textResponse('skill body');
    }) as unknown as typeof fetch;

    const skills = await fetchPluginSkills({ ref: 'main', fetchImpl });
    expect(skills.map((s) => s.name)).toEqual(KNOWN_SKILL_NAMES);
  });

  it('skips files that 404 but keeps the rest', async () => {
    const fetchImpl = jest.fn(async (url: string) => {
      if (url.includes('api.github.com')) {
        return jsonResponse([
          { name: 'define-steward', type: 'dir' },
          { name: 'gone', type: 'dir' },
        ]);
      }
      if (url.includes('gone')) return textResponse('', false, 404);
      return textResponse('present');
    }) as unknown as typeof fetch;

    const skills = await fetchPluginSkills({ ref: 'main', fetchImpl });
    expect(skills.map((s) => s.name)).toEqual(['define-steward']);
  });

  it('throws when no skills could be fetched', async () => {
    const fetchImpl = jest.fn(async (url: string) => {
      if (url.includes('api.github.com')) return jsonResponse([{ name: 'x', type: 'dir' }]);
      return textResponse('', false, 500);
    }) as unknown as typeof fetch;

    await expect(fetchPluginSkills({ ref: 'main', fetchImpl })).rejects.toThrow(/Could not fetch steward skills/);
  });
});
