import { randomBytes, scrypt as nodeScrypt, timingSafeEqual } from 'node:crypto';

const ALGORITHM = 'scrypt';
const KEY_LENGTH = 32;
const SALT_LENGTH = 16;
const DEFAULT_N = 32_768;
const DEFAULT_R = 8;
const DEFAULT_P = 1;
const MAX_PASSWORD_BYTES = 1_024;
const MAX_SCRYPT_N = 131_072;

export interface ScryptParameters {
  N: number;
  r: number;
  p: number;
}

function validParameters(parameters: ScryptParameters): boolean {
  return (
    Number.isInteger(parameters.N) &&
    parameters.N >= 16_384 &&
    parameters.N <= MAX_SCRYPT_N &&
    (parameters.N & (parameters.N - 1)) === 0 &&
    Number.isInteger(parameters.r) &&
    parameters.r >= 1 &&
    parameters.r <= 16 &&
    Number.isInteger(parameters.p) &&
    parameters.p >= 1 &&
    parameters.p <= 4
  );
}

async function deriveKey(password: string, salt: Buffer, parameters: ScryptParameters): Promise<Buffer> {
  // Node's default maxmem is too close to N=32768/r=8's actual requirement.
  const maxmem = Math.max(64 * 1024 * 1024, 256 * parameters.N * parameters.r);
  return await new Promise<Buffer>((resolve, reject) => {
    nodeScrypt(password, salt, KEY_LENGTH, { ...parameters, maxmem }, (error, derivedKey) => {
      if (error) reject(error);
      else resolve(derivedKey);
    });
  });
}

/**
 * Produces a self-describing, versionable password record suitable for
 * AUTH_USERS_JSON. The plaintext password is never retained by this module.
 */
export async function hashPassword(
  password: string,
  parameters: ScryptParameters = { N: DEFAULT_N, r: DEFAULT_R, p: DEFAULT_P },
): Promise<string> {
  if (typeof password !== 'string' || password.length < 12) {
    throw new Error('Passwords must contain at least 12 characters.');
  }
  if (Buffer.byteLength(password, 'utf8') > MAX_PASSWORD_BYTES) {
    throw new Error('Password is too long.');
  }
  if (!validParameters(parameters)) {
    throw new Error('Invalid scrypt parameters.');
  }

  const salt = randomBytes(SALT_LENGTH);
  const derivedKey = await deriveKey(password, salt, parameters);
  return [
    ALGORITHM,
    parameters.N,
    parameters.r,
    parameters.p,
    salt.toString('base64url'),
    derivedKey.toString('base64url'),
  ].join('$');
}

export async function verifyPassword(password: unknown, record: unknown): Promise<boolean> {
  if (
    typeof password !== 'string' ||
    typeof record !== 'string' ||
    Buffer.byteLength(password, 'utf8') > MAX_PASSWORD_BYTES
  ) {
    return false;
  }

  try {
    const parts = record.split('$');
    if (parts.length !== 6 || parts[0] !== ALGORITHM) return false;

    const parameters: ScryptParameters = {
      N: Number(parts[1]),
      r: Number(parts[2]),
      p: Number(parts[3]),
    };
    if (!validParameters(parameters)) return false;

    const salt = Buffer.from(parts[4], 'base64url');
    const expected = Buffer.from(parts[5], 'base64url');
    if (salt.length !== SALT_LENGTH || expected.length !== KEY_LENGTH) return false;

    const actual = await deriveKey(password, salt, parameters);
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

/** Performs equivalent expensive work when a username does not exist. */
export async function burnPasswordCheck(password: unknown): Promise<void> {
  const candidate =
    typeof password === 'string' && Buffer.byteLength(password, 'utf8') <= MAX_PASSWORD_BYTES
      ? password
      : randomBytes(24).toString('base64url');
  const salt = randomBytes(SALT_LENGTH);
  const actual = await deriveKey(candidate, salt, { N: DEFAULT_N, r: DEFAULT_R, p: DEFAULT_P });
  timingSafeEqual(actual, randomBytes(KEY_LENGTH));
}
