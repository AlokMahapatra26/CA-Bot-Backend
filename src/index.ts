import express from 'express';
import { config } from './config/env';
import { messageService } from './providers';
import { handleIncomingMessage } from './controllers/whatsapp.controller';

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

app.listen(config.PORT, async () => {
  console.log(`Server is running on port ${config.PORT}`);
  await messageService.initialize(handleIncomingMessage);
});
