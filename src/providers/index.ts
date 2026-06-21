import type { IWhatsAppProvider, IncomingMessage, ConnectionStatus, MessageHandler, DownloadedMedia } from './types';
import { CloudProvider } from './cloud.provider';

export class MetaProvider implements IWhatsAppProvider {
  private activeProvider: CloudProvider;
  private onMessageCallback: MessageHandler | null = null;

  constructor() {
    this.activeProvider = new CloudProvider();
  }

  /**
   * Initialize the Meta Cloud provider.
   */
  async initialize(onMessage: MessageHandler): Promise<void> {
    this.onMessageCallback = onMessage;
    console.log(`[MetaProvider] Initializing official Meta Cloud API provider`);
    
    try {
      await this.activeProvider.initialize(this.onMessageCallback);
    } catch (e: any) {
      console.error(`[MetaProvider] Error during active provider initialization:`, e.message);
    }
  }

  getProviderName(): 'cloud' {
    return 'cloud';
  }

  /**
   * Switching is no longer supported since Baileys is removed.
   */
  async switchProvider(newName: 'baileys' | 'cloud'): Promise<void> {
    if (newName === 'baileys') {
      throw new Error('[MetaProvider] Baileys (Web Scan) is no longer available on this system.');
    }
  }

  // ── Delegated IWhatsAppProvider methods ───────────────────────────────────────

  async sendText(to: string, text: string): Promise<void> {
    await this.activeProvider.sendText(to, text);
  }

  async sendDocument(to: string, documentUrl: string, fileName: string, caption?: string): Promise<void> {
    await this.activeProvider.sendDocument(to, documentUrl, fileName, caption);
  }

  async sendButtons(to: string, text: string, buttons: { id: string; title: string }[]): Promise<void> {
    await this.activeProvider.sendButtons(to, text, buttons);
  }


  async downloadMedia(rawMessage: unknown, rawMessageContent: unknown): Promise<DownloadedMedia | null> {
    return await this.activeProvider.downloadMedia(rawMessage, rawMessageContent);
  }

  getStatus(): ConnectionStatus {
    return this.activeProvider.getStatus();
  }

  async logout(): Promise<void> {
    await this.activeProvider.logout();
  }

  /**
   * Forwards incoming webhook payloads from Express to the active provider
   */
  async handleWebhook(body: any): Promise<void> {
    await this.activeProvider.handleWebhook(body);
  }
}

/** Singleton provider instance — use this everywhere in the app */
export const messageService = new MetaProvider();

// Re-export types for convenience
export type { IWhatsAppProvider, IncomingMessage, ConnectionStatus, MessageHandler, DownloadedMedia } from './types';
