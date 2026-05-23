import { WASocket, proto, downloadMediaMessage, WAMessage } from '@whiskeysockets/baileys';
import {
  getClient,
  createClientRecord,
  updateClient,
  getFiling,
  createFiling,
  updateFiling,
  supabase,
  uploadDocument,
  ClientBotStatus,
  ItrStatus,
} from '../services/supabase.service';
import { getFinancialAndAssessmentYear } from '../utils/date';

// ─────────────────────────────────────────────────────────────────
// COMPANY INFO — Edit to personalise
// ─────────────────────────────────────────────────────────────────
const COMPANY_NAME = 'DAV Labs';
const COMPANY_TAGLINE = 'Your Trusted CA & Tax Partner';
const SUPPORT_PHONE = '+91-XXXXXXXXXX'; // Replace with your actual number

// ─────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────

const isGreeting = (text: string): boolean => {
  const greetings = ['hi', 'hello', 'hey', 'start', 'menu', 'yo', 'hii', 'hiii', 'namaste', 'helo', 'help'];
  return greetings.includes(text.toLowerCase().trim());
};

// ─────────────────────────────────────────────────────────────────
// MAIN HANDLER
// ─────────────────────────────────────────────────────────────────

export const handleBaileysMessage = async (sock: WASocket, msg: proto.IWebMessageInfo) => {
  try {
    if (!msg.key) return;
    const senderJid = msg.key.remoteJid;
    if (!senderJid) return;

    if (
      senderJid === 'status@broadcast' ||
      senderJid.endsWith('@g.us') ||
      senderJid.endsWith('@newsletter') ||
      senderJid.endsWith('@broadcast')
    ) return;

    let incomingMessage = '';
    const messageContent = msg.message;
    if (!messageContent) return;

    if (messageContent.conversation) {
      incomingMessage = messageContent.conversation.trim();
    } else if (messageContent.extendedTextMessage?.text) {
      incomingMessage = messageContent.extendedTextMessage.text.trim();
    } else if (messageContent.imageMessage?.caption) {
      incomingMessage = messageContent.imageMessage.caption.trim();
    } else if (messageContent.documentMessage?.caption) {
      incomingMessage = messageContent.documentMessage.caption.trim();
    }

    const isMedia = !!(messageContent.imageMessage || messageContent.documentMessage);
    let mediaUrl: string | null = null;

    console.log(`Received message from ${senderJid}: text="${incomingMessage}", isMedia=${isMedia}`);

    const sendMessage = async (text: string) => {
      await sock.sendMessage(senderJid, { text });
    };

    if (!supabase) {
      await sendMessage('⚠️ The bot is currently undergoing maintenance. Please try again later.');
      return;
    }

    // Upload media if present
    if (isMedia) {
      const buffer = await downloadMediaMessage(msg as WAMessage, 'buffer', {}, {
        logger: console as any,
        reuploadRequest: sock.updateMediaMessage,
      });
      if (buffer) {
        let mimetype = '';
        let extension = '';
        if (messageContent.imageMessage) {
          mimetype = messageContent.imageMessage.mimetype || 'image/jpeg';
          extension = mimetype.split('/')[1] || 'jpg';
        } else if (messageContent.documentMessage) {
          mimetype = messageContent.documentMessage.mimetype || 'application/pdf';
          extension = messageContent.documentMessage.fileName?.split('.').pop() || 'pdf';
        }
        mediaUrl = await uploadDocument(senderJid, buffer as Buffer, mimetype, extension);
        if (!mediaUrl) {
          await sendMessage('⚠️ Failed to upload your document. Please try again.');
          return;
        }
      }
    }

    // ── Fetch or create client ────────────────────────────────────
    let client = await getClient(senderJid);
    const isNewClient = !client;
    if (!client) {
      client = await createClientRecord(senderJid);
    }
    if (!client) {
      await sendMessage('⚠️ Failed to initialize your account. Please try again.');
      return;
    }

    // ── ROUTE 1: Registration Phase ───────────────────────────────
    const botStatus = client.bot_status || 'REGISTERING_NAME';
    const isRegistering = botStatus !== 'PENDING_APPROVAL' && botStatus !== 'REGISTERED';

    if (isRegistering) {
      await handleRegistration(client, isNewClient, incomingMessage, isMedia, mediaUrl, sendMessage);
      return;
    }

    // ── ROUTE 2: Pending Approval — waiting for CA team ───────────
    if (botStatus === 'PENDING_APPROVAL' || client.account_status === 'PENDING') {
      if (client.account_status === 'REJECTED') {
        await sendMessage(
          `❌ Dear ${client.full_name || 'User'},\n\n` +
          `Unfortunately, your account registration has been *rejected* by our team.\n\n` +
          `Please contact us at ${SUPPORT_PHONE} for more information.`
        );
        return;
      }
      await sendMessage(
        `⏳ *Account Under Review*\n\n` +
        `Hi *${client.full_name || 'there'}*! Your registration documents have been submitted successfully.\n\n` +
        `Our team is currently reviewing your PAN and Aadhaar documents. You will be able to use our services once your account is approved.\n\n` +
        `_This usually takes 1–2 business days. For urgent queries, contact us at ${SUPPORT_PHONE}._`
      );
      return;
    }

    // ── ROUTE 3: Approved — Service Selection & Flow ──────────────────
    if (client.account_status !== 'APPROVED') {
      await sendMessage(
        `⏳ Your account is still *under review*. Please wait for our team to approve your profile before using our services.`
      );
      return;
    }

    const { fy, ay } = getFinancialAndAssessmentYear();
    let filing = await getFiling(client.id, fy);

    // If they do not have a filing record yet, it means they have NOT opted for ITR yet!
    if (!filing) {
      const choice = incomingMessage.trim();
      if (choice === '1' || choice.toLowerCase().includes('itr')) {
        // Now they opted for ITR filing! Create the record.
        filing = await createFiling(client.id, fy);
        if (!filing) {
          await sendMessage('⚠️ Failed to initialize your ITR filing. Please try again.');
          return;
        }
        await updateFiling(filing.id, { status: 'AWAITING_BANK_NAME' });
        await sendMessage(
          `📊 *ITR Filing — FY ${fy} (AY ${ay})*\n\n` +
          `Great, *${client.full_name}*! Let's get your Income Tax Return filed.\n\n` +
          `I'll need your *bank account details* for your tax refund.\n\n` +
          `*Step 1/4:* What is the *Name of your Bank*? (e.g., HDFC Bank, SBI, ICICI Bank)`
        );
      } else {
        // They haven't selected option 1 yet, show the service menu.
        await sendMessage(
          `Welcome back, *${client.full_name}*! 👋\n\n` +
          `🛎️ *What service do you need today?*\n\n` +
          `Please reply with the number:\n` +
          `*1* — 📊 ITR Filing (Income Tax Return) for FY ${fy}\n\n` +
          `_More services coming soon!_`
        );
      }
      return;
    }

    // If they already have a filing, process the active ITR flow!
    const userName = client.full_name || 'there';

    // If user sends a greeting/menu while already in an active ITR flow, show a helpful navigation prompt
    if (isGreeting(incomingMessage) && filing.status !== 'COMPLETED') {
      await sendMessage(
        `Welcome back, *${client.full_name}*! 👋\n\n` +
        `You have an active ITR Filing session for FY ${fy}.\n\n` +
        `Please continue where you left off or send your documents. Type your next details below!`
      );
      return;
    }

    await handleItrFlow(client, filing, incomingMessage, isMedia, mediaUrl, fy, ay, userName, sendMessage);

  } catch (error) {
    console.error('Error handling WhatsApp message:', error);
  }
};

// ─────────────────────────────────────────────────────────────────
// PHASE 1: REGISTRATION FLOW
// (Name → Phone → DOB → Email → PAN Card → Aadhaar → PENDING)
// ─────────────────────────────────────────────────────────────────

const handleRegistration = async (
  client: any,
  isNewClient: boolean,
  incomingMessage: string,
  isMedia: boolean,
  mediaUrl: string | null,
  sendMessage: (text: string) => Promise<void>
) => {
  const status: ClientBotStatus = client.bot_status || 'REGISTERING_NAME';

  switch (status) {

    // ── STEP 1: Collect Full Name ─────────────────────────────────
    case 'REGISTERING_NAME': {
      const greetings = ['hi', 'hello', 'hey', 'start', 'menu', 'yo', 'hii', 'hiii', 'namaste', 'help'];
      const lowerInput = incomingMessage.toLowerCase().trim();

      if (!incomingMessage || incomingMessage.length < 2 || isMedia || greetings.includes(lowerInput)) {
        await sendMessage(
          `🙏 *Welcome to ${COMPANY_NAME}!*\n` +
          `_${COMPANY_TAGLINE}_\n\n` +
          `━━━━━━━━━━━━━━━━━━━━━\n\n` +
          `Hello! I'm your *CA Assistant Bot* 🤖\n\n` +
          `To get started, I'll set up your account (takes ~2 minutes).\n\n` +
          `Please reply with your *Full Name* as printed on your *PAN Card* 👇`
        );
        return;
      }

      const formattedName = incomingMessage
        .split(' ').filter(Boolean)
        .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
        .join(' ');

      await updateClient(client.id, { full_name: formattedName, bot_status: 'REGISTERING_PHONE' });

      await sendMessage(
        `Nice to meet you, *${formattedName}*! 😊\n\n` +
        `*(Step 1/5)*\nPlease reply with your *10-digit mobile number* (e.g., 9876543210).`
      );
      break;
    }

    // ── STEP 2: Collect Phone Number ──────────────────────────────
    case 'REGISTERING_PHONE': {
      if (isMedia || !incomingMessage) {
        await sendMessage('⚠️ Please reply with your *10-digit mobile number* (e.g., 9876543210).');
        return;
      }

      let cleaned = incomingMessage.replace(/\D/g, '');
      if (cleaned.startsWith('0')) cleaned = cleaned.slice(1);
      if (cleaned.length === 12 && cleaned.startsWith('91')) cleaned = cleaned.slice(2);

      if (cleaned.length < 10 || cleaned.length > 15) {
        await sendMessage('⚠️ Please enter a valid mobile number — digits only, e.g., 9876543210.');
        return;
      }

      const fullNumber = cleaned.length === 10 ? `91${cleaned}` : cleaned;
      const { data: updated, error } = await updateClient(client.id, { phone_number: fullNumber, bot_status: 'REGISTERING_DOB' });

      if (error?.code === '23505') {
        await sendMessage(`⚠️ This phone number is already registered. Please provide a different number or contact ${SUPPORT_PHONE}.`);
        return;
      }
      if (!updated?.phone_number) {
        await sendMessage('⚠️ Error saving your number. Please try again.');
        return;
      }

      console.log(`✅ Phone "${fullNumber}" saved for client ${client.id}`);
      await sendMessage(
        `✅ Mobile number saved!\n\n` +
        `*(Step 2/5)*\nWhat is your *Date of Birth*? Reply in *DD-MM-YYYY* format (e.g., 15-08-1995).`
      );
      break;
    }

    // ── STEP 3: Collect Date of Birth ─────────────────────────────
    case 'REGISTERING_DOB': {
      if (isMedia || !incomingMessage) {
        await sendMessage('⚠️ Please enter your Date of Birth in *DD-MM-YYYY* format.');
        return;
      }

      if (!/^\d{2}-\d{2}-\d{4}$/.test(incomingMessage)) {
        await sendMessage('⚠️ Invalid format. Please reply in *DD-MM-YYYY* format (e.g., 15-08-1995).');
        return;
      }

      const [dd, mm, yyyy] = incomingMessage.split('-');
      const d = parseInt(dd), mo = parseInt(mm), yr = parseInt(yyyy);
      const dateObj = new Date(yr, mo - 1, d);

      if (
        dateObj.getFullYear() !== yr || dateObj.getMonth() !== mo - 1 || dateObj.getDate() !== d ||
        yr < 1900 || yr > new Date().getFullYear()
      ) {
        await sendMessage("⚠️ That doesn't look like a valid date. Please use *DD-MM-YYYY* format.");
        return;
      }

      await updateClient(client.id, { date_of_birth: `${yyyy}-${mm}-${dd}`, bot_status: 'REGISTERING_EMAIL' });
      await sendMessage(
        `✅ Date of birth saved!\n\n` +
        `*(Step 3/5)*\nWhat is your *Email Address*? (e.g., name@gmail.com)`
      );
      break;
    }

    // ── STEP 4: Collect Email ─────────────────────────────────────
    case 'REGISTERING_EMAIL': {
      if (isMedia || !incomingMessage) {
        await sendMessage('⚠️ Please reply with your *Email Address*.');
        return;
      }

      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(incomingMessage)) {
        await sendMessage('⚠️ Invalid email. Please enter a valid address (e.g., name@gmail.com).');
        return;
      }

      await updateClient(client.id, { email: incomingMessage.toLowerCase(), bot_status: 'REGISTERING_PAN' });
      await sendMessage(
        `✅ Email saved!\n\n` +
        `*(Step 4/5)*\nNow I need your *PAN Card* for KYC verification.\n\n` +
        `Please upload a clear photo or PDF of your *PAN Card* 📎`
      );
      break;
    }

    // ── STEP 5a: Collect PAN Card ─────────────────────────────────
    case 'REGISTERING_PAN': {
      if (mediaUrl) {
        await updateClient(client.id, { pan_media_url: mediaUrl, bot_status: 'REGISTERING_AADHAAR' });
        await sendMessage(
          `✅ *PAN Card received!*\n\n` +
          `*(Step 5/5)*\nAlmost done! Please now upload your *Aadhaar Card* 📎`
        );
      } else {
        await sendMessage(
          `⚠️ Please upload your *PAN Card* as an image or PDF.\n\n` +
          `Tap the attachment icon (📎) and send your PAN Card photo or PDF.`
        );
      }
      break;
    }

    // ── STEP 5b: Collect Aadhaar Card ─────────────────────────────
    case 'REGISTERING_AADHAAR': {
      if (mediaUrl) {
        const name = client.full_name || 'there';
        await updateClient(client.id, {
          aadhaar_media_url: mediaUrl,
          bot_status: 'PENDING_APPROVAL',
          // account_status remains 'PENDING' — CA must approve from dashboard
        });

        await sendMessage(
          `✅ *Aadhaar Card received!*\n\n` +
          `━━━━━━━━━━━━━━━━━━━━━\n\n` +
          `🎉 *Registration Complete, ${name}!*\n\n` +
          `Your account is now *under review* by our CA team. Here's what we have:\n\n` +
          `• 📝 *Name:* ${name}\n` +
          `• 📄 *PAN Card:* Submitted ✅\n` +
          `• 🪪 *Aadhaar Card:* Submitted ✅\n\n` +
          `⏳ Our team will verify your documents and *approve your account within 1–2 business days*.\n\n` +
          `You will be able to access our services (ITR Filing, etc.) once approved.\n\n` +
          `For urgent queries, contact: ${SUPPORT_PHONE}`
        );
      } else {
        await sendMessage(
          `⚠️ Please upload your *Aadhaar Card* as an image or PDF to complete your registration.\n\n` +
          `Tap the attachment icon (📎) and send your Aadhaar photo or PDF.`
        );
      }
      break;
    }

    default:
      await sendMessage(`Something went wrong. Please type *hi* to restart.`);
  }
};

// ─────────────────────────────────────────────────────────────────
// PHASE 2: ITR SERVICE FLOW
// (Only for APPROVED clients)
// ─────────────────────────────────────────────────────────────────

const handleItrFlow = async (
  client: any,
  filing: any,
  incomingMessage: string,
  isMedia: boolean,
  mediaUrl: string | null,
  fy: string,
  ay: string,
  userName: string,
  sendMessage: (text: string) => Promise<void>
) => {

  switch (filing.status as ItrStatus) {

    // ── SERVICE SELECTION MENU ─────────────────────────────────────
    case 'SERVICE_MENU': {
      const choice = incomingMessage.trim();
      if (choice === '1' || choice.toLowerCase().includes('itr')) {
        await updateFiling(filing.id, { status: 'AWAITING_BANK_NAME' });
        await sendMessage(
          `📊 *ITR Filing — FY ${fy} (AY ${ay})*\n\n` +
          `Great, *${userName}*! Let's get your Income Tax Return filed.\n\n` +
          `I'll need your *bank account details* for your tax refund.\n\n` +
          `*Step 1/4:* What is the *Name of your Bank*? (e.g., HDFC Bank, SBI, ICICI Bank)`
        );
      } else {
        await sendMessage(
          `Please reply with a valid option:\n\n` +
          `*1* — 📊 ITR Filing (Income Tax Return)\n\n` +
          `_More services coming soon!_`
        );
      }
      break;
    }

    // ── COLLECT BANK NAME ──────────────────────────────────────────
    case 'AWAITING_BANK_NAME': {
      if (isMedia || !incomingMessage || incomingMessage.length < 2) {
        await sendMessage(`⚠️ Please enter your *Bank Name* (e.g., HDFC Bank, SBI, ICICI Bank).`);
        return;
      }
      await updateFiling(filing.id, { bank_name: incomingMessage, status: 'AWAITING_BANK_ACC' });
      await sendMessage(`✅ Bank: *${incomingMessage}*\n\n*Step 2/4:* Please reply with your *Bank Account Number*.`);
      break;
    }

    // ── COLLECT BANK ACCOUNT NUMBER ────────────────────────────────
    case 'AWAITING_BANK_ACC': {
      if (isMedia || !incomingMessage) {
        await sendMessage('⚠️ Please enter your *Bank Account Number* (digits only, 6–18 digits).');
        return;
      }
      const acc = incomingMessage.replace(/\s/g, '');
      if (!/^\d{6,18}$/.test(acc)) {
        await sendMessage('⚠️ Account number must be digits only, 6–18 digits long. Please try again.');
        return;
      }
      await updateFiling(filing.id, { bank_account_number: acc, status: 'AWAITING_BANK_IFSC' });
      await sendMessage(`✅ Account number saved!\n\n*Step 3/4:* Please reply with your bank's *IFSC Code* (e.g., HDFC0001234).`);
      break;
    }

    // ── COLLECT IFSC CODE ──────────────────────────────────────────
    case 'AWAITING_BANK_IFSC': {
      if (isMedia || !incomingMessage) {
        await sendMessage('⚠️ Please enter a valid *IFSC Code* (e.g., HDFC0001234).');
        return;
      }
      const ifsc = incomingMessage.trim().toUpperCase();
      if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifsc)) {
        await sendMessage('⚠️ Invalid IFSC. It should be 11 characters: 4 letters + 0 + 6 alphanumeric (e.g., HDFC0001234). Try again.');
        return;
      }
      await updateFiling(filing.id, { bank_ifsc: ifsc, status: 'AWAITING_INCOME_SOURCE' });
      await sendMessage(
        `✅ IFSC: *${ifsc}*\n\n🏦 *Bank details saved!*\n\n` +
        `━━━━━━━━━━━━━━━━━━━━━\n\n` +
        `🛎️ *Please select your primary source of income:*\n\n` +
        `*1* — 👔 Salaried Employee\n` +
        `*2* — 💼 Self-Employed / Business / Freelancer\n` +
        `*3* — 📈 Investor / Trader (Stocks, Mutual Funds, Crypto)\n` +
        `*4* — 🏠 Property Seller / Landlord (Real Estate transactions)\n\n` +
        `_Reply with a number (1-4)._`
      );
      break;
    }

    // ── SELECT INCOME SOURCE ────────────────────────────────────────
    case 'AWAITING_INCOME_SOURCE': {
      const choice = incomingMessage.trim();
      if (choice === '1') {
        await updateFiling(filing.id, { income_source: 'SALARIED', status: 'AWAITING_FORM16' });
        await sendMessage(
          `👔 *Salaried Income Details*\n\n` +
          `Please upload your **Form 16** (issued by your employer) as a PDF or clear photo 📎`
        );
      } else if (choice === '2') {
        await updateFiling(filing.id, { income_source: 'BUSINESS', status: 'AWAITING_BANK_STATEMENT' });
        await sendMessage(
          `💼 *Business / Freelance Details*\n\n` +
          `Please upload your **Bank Statement** for FY ${fy} (PDF or photo) 📎`
        );
      } else if (choice === '3') {
        await updateFiling(filing.id, { income_source: 'INVESTOR', status: 'AWAITING_CAPITAL_GAINS' });
        await sendMessage(
          `📈 *Investment & Trading Details*\n\n` +
          `Please upload your broker's **Capital Gains Statement** or Tax Report (PDF or photo) 📎`
        );
      } else if (choice === '4') {
        await updateFiling(filing.id, { income_source: 'PROPERTY', status: 'AWAITING_PROPERTY_DOCS' });
        await sendMessage(
          `🏠 *Property Transaction Details*\n\n` +
          `Please upload your **Property Sale/Purchase Deeds** or registration documents (PDF or photo) 📎`
        );
      } else {
        await sendMessage(
          `⚠️ Invalid selection. Please reply with a number between 1 and 4:\n\n` +
          `*1* — 👔 Salaried\n` +
          `*2* — 💼 Self-Employed / Business\n` +
          `*3* — 📈 Investor / Trader\n` +
          `*4* — 🏠 Property transactions`
        );
      }
      break;
    }

    // ── COLLECT FORM 16 ────────────────────────────────────────────
    case 'AWAITING_FORM16': {
      if (mediaUrl) {
        await updateFiling(filing.id, { form16_media_url: mediaUrl, status: 'AWAITING_PROPERTY_SALE_DECISION' });
        await sendMessage(
          `✅ *Form 16 received!*\n\n` +
          `Did you buy or sell any real estate property (house, plot, land) during this financial year?\n\n` +
          `*1* — 🏠 Yes\n` +
          `*2* — ❌ No`
        );
      } else {
        await sendMessage(`⚠️ Please attach your **Form 16** to continue, *${userName}*.`);
      }
      break;
    }

    // ── COLLECT BANK STATEMENT ──────────────────────────────────────
    case 'AWAITING_BANK_STATEMENT': {
      if (mediaUrl) {
        await updateFiling(filing.id, { bank_statement_media_url: mediaUrl, status: 'AWAITING_PROPERTY_SALE_DECISION' });
        await sendMessage(
          `✅ *Bank Statement received!*\n\n` +
          `Did you buy or sell any real estate property (house, plot, land) during this financial year?\n\n` +
          `*1* — 🏠 Yes\n` +
          `*2* — ❌ No`
        );
      } else {
        await sendMessage(`⚠️ Please attach your **Bank Statement** to continue, *${userName}*.`);
      }
      break;
    }

    // ── COLLECT CAPITAL GAINS ───────────────────────────────────────
    case 'AWAITING_CAPITAL_GAINS': {
      if (mediaUrl) {
        await updateFiling(filing.id, { capital_gains_media_url: mediaUrl, status: 'AWAITING_PROPERTY_SALE_DECISION' });
        await sendMessage(
          `✅ *Capital Gains Statement received!*\n\n` +
          `Did you buy or sell any real estate property (house, plot, land) during this financial year?\n\n` +
          `*1* — 🏠 Yes\n` +
          `*2* — ❌ No`
        );
      } else {
        await sendMessage(`⚠️ Please attach your **Capital Gains Statement** to continue, *${userName}*.`);
      }
      break;
    }

    // ── COLLECT PROPERTY DOCUMENTS ──────────────────────────────────
    case 'AWAITING_PROPERTY_DOCS': {
      if (mediaUrl) {
        await updateFiling(filing.id, { property_docs_media_url: mediaUrl, status: 'AWAITING_OTHER_DOCS_DECISION' });
        await sendMessage(
          `✅ *Property documents received!*\n\n` +
          `Do you have any other supporting tax documents (like rent agreements, insurance premium receipts, or dividend statements) to share?\n\n` +
          `*1* — 📎 Yes, upload other documents\n` +
          `*2* — ❌ No, I am done`
        );
      } else {
        await sendMessage(`⚠️ Please attach your **Property Sale/Purchase Deeds** or documents to continue, *${userName}*.`);
      }
      break;
    }

    // ── PROPERTY DECISION ──────────────────────────────────────────
    case 'AWAITING_PROPERTY_SALE_DECISION': {
      const choice = incomingMessage.trim();
      if (choice === '1') {
        await updateFiling(filing.id, { status: 'AWAITING_PROPERTY_DOCS' });
        await sendMessage(
          `🏠 *Property Transaction Details*\n\n` +
          `Please upload your **Property Sale/Purchase Deeds** or registration documents (PDF or photo) 📎`
        );
      } else if (choice === '2') {
        await updateFiling(filing.id, { status: 'AWAITING_OTHER_DOCS_DECISION' });
        await sendMessage(
          `Do you have any other supporting tax documents (like rent agreements, insurance premium receipts, or dividend statements) to share?\n\n` +
          `*1* — 📎 Yes, upload other documents\n` +
          `*2* — ❌ No, I am done`
        );
      } else {
        await sendMessage(
          `⚠️ Invalid selection. Did you buy or sell any real estate property during this financial year?\n\n` +
          `*1* — 🏠 Yes\n` +
          `*2* — ❌ No`
        );
      }
      break;
    }

    // ── OTHER DOCUMENTS DECISION ────────────────────────────────────
    case 'AWAITING_OTHER_DOCS_DECISION': {
      const choice = incomingMessage.trim();
      if (choice === '1') {
        await updateFiling(filing.id, { status: 'AWAITING_OTHER_DOCS' });
        await sendMessage(
          `📎 *Other Supporting Documents*\n\n` +
          `Please upload your other tax files (PDF or Photo). Once uploaded, you can send more or submit! 📎`
        );
      } else if (choice === '2') {
        await updateFiling(filing.id, { status: 'COMPLETED' });
        await sendMessage(
          `🎉 *All Documents Submitted!*\n\n` +
          `Dear *${userName}*, your ITR filing request for *FY ${filing.fy_year}* has been successfully logged.\n\n` +
          `Our CA team will review your documents and get back to you shortly.\n\n` +
          `Thank you for choosing *${COMPANY_NAME}*! 🙏`
        );
      } else {
        await sendMessage(
          `⚠️ Invalid selection. Do you have any other supporting tax documents to share?\n\n` +
          `*1* — 📎 Yes, upload other documents\n` +
          `*2* — ❌ No, I am done`
        );
      }
      break;
    }

    // ── OTHER DOCUMENTS UPLOAD LOOP ─────────────────────────────────
    case 'AWAITING_OTHER_DOCS': {
      if (mediaUrl) {
        const existingDocs = filing.other_docs_media_url;
        const newDocs = existingDocs ? `${existingDocs},${mediaUrl}` : mediaUrl;
        await updateFiling(filing.id, { other_docs_media_url: newDocs });
        await sendMessage(
          `✅ *Document received successfully!*\n\n` +
          `If you have **more supporting documents** to send (such as rent agreements or insurance receipts), please upload them now.\n\n` +
          `Otherwise, reply **DONE** to submit your filing request!`
        );
      } else if (incomingMessage.trim().toUpperCase() === 'DONE') {
        await updateFiling(filing.id, { status: 'COMPLETED' });
        await sendMessage(
          `🎉 *All Documents Submitted!*\n\n` +
          `Dear *${userName}*, your ITR filing request for *FY ${filing.fy_year}* has been successfully logged.\n\n` +
          `Our CA team will review your documents and get back to you shortly.\n\n` +
          `Thank you for choosing *${COMPANY_NAME}*! 🙏`
        );
      } else {
        await sendMessage(
          `⚠️ Please upload another document file, or reply **DONE** if you are finished submitting documents.`
        );
      }
      break;
    }

    // ── COMPLETED ──────────────────────────────────────────────────
    case 'COMPLETED': {
      await sendMessage(
        `Dear *${userName}*, your ITR documents for *FY ${filing.fy_year}* have already been submitted and are under review. 📊\n\n` +
        `For changes or queries, contact us at ${SUPPORT_PHONE}.\n\n` +
        `Thank you for choosing *${COMPANY_NAME}*! 🙏`
      );
      break;
    }

    default:
      await sendMessage('An unexpected error occurred. Please type *hi* to restart, or contact our support.');
  }
};
