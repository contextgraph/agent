import { defaultStewardConfig, getStewardConfigPath, loadStewardConfig, saveStewardConfig } from '../steward-config.js';
import { printWrapped } from './render.js';

export async function runStewardConfigure(): Promise<void> {
  const configPath = getStewardConfigPath();
  const existing = await loadStewardConfig();

  if (!existing) {
    await saveStewardConfig(defaultStewardConfig());
  }

  const config = existing ?? defaultStewardConfig();

  console.log('# Steward Config');
  console.log(`- Path: ${configPath}`);
  console.log(`- Status: ${existing ? 'Loaded existing config' : 'Created new config scaffold'}`);
  console.log(`- Integrations: ${config.integrations.length}`);

  console.log('\n## Next Steps');
  printWrapped('Add the integrations available on this machine by listing the environment variables each one requires.', {
    indent: '  ',
  });
  printWrapped('This file does not define stewards. Steward missions and behavior live in steward.foo; this file only describes what local secrets and endpoints are available here.', {
    indent: '  ',
  });
  printWrapped('The next step after this scaffold is validation: prove the declared integrations are reachable before steward heartbeat and steward run rely on them.', {
    indent: '  ',
  });
}
