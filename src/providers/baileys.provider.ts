/**
 * ─────────────────────────────────────────────────────────────────
 * BaileysProvider — WhatsApp connection via @whiskeysockets/baileys
 * ─────────────────────────────────────────────────────────────────
 *
 * This is the ACTIVE provider. It wraps all Baileys-specific logic
 * behind the generic IWhatsAppProvider interface so that the rest
 * of the application never imports from @whiskeysockets/baileys.
 *
 * If you are migrating to Cloud API, you do NOT need to touch this
 * file — just implement CloudProvider and flip the env var.
 */

import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  WASocket,
  downloadMediaMessage,
  WAMessage,
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import pino from 'pino';
import QRCode from 'qrcode';
import fs from 'fs';
import path from 'path';

import type {
  IWhatsAppProvider,
  ConnectionStatus,
  MessageHandler,
  IncomingMessage,
  DownloadedMedia,
} from './types';

export class BaileysProvider implements IWhatsAppProvider {
  private sock: WASocket | null = null;
  private botStatus: 'disconnected' | 'connecting' | 'connected' = 'disconnected';
  private latestQR: string | null = null;
  private botNumber: string | null = null;
  private onMessageHandler: MessageHandler | null = null;

  // ── Initialize ───────────────────────────────────────────────────

  async initialize(onMessage: MessageHandler): Promise<void> {
    this.onMessageHandler = onMessage;
    await this.connect();
  }

  private async connect(): Promise<void> {
    this.botStatus = 'connecting';
    this.latestQR = null;

    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');

    this.sock = makeWASocket({
      auth: state,
      printQRInTerminal: false,
      logger: pino({ level: 'silent' }) as any,
    });

    this.sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        try {
          this.latestQR = await QRCode.toDataURL(qr, { width: 256, margin: 2 });
        } catch (e) {
          console.error('Failed to generate QR PNG:', e);
        }
        this.botStatus = 'connecting';
      }

      if (connection === 'close') {
        const shouldReconnect =
          (lastDisconnect?.error as Boom)?.output?.statusCode !== DisconnectReason.loggedOut;
        console.log(
          'Connection closed:',
          lastDisconnect?.error?.message,
          '| Reconnecting:',
          shouldReconnect
        );
        this.sock = null;
        this.latestQR = null;
        this.botNumber = null;

        if (shouldReconnect) {
          this.botStatus = 'connecting';
          this.connect();
        } else {
          this.botStatus = 'disconnected';
          console.log('Logged out. Delete "auth_info_baileys" folder and restart to re-scan.');
        }
      } else if (connection === 'open') {
        console.log('WhatsApp connection opened successfully!');
        this.latestQR = null;
        this.botStatus = 'connected';
        this.botNumber = this.sock?.user?.id
          ? this.sock.user.id.split(':')[0].split('@')[0]
          : null;
      }
    });

    this.sock.ev.on('messages.upsert', async (m) => {
      try {
        const msg = m.messages[0];
        if (!msg.message || msg.key.fromMe) return;

        const senderJid = msg.key.remoteJid;
        if (!senderJid) return;

        // Build the provider-agnostic IncomingMessage
        const messageContent = msg.message;
        let text = '';

        if (messageContent.conversation) {
          text = messageContent.conversation.trim();
        } else if (messageContent.extendedTextMessage?.text) {
          text = messageContent.extendedTextMessage.text.trim();
        } else if (messageContent.imageMessage?.caption) {
          text = messageContent.imageMessage.caption.trim();
        } else if (messageContent.documentMessage?.caption) {
          text = messageContent.documentMessage.caption.trim();
        }

        const isMedia = !!(messageContent.imageMessage || messageContent.documentMessage);

        const incomingMessage: IncomingMessage = {
          senderJid,
          text,
          isMedia,
          rawMessage: msg,
          rawMessageContent: messageContent,
        };

        await this.onMessageHandler!(incomingMessage);
      } catch (error) {
        console.error('Error handling message:', error);
      }
    });

    this.sock.ev.on('creds.update', saveCreds);
  }

  // ── Send Text ────────────────────────────────────────────────────

  async sendText(to: string, text: string): Promise<void> {
    if (!this.sock) {
      throw new Error('WhatsApp socket connection is not active');
    }
    await this.sock.sendMessage(to, { text });
  }

  // ── Send Document ────────────────────────────────────────────────

  async sendDocument(
    to: string,
    documentUrl: string,
    fileName: string,
    caption?: string
  ): Promise<void> {
    if (!this.sock) {
      throw new Error('WhatsApp socket connection is not active');
    }
    await this.sock.sendMessage(to, {
      document: { url: documentUrl },
      mimetype: 'application/pdf',
      fileName,
      caption: caption || undefined,
    });
  }

  // ── Download Media ───────────────────────────────────────────────

  async downloadMedia(
    rawMessage: unknown,
    rawMessageContent: unknown
  ): Promise<DownloadedMedia | null> {
    if (!this.sock) return null;

    try {
      const msg = rawMessage as WAMessage;
      const messageContent = rawMessageContent as any;

      const buffer = await downloadMediaMessage(msg, 'buffer', {}, {
        logger: console as any,
        reuploadRequest: this.sock.updateMediaMessage,
      });

      if (!buffer) return null;

      let mimetype = '';
      let extension = '';

      if (messageContent.imageMessage) {
        mimetype = messageContent.imageMessage.mimetype || 'image/jpeg';
        // Normalize iPhone HEIC/HEIF to a known extension
        const imgExt = mimetype.split('/')[1] || 'jpg';
        extension = (imgExt === 'heif' || imgExt === 'heic') ? 'heic' : imgExt;
      } else if (messageContent.documentMessage) {
        mimetype = messageContent.documentMessage.mimetype || 'application/pdf';
        extension = messageContent.documentMessage.fileName?.split('.').pop() || 'pdf';
      }

      return { buffer: buffer as Buffer, mimetype, extension };
    } catch (error) {
      console.error('Error downloading media:', error);
      return null;
    }
  }

  // ── Get Status ───────────────────────────────────────────────────

  getStatus(): ConnectionStatus {
    return {
      status: this.botStatus,
      qr: this.latestQR,
      connected: this.botStatus === 'connected',
      botNumber: this.botNumber,
    };
  }

  // ── Logout ───────────────────────────────────────────────────────

  async logout(): Promise<void> {
    if (this.sock) {
      try {
        await this.sock.logout();
      } catch (_) {}
      this.sock = null;
    }
    // Remove saved auth so next connect shows a fresh QR
    const authDir = path.resolve('auth_info_baileys');
    if (fs.existsSync(authDir)) {
      fs.rmSync(authDir, { recursive: true, force: true });
    }
    this.botStatus = 'disconnected';
    this.latestQR = null;
    this.botNumber = null;
  }
}
