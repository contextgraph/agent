import { authenticateAgent } from '../auth-flow.js';

export async function runAuth(): Promise<void> {
  console.log('Starting authentication flow...\n');

  const result = await authenticateAgent();

  if (result.success) {
    console.log('\n✅ Authentication successful!');
    console.log(`User ID: ${result.credentials.userId}`);
  } else {
    console.error('\n❌ Authentication failed:', result.error);
    process.exit(1);
  }
}

