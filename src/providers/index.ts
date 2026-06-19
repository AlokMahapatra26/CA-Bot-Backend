/**
 * ─────────────────────────────────────────────────────────────────
 * WhatsApp Provider Factory & Singleton (Dynamic)
 * ─────────────────────────────────────────────────────────────────
 *
 * This module manages the active WhatsApp provider dynamically, allowing
 * administrators to switch between direct WhatsApp connection (Baileys)
 * and the official Meta Cloud API at runtime.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import type { IWhatsAppProvider, IncomingMessage, ConnectionStatus, MessageHandler, DownloadedMedia } from './types';
import { BaileysProvider } from './baileys.provider';
import { CloudProvider } from './cloud.provider';

export class DynamicProvider implements IWhatsAppProvider {
  private activeProvider: IWhatsAppProvider;
  private currentName: 'baileys' | 'cloud' = 'baileys';
  private onMessageCallback: MessageHandler | null = null;
  private settingsFilePath = path.join(__dirname, '../config/provider-settings.json');

  constructor() {
    // Initial default provider (will be updated during initialize)
    this.activeProvider = new BaileysProvider();
  }

  /**
   * Initialize the dynamic provider. Loads the last saved setting
   * and initializes the corresponding active provider.
   */
  async initialize(onMessage: MessageHandler): Promise<void> {
    this.onMessageCallback = onMessage;

    try {
      const data = await fs.readFile(this.settingsFilePath, 'utf8');
      const settings = JSON.parse(data);
      if (settings.provider === 'baileys' || settings.provider === 'cloud') {
        this.currentName = settings.provider;
      }
    } catch {
      // If config doesn't exist, create it with default
      await this.saveSettings();
    }

    this.activeProvider = this.instantiateProvider(this.currentName);
    console.log(`[DynamicProvider] Initializing active provider: ${this.currentName}`);
    
    try {
      await this.activeProvider.initialize(this.onMessageCallback);
    } catch (e: any) {
      console.error(`[DynamicProvider] Error during initial active provider initialization:`, e.message);
    }
  }

  private instantiateProvider(name: 'baileys' | 'cloud'): IWhatsAppProvider {
    if (name === 'cloud') {
      return new CloudProvider();
    }
    return new BaileysProvider();
  }

  private async saveSettings() {
    try {
      await fs.mkdir(path.dirname(this.settingsFilePath), { recursive: true });
      await fs.writeFile(this.settingsFilePath, JSON.stringify({ provider: this.currentName }, null, 2), 'utf8');
    } catch (error) {
      console.error('[DynamicProvider] Failed to save provider settings file:', error);
    }
  }

  getProviderName(): 'baileys' | 'cloud' {
    return this.currentName;
  }

  /**
   * Switches the active provider dynamically at runtime.
   */
  async switchProvider(newName: 'baileys' | 'cloud'): Promise<void> {
    if (this.currentName === newName) return;

    console.log(`[DynamicProvider] Switching provider from ${this.currentName} to ${newName}`);

    // 1. Logout/disconnect the current provider to free resources
    try {
      await this.activeProvider.logout();
    } catch (err: any) {
      console.warn(`[DynamicProvider] Warning during old provider logout:`, err.message);
    }

    // 2. Load and save new settings
    this.currentName = newName;
    await this.saveSettings();
    this.activeProvider = this.instantiateProvider(newName);

    // 3. Initialize the new provider
    if (this.onMessageCallback) {
      console.log(`[DynamicProvider] Initializing new active provider: ${newName}`);
      try {
        await this.activeProvider.initialize(this.onMessageCallback);
      } catch (err: any) {
        console.error(`[DynamicProvider] Error during active provider initialization:`, err.message);
      }
    }
  }

  // ── Delegated IWhatsAppProvider methods ───────────────────────────────────────

  async sendText(to: string, text: string): Promise<void> {
    await this.activeProvider.sendText(to, text);
  }

  async sendDocument(to: string, documentUrl: string, fileName: string, caption?: string): Promise<void> {
    await this.activeProvider.sendDocument(to, documentUrl, fileName, caption);
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
}

/** Singleton provider instance — use this everywhere in the app */
export const messageService: DynamicProvider = new DynamicProvider();

// Re-export types for convenience
export type { IWhatsAppProvider, IncomingMessage, ConnectionStatus, MessageHandler, DownloadedMedia } from './types';
