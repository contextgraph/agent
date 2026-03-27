import type { StewardClaimOptions } from './steward-claim.js';
import { runStewardClaim } from './steward-claim.js';

export interface StewardNextOptions extends StewardClaimOptions {}

export async function runStewardNext(options: StewardNextOptions = {}): Promise<void> {
  await runStewardClaim(options);
}
