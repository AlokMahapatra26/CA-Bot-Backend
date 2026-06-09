/**
 * Utility functions for handling WhatsApp JID (Jabber ID) identifiers.
 *
 * WhatsApp uses two types of JIDs:
 * - Phone JID: e.g. "917383149649@s.whatsapp.net"  (standard, contains real phone number)
 * - LID:       e.g. "200433658294422@lid"           (privacy-protected, no phone number)
 *
 * The bot stores a clean phone number (e.g. "917383149649") in the database.
 * When sending a WhatsApp message, the JID must be reconstructed.
 */

/** Check if a given JID is a privacy-protected LID (no phone number available). */
export const isLid = (jid: string): boolean => jid.endsWith('@lid');

/**
 * Extract the clean phone number from a standard phone JID.
 * Returns null if the JID is a LID (phone number is not available).
 * Example: "917383149649@s.whatsapp.net" → "917383149649"
 */
export const extractPhoneNumber = (jid: string): string | null => {
  if (isLid(jid)) return null;
  const match = jid.match(/^(\d+)@/);
  return match ? match[1] : null;
};

/**
 * Reconstruct the WhatsApp JID required to send a message.
 * - If phone_number is a clean number → append "@s.whatsapp.net"
 * - If phone_number is a raw LID string → use it as-is (already a valid JID)
 * Example: "917383149649" → "917383149649@s.whatsapp.net"
 * Example: "200433658294422@lid" → "200433658294422@lid"
 */
export const toWhatsAppJid = (storedPhoneNumber: string): string => {
  // Already a full JID (LID or phone JID stored as-is)
  if (storedPhoneNumber.includes('@')) return storedPhoneNumber;
  // Plain phone number — reconstruct standard JID
  return `${storedPhoneNumber}@s.whatsapp.net`;
};

/**
 * Derive the canonical storage key from a raw sender JID.
 * - Phone JID: extract the clean number (e.g. "917383149649")
 * - LID: store the full LID string as-is (e.g. "200433658294422@lid")
 *   This allows the bot to look up the session and reply until the real number is known.
 */
export const toStorageKey = (senderJid: string): string => {
  const phone = extractPhoneNumber(senderJid);
  return phone ?? senderJid; // fall back to raw LID if number unavailable
};

import fs from 'fs';
import path from 'path';

/**
 * Resolves the real phone number (digits only, e.g. "918849561649") from a JID.
 * Handles standard JIDs directly.
 * Handles LIDs by checking the raw message key.senderPn or the Baileys auth local mapping files.
 */
export const resolvePhoneNumber = (jid: string, rawMessage?: any): string | null => {
  if (!jid) return null;

  // 1. If standard JID, extract number directly
  if (!isLid(jid)) {
    const match = jid.match(/^(\d+)@/);
    return match ? match[1] : null;
  }

  // 2. If LID, try to get from message senderPn
  if (rawMessage?.key?.senderPn) {
    const pn = rawMessage.key.senderPn.split('@')[0];
    if (pn && /^\d+$/.test(pn)) {
      return pn;
    }
  }

  // 3. Try reading from Baileys auth state mapping file
  try {
    const lidNumber = jid.split('@')[0];
    const mappingPath = path.resolve('auth_info_baileys', `lid-mapping-${lidNumber}_reverse.json`);
    if (fs.existsSync(mappingPath)) {
      const content = fs.readFileSync(mappingPath, 'utf-8');
      const pn = JSON.parse(content); // content is JSON string e.g. "918849561649"
      if (pn && typeof pn === 'string') {
        return pn.replace(/\D/g, '');
      }
    }
  } catch (err) {
    console.error(`[resolvePhoneNumber] Error reading mapping file for JID ${jid}:`, err);
  }

  return null;
};
