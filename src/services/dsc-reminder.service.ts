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

class DscReminderService {
  private settingsFilePath = path.join(__dirname, '../config/dsc-reminder-settings.json');
  private settings: ReminderSettings = { enabled: false, intervalHours: 24, lastRun: null, isTesting: false };
  private timerId: NodeJS.Timeout | null = null;

  async initialize() {
    try {
      const data = await fs.readFile(this.settingsFilePath, 'utf8');
      this.settings = JSON.parse(data);
      console.log('DSC Reminder settings loaded successfully:', this.settings);
      
      if (this.settings.enabled) {
        this.startScheduler();
      }
    } catch (error) {
      console.warn('Could not read DSC reminder settings, creating default file:', error);
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
    console.log(`DSC Reminder scheduler toggled: enabled=${enabled}, interval=${intervalHours}${isTesting ? 's' : 'h'} (Testing Mode: ${!!isTesting})`);
    return this.getSettings();
  }

  private startScheduler() {
    this.stopScheduler();
    const msInterval = this.settings.isTesting
      ? this.settings.intervalHours * 1000
      : this.settings.intervalHours * 60 * 60 * 1000;
    
    this.timerId = setInterval(async () => {
      console.log(`DSC Reminder scheduler: executing periodic document checks (Testing Mode: ${!!this.settings.isTesting})...`);
      await this.triggerReminders();
    }, msInterval);

    console.log(`Started background DSC reminder scheduler. Checked every ${this.settings.intervalHours} ${this.settings.isTesting ? 'seconds' : 'hours'}.`);
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
      console.error('Failed to save DSC reminder settings file:', error);
    }
  }

  /**
   * Dry Run: Scans DSC applications and returns which clients are awaiting what steps.
   */
  async dryRun(): Promise<any[]> {
    if (!supabase) {
      return [];
    }

    try {
      const { data: dscApps, error } = await supabase
        .from('dsc_applications')
        .select(`
          id,
          status,
          expiry_date,
          clients (
            id,
            full_name,
            whatsapp_jid,
            phone_number
          )
        `)
        .in('status', [
          'AWAITING_TYPE',
          'AWAITING_VIDEO_VERIFICATION'
        ]);

      if (error) {
        throw error;
      }

      return (dscApps || []).map((d: any) => {
        const client = d.clients;
        return {
          dscId: d.id,
          clientId: client?.id || '',
          clientName: client?.full_name || 'Client',
          jid: client?.whatsapp_jid || (client?.phone_number ? `${client.phone_number}@s.whatsapp.net` : ''),
          pendingDoc: this.mapStatusToLabel(d.status),
          status: d.status,
          expiryDate: d.expiry_date
        };
      }).filter((c: any): c is any => !!c && !!c.jid);
    } catch (error) {
      console.error('Failed to execute DSC reminder dry-run:', error);
      return [];
    }
  }

  /**
   * Instantly trigger WhatsApp DSC reminders
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
      const message = this.buildReminderMessage(c.clientName, c.pendingDoc, c.status);
      try {
        await messageService.sendText(c.jid, message);
        successCount++;
        console.log(`DSC reminder successfully sent to ${c.clientName} (${c.jid})`);
      } catch (err) {
        console.error(`Failed to send DSC reminder to ${c.jid}:`, err);
        failCount++;
      }
    }

    this.settings.lastRun = new Date().toISOString();
    await this.saveSettings();

    console.log(`DSC Reminder run completed: dispatched ${successCount} successfully, failed for ${failCount}`);
    return { success: true, count: successCount, failed: failCount };
  }

  private mapStatusToLabel(status: string): string {
    switch (status) {
      case 'AWAITING_TYPE':
        return 'DSC User Type Selection';
      case 'AWAITING_VIDEO_VERIFICATION':
        return 'Video KYC Verification';
      default:
        return 'Pending DSC Application Steps';
    }
  }

  private buildReminderMessage(name: string, stepLabel: string, status: string): string {
    let detailMessage = '';
    if (status === 'AWAITING_TYPE') {
      detailMessage = `We are currently awaiting your choice of DSC User Type (Individual vs Organization) to proceed.\n\n👉 Please reply to this WhatsApp chat and choose your option from the prompt menu.`;
    } else if (status === 'AWAITING_VIDEO_VERIFICATION') {
      detailMessage = `We are currently awaiting your Video KYC completion to proceed.\n\n👉 Please complete your video KYC verification using the instructions or portal link provided earlier.`;
    } else {
      detailMessage = `We are currently awaiting your completion of the *${stepLabel}* step to proceed.`;
    }

    return (
      `🔔 *DSC Progress Reminder* 🔔\n\n` +
      `Dear *${name}*,\n\n` +
      `This is a friendly reminder from your CA Specialist at *DAV Labs*.\n\n` +
      `${detailMessage}\n\n` +
      `💡 _You can type *back* at any step if you need to adjust previous entries._\n\n` +
      `Thank you! 🙏`
    );
  }
}

export const dscReminderService = new DscReminderService();
