/**
 * ─────────────────────────────────────────────────────────────────
 * WhatsApp Provider Factory & Singleton
 * ─────────────────────────────────────────────────────────────────
 *
 * This module reads WHATSAPP_PROVIDER from the environment and
 * creates the correct provider instance. All business logic imports
 * `messageService` from this file — never from provider-specific modules.
 *
 * Usage:
 *   import { messageService } from '../providers';
 *   await messageService.sendText(jid, 'Hello!');
 */

import { config } from '../config/env';
import type { IWhatsAppProvider } from './types';
import { BaileysProvider } from './baileys.provider';
import { CloudProvider } from './cloud.provider';

/**
 * Factory: create the appropriate WhatsApp provider based on WHATSAPP_PROVIDER env var.
 *
 * Currently supported:
 *   'baileys' (default) — Direct WhatsApp connection via @whiskeysockets/baileys
 *   'cloud'             — WhatsApp Cloud API (stub, not yet implemented)
 */
function createProvider(): IWhatsAppProvider {
  const providerName = config.WHATSAPP_PROVIDER;

  switch (providerName) {
    case 'baileys':
      console.log('[Provider] Using BaileysProvider (direct WhatsApp connection)');
      return new BaileysProvider();

    case 'cloud':
      console.log('[Provider] Using CloudProvider (WhatsApp Cloud API)');
      return new CloudProvider();

    default:
      console.warn(
        `[Provider] Unknown WHATSAPP_PROVIDER="${providerName}". Falling back to BaileysProvider.`
      );
      return new BaileysProvider();
  }
}

/** Singleton provider instance — use this everywhere in the app */
export const messageService: IWhatsAppProvider = createProvider();

// Re-export types for convenience
export type { IWhatsAppProvider, IncomingMessage, ConnectionStatus, MessageHandler, DownloadedMedia } from './types';
