import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import { mkdir, writeFile } from 'fs/promises';

// Mock fs/promises
jest.mock('fs/promises');

const mockMkdir = mkdir as jest.MockedFunction<typeof mkdir>;
const mockWriteFile = writeFile as jest.MockedFunction<typeof writeFile>;

// Import after mocking
import { injectSkills, type SkillToInject } from '../src/skill-injection.js';
import { getValidationSkills } from '../src/test-skills.js';

describe('skill-injection', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockMkdir.mockResolvedValue(undefined);
    mockWriteFile.mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  describe('injectSkills', () => {
    it('should inject a single skill with correct structure', async () => {
      const testSkill: SkillToInject = {
        name: 'test-skill',
        description: 'Test skill description',
        content: '# Test Skill\n\nSkill content here.',
      };

      await injectSkills('/workspace', [testSkill]);

      // Verify directory was created
      expect(mockMkdir).toHaveBeenCalledWith(
        '/workspace/.claude/skills/test-skill',
        { recursive: true }
      );

      // Verify SKILL.md was written with frontmatter
      expect(mockWriteFile).toHaveBeenCalledWith(
        '/workspace/.claude/skills/test-skill/SKILL.md',
        expect.stringContaining('---\nname: test-skill\ndescription: Test skill description\n---'),
        'utf-8'
      );

      // Verify content is included
      expect(mockWriteFile).toHaveBeenCalledWith(
        expect.any(String),
        expect.stringContaining('# Test Skill\n\nSkill content here.'),
        'utf-8'
      );
    });

    it('should inject multiple skills', async () => {
      const skills: SkillToInject[] = [
        {
          name: 'skill-one',
          description: 'First skill',
          content: 'Content one',
        },
        {
          name: 'skill-two',
          description: 'Second skill',
          content: 'Content two',
        },
      ];

      await injectSkills('/workspace', skills);

      expect(mockMkdir).toHaveBeenCalledTimes(2);
      expect(mockWriteFile).toHaveBeenCalledTimes(2);

      // Verify each skill directory was created
      expect(mockMkdir).toHaveBeenCalledWith(
        '/workspace/.claude/skills/skill-one',
        { recursive: true }
      );
      expect(mockMkdir).toHaveBeenCalledWith(
        '/workspace/.claude/skills/skill-two',
        { recursive: true }
      );
    });

    it('should handle empty skills array gracefully', async () => {
      await injectSkills('/workspace', []);

      expect(mockMkdir).not.toHaveBeenCalled();
      expect(mockWriteFile).not.toHaveBeenCalled();
    });

    it('should throw error if skill injection fails', async () => {
      const testSkill: SkillToInject = {
        name: 'test-skill',
        description: 'Test skill',
        content: 'Content',
      };

      mockMkdir.mockRejectedValueOnce(new Error('Permission denied'));

      await expect(injectSkills('/workspace', [testSkill])).rejects.toThrow('Permission denied');
    });
  });

  describe('getValidationSkills', () => {
    it('should return validation skill with correct structure', () => {
      const skills = getValidationSkills();

      expect(skills).toHaveLength(1);
      expect(skills[0].name).toBe('contextgraph-validation-marker');
      expect(skills[0].description).toBeTruthy();
      expect(skills[0].content).toContain('SKILL_INJECTION_VALIDATED');
    });

    it('should return skill with high-frequency trigger instructions', () => {
      const skills = getValidationSkills();
      const validationSkill = skills[0];

      // Verify the skill content instructs agent to emit marker
      expect(validationSkill.content).toContain('IMMEDIATELY');
      expect(validationSkill.content).toContain('first response');
    });
  });
});
