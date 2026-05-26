import * as fs from 'fs/promises';
import * as path from 'path';
import { supabase } from './supabase.service';
import { messageService } from '../providers';

interface ReminderSettings {
  enabled: boolean;
  intervalHours: number;
  lastRun: string | null;
  isTesting?: boolean;
}

class ReminderService {
  private settingsFilePath = path.join(__dirname, '../config/reminder-settings.json');
  private settings: ReminderSettings = { enabled: false, intervalHours: 24, lastRun: null, isTesting: false };
  private timerId: NodeJS.Timeout | null = null;

  async initialize() {
    try {
      const data = await fs.readFile(this.settingsFilePath, 'utf8');
      this.settings = JSON.parse(data);
      console.log('Reminder settings loaded successfully:', this.settings);
      
      if (this.settings.enabled) {
        this.startScheduler();
      }
    } catch (error) {
      console.warn('Could not read reminder settings, creating default file:', error);
      await this.saveSettings();
    }
  }

  getSettings() {
    return {
      ...this.settings,
      nextRun: this.calculateNextRun()
    };
  }

  private calculateNextRun(): string | null {
    if (!this.settings.enabled) return null;
    const last = this.settings.lastRun ? new Date(this.settings.lastRun) : new Date();
    const multiplier = this.settings.isTesting ? 1000 : 60 * 60 * 1000;
    const next = new Date(last.getTime() + this.settings.intervalHours * multiplier);
    return next.toISOString();
  }

  async toggle(enabled: boolean, intervalHours: number, isTesting?: boolean) {
    this.settings.enabled = enabled;
    this.settings.intervalHours = intervalHours;
    this.settings.isTesting = !!isTesting;
    await this.saveSettings();

    this.stopScheduler();
    if (enabled) {
      this.startScheduler();
    }
    console.log(`Reminder scheduler toggled: enabled=${enabled}, interval=${intervalHours}${isTesting ? 's' : 'h'} (Testing Mode: ${!!isTesting})`);
    return this.getSettings();
  }

  private startScheduler() {
    this.stopScheduler();
    const msInterval = this.settings.isTesting
      ? this.settings.intervalHours * 1000
      : this.settings.intervalHours * 60 * 60 * 1000;
    
    // Set up standard recurring check
    this.timerId = setInterval(async () => {
      console.log(`Reminder scheduler: executing periodic document checks (Testing Mode: ${!!this.settings.isTesting})...`);
      await this.triggerReminders();
    }, msInterval);

    console.log(`Started background reminder scheduler. Checked every ${this.settings.intervalHours} ${this.settings.isTesting ? 'seconds' : 'hours'}.`);
  }

  private stopScheduler() {
    if (this.timerId) {
      clearInterval(this.timerId);
      this.timerId = null;
    }
  }

  private async saveSettings() {
    try {
      await fs.writeFile(this.settingsFilePath, JSON.stringify(this.settings, null, 2), 'utf8');
    } catch (error) {
      console.error('Failed to save reminder settings file:', error);
    }
  }

  /**
   * Dry Run: Scans filings and returns which clients are awaiting what documents.
   * Perfect for showing a list inside the settings dashboard!
   */
  async dryRun() {
    if (!supabase) {
      return [];
    }

    try {
      const { data: filings, error } = await supabase
        .from('itr_filings')
        .select(`
          id,
          status,
          fy_year,
          clients (
            id,
            full_name,
            whatsapp_jid,
            phone_number
          )
        `)
        .in('status', [
          'AWAITING_FORM16',
          'AWAITING_BANK_STATEMENT',
          'AWAITING_CAPITAL_GAINS',
          'AWAITING_PROPERTY_DOCS',
          'AWAITING_OTHER_DOCS'
        ]);

      if (error) {
        throw error;
      }

      return (filings || []).map((f: any) => {
        const client = f.clients;
        return {
          filingId: f.id,
          clientId: client?.id || '',
          clientName: client?.full_name || 'Client',
          jid: client?.whatsapp_jid || (client?.phone_number ? `${client.phone_number}@s.whatsapp.net` : ''),
          pendingDoc: this.mapStatusToLabel(f.status),
          status: f.status
        };
      }).filter(c => c.jid);
    } catch (error) {
      console.error('Failed to execute reminder dry-run:', error);
      return [];
    }
  }

  /**
   * Instantly trigger WhatsApp document reminders
   */
  async triggerReminders() {
    const clientsToRemind = await this.dryRun();
    if (clientsToRemind.length === 0) {
      this.settings.lastRun = new Date().toISOString();
      await this.saveSettings();
      return { success: true, count: 0, failed: 0 };
    }

    const { connected } = messageService.getStatus();
    if (!connected) {
      throw new Error('WhatsApp connection is not active');
    }

    let successCount = 0;
    let failCount = 0;

    for (const c of clientsToRemind) {
      const message = this.buildReminderMessage(c.clientName, c.pendingDoc);
      try {
        await messageService.sendText(c.jid, message);
        successCount++;
        console.log(`Document reminder successfully sent to ${c.clientName} (${c.jid})`);
      } catch (err) {
        console.error(`Failed to send document reminder to ${c.jid}:`, err);
        failCount++;
      }
    }

    this.settings.lastRun = new Date().toISOString();
    await this.saveSettings();

    console.log(`Reminder run completed: dispatched ${successCount} successfully, failed for ${failCount}`);
    return { success: true, count: successCount, failed: failCount };
  }

  private mapStatusToLabel(status: string): string {
    switch (status) {
      case 'AWAITING_FORM16':
        return 'Form-16 (PDF)';
      case 'AWAITING_BANK_STATEMENT':
        return 'Bank Statement (PDF)';
      case 'AWAITING_CAPITAL_GAINS':
        return 'Capital Gains Statement';
      case 'AWAITING_PROPERTY_DOCS':
        return 'Property Transaction Deeds';
      case 'AWAITING_OTHER_DOCS':
        return 'Other Supportive Documents';
      default:
        return 'Pending ITR Documents';
    }
  }

  private buildReminderMessage(name: string, docLabel: string): string {
    return (
      `🔔 *Pending Document Reminder* 🔔\n\n` +
      `Dear *${name}*,\n\n` +
      `This is a friendly reminder from your CA Specialist at *DAV Labs*.\n\n` +
      `We are currently awaiting your *${docLabel}* to proceed with your Income Tax Return (ITR) filing.\n\n` +
      `👉 Please upload/send a clear photo or PDF of your *${docLabel}* directly here on WhatsApp.\n\n` +
      `💡 _You can type *back* at any step if you need to adjust previous entries._\n\n` +
      `Thank you! 🙏`
    );
  }
}

export const reminderService = new ReminderService();
