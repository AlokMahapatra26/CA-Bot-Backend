import * as fs from 'fs/promises';
import * as path from 'path';
import { supabase } from './supabase.service';
import { messageService } from '../providers';
import cron, { ScheduledTask } from 'node-cron';

interface ExpirySettings {
  enabled: boolean;
  remindDays: number[];
  lastRun: string | null;
  isTesting?: boolean;
}

class DscExpiryReminderService {
  private settingsFilePath = path.join(__dirname, '../config/dsc-expiry-settings.json');
  private settings: ExpirySettings = { enabled: false, remindDays: [7, 3, 1], lastRun: null, isTesting: false };
  private cronTask: ScheduledTask | null = null;

  async initialize() {
    try {
      const data = await fs.readFile(this.settingsFilePath, 'utf8');
      this.settings = JSON.parse(data);
      console.log('DSC Expiry Reminder settings loaded successfully:', this.settings);
      
      if (this.settings.enabled) {
        await this.startScheduler();
      }
    } catch (error) {
      console.warn('Could not read DSC expiry reminder settings, creating default file:', error);
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
      return new Date(last.getTime() + 30 * 1000).toISOString();
    }
    const now = new Date();
    const next = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 10, 0, 0, 0);
    if (next.getTime() <= now.getTime()) {
      next.setDate(next.getDate() + 1);
    }
    return next.toISOString();
  }

  async toggle(enabled: boolean, remindDays: number[], isTesting?: boolean) {
    this.settings.enabled = enabled;
    this.settings.remindDays = remindDays;
    this.settings.isTesting = !!isTesting;
    await this.saveSettings();

    this.stopScheduler();
    if (enabled) {
      await this.startScheduler();
    }
    console.log(`DSC Expiry Reminder scheduler toggled: enabled=${enabled}, remindDays=[${remindDays.join(',')}], testing=${!!isTesting}`);
    return this.getSettings();
  }

  private async startScheduler() {
    this.stopScheduler();

    // 1. Startup check: run immediately if we haven't run today yet (and testing mode is off)
    if (!this.settings.isTesting) {
      const now = new Date();
      const todayStr = now.toISOString().split('T')[0];
      const lastRunStr = this.settings.lastRun ? this.settings.lastRun.split('T')[0] : '';
      
      if (todayStr !== lastRunStr) {
        console.log('DSC Expiry Reminder scheduler: running startup check...');
        try {
          await this.triggerReminders();
        } catch (e) {
          console.error('Error running DSC Expiry Reminder startup check:', e);
        }
      }
    }

    // 2. Schedule the Cron Job
    // Normal mode: every day at 10:00 AM ('0 10 * * *')
    // Testing mode: every 30 seconds ('*/30 * * * * *')
    const expression = this.settings.isTesting ? '*/30 * * * * *' : '0 10 * * *';
    
    this.cronTask = cron.schedule(expression, async () => {
      console.log(`DSC Expiry Reminder cron execution triggered (Testing Mode: ${!!this.settings.isTesting})...`);
      try {
        await this.triggerReminders();
      } catch (e) {
        console.error('Error executing DSC Expiry Reminder cron task:', e);
      }
    });

    console.log(`Started background DSC expiry reminder scheduler with cron pattern: ${expression}`);
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
      console.error('Failed to save DSC expiry reminder settings file:', error);
    }
  }

  /**
   * Dry Run: Scans DSC applications and returns which clients match the expiry days criteria.
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
        .not('expiry_date', 'is', null);

      if (error) {
        throw error;
      }

      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);

      return (dscApps || []).map((d: any) => {
        const client = d.clients;
        if (!client) return null;

        const expDate = new Date(d.expiry_date);
        expDate.setHours(0, 0, 0, 0);
        
        let diffDays = Math.ceil((expDate.getTime() - todayStart.getTime()) / (1000 * 60 * 60 * 24));

        // For testing mode: let all clients expiring within max of remindDays (e.g. 7 days) show up so they can be tested
        const isMatched = this.settings.isTesting 
          ? (diffDays <= Math.max(...this.settings.remindDays) && diffDays >= 0)
          : this.settings.remindDays.includes(diffDays);

        if (isMatched) {
          return {
            dscId: d.id,
            clientId: client.id,
            clientName: client.full_name || 'Client',
            jid: client.whatsapp_jid || (client.phone_number ? `${client.phone_number}@s.whatsapp.net` : ''),
            daysLeft: diffDays,
            expiryDate: d.expiry_date
          };
        }

        return null;
      }).filter((c: any): c is any => !!c && !!c.jid);
    } catch (error) {
      console.error('Failed to execute DSC expiry reminder dry-run:', error);
      return [];
    }
  }

  /**
   * Instantly trigger WhatsApp DSC expiry reminders
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
      const message = this.buildReminderMessage(c.clientName, c.daysLeft, c.expiryDate);
      try {
        await messageService.sendText(c.jid, message);
        successCount++;
        console.log(`DSC expiry reminder successfully sent to ${c.clientName} (${c.jid})`);
      } catch (err) {
        console.error(`Failed to send DSC expiry reminder to ${c.jid}:`, err);
        failCount++;
      }
    }

    this.settings.lastRun = new Date().toISOString();
    await this.saveSettings();

    console.log(`DSC Expiry Reminder run completed: dispatched ${successCount} successfully, failed for ${failCount}`);
    return { success: true, count: successCount, failed: failCount };
  }

  private buildReminderMessage(name: string, daysLeft: number, expiryDate: string): string {
    const formattedDate = new Date(expiryDate).toLocaleDateString('en-IN');
    
    let daysString = '';
    if (daysLeft === 0) {
      daysString = 'TODAY';
    } else if (daysLeft === 1) {
      daysString = 'tomorrow (in 1 day)';
    } else {
      daysString = `in ${daysLeft} days`;
    }

    return (
      `⚠️ *DSC Renewal Alert* ⚠️\n\n` +
      `Dear *${name}*,\n\n` +
      `This is an important notice from *DAV Labs* regarding your Digital Signature Certificate (DSC).\n\n` +
      `Your DSC is scheduled to expire *${daysString}* on *${formattedDate}*.\n\n` +
      `👉 To avoid any disruption in your document signing or filing services, please get in touch with us immediately to renew your certificate.\n\n` +
      `Thank you! 🙏`
    );
  }
}

export const dscExpiryReminderService = new DscExpiryReminderService();
