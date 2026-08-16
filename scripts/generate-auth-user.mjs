import { randomBytes, scrypt as nodeScrypt } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(nodeScrypt);
const [usernameRaw, roleRaw = 'admin'] = process.argv.slice(2);
const username = String(usernameRaw ?? '').trim().toLowerCase();
const role = roleRaw === 'tester' ? 'tester' : 'admin';
if (!/^[a-z0-9][a-z0-9._-]{2,63}$/.test(username)) {
  console.error('Usage: node scripts/generate-auth-user.mjs <username> [admin|tester]');
  process.exit(1);
}

const password = randomBytes(18).toString('base64url');
const N = 32768, r = 8, p = 1;
const salt = randomBytes(16);
const derived = await scrypt(password, salt, 32, { N, r, p, maxmem: 64 * 1024 * 1024 });
const passwordHash = `scrypt$${N}$${r}$${p}$${salt.toString('base64url')}$${Buffer.from(derived).toString('base64url')}`;
const id = `${role}-${randomBytes(8).toString('hex')}`;

console.log('Username:', username);
console.log('Password:', password);
console.log('AUTH_USERS_JSON entry:');
console.log(JSON.stringify({ id, username, role, passwordHash }));
console.log('\nStore the password in a password manager. Do not commit it or the generated JSON entry.');
