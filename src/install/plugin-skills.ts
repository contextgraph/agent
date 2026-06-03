/**
 * Source of truth for steward skills: the canonical `SKILL.md` files that ship
 * with the Claude Code plugin. The install command fetches them straight from
 * the plugin repo so the CLI and the plugin never drift.
 */
export const PLUGIN_SKILLS_REPO = 'contextgraph/claude-code-plugin';
export const PLUGIN_SKILLS_PATH = 'plugins/steward/skills';
export const DEFAULT_SKILLS_REF = 'main';

/**
 * Fallback skill list used only if the GitHub directory-listing API is
 * unavailable (e.g. unauthenticated rate limit). Raw file fetches don't share
 * that limit, so install still works against these names.
 */
export const KNOWN_SKILL_NAMES = ['define-steward', 'plan-review', 'work-top-backlog-item'];

/** A skill fetched verbatim — the markdown already contains its frontmatter. */
export interface RawSkill {
  name: string;
  markdown: string;
}

export interface FetchPluginSkillsOptions {
  /** Git ref (branch/tag/sha) to read skills from. Defaults to env or `main`. */
  ref?: string;
  /** Injectable fetch for testing. */
  fetchImpl?: typeof fetch;
}

const GITHUB_HEADERS = { 'User-Agent': 'steward-cli' } as const;

/** Per-request timeout so a stalled fetch can't hang the interactive install. */
const FETCH_TIMEOUT_MS = 10_000;

async function listSkillNames(ref: string, fetchImpl: typeof fetch): Promise<string[]> {
  const url = `https://api.github.com/repos/${PLUGIN_SKILLS_REPO}/contents/${PLUGIN_SKILLS_PATH}?ref=${encodeURIComponent(ref)}`;
  try {
    const response = await fetchImpl(url, {
      headers: { ...GITHUB_HEADERS, Accept: 'application/vnd.github+json' },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!response.ok) {
      return KNOWN_SKILL_NAMES;
    }
    const entries = (await response.json()) as Array<{ name: string; type: string }>;
    const names = entries.filter((e) => e?.type === 'dir' && e.name).map((e) => e.name);
    return names.length > 0 ? names : KNOWN_SKILL_NAMES;
  } catch {
    return KNOWN_SKILL_NAMES;
  }
}

function rawSkillUrl(ref: string, name: string): string {
  return `https://raw.githubusercontent.com/${PLUGIN_SKILLS_REPO}/${ref}/${PLUGIN_SKILLS_PATH}/${name}/SKILL.md`;
}

/**
 * Fetch the steward skills (verbatim `SKILL.md`) from the plugin repo.
 *
 * Throws if no skills could be fetched, so the install flow surfaces a clear
 * failure instead of silently writing nothing.
 */
export async function fetchPluginSkills(options: FetchPluginSkillsOptions = {}): Promise<RawSkill[]> {
  const ref = options.ref ?? process.env.STEWARD_SKILLS_REF ?? DEFAULT_SKILLS_REF;
  const fetchImpl = options.fetchImpl ?? fetch;

  const names = await listSkillNames(ref, fetchImpl);

  const skills: RawSkill[] = [];
  const errors: string[] = [];
  for (const name of names) {
    try {
      const response = await fetchImpl(rawSkillUrl(ref, name), {
        headers: { ...GITHUB_HEADERS },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (!response.ok) {
        errors.push(`${name} (HTTP ${response.status})`);
        continue;
      }
      const markdown = await response.text();
      if (markdown.trim().length > 0) {
        skills.push({ name, markdown });
      }
    } catch (error) {
      errors.push(`${name} (${error instanceof Error ? error.message : 'fetch error'})`);
    }
  }

  if (skills.length === 0) {
    throw new Error(
      `Could not fetch steward skills from ${PLUGIN_SKILLS_REPO}@${ref}` +
        (errors.length > 0 ? `: ${errors.join(', ')}` : '')
    );
  }
  return skills;
}
