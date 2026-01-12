---
name: agent-session-start
description: Initialization skill to verify skills are loading correctly
---

# Agent Session Start

**Trigger:** At the very beginning of every agent session, before doing any other work.

## Instructions

You MUST invoke this skill as your very first action when starting any agent session. This verifies that skills are being loaded and the Skill tool is working correctly.

After invoking this skill, proceed with your assigned work normally.

## What This Confirms

When you successfully invoke this skill, it confirms:
1. Skills are being loaded from `.claude/skills/`
2. The Skill tool is enabled and working
3. Skill activations will appear in agent logs
