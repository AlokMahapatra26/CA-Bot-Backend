/**
 * ─────────────────────────────────────────────────────────────────
 * CloudProvider — WhatsApp Cloud API (STUB / PLACEHOLDER)
 * ─────────────────────────────────────────────────────────────────
 *
 * This provider is NOT active. It exists as a placeholder for when
 * you're ready to migrate from Baileys to WhatsApp Cloud API.
 *
 * To activate:
 * 1. Set WHATSAPP_PROVIDER=cloud in .env
 * 2. Add required env vars: CLOUD_API_TOKEN, CLOUD_PHONE_NUMBER_ID, CLOUD_VERIFY_TOKEN
 * 3. Implement each method below following the TODO comments
 * 4. Set up a webhook endpoint to receive incoming messages
 *
 * WhatsApp Cloud API Docs:
 * https://developers.facebook.com/docs/whatsapp/cloud-api/
 */

import type {
  IWhatsAppProvider,
  ConnectionStatus,
  MessageHandler,
  DownloadedMedia,
} from './types';

export class CloudProvider implements IWhatsAppProvider {

  // TODO: Store these from environment variables
  // private apiToken: string;
  // private phoneNumberId: string;
  // private verifyToken: string;

  /**
   * Initialize the Cloud API provider.
   *
   * TODO: Implementation steps:
   * 1. Read CLOUD_API_TOKEN, CLOUD_PHONE_NUMBER_ID, CLOUD_VERIFY_TOKEN from env
   * 2. Register a webhook endpoint (e.g. POST /webhook) to receive messages
   * 3. Verify the webhook with Meta's challenge handshake
   * 4. Parse incoming webhook payloads and call onMessage() with IncomingMessage
   */
  async initialize(_onMessage: MessageHandler): Promise<void> {
    throw new Error(
      'WhatsApp Cloud API provider is not yet implemented. ' +
      'Set WHATSAPP_PROVIDER=baileys in .env to use the Baileys provider.'
    );
  }

  /**
   * Send a plain text message via Cloud API.
   *
   * TODO: Implementation steps:
   * 1. POST to https://graph.facebook.com/v18.0/{phoneNumberId}/messages
   * 2. Body: { messaging_product: "whatsapp", to: recipientPhone, type: "text", text: { body: text } }
   * 3. Headers: Authorization: Bearer {apiToken}
   * 4. Note: Cloud API uses phone numbers (e.g. "917383149649"), not JIDs
   *    — you may need a JID-to-phone conversion utility
   */
  async sendText(_to: string, _text: string): Promise<void> {
    throw new Error('WhatsApp Cloud API sendText() not yet implemented.');
  }

  /**
   * Send a document via Cloud API.
   *
   * TODO: Implementation steps:
   * 1. POST to https://graph.facebook.com/v18.0/{phoneNumberId}/messages
   * 2. Body: { messaging_product: "whatsapp", to: recipientPhone, type: "document",
   *            document: { link: documentUrl, filename: fileName, caption: caption } }
   * 3. Headers: Authorization: Bearer {apiToken}
   */
  async sendDocument(
    _to: string,
    _documentUrl: string,
    _fileName: string,
    _caption?: string
  ): Promise<void> {
    throw new Error('WhatsApp Cloud API sendDocument() not yet implemented.');
  }

  /**
   * Download media from an incoming Cloud API message.
   *
   * TODO: Implementation steps:
   * 1. Extract media ID from the incoming webhook payload
   * 2. GET https://graph.facebook.com/v18.0/{mediaId} to get the download URL
   * 3. GET the download URL with Authorization header to fetch the raw buffer
   * 4. Return { buffer, mimetype, extension }
   */
  async downloadMedia(
    _rawMessage: unknown,
    _rawMessageContent: unknown
  ): Promise<DownloadedMedia | null> {
    throw new Error('WhatsApp Cloud API downloadMedia() not yet implemented.');
  }

  /**
   * Get connection status.
   *
   * TODO: Cloud API is always "connected" if the token is valid.
   * You could verify by calling GET /v18.0/{phoneNumberId} and checking the response.
   */
  getStatus(): ConnectionStatus {
    return {
      status: 'disconnected',
      qr: null,
      connected: false,
      botNumber: null,
    };
  }

  /**
   * Logout / disconnect.
   *
   * TODO: For Cloud API, this could revoke the API token or
   * simply deregister the webhook. Implementation depends on
   * your deployment strategy.
   */
  async logout(): Promise<void> {
    throw new Error('WhatsApp Cloud API logout() not yet implemented.');
  }
}
