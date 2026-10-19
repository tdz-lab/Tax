/**
 * Password-based authenticated encryption for backups using the browser's WebCrypto API
 * (PBKDF2-SHA-256 key derivation + AES-256-GCM). No custom cryptography.
 */
import { base64ToBuf, bufToBase64 } from '../lib/files';

export const KDF_ITERATIONS = 600_000;

export interface EncryptedEnvelope {
  format: 'au-tax-ledger-backup-encrypted';
  version: 1;
  kdf: { name: 'PBKDF2'; hash: 'SHA-256'; iterations: number; salt: string };
  cipher: { name: 'AES-GCM'; iv: string; tagLength: 128 };
  ciphertext: string;
}

async function deriveKey(password: string, salt: Uint8Array, iterations: number): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

export async function encryptText(plain: string, password: string, iterations = KDF_ITERATIONS): Promise<EncryptedEnvelope> {
  if (!password || password.length < 8) throw new Error('Backup password must be at least 8 characters.');
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt, iterations);
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, tagLength: 128 }, key, new TextEncoder().encode(plain));
  return {
    format: 'au-tax-ledger-backup-encrypted',
    version: 1,
    kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations, salt: bufToBase64(salt) },
    cipher: { name: 'AES-GCM', iv: bufToBase64(iv), tagLength: 128 },
    ciphertext: bufToBase64(ct)
  };
}

export async function decryptText(env: EncryptedEnvelope, password: string): Promise<string> {
  const key = await deriveKey(password, new Uint8Array(base64ToBuf(env.kdf.salt)), env.kdf.iterations);
  try {
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: new Uint8Array(base64ToBuf(env.cipher.iv)), tagLength: 128 }, key, base64ToBuf(env.ciphertext));
    return new TextDecoder().decode(pt);
  } catch {
    throw new Error('Could not decrypt the backup — the password is wrong or the file has been modified.');
  }
}
