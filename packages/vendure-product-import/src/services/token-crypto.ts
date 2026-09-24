import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto';

const ALGO = 'aes-256-gcm';

function deriveKey(secret: string): Buffer {
    return scryptSync(secret, 'shopify-store-connection', 32);
}

/** Encrypts `plaintext` with a key derived from `secret` (the app's Shopify apiSecret). */
export function encryptToken(plaintext: string, secret: string): string {
    const key = deriveKey(secret);
    const iv = randomBytes(12);
    const cipher = createCipheriv(ALGO, key, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf-8'), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return Buffer.concat([iv, authTag, encrypted]).toString('base64');
}

export function decryptToken(ciphertext: string, secret: string): string {
    const key = deriveKey(secret);
    const raw = Buffer.from(ciphertext, 'base64');
    const iv = raw.subarray(0, 12);
    const authTag = raw.subarray(12, 28);
    const encrypted = raw.subarray(28);
    const decipher = createDecipheriv(ALGO, key, iv);
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf-8');
}
