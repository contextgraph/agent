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
      content: string;
    }>;
  };
}

/**
 * Fetches the user's skills library from the ContextGraph API.
 *
 * @param authToken - User authentication token
 * @returns Array of skills to inject, or empty array if fetch fails
 */
export async function fetchSkillsLibrary(authToken: string): Promise<SkillToInject[]> {
  try {
    const response = await fetchWithRetry(
      `${API_BASE_URL}/api/skills/library`,
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
    const skills: SkillToInject[] = data.data.skills.map((skill) => {
      // Extract skill name from filename (remove .md extension)
      const name = skill.filename.replace(/\.md$/, '');

      // Parse frontmatter to extract description (if present)
      // Expected format:
      // ---
      // name: skill-name
      // description: Brief description
      // ---
      // Content...
      let description = 'Skill from ContextGraph library';
      const frontmatterMatch = skill.content.match(/^---\n([\s\S]*?)\n---/);
      if (frontmatterMatch) {
        const descMatch = frontmatterMatch[1].match(/description:\s*(.+)/);
        if (descMatch) {
          description = descMatch[1].trim();
        }
      }

      // Remove frontmatter from content since injectSkills will add it
      const contentWithoutFrontmatter = skill.content.replace(/^---\n[\s\S]*?\n---\n/, '');

      return {
        name,
        description,
        content: contentWithoutFrontmatter,
      };
    });

    return skills;
  } catch (error) {
    // Graceful degradation - log warning but don't fail
    console.warn('⚠️  Failed to fetch skills library:', error instanceof Error ? error.message : error);
    return [];
  }
}
