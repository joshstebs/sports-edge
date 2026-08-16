import { randomBytes, randomUUID } from 'node:crypto';
import { hashPassword } from '../src/auth/password.js';

function argument(name: string, fallback: string): string {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : fallback;
  if (!value || !/^[a-z0-9][a-z0-9._-]{2,63}$/i.test(value)) {
    throw new Error(`${name} must be a 3-64 character username containing only letters, numbers, ., _, or -.`);
  }
  return value.toLowerCase();
}

function strongPassword(): string {
  // 256 random bits. base64url avoids shell-hostile punctuation while retaining
  // substantially more entropy than a human-selected password.
  return randomBytes(32).toString('base64url');
}

async function main(): Promise<void> {
  const adminUsername = argument('--admin', 'admin');
  const testerUsername = argument('--tester', 'tester');
  if (adminUsername === testerUsername) throw new Error('Admin and tester usernames must differ.');

  const adminPassword = strongPassword();
  const testerPassword = strongPassword();
  const users = [
    {
      id: randomUUID(),
      username: adminUsername,
      role: 'admin',
      passwordHash: await hashPassword(adminPassword),
    },
    {
      id: randomUUID(),
      username: testerUsername,
      role: 'tester',
      passwordHash: await hashPassword(testerPassword),
    },
  ];

  // stdout contains deployment-safe environment configuration and can be
  // redirected directly to a protected local file. Plaintext credentials are
  // deliberately emitted once on stderr so they cannot accidentally enter the
  // redirected config, and this script never writes them to the repository.
  process.stdout.write(`AUTH_USERS_JSON='${JSON.stringify(users)}'\n`);
  process.stdout.write(`AUTH_SESSION_SECRET=${randomBytes(48).toString('base64url')}\n`);
  process.stderr.write('\nStore these one-time credentials in a password manager now:\n');
  process.stderr.write(`  Admin  ${adminUsername}: ${adminPassword}\n`);
  process.stderr.write(`  Tester ${testerUsername}: ${testerPassword}\n\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
