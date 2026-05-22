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
  ItrStatus,
} from '../services/supabase.service';
import { getFinancialAndAssessmentYear } from '../utils/date';

export const handleBaileysMessage = async (sock: WASocket, msg: proto.IWebMessageInfo) => {
  try {
    if (!msg.key) return;
    const senderJid = msg.key.remoteJid;
    if (!senderJid) return;

    // Ignore group chats, newsletters, broadcasts and status updates
    if (
      senderJid === 'status@broadcast' ||
      senderJid.endsWith('@g.us') ||
      senderJid.endsWith('@newsletter') ||
      senderJid.endsWith('@broadcast')
    ) {
      return;
    }

    // Extract text from all message types
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

    // Always send replies back to the original sender JID (works for both phone JID and LID)
    const sendMessage = async (text: string) => {
      await sock.sendMessage(senderJid, { text });
    };

    if (!supabase) {
      await sendMessage('⚠️ The bot is currently undergoing maintenance (Database not configured). Please try again later.');
      return;
    }

    // Download and upload media if present
    if (isMedia) {
      const buffer = await downloadMediaMessage(
        msg as WAMessage,
        'buffer',
        {},
        {
          logger: console as any,
          reuploadRequest: sock.updateMediaMessage,
        }
      );

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

    // 1. Fetch or create client profile using the raw sender JID
    // The service handles two-pass lookup: phone_number then whatsapp_jid
    let client = await getClient(senderJid);
    if (!client) {
      client = await createClientRecord(senderJid);
    }
    if (!client) {
      await sendMessage('⚠️ Failed to initialize your client profile. Please try again.');
      return;
    }

    // Dynamically calculate India filing FY and AY
    const { fy, ay } = getFinancialAndAssessmentYear();

    // 2. Fetch or create current year ITR filing
    let filing = await getFiling(client.id, fy);
    const isNewFiling = !filing;

    if (isNewFiling) {
      filing = await createFiling(client.id, fy);
    }
    if (!filing) {
      await sendMessage('⚠️ Failed to initialize your ITR filing. Please try again.');
      return;
    }

    // 3. If brand new session — send onboarding welcome (or welcome back) and stop
    if (isNewFiling) {
      let nextStatus: ItrStatus = 'AWAITING_NAME';
      if (client.full_name) nextStatus = 'AWAITING_PHONE';
      if (nextStatus === 'AWAITING_PHONE' && client.phone_number) nextStatus = 'AWAITING_DOB';
      if (nextStatus === 'AWAITING_DOB' && client.date_of_birth) nextStatus = 'AWAITING_EMAIL';
      if (nextStatus === 'AWAITING_EMAIL' && client.email) nextStatus = 'AWAITING_BANK_NAME';
      if (nextStatus === 'AWAITING_BANK_NAME' && filing.bank_name) nextStatus = 'AWAITING_BANK_ACC';
      if (nextStatus === 'AWAITING_BANK_ACC' && filing.bank_account_number) nextStatus = 'AWAITING_BANK_IFSC';
      if (nextStatus === 'AWAITING_BANK_IFSC' && filing.bank_ifsc) nextStatus = 'AWAITING_PAN';

      if (nextStatus === 'AWAITING_NAME') {
        await sendMessage(
          `Welcome to the ITR Filing Assistant! 📊😊\n\n` +
          `I'll guide you step-by-step to securely submit your details and documents for Income Tax Return filing for Financial Year ${fy} (Assessment Year ${ay}).\n\n` +
          `To get started, please reply with your Full Name exactly as printed on your PAN Card.`
        );
      } else {
        await updateFiling(filing.id, { status: nextStatus });

        let promptMsg = '';
        if (nextStatus === 'AWAITING_PAN') {
          promptMsg = `We have your profile securely saved. Let's start with your documents!\n\nPlease upload a clear photo or PDF of your *PAN Card*.`;
        } else if (nextStatus === 'AWAITING_PHONE') {
          promptMsg = `Please reply with your *10-digit mobile number* so we can reach you when your filing is complete.`;
        } else if (nextStatus === 'AWAITING_DOB') {
          promptMsg = `What is your *Date of Birth*? Please reply in *DD-MM-YYYY* format (e.g., 15-08-1995).`;
        } else if (nextStatus === 'AWAITING_EMAIL') {
          promptMsg = `What is your *Email Address*?`;
        } else if (nextStatus === 'AWAITING_BANK_NAME') {
          promptMsg = `What is the *Name of your Bank* (e.g., HDFC, SBI)?`;
        } else if (nextStatus === 'AWAITING_BANK_ACC') {
          promptMsg = `What is your *Bank Account Number*?`;
        } else if (nextStatus === 'AWAITING_BANK_IFSC') {
          promptMsg = `What is your *Bank IFSC Code*?`;
        }

        await sendMessage(
          `Welcome back, *${client.full_name}*! 👋\n\n` +
          `Let's continue your ITR Filing for Financial Year ${fy}.\n\n` +
          `${promptMsg}`
        );
      }
      return;
    }

    const userName = client.full_name || '';

    // 4. State machine
    switch (filing.status as ItrStatus) {

      // ── COLLECT FULL NAME ──────────────────────────────────────────────
      case 'AWAITING_NAME': {
        const commonGreetings = ['hi', 'hello', 'hey', 'start', 'restart', 'reset', 'menu', 'yo', 'hii', 'hiii'];
        const lowerInput = incomingMessage.toLowerCase().trim();

        if (!incomingMessage || incomingMessage.length < 2 || isMedia || commonGreetings.includes(lowerInput)) {
          await sendMessage(
            `Welcome to the ITR Filing Assistant! 📊😊\n\n` +
            `To begin your ITR filing for Financial Year ${filing.fy_year}, please reply with your Full Name exactly as printed on your PAN Card.`
          );
          return;
        }

        // Capitalize each word
        const formattedName = incomingMessage
          .split(' ')
          .filter(Boolean)
          .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
          .join(' ');

        await updateClient(client.id, { full_name: formattedName });
        await updateFiling(filing.id, { status: 'AWAITING_PHONE' });

        await sendMessage(
          `Pleasure meeting you, *${formattedName}*! 😊\n\n` +
          `Please reply with your *10-digit mobile number* so we can reach you when your filing is complete.`
        );
        break;
      }

      // ── COLLECT PHONE NUMBER (asked to ALL users) ─────────────────────
      case 'AWAITING_PHONE': {
        if (isMedia || !incomingMessage) {
          await sendMessage('⚠️ Please reply with your 10-digit mobile number (e.g., 9876543210).');
          return;
        }

        let cleaned = incomingMessage.replace(/\D/g, ''); // strip spaces, dashes, +91 etc.

        // Strip leading zero if present (e.g. 09898636398)
        if (cleaned.startsWith('0')) {
          cleaned = cleaned.slice(1);
        }

        // If it starts with 91 and has 12 digits, extract the 10-digit number
        if (cleaned.length === 12 && cleaned.startsWith('91')) {
          cleaned = cleaned.slice(2);
        }

        // Support any number between 10 and 15 digits (relaxed for international/virtual testing)
        if (cleaned.length < 10 || cleaned.length > 15) {
          await sendMessage('⚠️ Please enter a valid mobile number (digits only, e.g., 9876543210).');
          return;
        }

        // Prefix with 91 only if it's a standard 10-digit number
        const fullNumber = cleaned.length === 10 ? `91${cleaned}` : cleaned;

        // Save the clean phone number. The whatsapp_jid (LID) remains in the DB
        // permanently so all future message lookups via senderJid still resolve correctly.
        const { data: updatedClient, error } = await updateClient(client.id, { phone_number: fullNumber });

        if (error && error.code === '23505') {
          console.warn(`⚠️ Phone number "${fullNumber}" is already registered to another client.`);
          await sendMessage(`⚠️ This phone number is already registered to another account. Please provide a different number, or contact support.`);
          return;
        }

        if (!updatedClient || !updatedClient.phone_number) {
          console.error(`❌ CRITICAL: Failed to save phone number "${fullNumber}" for client ${client.id}. updateClient returned:`, updatedClient, error);
          await sendMessage('⚠️ Sorry, there was an error saving your phone number. Please try again.');
          return;
        }
        console.log(`✅ Phone number "${fullNumber}" saved successfully for client ${client.id}`);

        await updateFiling(filing.id, { status: 'AWAITING_DOB' });

        await sendMessage(
          `Got it, *${userName}*! Mobile number saved ✅\n\n` +
          `*Step 1/6:*\nWhat is your *Date of Birth*? Please reply in *DD-MM-YYYY* format (e.g., 15-08-1995).`
        );
        break;
      }

      // ── COLLECT DATE OF BIRTH ─────────────────────────────────────────
      case 'AWAITING_DOB': {
        if (isMedia || !incomingMessage) {
          await sendMessage('⚠️ Please enter your Date of Birth in *DD-MM-YYYY* format.');
          return;
        }

        const dobRegex = /^\d{2}-\d{2}-\d{4}$/;
        if (!dobRegex.test(incomingMessage)) {
          await sendMessage('⚠️ Invalid format. Please reply in *DD-MM-YYYY* format (e.g., 15-08-1995).');
          return;
        }

        const [dayStr, monthStr, yearStr] = incomingMessage.split('-');
        const day = parseInt(dayStr, 10);
        const month = parseInt(monthStr, 10);
        const year = parseInt(yearStr, 10);
        const dateObj = new Date(year, month - 1, day);

        if (
          dateObj.getFullYear() !== year ||
          dateObj.getMonth() !== month - 1 ||
          dateObj.getDate() !== day ||
          year < 1900 ||
          year > new Date().getFullYear()
        ) {
          await sendMessage("⚠️ That doesn't look like a valid calendar date. Please enter a valid Date of Birth (DD-MM-YYYY).");
          return;
        }

        // Store as YYYY-MM-DD for PostgreSQL DATE type
        const formattedDbDate = `${yearStr}-${monthStr}-${dayStr}`;
        await updateClient(client.id, { date_of_birth: formattedDbDate });
        await updateFiling(filing.id, { status: 'AWAITING_EMAIL' });

        await sendMessage(`Got it, *${userName}*!\n\n*Step 2/6:*\nWhat is your *Email Address*?`);
        break;
      }

      // ── COLLECT EMAIL ─────────────────────────────────────────────────
      case 'AWAITING_EMAIL': {
        if (isMedia || !incomingMessage) {
          await sendMessage('⚠️ Please reply with your Email Address.');
          return;
        }

        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(incomingMessage)) {
          await sendMessage('⚠️ Please enter a valid Email Address (e.g., yourname@domain.com).');
          return;
        }

        await updateClient(client.id, { email: incomingMessage.toLowerCase() });
        await updateFiling(filing.id, { status: 'AWAITING_BANK_NAME' });

        await sendMessage(
          `Perfect!\n\n*Step 3/6:*\nIn which bank do you want your tax refund? Please enter the *Bank Name* (e.g., HDFC Bank, ICICI Bank, SBI).`
        );
        break;
      }

      // ── COLLECT BANK NAME ─────────────────────────────────────────────
      case 'AWAITING_BANK_NAME': {
        if (isMedia || !incomingMessage || incomingMessage.length < 2) {
          await sendMessage('⚠️ Please enter your Bank Name.');
          return;
        }

        await updateFiling(filing.id, { bank_name: incomingMessage });
        await updateFiling(filing.id, { status: 'AWAITING_BANK_ACC' });

        await sendMessage(`Understood. Bank set to *${incomingMessage}*.\n\n*Step 4/6:*\nPlease reply with your *Bank Account Number*.`);
        break;
      }

      // ── COLLECT BANK ACCOUNT NUMBER ───────────────────────────────────
      case 'AWAITING_BANK_ACC': {
        if (isMedia || !incomingMessage) {
          await sendMessage('⚠️ Please enter your Bank Account Number (digits only, minimum 6 digits).');
          return;
        }

        const accCleaned = incomingMessage.replace(/\s/g, '');
        if (!/^\d{6,18}$/.test(accCleaned)) {
          await sendMessage('⚠️ Bank account number must contain digits only (6–18 digits). Please try again.');
          return;
        }

        await updateFiling(filing.id, { bank_account_number: accCleaned });
        await updateFiling(filing.id, { status: 'AWAITING_BANK_IFSC' });

        await sendMessage(`Got it.\n\n*Step 5/6:*\nPlease reply with your bank's *IFSC Code* (e.g., HDFC0001234).`);
        break;
      }

      // ── COLLECT IFSC CODE ─────────────────────────────────────────────
      case 'AWAITING_BANK_IFSC': {
        if (isMedia || !incomingMessage) {
          await sendMessage('⚠️ Please enter a valid 11-character IFSC Code (e.g., HDFC0001234).');
          return;
        }

        const ifsc = incomingMessage.trim().toUpperCase();
        if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifsc)) {
          await sendMessage(
            '⚠️ That doesn\'t look like a valid IFSC code. It should be 11 characters: 4 letters, a 0, then 6 alphanumeric characters (e.g., HDFC0001234). Please try again.'
          );
          return;
        }

        await updateFiling(filing.id, { bank_ifsc: ifsc });
        await updateFiling(filing.id, { status: 'AWAITING_PAN' });

        await sendMessage(
          `Profile set up successfully! 🎉\n\n` +
          `*Document Submission (Step 6/6):*\nPlease upload a clear photo or PDF of your *PAN Card*.`
        );
        break;
      }

      // ── COLLECT PAN CARD ──────────────────────────────────────────────
      case 'AWAITING_PAN': {
        if (mediaUrl) {
          // Dynamic evaluation: check which required document is still missing
          let nextStatus: ItrStatus = 'COMPLETED';
          let responseMsg = `✅ PAN Card received, *${userName}*!\n\n`;

          if (!client.aadhaar_media_url) {
            nextStatus = 'AWAITING_AADHAAR';
            responseMsg += `*Next Document:*\nPlease upload a clear photo or PDF of your *Aadhaar Card*.`;
          } else if (!filing.form16_media_url) {
            nextStatus = 'AWAITING_FORM16';
            responseMsg += `*Next Document:*\nPlease upload your *Form 16* (issued by your employer).`;
          } else {
            responseMsg += `🎉 All documents received successfully! Your filing request is now locked and under review by our experts. Thank you! 🙏`;
          }

          await updateClient(client.id, { pan_media_url: mediaUrl });
          await updateFiling(filing.id, { status: nextStatus });
          await sendMessage(responseMsg);
        } else {
          await sendMessage(
            `⚠️ We need your PAN Card to proceed, *${userName}*. Please tap the attachment icon (📎) and send a photo or PDF of your PAN Card.`
          );
        }
        break;
      }

      // ── COLLECT AADHAAR CARD ──────────────────────────────────────────
      case 'AWAITING_AADHAAR': {
        if (mediaUrl) {
          // Dynamic evaluation: check which required document is still missing
          let nextStatus: ItrStatus = 'COMPLETED';
          let responseMsg = `✅ Aadhaar Card received, *${userName}*!\n\n`;

          if (!filing.form16_media_url) {
            nextStatus = 'AWAITING_FORM16';
            responseMsg += `*Next Document:*\nPlease upload your *Form 16* (issued by your employer).`;
          } else if (!client.pan_media_url) {
            nextStatus = 'AWAITING_PAN';
            responseMsg += `*Next Document:*\nPlease upload a clear photo or PDF of your *PAN Card*.`;
          } else {
            responseMsg += `🎉 All documents received successfully! Your filing request is now locked and under review by our experts. Thank you! 🙏`;
          }

          await updateClient(client.id, { aadhaar_media_url: mediaUrl });
          await updateFiling(filing.id, { status: nextStatus });
          await sendMessage(responseMsg);
        } else {
          await sendMessage(
            `⚠️ We need your Aadhaar Card to proceed, *${userName}*. Please attach a photo or PDF of your Aadhaar Card.`
          );
        }
        break;
      }

      // ── COLLECT FORM 16 ───────────────────────────────────────────────
      case 'AWAITING_FORM16': {
        if (mediaUrl) {
          // Dynamic evaluation: check which required document is still missing
          let nextStatus: ItrStatus = 'COMPLETED';
          let responseMsg = `✅ Form 16 received, *${userName}*!\n\n`;

          if (!client.pan_media_url) {
            nextStatus = 'AWAITING_PAN';
            responseMsg += `*Next Document:*\nPlease upload a clear photo or PDF of your *PAN Card*.`;
          } else if (!client.aadhaar_media_url) {
            nextStatus = 'AWAITING_AADHAAR';
            responseMsg += `*Next Document:*\nPlease upload a clear photo or PDF of your *Aadhaar Card*.`;
          } else {
            responseMsg = `🎉 All documents received successfully, *${userName}*!\n\n` +
              `Your ITR filing request for Financial Year *${filing.fy_year}* has been logged. ` +
              `Our tax experts will review your documents and get in touch with you shortly.\n\n` +
              `Thank you for trusting us with your filing! 🙏`;
          }

          await updateFiling(filing.id, { status: nextStatus, form16_media_url: mediaUrl });
          await sendMessage(responseMsg);
        } else {
          await sendMessage(
            `⚠️ Please attach your Form 16, *${userName}*, to complete the document submission process.`
          );
        }
        break;
      }

      // ── COMPLETED — SUBMISSION LOCKED ─────────────────────────────────
      case 'COMPLETED': {
        await sendMessage(
          `Dear *${userName}*, your ITR documents for Financial Year *${filing.fy_year}* have already been submitted and are under review by our experts! 📊\n\n` +
          `For data integrity and security reasons, submissions cannot be modified or resubmitted once locked.\n\n` +
          `If you need to make any changes, please contact our support team directly. Thank you! 🙏`
        );
        break;
      }

      default:
        await sendMessage('An unexpected error occurred. Please contact our support team.');
    }

  } catch (error) {
    console.error('Error handling WhatsApp message:', error);
  }
};
