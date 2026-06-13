import * as fs from 'fs/promises';
import * as path from 'path';
import { supabase } from './supabase.service';
import { messageService } from '../providers';
import cron, { ScheduledTask } from 'node-cron';

interface ReminderSettings {
  enabled: boolean;
  intervalHours: number;
  lastRun: string | null;
  isTesting?: boolean;
}

class DscReminderService {
  private settingsFilePath = path.join(__dirname, '../config/dsc-reminder-settings.json');
  private settings: ReminderSettings = { enabled: false, intervalHours: 24, lastRun: null, isTesting: false };
  private cronTask: ScheduledTask | null = null;

  async initialize() {
    try {
      const data = await fs.readFile(this.settingsFilePath, 'utf8');
      this.settings = JSON.parse(data);
      console.log('DSC Reminder settings loaded successfully:', this.settings);
      
      if (this.settings.enabled) {
        await this.startScheduler();
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
    if (this.settings.isTesting) {
      const seconds = this.settings.intervalHours || 30;
      return new Date(last.getTime() + seconds * 1000).toISOString();
    }
    const hours = this.settings.intervalHours || 24;
    if (hours >= 24) {
      const now = new Date();
      const next = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 10, 0, 0, 0);
      if (next.getTime() <= now.getTime()) {
        next.setDate(next.getDate() + 1);
      }
      return next.toISOString();
    }
    return new Date(last.getTime() + hours * 60 * 60 * 1000).toISOString();
  }

  async toggle(enabled: boolean, intervalHours: number, isTesting?: boolean) {
    this.settings.enabled = enabled;
    this.settings.intervalHours = intervalHours;
    this.settings.isTesting = !!isTesting;
    await this.saveSettings();

    this.stopScheduler();
    if (enabled) {
      await this.startScheduler();
    }
    console.log(`DSC Reminder scheduler toggled: enabled=${enabled}, interval=${intervalHours}${isTesting ? 's' : 'h'} (Testing Mode: ${!!isTesting})`);
    return this.getSettings();
  }

  private async startScheduler() {
    this.stopScheduler();

    // 1. Startup check: run immediately if we missed our threshold
    if (!this.settings.isTesting) {
      const now = new Date();
      const last = this.settings.lastRun ? new Date(this.settings.lastRun) : null;
      const msPassed = last ? now.getTime() - last.getTime() : Infinity;
      const msThreshold = this.settings.intervalHours * 60 * 60 * 1000;
      
      if (msPassed >= msThreshold) {
        console.log('DSC Reminder scheduler: running startup check...');
        try {
          await this.triggerReminders();
        } catch (e) {
          console.error('Error running DSC Reminder startup check:', e);
        }
      }
    }

    // 2. Schedule the Cron Job dynamically based on intervalHours
    const expression = this.getCronExpression();
    
    this.cronTask = cron.schedule(expression, async () => {
      console.log(`DSC Reminder cron execution triggered (Testing Mode: ${!!this.settings.isTesting})...`);
      try {
        await this.triggerReminders();
      } catch (e) {
        console.error('Error executing DSC Reminder cron task:', e);
      }
    });

    console.log(`Started background DSC reminder scheduler with cron pattern: ${expression}`);
  }

  private getCronExpression(): string {
    if (this.settings.isTesting) {
      const seconds = this.settings.intervalHours || 30;
      return `*/${seconds} * * * * *`;
    }
    const hours = this.settings.intervalHours || 24;
    if (hours >= 24) {
      return '0 10 * * *'; // Run daily at 10:00 AM
    }
    return `0 */${hours} * * *`; // Run every X hours
  }

  private stopScheduler() {
    if (this.cronTask) {
      this.cronTask.stop();
      this.cronTask = null;
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
