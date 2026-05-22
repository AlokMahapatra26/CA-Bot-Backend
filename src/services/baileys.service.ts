import makeWASocket, { useMultiFileAuthState, DisconnectReason, WASocket } from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import pino from 'pino';
import QRCode from 'qrcode';
import fs from 'fs';
import path from 'path';

export let sock: WASocket | null = null;

// Shared state readable by API routes
export let botStatus: 'disconnected' | 'connecting' | 'connected' = 'disconnected';
export let latestQR: string | null = null; // base64 PNG data URL
export let botNumber: string | null = null;

let onMessageHandler: ((sock: WASocket, msg: any) => Promise<void>) | null = null;

export const connectToWhatsApp = async (onMessage: (sock: WASocket, msg: any) => Promise<void>) => {
  onMessageHandler = onMessage;
  botStatus = 'connecting';
  latestQR = null;

  const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');

  sock = makeWASocket({
    auth: state,
    printQRInTerminal: false,
    logger: pino({ level: 'silent' }) as any,
  });

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      // Convert raw QR string to a base64 PNG for the frontend
      try {
        latestQR = await QRCode.toDataURL(qr, { width: 256, margin: 2 });
      } catch (e) {
        console.error('Failed to generate QR PNG:', e);
      }
      botStatus = 'connecting';
    }

    if (connection === 'close') {
      const shouldReconnect = (lastDisconnect?.error as Boom)?.output?.statusCode !== DisconnectReason.loggedOut;
      console.log('Connection closed:', lastDisconnect?.error?.message, '| Reconnecting:', shouldReconnect);
      sock = null;
      latestQR = null;
      botNumber = null;

      if (shouldReconnect) {
        botStatus = 'connecting';
        connectToWhatsApp(onMessageHandler!);
      } else {
        botStatus = 'disconnected';
        console.log('Logged out. Delete "auth_info_baileys" folder and restart to re-scan.');
      }
    } else if (connection === 'open') {
      console.log('WhatsApp connection opened successfully!');
      latestQR = null;
      botStatus = 'connected';
      botNumber = sock?.user?.id ? sock.user.id.split(':')[0].split('@')[0] : null;
    }
  });

  sock.ev.on('messages.upsert', async (m) => {
    try {
      const msg = m.messages[0];
      if (!msg.message || msg.key.fromMe) return;
      await onMessageHandler!(sock!, msg);
    } catch (error) {
      console.error('Error handling message:', error);
    }
  });

  sock.ev.on('creds.update', saveCreds);
};

export const logoutWhatsApp = async () => {
  if (sock) {
    try {
      await sock.logout();
    } catch (_) {}
    sock = null;
  }
  // Remove saved auth so next connect shows a fresh QR
  const authDir = path.resolve('auth_info_baileys');
  if (fs.existsSync(authDir)) {
    fs.rmSync(authDir, { recursive: true, force: true });
  }
  botStatus = 'disconnected';
  latestQR = null;
  botNumber = null;
};
