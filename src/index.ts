import express from 'express';
import { config } from './config/env';
import { messageService } from './providers';
import { handleIncomingMessage } from './controllers/whatsapp.controller';
import { supabase } from './services/supabase.service';
import { reminderService } from './services/reminder.service';

const app = express();
app.use(express.json());

// CORS — allow Next.js frontend (3000/3001) to call us
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && (origin.startsWith('http://localhost') || origin.startsWith('http://127.0.0.1'))) {
    res.header('Access-Control-Allow-Origin', origin);
  } else {
    res.header('Access-Control-Allow-Origin', 'http://localhost:3000');
  }
  res.header('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// ── Health check ──────────────────────────────────────────────────────────────
app.get('/', (req, res) => {
  res.send('WhatsApp Bot Server is running.');
});

// ── Bot Status (QR + connection state) ───────────────────────────────────────
app.get('/api/bot/status', (req, res) => {
  const status = messageService.getStatus();
  res.json(status);
});

// ── Logout / Disconnect bot ───────────────────────────────────────────────────
app.post('/api/bot/logout', async (req, res) => {
  try {
    await messageService.logout();
    res.json({ success: true, message: 'Bot disconnected and session cleared.' });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ── Send message (called by Next.js server actions) ───────────────────────────
app.post('/api/send-message', async (req, res) => {
  const { jid, text, documentUrl, fileName } = req.body;

  if (!jid || (!text && !documentUrl)) {
    return res.status(400).json({ error: 'Missing jid, text or documentUrl parameter' });
  }

  const { connected } = messageService.getStatus();
  if (!connected) {
    return res.status(503).json({ error: 'WhatsApp connection is not active' });
  }

  try {
    if (documentUrl) {
      await messageService.sendDocument(jid, documentUrl, fileName || 'ITRV_Acknowledgement.pdf', text || undefined);
      console.log(`Sent document notification to ${jid} with URL: ${documentUrl}`);
    } else {
      await messageService.sendText(jid, text);
      console.log(`Sent manual text notification to ${jid}`);
    }
    return res.json({ success: true });
  } catch (error: any) {
    console.error('Failed to send manual message:', error);
    return res.status(500).json({ error: error.message || 'Internal Server Error' });
  }
});

// ── Broadcast message to all registered or specific clients ───────────────────
app.post('/api/broadcast-message', async (req, res) => {
  const { text, jids } = req.body;

  if (!text) {
    return res.status(400).json({ error: 'Missing text parameter' });
  }

  const { connected } = messageService.getStatus();
  if (!connected) {
    return res.status(503).json({ error: 'WhatsApp connection is not active' });
  }

  if (!supabase) {
    return res.status(503).json({ error: 'Database service is not active' });
  }

  try {
    let targetClients: { whatsapp_jid: string | null }[] = [];

    if (jids && Array.isArray(jids)) {
      targetClients = jids.map((jid: string) => ({ whatsapp_jid: jid }));
    } else {
      // 1. Fetch all clients who have a WhatsApp JID
      const { data, error } = await supabase
        .from('clients')
        .select('whatsapp_jid')
        .not('whatsapp_jid', 'is', null);

      if (error) {
        throw error;
      }
      targetClients = data || [];
    }

    if (!targetClients || targetClients.length === 0) {
      return res.json({ success: true, count: 0, message: 'No clients to broadcast' });
    }

    // 2. Loop through clients and send message
    let successCount = 0;
    let failCount = 0;

    for (const client of targetClients) {
      if (client.whatsapp_jid) {
        try {
          await messageService.sendText(client.whatsapp_jid, text);
          successCount++;
        } catch (err) {
          console.error(`Failed to send broadcast to ${client.whatsapp_jid}:`, err);
          failCount++;
        }
      }
    }

    console.log(`Broadcast completed: sent to ${successCount} successfully, failed for ${failCount}`);
    return res.json({ success: true, count: successCount, failed: failCount });
  } catch (error: any) {
    console.error('Failed to broadcast message:', error);
    return res.status(500).json({ error: error.message || 'Internal Server Error' });
  }
});

// ── Document Reminder System routes ──────────────────────────────────────────
app.get('/api/reminders/status', async (req, res) => {
  try {
    const status = reminderService.getSettings();
    const activeClients = await reminderService.dryRun();
    return res.json({ success: true, ...status, activeClients });
  } catch (error: any) {
    console.error('Failed to fetch reminder status:', error);
    return res.status(500).json({ error: error.message || 'Internal Server Error' });
  }
});

app.post('/api/reminders/toggle', async (req, res) => {
  const { enabled, intervalHours, isTesting } = req.body;

  if (typeof enabled !== 'boolean' || typeof intervalHours !== 'number') {
    return res.status(400).json({ error: 'Missing enabled (boolean) or intervalHours (number) parameters' });
  }

  try {
    const status = await reminderService.toggle(enabled, intervalHours, isTesting);
    const activeClients = await reminderService.dryRun();
    return res.json({ success: true, ...status, activeClients });
  } catch (error: any) {
    console.error('Failed to toggle reminder scheduler:', error);
    return res.status(500).json({ error: error.message || 'Internal Server Error' });
  }
});

app.post('/api/reminders/trigger', async (req, res) => {
  try {
    const result = await reminderService.triggerReminders();
    const status = reminderService.getSettings();
    return res.json({ ...result, ...status });
  } catch (error: any) {
    console.error('Failed to manually trigger reminders:', error);
    return res.status(500).json({ error: error.message || 'Internal Server Error' });
  }
});

app.listen(config.PORT, async () => {
  console.log(`Server is running on port ${config.PORT}`);
  await messageService.initialize(handleIncomingMessage);
  await reminderService.initialize();
});
