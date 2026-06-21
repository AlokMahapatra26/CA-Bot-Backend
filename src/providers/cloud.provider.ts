/**
 * ─────────────────────────────────────────────────────────────────
 * CloudProvider — WhatsApp Cloud API Implementation
 * ─────────────────────────────────────────────────────────────────
 *
 * This provider handles official Meta WhatsApp Cloud API connectivity.
 * It uses stateless HTTPS calls to send messages and parses webhook payloads
 * forwarded from the backend's Express router.
 *
 * WhatsApp Cloud API Docs:
 * https://developers.facebook.com/docs/whatsapp/cloud-api/
 */

import { config } from '../config/env';
import type {
  IWhatsAppProvider,
  ConnectionStatus,
  MessageHandler,
  DownloadedMedia,
  IncomingMessage,
} from './types';

export class CloudProvider implements IWhatsAppProvider {
  private apiToken: string = '';
  private phoneNumberId: string = '';
  private verifyToken: string = '';
  private onMessageCallback: MessageHandler | null = null;

  /**
   * Initialize the Cloud API provider from the configuration.
   */
  async initialize(onMessage: MessageHandler): Promise<void> {
    this.onMessageCallback = onMessage;
    this.apiToken = config.META_ACCESS_TOKEN;
    this.phoneNumberId = config.META_PHONE_NUMBER_ID;
    this.verifyToken = config.META_VERIFY_TOKEN;

    if (!this.apiToken || !this.phoneNumberId) {
      console.warn(
        '[CloudProvider] Warning: META_ACCESS_TOKEN or META_PHONE_NUMBER_ID is missing. ' +
        'Configure these variables to enable official Cloud API communication.'
      );
    } else {
      console.log('[CloudProvider] Meta API configuration successfully loaded.');
    }
  }

  /**
   * Send a plain text message via Meta Graph API.
   */
  async sendText(to: string, text: string): Promise<void> {
    if (!this.apiToken || !this.phoneNumberId) {
      throw new Error('[CloudProvider] API credentials are not configured.');
    }

    const cleanPhone = to.split('@')[0].replace('+', '');
    const url = `https://graph.facebook.com/v25.0/${this.phoneNumberId}/messages`;

    console.log(`[CloudProvider] Sending text to ${cleanPhone}...`);

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: cleanPhone,
        type: 'text',
        text: { body: text },
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`[CloudProvider] Send text failed: ${response.statusText}. Details: ${errorText}`);
    }
  }

  /**
   * Send a document attachment via Meta Graph API.
   */
  async sendDocument(
    to: string,
    documentUrl: string,
    fileName: string,
    caption?: string
  ): Promise<void> {
    if (!this.apiToken || !this.phoneNumberId) {
      throw new Error('[CloudProvider] API credentials are not configured.');
    }

    const cleanPhone = to.split('@')[0].replace('+', '');
    const url = `https://graph.facebook.com/v25.0/${this.phoneNumberId}/messages`;

    console.log(`[CloudProvider] Sending document to ${cleanPhone} (${fileName})...`);

    const body: any = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: cleanPhone,
      type: 'document',
      document: {
        link: documentUrl,
        filename: fileName,
      },
    };

    if (caption) {
      body.document.caption = caption;
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`[CloudProvider] Send document failed: ${response.statusText}. Details: ${errorText}`);
    }
  }

  /**
   * Send interactive quick reply buttons to a WhatsApp recipient.
   */
  async sendButtons(
    to: string,
    text: string,
    buttons: { id: string; title: string }[]
  ): Promise<void> {
    if (!this.apiToken || !this.phoneNumberId) {
      throw new Error('[CloudProvider] API credentials are not configured.');
    }

    const cleanPhone = to.split('@')[0].replace('+', '');
    const url = `https://graph.facebook.com/v25.0/${this.phoneNumberId}/messages`;

    console.log(`[CloudProvider] Sending interactive buttons to ${cleanPhone}...`);

    const formattedButtons = buttons.slice(0, 3).map((btn) => ({
      type: 'reply',
      reply: {
        id: btn.id,
        title: btn.title,
      },
    }));

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: cleanPhone,
        type: 'interactive',
        interactive: {
          type: 'button',
          body: {
            text: text,
          },
          action: {
            buttons: formattedButtons,
          },
        },
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`[CloudProvider] Send buttons failed: ${response.statusText}. Details: ${errorText}`);
    }
  }


  /**
   * Download media attachments using Meta's media download flow.
   */
  async downloadMedia(
    rawMessage: any,
    _rawMessageContent: unknown
  ): Promise<DownloadedMedia | null> {
    if (!this.apiToken) {
      throw new Error('[CloudProvider] API Access Token is missing.');
    }

    if (!rawMessage || typeof rawMessage !== 'object') return null;

    const type = rawMessage.type;
    const mediaObj = rawMessage[type];
    if (!mediaObj || !mediaObj.id) {
      console.warn('[CloudProvider] No media attachment ID found in payload.');
      return null;
    }

    const mediaId = mediaObj.id;

    try {
      // 1. Fetch media URL from Meta
      const metadataUrl = `https://graph.facebook.com/v25.0/${mediaId}`;
      const metadataRes = await fetch(metadataUrl, {
        headers: {
          'Authorization': `Bearer ${this.apiToken}`,
        },
      });

      if (!metadataRes.ok) {
        const errorText = await metadataRes.text();
        throw new Error(`Failed fetching media metadata: ${metadataRes.statusText}. Details: ${errorText}`);
      }

      const metadata: any = await metadataRes.json();
      const mediaDownloadUrl = metadata.url;
      const mimetype = metadata.mime_type || mediaObj.mime_type;

      if (!mediaDownloadUrl) {
        throw new Error('Media resource URL not returned by Meta.');
      }

      // 2. Fetch the raw binary buffer using the download URL
      const fileRes = await fetch(mediaDownloadUrl, {
        headers: {
          'Authorization': `Bearer ${this.apiToken}`,
        },
      });

      if (!fileRes.ok) {
        throw new Error(`Failed downloading file binary: ${fileRes.statusText}`);
      }

      const arrayBuffer = await fileRes.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      // Determine extension
      let extension = '';
      if (type === 'document' && mediaObj.filename) {
        extension = mediaObj.filename.split('.').pop() || '';
      } else if (mimetype) {
        extension = mimetype.split('/')[1] || '';
      }

      return {
        buffer,
        mimetype,
        extension,
      };
    } catch (error: any) {
      console.error('[CloudProvider] Failed to download media:', error.message);
      return null;
    }
  }

  /**
   * Get the current connection status.
   */
  getStatus(): ConnectionStatus {
    const isConfigured = !!(this.apiToken && this.phoneNumberId);
    return {
      status: isConfigured ? 'connected' : 'disconnected',
      qr: null,
      connected: isConfigured,
      botNumber: this.phoneNumberId || null,
    };
  }

  /**
   * Stateless API — no persistent connection to close.
   */
  async logout(): Promise<void> {
    console.log('[CloudProvider] Clearing session config.');
  }

  /**
   * Webhook router callback triggered by App Router.
   */
  async handleWebhook(body: any): Promise<void> {
    if (!this.onMessageCallback) return;

    const entry = body.entry?.[0];
    const change = entry?.changes?.[0];
    const value = change?.value;
    const message = value?.messages?.[0];

    if (!message) return;

    const senderPhone = message.from;
    const senderJid = `${senderPhone}@s.whatsapp.net`;

    let text = '';
    let isMedia = false;

    if (message.type === 'text') {
      text = message.text?.body || '';
    } else if (message.type === 'document') {
      isMedia = true;
      text = message.document?.caption || '';
    } else if (message.type === 'image') {
      isMedia = true;
      text = message.image?.caption || '';
    } else if (message.type === 'interactive') {
      const interactive = message.interactive;
      if (interactive.type === 'button_reply') {
        text = interactive.button_reply?.title || '';
      } else if (interactive.type === 'list_reply') {
        text = interactive.list_reply?.title || '';
      }
    } else if (message.type === 'button') {
      text = message.button?.text || '';
    }

    const incoming: IncomingMessage = {
      senderJid,
      text,
      isMedia,
      rawMessage: message,
      rawMessageContent: message[message.type],
    };

    console.log(`[CloudProvider] Received message from ${senderPhone}: "${text}"`);
    await this.onMessageCallback(incoming);
  }
}

