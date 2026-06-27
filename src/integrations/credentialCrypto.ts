import crypto from "crypto";

/** Matches rapidomeet supabase/functions/encrypt-credentials (AES-256-GCM). */
function getEncryptionKey(): Buffer {
  const secret = process.env.ENCRYPTION_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return Buffer.from(secret.slice(0, 32).padEnd(32, "0"), "utf8");
}

export function encryptCredential(plaintext: string): string {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, encrypted, tag]).toString("base64");
}

export function decryptCredential(encryptedB64: string): string {
  const key = getEncryptionKey();
  const combined = Buffer.from(encryptedB64, "base64");
  const iv = combined.subarray(0, 12);
  const tag = combined.subarray(combined.length - 16);
  const ciphertext = combined.subarray(12, combined.length - 16);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}
