import { fetchWithRetry } from './fetch-with-retry.js';
import type { SkillToInject } from './skill-injection.js';

const API_BASE_URL = 'https://www.contextgraph.dev';

/**
 * Response format from the skills library API
 */
interface SkillsLibraryResponse {
  success: boolean;
  data: {
    skills: Array<{
      id: string;
      filename: string;
      title: string;
      description: string;
      trigger: string | null;
      content: string;
    }>;
  };
}

export interface FetchSkillsLibraryOptions {
  authToken: string;
  runId?: string; // Optional runId to record which skills were loaded for this run
}

/**
 * Fetches the user's skills library from the ContextGraph API.
 *
 * @param options - Options including authToken and optional runId
 * @returns Array of skills to inject, or empty array if fetch fails
 */
export async function fetchSkillsLibrary(options: FetchSkillsLibraryOptions): Promise<SkillToInject[]> {
  const { authToken, runId } = options;

  try {
    // Build URL with optional runId query parameter
    const url = new URL(`${API_BASE_URL}/api/skills/library`);
    if (runId) {
      url.searchParams.set('runId', runId);
    }

    const response = await fetchWithRetry(
      url.toString(),
      {
        headers: {
          'x-authorization': `Bearer ${authToken}`,
          'Content-Type': 'application/json',
        },
      },
      {
        maxRetries: 2,
        baseDelayMs: 500,
      }
    );

    if (!response.ok) {
      // Log warning but don't throw - graceful degradation
      console.warn(`⚠️  Skills library API returned ${response.status}: ${response.statusText}`);
      return [];
    }

    const data = (await response.json()) as SkillsLibraryResponse;

    if (!data.success || !data.data?.skills) {
      console.warn('⚠️  Skills library API returned unexpected format');
      return [];
    }

    // Transform API response to SkillToInject format
    // API now returns structured metadata fields, no need to parse frontmatter
    const skills: SkillToInject[] = data.data.skills.map((skill) => {
      // Extract skill name from filename (remove .md extension)
      const name = skill.filename.replace(/\.md$/, '');

      return {
        name,
        description: skill.description,
        trigger: skill.trigger,
        content: skill.content,
      };
    });

    return skills;
  } catch (error) {
    // Graceful degradation - log warning but don't fail
    console.warn('⚠️  Failed to fetch skills library:', error instanceof Error ? error.message : error);
    return [];
  }
}
