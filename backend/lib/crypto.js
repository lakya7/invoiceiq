// lib/crypto.js — AES-256-GCM encryption for ERP credentials
//
// Format: "v1:<base64(iv)>:<base64(authTag)>:<base64(ciphertext)>"
// The "v1:" prefix lets us detect encrypted values at read-time and pass
// through legacy plaintext values unchanged during the migration window.
//
// Key: 32 raw bytes (256 bits), provided as a 64-char hex string in the
// ENCRYPTION_KEY env var. Generated once with:
//   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

const crypto = require("crypto");

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12; // 12 bytes is the recommended IV size for GCM
const KEY_PREFIX = "v1:";

function getKey() {
  const hex = process.env.ENCRYPTION_KEY;
  if (!hex) {
    throw new Error(
      "ENCRYPTION_KEY env var is not set. Refusing to encrypt/decrypt."
    );
  }
  if (hex.length !== 64) {
    throw new Error(
      `ENCRYPTION_KEY must be 64 hex chars (32 bytes). Got ${hex.length} chars.`
    );
  }
  return Buffer.from(hex, "hex");
}

function encrypt(plaintext) {
  if (plaintext === null || plaintext === undefined) return plaintext;
  if (typeof plaintext !== "string") {
    throw new Error("encrypt() expects a string");
  }
  // Don't double-encrypt
  if (plaintext.startsWith(KEY_PREFIX)) return plaintext;

  const key = getKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  return [
    "v1",
    iv.toString("base64"),
    authTag.toString("base64"),
    ciphertext.toString("base64"),
  ].join(":");
}

function decrypt(value) {
  if (value === null || value === undefined) return value;
  if (typeof value !== "string") {
    throw new Error("decrypt() expects a string");
  }
  // Passthrough for plaintext (legacy values without the v1: prefix)
  if (!value.startsWith(KEY_PREFIX)) return value;

  const parts = value.split(":");
  if (parts.length !== 4 || parts[0] !== "v1") {
    throw new Error("Invalid v1 encrypted format");
  }
  const [, ivB64, tagB64, ctB64] = parts;
  const iv = Buffer.from(ivB64, "base64");
  const authTag = Buffer.from(tagB64, "base64");
  const ciphertext = Buffer.from(ctB64, "base64");

  const key = getKey();
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  const plaintext = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]);
  return plaintext.toString("utf8");
}

function isEncrypted(value) {
  return typeof value === "string" && value.startsWith(KEY_PREFIX);
}

function assertKeyConfigured() {
  // Throw early at boot if the key is missing/malformed.
  getKey();
}

module.exports = { encrypt, decrypt, isEncrypted, assertKeyConfigured };
