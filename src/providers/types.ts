/**
 * ─────────────────────────────────────────────────────────────────
 * WhatsApp Provider Abstraction — Type Definitions
 * ─────────────────────────────────────────────────────────────────
 *
 * This file defines the generic interface that ALL WhatsApp providers
 * (Baileys, Cloud API, etc.) must implement. Business logic should
 * ONLY depend on these types — never on provider-specific packages.
 */

// ── Connection Status ────────────────────────────────────────────

export interface ConnectionStatus {
  /** Current connection state */
  status: 'disconnected' | 'connecting' | 'connected';
  /** Base64 PNG data URL for QR code (only present when status === 'connecting') */
  qr: string | null;
  /** Whether the bot is fully connected and ready to send/receive */
  connected: boolean;
  /** The bot's own phone number (if connected) */
  botNumber: string | null;
}

// ── Incoming Message ─────────────────────────────────────────────

export interface IncomingMessage {
  /** The sender's JID (e.g. "917383149649@s.whatsapp.net" or "200433658294422@lid") */
  senderJid: string;
  /** The extracted text content of the message (may be empty for media-only messages) */
  text: string;
  /** Whether the message contains an image or document attachment */
  isMedia: boolean;
  /**
   * The raw, provider-specific message object.
   * Used internally by the provider's downloadMedia() method.
   * Business logic should NOT inspect this directly.
   */
  rawMessage: unknown;
  /**
   * The raw message content object (provider-specific).
   * Used by the provider to determine media type and mimetype.
   */
  rawMessageContent: unknown;
}

// ── Downloaded Media Result ──────────────────────────────────────

export interface DownloadedMedia {
  /** The raw file buffer */
  buffer: Buffer;
  /** MIME type (e.g. "image/jpeg", "application/pdf") */
  mimetype: string;
  /** File extension (e.g. "jpg", "pdf") */
  extension: string;
}

// ── Message Handler ──────────────────────────────────────────────

/**
 * Callback signature for handling incoming messages.
 * The controller exports a function matching this type.
 */
export type MessageHandler = (message: IncomingMessage) => Promise<void>;

// ── Provider Interface ───────────────────────────────────────────

/**
 * The core abstraction that all WhatsApp providers must implement.
 *
 * To add a new provider:
 * 1. Create a new file in src/providers/ (e.g. twilio.provider.ts)
 * 2. Implement this interface
 * 3. Register it in the factory (src/providers/index.ts)
 * 4. Set WHATSAPP_PROVIDER=twilio in .env
 */
export interface IWhatsAppProvider {
  /**
   * Initialize the provider connection (e.g. connect to WhatsApp,
   * start listening for messages).
   *
   * @param onMessage - Callback invoked for every incoming user message
   */
  initialize(onMessage: MessageHandler): Promise<void>;

  /**
   * Send a plain text message to a WhatsApp recipient.
   *
   * @param to - The recipient's JID
   * @param text - The message body
   */
  sendText(to: string, text: string): Promise<void>;

  /**
   * Send a document (PDF, image, etc.) to a WhatsApp recipient.
   *
   * @param to - The recipient's JID
   * @param documentUrl - Public URL of the document to send
   * @param fileName - The filename shown in the chat (e.g. "ITRV_Acknowledgement.pdf")
   * @param caption - Optional text caption accompanying the document
   */
  sendDocument(to: string, documentUrl: string, fileName: string, caption?: string): Promise<void>;

  /**
   * Send interactive quick reply buttons (up to 3) to a WhatsApp recipient.
   *
   * @param to - The recipient's JID
   * @param text - The message body text
   * @param buttons - Array of button objects containing id and title
   */
  sendButtons(to: string, text: string, buttons: { id: string; title: string }[]): Promise<void>;


  /**
   * Download media (image/document) from an incoming message.
   *
   * @param rawMessage - The raw, provider-specific message object
   * @param rawMessageContent - The raw message content for type detection
   * @returns The downloaded buffer + metadata, or null if download fails
   */
  downloadMedia(rawMessage: unknown, rawMessageContent: unknown): Promise<DownloadedMedia | null>;

  /**
   * Get the current connection status, QR code, and bot number.
   */
  getStatus(): ConnectionStatus;

  /**
   * Disconnect and clear the session (e.g. delete auth tokens).
   */
  logout(): Promise<void>;
}
