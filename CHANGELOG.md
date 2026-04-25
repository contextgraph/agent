# Changelog

All notable changes to this project will be documented in this file.

## Unreleased

### Removed
- Legacy local-integrations model. The CLI no longer fetches an "integration
  surfaces" catalog from the platform, matches surfaces against local env vars,
  or injects an "Available Integrations" section into claim output / step
  prompts. The server endpoint `/api/integrations/surfaces` it relied on no
  longer exists, so every `steward backlog claim` was already printing a
  `failed to load integration surfaces: API error 404` warning. This removes
  `ApiClient.getIntegrationSurfaces`, the `IntegrationSurfaceResource` type, the
  `steward configure` / `steward configure validate` commands (and the
  `~/.steward/config.json` scaffold they maintained), the orphan
  `steward-heartbeat` workflow, and the `.steward/integrations/...` tooling
  guidance that only made sense under the local model. Workspace-scoped
  integrations now live on the platform side (steward.foo workspace settings);
  there is no CLI-side replacement.

## [0.5.0](https://github.com/contextgraph/agent/compare/v0.4.41...v0.5.0) (2026-04-25)


### Features

* Add --force-haiku CLI flag to override model for all workflows ([a783e9c](https://github.com/contextgraph/agent/commit/a783e9c9722f74f039e80b367f3f17f8bc1f1213))
* Add --skip-learning flag to opt out of learning runs ([90b3f70](https://github.com/contextgraph/agent/commit/90b3f70855bcb569a51236e6339b08c27eb82dfb))
* Add --skip-skills flag and structured frontmatter generation ([fbdcd33](https://github.com/contextgraph/agent/commit/fbdcd334c23c6f42b7fea5e9cd7f82ec3422165c))
* Add API token authentication via environment variable ([0922531](https://github.com/contextgraph/agent/commit/092253164934081958b7591bc59d0afdc4c9650b))
* Add Claude Agent SDK wrapper implementation ([e4b7807](https://github.com/contextgraph/agent/commit/e4b780741d02d04cad76c695e8d06a730b62c2ca))
* add codex provider behind execution flag ([#16](https://github.com/contextgraph/agent/issues/16)) ([7059774](https://github.com/contextgraph/agent/commit/7059774011e3741f5ba41d860a171b487891c8e7))
* Add completion handling after action execution ([5064764](https://github.com/contextgraph/agent/commit/5064764183b44fc49767c5ad9d38fc9d9ae5a3d4))
* Add learning phase detection to agent workflow ([becaaa9](https://github.com/contextgraph/agent/commit/becaaa98bd3363d81a2450379c0f8e87183453b0))
* Add learning workflow for extracting learnings from reviewed actions ([d1eedb0](https://github.com/contextgraph/agent/commit/d1eedb04e3862f8ef50aa47a152c0967fb5a3fc3))
* Add log streaming to prepare workflow ([e4e90e9](https://github.com/contextgraph/agent/commit/e4e90e99ff49793d7cf2ca9a43718b81db29ea7d))
* Add MCP server configuration to SDK for contextgraph actions ([3df2273](https://github.com/contextgraph/agent/commit/3df2273a07e3ad7b12a1ea990713b1d35617966c))
* Add polling with exponential backoff for worker loop ([1b998fb](https://github.com/contextgraph/agent/commit/1b998fb9a46c0e7b48b9c4d2a1abc9f277c2ba41))
* Add prompt_version observability logging to worker loop ([#44](https://github.com/contextgraph/agent/issues/44)) ([f709651](https://github.com/contextgraph/agent/commit/f709651ca5ef5ea0fba1ffb04407c72da18c9be4))
* Add retry logic with exponential backoff for API calls ([03fb547](https://github.com/contextgraph/agent/commit/03fb5471dd8d4b5d5548398b4e1b578fa49c55b8))
* Add session metadata injection for loop wrapper trace correlation ([#45](https://github.com/contextgraph/agent/issues/45)) ([1702824](https://github.com/contextgraph/agent/commit/170282458a97456964bc071c0e51f02ca3c571c7))
* Add skill invocation preamble to agent prompts ([209087e](https://github.com/contextgraph/agent/commit/209087ecb46751ea5cb46c7b39eddc3b3503505e))
* Add stats tracking and periodic status updates ([e4725ff](https://github.com/contextgraph/agent/commit/e4725ff391de80583902f513ea9ae44f185ee4dc))
* Add test skill to validate Claude Code skill loading ([ef1d225](https://github.com/contextgraph/agent/commit/ef1d225f77e43ec9d9a185a8eb1403208c24694b))
* Add TR-808 themed auth callback pages ([c04295b](https://github.com/contextgraph/agent/commit/c04295b1767971fd2aee3a6967f30e405e4be710))
* Add USE_CLAUDE_SDK feature flag for SDK/CLI switching ([0d43120](https://github.com/contextgraph/agent/commit/0d43120ffad9e0906658c3e33662c677d17c973f))
* Add Zod validation to cg CLI commands ([#21](https://github.com/contextgraph/agent/issues/21)) ([fcdb4b5](https://github.com/contextgraph/agent/commit/fcdb4b51dac16e048098ae12a6233fd7d93ad595))
* **agent:** execute-only loop uses worker queue prompt ([#41](https://github.com/contextgraph/agent/issues/41)) ([ae08944](https://github.com/contextgraph/agent/commit/ae089443327043cb320f447aab10520385da28e7))
* allow codex sandbox mode override via env ([f3a56d0](https://github.com/contextgraph/agent/commit/f3a56d05eb50238b628e72e1cd922a1b2b0124da))
* Capture starting commit in workspace preparation ([7a70855](https://github.com/contextgraph/agent/commit/7a708551e4de8cf9fd832feb0c6441f0920e8541))
* **cli:** add explicit steward backlog claim commands ([#82](https://github.com/contextgraph/agent/issues/82)) ([53dbd4a](https://github.com/contextgraph/agent/commit/53dbd4a02bffe9e923187db5b856bde71ba0f817))
* **cli:** add local Axiom heartbeat ([#87](https://github.com/contextgraph/agent/issues/87)) ([2b07104](https://github.com/contextgraph/agent/commit/2b071040a3bf3c67c70bd45a924bc3f2cadbb546))
* **cli:** add steward configure scaffold ([#85](https://github.com/contextgraph/agent/issues/85)) ([e0c5ae9](https://github.com/contextgraph/agent/commit/e0c5ae9d3e8f9a4104bb9b7e028470288b91fcea))
* **cli:** add steward queue claim commands ([#84](https://github.com/contextgraph/agent/issues/84)) ([0429386](https://github.com/contextgraph/agent/commit/0429386613120d97daa5ebb067d5ca589b1fac6a))
* **cli:** add steward queue top command ([#83](https://github.com/contextgraph/agent/issues/83)) ([390d26f](https://github.com/contextgraph/agent/commit/390d26f4635b23d5d8ce4d3668f721a6f6eb43a3))
* **cli:** auto-register current branch at `steward backlog claim` ([#106](https://github.com/contextgraph/agent/issues/106)) ([a567757](https://github.com/contextgraph/agent/commit/a567757cbc281880a05fc677906411375cdbce29))
* **cli:** inspect steward backlog items by slug ([#97](https://github.com/contextgraph/agent/issues/97)) ([52120ab](https://github.com/contextgraph/agent/commit/52120ab77ac68ee8a289414919bdda44cfbc35bf))
* **cli:** polish manual steward backlog workflow ([#88](https://github.com/contextgraph/agent/issues/88)) ([91e6812](https://github.com/contextgraph/agent/commit/91e6812f8b799553923ceb139d3d66ea16c8b049))
* **cli:** show file surface conjecture in backlog views ([#98](https://github.com/contextgraph/agent/issues/98)) ([0e51b49](https://github.com/contextgraph/agent/commit/0e51b494f6d93066e108f0e14a215ab3df2664b9))
* **cli:** validate steward integrations ([#86](https://github.com/contextgraph/agent/issues/86)) ([44d0f9c](https://github.com/contextgraph/agent/commit/44d0f9c0567aee632bdaa96df9ded484f317de64))
* Configure prepare phase to use Claude Opus 4.5 ([7ac8764](https://github.com/contextgraph/agent/commit/7ac876450c1685bdcdf8e222191296f53a55026b))
* default codex runs to bypass sandbox ([2d6d849](https://github.com/contextgraph/agent/commit/2d6d849f74a7fd35d606d9143234fe0286de0f15))
* default codex sandbox to danger-full-access ([4b87b0c](https://github.com/contextgraph/agent/commit/4b87b0c9a4f5bc15ad11c548c8c943260e145888))
* Enable skills in Agent SDK configuration ([c6e2d27](https://github.com/contextgraph/agent/commit/c6e2d27513d747bef036c8860206b76a44b97a91))
* enforce action branch via pre-push hook in agent sandbox ([#12](https://github.com/contextgraph/agent/issues/12)) ([e24dc64](https://github.com/contextgraph/agent/commit/e24dc64637409dabe3bb452bede0ed2e7bbb4804))
* enhance MCP tool error handling and validation ([#20](https://github.com/contextgraph/agent/issues/20)) ([232bf6c](https://github.com/contextgraph/agent/commit/232bf6c6618d60fb5f495441d0db8b98661b0756))
* Extract agent workflow scripts ([1af411a](https://github.com/contextgraph/agent/commit/1af411ab010239b46f5c3ffc2a5d5d2155217df8))
* Fetch and inject skills from ContextGraph API before agent starts ([43e8e9b](https://github.com/contextgraph/agent/commit/43e8e9b933d1fd443300eb093adf3289a19c3b74))
* Implement CLI interface with commander framework ([97b8900](https://github.com/contextgraph/agent/commit/97b890096d6ea465fcd8e0873fec81fc348f8e64))
* Implement graceful shutdown on Ctrl+C for worker loop ([b9e93cd](https://github.com/contextgraph/agent/commit/b9e93cd12f88985b211f8bf68b2bb5a1354211f2))
* implement skill injection prototype for agent workspace ([29e6bc2](https://github.com/contextgraph/agent/commit/29e6bc2db22f9166453df46f8af3074514308d76))
* Improve worker error handling and OAuth token logging ([ebecbec](https://github.com/contextgraph/agent/commit/ebecbece737ae5fb1d671cd9464dd76855ee723a))
* Make agent resilient to extended API outages ([62bc157](https://github.com/contextgraph/agent/commit/62bc1570741342b10c4adfb6befb13f05a3f2439))
* multi-repo workspace support ([f3ca2c1](https://github.com/contextgraph/agent/commit/f3ca2c1bd9690cdf48f572b9f934c74bb1fe694b))
* Pass run_id to prompt API for inclusion in system prompt ([b707237](https://github.com/contextgraph/agent/commit/b707237c105dbc9f5d7b92b2ccfcd7269cd35634))
* Pass runId through workflow for skill tracking ([59c0990](https://github.com/contextgraph/agent/commit/59c099023fa2220bd4ef77cb6c4775b891a4f91d))
* print actionable diagnostics when worker queue is empty ([4fd751c](https://github.com/contextgraph/agent/commit/4fd751c031c984ddc66f14f9f0950fab4e6773e2))
* Send agent version when polling /api/worker/next ([2b95863](https://github.com/contextgraph/agent/commit/2b95863a72e071369d95e21f8e48908b60370637))
* Send starting commit to API when creating runs ([0f59770](https://github.com/contextgraph/agent/commit/0f597702101ff0edf08aa2c1190d4c6533082fa3))
* Show loaded skills in SDK init message ([6e7c52c](https://github.com/contextgraph/agent/commit/6e7c52c9a35f503741792e23f6c240ccf3c1f3c4))
* Show version number at agent startup ([f94df79](https://github.com/contextgraph/agent/commit/f94df79d00ef90ef87f8690e73536911e9e89b2f))
* Simplify SDK event transformer to emit Vercel sandbox format ([5548d83](https://github.com/contextgraph/agent/commit/5548d83dce96ec5dabc3eb48482a43f7eff579fd))
* **steward:** add integrations to execution prompt context ([#92](https://github.com/contextgraph/agent/issues/92)) ([aeaecb8](https://github.com/contextgraph/agent/commit/aeaecb82f84cdf2c8a7e35063af752016751795d))
* **steward:** add step/run commands and multi-repo workspace prep ([#46](https://github.com/contextgraph/agent/issues/46)) ([5414b31](https://github.com/contextgraph/agent/commit/5414b3137775598899de0484f2dbeaeece8f00e4))
* **steward:** add steward list command ([#95](https://github.com/contextgraph/agent/issues/95)) ([9968b39](https://github.com/contextgraph/agent/commit/9968b3958f4501bbf618bbc0c51c50cd165748ca))
* **steward:** add top command and improve cli formatting ([f0d409d](https://github.com/contextgraph/agent/commit/f0d409d9f023bdf8e500defc99b50c03005f39a6))
* **steward:** discover integrations at heartbeat runtime ([#91](https://github.com/contextgraph/agent/issues/91)) ([df66d65](https://github.com/contextgraph/agent/commit/df66d6525635518a348439dccbc4a78ecc8ae018))
* **steward:** separate backlog claim from workspace setup ([#94](https://github.com/contextgraph/agent/issues/94)) ([efd27b3](https://github.com/contextgraph/agent/commit/efd27b3580fdbeb1305bd7f7db89ab54387ca577))
* **steward:** show integrations in backlog claim output ([#93](https://github.com/contextgraph/agent/issues/93)) ([ceed159](https://github.com/contextgraph/agent/commit/ceed1590ed5e6dbbed91ad0417ee51299afca1ec))
* **steward:** standardize integration tooling convention ([#96](https://github.com/contextgraph/agent/issues/96)) ([c1cebf9](https://github.com/contextgraph/agent/commit/c1cebf9dc2d007a9a42bb94461b15b3b0c2bd9b2))
* Switch to SDK as default implementation ([96b4d96](https://github.com/contextgraph/agent/commit/96b4d96241471a8f7157c61fffa3a1dfae96a5b5))
* Update log-transport to use /start and /finish endpoints ([1dfd313](https://github.com/contextgraph/agent/commit/1dfd313c113ae022c31ff32e5c063a13c4cd8be7))
* Use ANTHROPIC_API_KEY for Claude Agent SDK authentication ([d861775](https://github.com/contextgraph/agent/commit/d861775802f3f5349f5aaca70897c2da0103ff27))
* Use Claude Code plugin with SDK ([9e7bba3](https://github.com/contextgraph/agent/commit/9e7bba36e14c0930dae4f08c534c2f88db477286))
* Worker log streaming implementation ([#5](https://github.com/contextgraph/agent/issues/5)) ([fdf6294](https://github.com/contextgraph/agent/commit/fdf629479780dd8fa6b2d18fcec9311fda8448fe))


### Bug Fixes

* allow codex unsandboxed runs for PR-capable workflows ([904991c](https://github.com/contextgraph/agent/commit/904991ccd4ccf40e85996ba1d1656ecc93a0e2f4))
* avoid claude model defaults and duplicate run finalization ([41f48fc](https://github.com/contextgraph/agent/commit/41f48fcb3386a264951319394bec13670e430187))
* Await server close to prevent auth command from hanging ([bc4660c](https://github.com/contextgraph/agent/commit/bc4660ccbd3d459f65f1b00a816a3bf115ecced0))
* Check learning eligibility before prepare phase in agent ([b41b636](https://github.com/contextgraph/agent/commit/b41b636cdcfc7e4fe3d0da8adf302aa9a4c29751))
* **cli:** add default npx bin alias ([5ccd34e](https://github.com/contextgraph/agent/commit/5ccd34ec017b00e82bd45a22fb1e218568492b99))
* **cli:** reframe claim output branch as preferred, not required ([#105](https://github.com/contextgraph/agent/issues/105)) ([e0746c6](https://github.com/contextgraph/agent/commit/e0746c60dd65f98924878ef7c7c8946a9edac844))
* **cli:** remove legacy top-level steward commands ([#99](https://github.com/contextgraph/agent/issues/99)) ([7def2e8](https://github.com/contextgraph/agent/commit/7def2e8f78a6eba9d9ac9e149da8a3e4b296bc69))
* configure contextgraph MCP for codex runs ([0d1a222](https://github.com/contextgraph/agent/commit/0d1a22243c37f8fbbce67386a41d8c59179ab4d2))
* Correct API endpoints for prepare and execute prompts ([1aa53ae](https://github.com/contextgraph/agent/commit/1aa53ae4a8adb8464e3bda1088cc00147f41295c))
* Correct MCP server URL to https://mcp.contextgraph.dev ([9c12545](https://github.com/contextgraph/agent/commit/9c12545deb98ecae1810339a3235325232cd8c8d))
* Correct package.json path for built version display ([04d56d9](https://github.com/contextgraph/agent/commit/04d56d98bbf95feb223aed29b6e8b73905ce0838))
* Correct repository URLs to use contextgraph org name ([c524471](https://github.com/contextgraph/agent/commit/c524471e10d3d2b060d4806d73b8406133bd03d5))
* Enable bypassPermissions mode for autonomous agent execution ([15dc5a3](https://github.com/contextgraph/agent/commit/15dc5a37a3a7fdc547b62950f6e651c76cc84e13))
* Enable bypassPermissions mode for MCP tools to execute automatically ([de5aa9f](https://github.com/contextgraph/agent/commit/de5aa9fcfb6f89ac1d9e7fd3fc894f48763d318b))
* Ensure auth flow exits cleanly after successful authentication ([e886937](https://github.com/contextgraph/agent/commit/e8869377997b397e1bc6553b025e6c5a5239e6b4))
* Ensure claim release after all Claude exit scenarios ([92fc052](https://github.com/contextgraph/agent/commit/92fc052883a425a0975d60cf96286c98dc91d825))
* Exclude .claude/skills/ from git to prevent injected skills in PRs ([19b2e1d](https://github.com/contextgraph/agent/commit/19b2e1dc8ae2efd8795be31e715819dac9687adf))
* handle commander helpDisplayed as non-error in cg CLI ([#14](https://github.com/contextgraph/agent/issues/14)) ([f39941c](https://github.com/contextgraph/agent/commit/f39941c909f0c925eaf1beb3e271da53cf1c4eb5))
* Handle race condition when run is already in summarizing state ([a693c66](https://github.com/contextgraph/agent/commit/a693c66ef40794660925c78d8afe38d8e77b7515))
* Only log "Waiting for work" once until work is found ([76a32ca](https://github.com/contextgraph/agent/commit/76a32cadcf25ca2fd828d2953ff2c13f9febc0f2))
* Only print 'Working' message for actions with actual work ([2315b33](https://github.com/contextgraph/agent/commit/2315b33f414e4c53c2459beb533eb7ddcdb530c7))
* pass action branch explicitly in prompt prefix to Claude ([#10](https://github.com/contextgraph/agent/issues/10)) ([c9df82a](https://github.com/contextgraph/agent/commit/c9df82a320def91e2042ffc9732dd644b25bd5a0))
* pass graphId to credentials endpoint for correct GitHub token ([#11](https://github.com/contextgraph/agent/issues/11)) ([75969be](https://github.com/contextgraph/agent/commit/75969be5c6990597df0acaccf3bc46a7d65bfacd))
* Read version dynamically from package.json instead of hardcoding ([8ee42d7](https://github.com/contextgraph/agent/commit/8ee42d722f42ffb0c5e2ca513e2910b1433c50f0))
* Remove MCP server override to let plugin handle configuration ([10bbff4](https://github.com/contextgraph/agent/commit/10bbff4ed1a3ed5dbe8552d4bbcaeb248369f802))
* Remove redundant claim release after preparation ([d3def59](https://github.com/contextgraph/agent/commit/d3def59a6408877036ffc8c0399b0115e29048a5))
* render codex item events with readable labels ([d2c2e29](https://github.com/contextgraph/agent/commit/d2c2e2976e96ef585b1c583488e394ed4281c2f7))
* resolve Claude run status from final SDK result ([a02958a](https://github.com/contextgraph/agent/commit/a02958a1d48bbdd32faeebff979b8f5aaf617997))
* Return logTransport from setupWorkspaceForAction ([16d71c7](https://github.com/contextgraph/agent/commit/16d71c7439c25bbf54e42f6b070baa8607640f86))
* show codex progress for non-message events ([888687d](https://github.com/contextgraph/agent/commit/888687db741b16bb9ac4a17a39a91041f7854196))
* Silence verbose skip messages when learning is disabled ([3293b83](https://github.com/contextgraph/agent/commit/3293b8373249406157828be1f07d17ca47cf21c6))
* **steward:** count only claimed work toward max steps ([#47](https://github.com/contextgraph/agent/issues/47)) ([e163f00](https://github.com/contextgraph/agent/commit/e163f00ba18a40221dfb913d22443a83ede41715))
* **steward:** normalize and prefer authenticated clone URLs ([#57](https://github.com/contextgraph/agent/issues/57)) ([e29e12b](https://github.com/contextgraph/agent/commit/e29e12b1faf5794b121dc724971731612eb5d703))
* **steward:** preserve authenticated clone URL during repo dedupe ([#58](https://github.com/contextgraph/agent/issues/58)) ([ab16cd2](https://github.com/contextgraph/agent/commit/ab16cd28a6e7a604d70bb9257ed7506721405cb1))
* **steward:** preserve authenticated clone URL during repo dedupe ([#59](https://github.com/contextgraph/agent/issues/59)) ([28f1893](https://github.com/contextgraph/agent/commit/28f189313bd3ce841c0741802df6b957cd4c9c5e))
* stream codex progress events to console ([199cfcd](https://github.com/contextgraph/agent/commit/199cfcd8f9b8f85e2340f438c705c2754dc555af))
* Update API base URL to include www subdomain ([224cdb4](https://github.com/contextgraph/agent/commit/224cdb474ca2527f1487b13a3aa7276baffe6e98))
* Use Claude Haiku 4.5 for --force-haiku flag ([3b7c1b0](https://github.com/contextgraph/agent/commit/3b7c1b01ef42781ad0e24893148a185d44cdb605))
* Use correct Opus model identifier and scope to prepare phase only ([e9a7164](https://github.com/contextgraph/agent/commit/e9a7164abae868168e67a7f14cc5db0346a231b2))
* Use local findNextLeaf instead of nonexistent API endpoint ([94d6580](https://github.com/contextgraph/agent/commit/94d658031d0327b46a331b854261f14ae0570e4b))
* Use x-access-token format for GitHub App token authentication ([0fd148b](https://github.com/contextgraph/agent/commit/0fd148bdaa7f8217c9b0b4c65d7951b4d5ed6ba5))

## [0.1.1] - 2025-11-16

### Fixed
- Fixed 400 error on iteration 2 by using local findNextLeaf instead of nonexistent API endpoint
- Fixed auth command hanging after successful authentication by properly awaiting server close

### Changed
- Updated README to prioritize npx usage over global installation
- Removed unused ApiClient.findNextLeaf() method
- Simplified agent workflow to use local tree traversal

## [0.1.0] - 2025-11-15

### Added
- Initial release of @contextgraph/agent
- OAuth authentication with contextgraph.dev
- CLI commands: auth, whoami, run, prepare, execute
- Autonomous agent loop with tree traversal
- Dependency-aware action execution
- Claude CLI integration for agent execution
- MCP server integration
- Secure credential storage in ~/.contextgraph/

### Technical Details
- ESM-only package for Node.js 18+
- Built with TypeScript and tsup
- Commander framework for CLI
- Extracted from actionbias repository
