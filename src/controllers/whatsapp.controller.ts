import { messageService, type IncomingMessage } from '../providers';
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
  DscStatus,
  getDscApplication,
  createDscApplication,
  updateDscApplication,
} from '../services/supabase.service';
import { getFinancialAndAssessmentYear } from '../utils/date';
import { resolvePhoneNumber } from '../utils/jid';

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

// Per-JID lock to prevent race conditions from concurrent message deliveries
const processingLocks = new Map<string, Promise<void>>();

// ─────────────────────────────────────────────────────────────────
// MAIN HANDLER (Provider-Agnostic)
// ─────────────────────────────────────────────────────────────────

export const handleIncomingMessage = async (message: IncomingMessage) => {
  const { senderJid } = message;

  // Serialize processing per JID to avoid race conditions from rapid-fire messages
  const previous = processingLocks.get(senderJid) ?? Promise.resolve();
  let releaseLock: () => void;
  const current = new Promise<void>((resolve) => { releaseLock = resolve; });
  processingLocks.set(senderJid, current);
  await previous;

  try {
    const { text: incomingMessage, isMedia, rawMessage, rawMessageContent } = message;

    if (
      senderJid === 'status@broadcast' ||
      senderJid.endsWith('@g.us') ||
      senderJid.endsWith('@newsletter') ||
      senderJid.endsWith('@broadcast')
    ) return;

    let mediaUrl: string | null = null;

    console.log(`Received message from ${senderJid}: text="${incomingMessage}", isMedia=${isMedia}`);

    const sendMessage = async (text: string) => {
      await messageService.sendText(senderJid, text);
    };

    if (!supabase) {
      await sendMessage('⚠️ The bot is currently undergoing maintenance. Please try again later.');
      return;
    }

    // Upload media if present — uses provider abstraction for download
    if (isMedia) {
      const media = await messageService.downloadMedia(rawMessage, rawMessageContent);
      if (media) {
        mediaUrl = await uploadDocument(senderJid, media.buffer, media.mimetype, media.extension);
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

    // ── BACK / UNDO HANDLER (Conversation backtracking) ───────────
    const isBack = incomingMessage.trim().toLowerCase() === 'back' || incomingMessage.trim().toLowerCase() === 'undo';

    if (isBack) {
      if (isRegistering) {
        let prevStatus: ClientBotStatus = 'REGISTERING_NAME';
        let fieldToClear: Record<string, any> = {};

        if (botStatus === 'REGISTERING_PHONE') {
          prevStatus = 'REGISTERING_NAME';
          fieldToClear = { full_name: null };
        } else if (botStatus === 'REGISTERING_DOB') {
          prevStatus = 'REGISTERING_PHONE';
          fieldToClear = { phone_number: null };
        } else if (botStatus === 'REGISTERING_EMAIL') {
          prevStatus = 'REGISTERING_DOB';
          fieldToClear = { date_of_birth: null };
        } else if (botStatus === 'REGISTERING_PAN') {
          prevStatus = 'REGISTERING_EMAIL';
          fieldToClear = { email: null };
        } else if (botStatus === 'REGISTERING_AADHAAR') {
          prevStatus = 'REGISTERING_PAN';
          fieldToClear = { pan_media_url: null };
        } else {
          await sendMessage('ℹ️ You are at the first step of registration. Cannot go back further.');
          return;
        }

        const { data: updated } = await updateClient(client.id, {
          bot_status: prevStatus,
          ...fieldToClear
        });

        await sendMessage('↩️ *Going back to previous step...*');
        
        if (updated) {
          await handleRegistration(updated, isNewClient, '', false, null, sendMessage, null);
        }
        return;
      }

      // Check if they are backtracking in DSC flow first
      const dsc = await getDscApplication(client.id);
      if (dsc && dsc.status !== 'COMPLETED') {
        let prevDscStatus: DscStatus = 'AWAITING_TYPE';
        let fieldsToClear: Record<string, any> = {};
        
        if (dsc.status === 'AWAITING_TYPE') {
          await supabase.from('dsc_applications').delete().eq('id', dsc.id);
          await sendMessage('↩️ *Returning to Main Menu...*');
          const { fy } = getFinancialAndAssessmentYear();
          await sendMessage(
            `👋 Hi *${client.full_name}*! What service do you need?\n\n` +
            `*1* — 📊 ITR Filing for FY ${fy}\n` +
            `*2* — 🔑 DSC Application\n\n` +
            `Reply with the service number (1 or 2).`
          );
          return;
        } else if (dsc.status === 'AWAITING_VIDEO_VERIFICATION') {
          prevDscStatus = 'AWAITING_TYPE';
          fieldsToClear = { user_type: null };
        }
        
        const updated = await updateDscApplication(dsc.id, {
          status: prevDscStatus,
          ...fieldsToClear
        });
        
        await sendMessage('↩️ *Going back to previous step...*');
        if (updated) {
          await handleDscFlow(client, updated, '', sendMessage);
        }
        return;
      }

      const { fy } = getFinancialAndAssessmentYear();
      const filing = await getFiling(client.id, fy);
      if (filing && filing.status !== 'COMPLETED') {
        const currentFilingStatus = filing.status as ItrStatus;
        let prevFilingStatus: ItrStatus = 'SERVICE_MENU';
        let fieldsToClear: Record<string, any> = {};

        if (currentFilingStatus === 'AWAITING_BANK_NAME') {
          prevFilingStatus = 'SERVICE_MENU';
        } else if (currentFilingStatus === 'AWAITING_BANK_ACC') {
          prevFilingStatus = 'AWAITING_BANK_NAME';
          fieldsToClear = { bank_name: null };
        } else if (currentFilingStatus === 'AWAITING_BANK_IFSC') {
          prevFilingStatus = 'AWAITING_BANK_ACC';
          fieldsToClear = { bank_account_number: null };
        } else if (currentFilingStatus === 'AWAITING_BANK_CONFIRMATION') {
          prevFilingStatus = 'AWAITING_BANK_IFSC';
          fieldsToClear = { bank_ifsc: null };
        } else if (currentFilingStatus === 'AWAITING_INCOME_SOURCE') {
          prevFilingStatus = 'AWAITING_BANK_CONFIRMATION';
        } else if (
          currentFilingStatus === 'AWAITING_FORM16' ||
          currentFilingStatus === 'AWAITING_BANK_STATEMENT' ||
          currentFilingStatus === 'AWAITING_CAPITAL_GAINS' ||
          currentFilingStatus === 'AWAITING_PROPERTY_DOCS'
        ) {
          prevFilingStatus = 'AWAITING_INCOME_SOURCE';
          fieldsToClear = {
            income_source: null,
            form16_media_url: null,
            bank_statement_media_url: null,
            capital_gains_media_url: null,
            property_docs_media_url: null
          };
        } else if (currentFilingStatus === 'AWAITING_PROPERTY_SALE_DECISION') {
          const source = filing.income_source;
          if (source === 'SALARIED') {
            prevFilingStatus = 'AWAITING_FORM16';
            fieldsToClear = { form16_media_url: null };
          } else if (source === 'BUSINESS') {
            prevFilingStatus = 'AWAITING_BANK_STATEMENT';
            fieldsToClear = { bank_statement_media_url: null };
          } else if (source === 'INVESTOR') {
            prevFilingStatus = 'AWAITING_CAPITAL_GAINS';
            fieldsToClear = { capital_gains_media_url: null };
          } else {
            prevFilingStatus = 'AWAITING_INCOME_SOURCE';
            fieldsToClear = { income_source: null };
          }
        } else if (currentFilingStatus === 'AWAITING_OTHER_DOCS_DECISION') {
          const source = filing.income_source;
          if (source === 'PROPERTY') {
            prevFilingStatus = 'AWAITING_PROPERTY_DOCS';
            fieldsToClear = { property_docs_media_url: null };
          } else {
            prevFilingStatus = 'AWAITING_PROPERTY_SALE_DECISION';
          }
        } else if (currentFilingStatus === 'AWAITING_OTHER_DOCS') {
          prevFilingStatus = 'AWAITING_OTHER_DOCS_DECISION';
          fieldsToClear = { other_docs_media_url: null };
        } else {
          await sendMessage('ℹ️ Cannot go back further.');
          return;
        }

        const updated = await updateFiling(filing.id, {
          status: prevFilingStatus,
          ...fieldsToClear
        });

        await sendMessage('↩️ *Going back to previous step...*');

        if (updated) {
          const { ay } = getFinancialAndAssessmentYear();
          const userName = client.full_name || 'there';
          await handleItrFlow(client, updated, '', false, null, fy, ay, userName, sendMessage);
        }
        return;
      }
    }

    if (isRegistering) {
      await handleRegistration(client, isNewClient, incomingMessage, isMedia, mediaUrl, sendMessage, rawMessage);
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
        `• Name: ${client.full_name || 'N/A'}\n` +
        `• PAN: ${client.pan_media_url ? '✅' : '⏳'}  |  Aadhaar: ${client.aadhaar_media_url ? '✅' : '⏳'}\n\n` +
        `We'll notify you once approved (1–2 business days).\n_Queries? Contact ${SUPPORT_PHONE}_`
      );
      return;
    }

    // ── ROUTE 3: Approved — Service Selection & Flow ──────────────────
    if (client.account_status !== 'APPROVED') {
      await sendMessage(`⏳ Your account is still under review. We'll notify you once approved.`);
      return;
    }

    const { fy, ay } = getFinancialAndAssessmentYear();
    
    // Query active states
    const filing = await getFiling(client.id, fy);
    const dsc = await getDscApplication(client.id);

    // Route to active DSC flow if in progress
    if (dsc && dsc.status !== 'COMPLETED') {
      if (isGreeting(incomingMessage)) {
        await sendMessage(`👋 Welcome back, *${client.full_name}*! Resuming your DSC Application:`);
        await handleDscFlow(client, dsc, '', sendMessage);
        return;
      }
      await handleDscFlow(client, dsc, incomingMessage, sendMessage);
      return;
    }

    // Route to active ITR flow if in progress
    if (filing && filing.status !== 'SERVICE_MENU' && filing.status !== 'COMPLETED') {
      const userName = client.full_name || 'there';
      if (isGreeting(incomingMessage)) {
        await sendMessage(`👋 Welcome back, *${client.full_name}*! Resuming your ITR filing for *FY ${fy}*:`);
        await handleItrFlow(client, filing, '', false, null, fy, ay, userName, sendMessage);
        return;
      }
      await handleItrFlow(client, filing, incomingMessage, isMedia, mediaUrl, fy, ay, userName, sendMessage);
      return;
    }

    // Otherwise, they are on the Service Selection Menu
    const choice = incomingMessage.trim();
    if (choice === '1' || choice.toLowerCase().includes('itr')) {
      const currentServices = client.services || [];
      if (!currentServices.includes('ITR')) {
        const newServices = [...currentServices, 'ITR'];
        await updateClient(client.id, { services: newServices });
        client.services = newServices;
      }
      let activeFiling = filing;
      if (!activeFiling) {
        activeFiling = await createFiling(client.id, fy);
      }
      if (!activeFiling) {
        await sendMessage('⚠️ Failed to start ITR filing. Please try again.');
        return;
      }
      
      // Determine where to resume based on existing fields
      let nextStatus: ItrStatus = 'AWAITING_BANK_NAME';
      if (!activeFiling.bank_name) {
        nextStatus = 'AWAITING_BANK_NAME';
      } else if (!activeFiling.bank_account_number) {
        nextStatus = 'AWAITING_BANK_ACC';
      } else if (!activeFiling.bank_ifsc) {
        nextStatus = 'AWAITING_BANK_IFSC';
      } else if (!activeFiling.income_source) {
        nextStatus = 'AWAITING_INCOME_SOURCE';
      } else {
        if (activeFiling.income_source === 'SALARIED') {
          nextStatus = activeFiling.form16_media_url ? 'AWAITING_PROPERTY_SALE_DECISION' : 'AWAITING_FORM16';
        } else if (activeFiling.income_source === 'BUSINESS') {
          nextStatus = activeFiling.bank_statement_media_url ? 'AWAITING_PROPERTY_SALE_DECISION' : 'AWAITING_BANK_STATEMENT';
        } else {
          nextStatus = 'AWAITING_INCOME_SOURCE';
        }
      }

      const updated = await updateFiling(activeFiling.id, { status: nextStatus });
      if (nextStatus === 'AWAITING_BANK_NAME') {
        await sendMessage(
          `📊 *ITR Filing — FY ${fy} (AY ${ay})*\n\n` +
          `What is the *Name of your Bank*?\n_e.g., HDFC Bank, SBI, ICICI_\n\n_Type *back* to go to previous step._`
        );
      } else {
        await sendMessage(`👋 Welcome back, *${client.full_name || 'there'}*! Resuming your ITR filing for *FY ${fy}*:`);
        if (updated) {
          await handleItrFlow(client, updated, '', false, null, fy, ay, client.full_name || 'there', sendMessage);
        }
      }
    } else if (choice === '2' || choice.toLowerCase().includes('dsc')) {
      if (!client.company_id) {
        await sendMessage('⚠️ Account configuration issue (missing Company ID). Please contact support.');
        return;
      }
      const currentServices = client.services || [];
      if (!currentServices.includes('DSC')) {
        const newServices = [...currentServices, 'DSC'];
        await updateClient(client.id, { services: newServices });
        client.services = newServices;
      }
      let activeDsc = dsc;
      if (!activeDsc) {
        activeDsc = await createDscApplication(client.id, client.company_id);
      }
      if (!activeDsc) {
        await sendMessage('⚠️ Failed to start DSC Application. Please try again.');
        return;
      }
      
      if (activeDsc.status === 'COMPLETED') {
        let expiryInfo = '';
        if (activeDsc.expiry_date) {
          expiryInfo = `\n📅 *Expiry Date:* ${activeDsc.expiry_date}`;
        }
        const typeStr = activeDsc.user_type === 'INDIVIDUAL' ? 'Individual' : 'Organization';
        await sendMessage(
          `✅ *Your DSC is Active*\n\n` +
          `• Type: *${typeStr}*\n` +
          `• Status: *Active / Completed*` +
          `${expiryInfo}\n\n` +
          `If you need to renew your DSC or make any changes, please contact our team.`
        );
      } else if (activeDsc.user_type) {
        const typeStr = activeDsc.user_type === 'INDIVIDUAL' ? 'Individual' : 'Organization';
        await sendMessage(
          `🔑 *DSC Application — ${typeStr}*\n\n` +
          `Your request is registered.\n\n` +
          `To complete the process, please record your *Video verification* using the link sent by our team.\n\n` +
          `_We will notify you once it's done!_`
        );
      } else {
        await updateDscApplication(activeDsc.id, { status: 'AWAITING_TYPE' });
        await sendMessage(
          `🔑 *DSC Application Type*\n\n` +
          `Please select the type of DSC:\n` +
          `*1* — Individual\n` +
          `*2* — Organization\n\n` +
          `Reply *1* or *2* to select.\n\n` +
          `_Type *back* to return to the Main Menu._`
        );
      }
    } else {
      await sendMessage(
        `👋 Hi *${client.full_name}*! What service do you need?\n\n` +
        `*1* — 📊 ITR Filing for FY ${fy}\n` +
        `*2* — 🔑 DSC Application\n\n` +
        `Reply with the service number (1 or 2).`
      );
    }

  } catch (error) {
    console.error('Error handling WhatsApp message:', error);
  } finally {
    releaseLock!();
    if (processingLocks.get(senderJid) === current) {
      processingLocks.delete(senderJid);
    }
  }
};

// ─────────────────────────────────────────────────────────────────
// PHASE 1: REGISTRATION FLOW
// (Name → Phone → DOB → Email → PAN Card → Aadhaar → PENDING)
// ─────────────────────────────────────────────────────────────────

const routeToNextOnboardingStep = async (
  updatedClient: any,
  sendMessage: (text: string) => Promise<void>
) => {
  const name = updatedClient.full_name || 'there';
  const isApproved = updatedClient.account_status === 'APPROVED';

  if (!updatedClient.date_of_birth) {
    await updateClient(updatedClient.id, { bot_status: 'REGISTERING_DOB' });
    await sendMessage(
      `*(2/5)* What is your *Date of Birth*?\n_DD-MM-YYYY (e.g., 15-08-1995)_\n\n_Type *back* to go to previous step._`
    );
  } else if (!updatedClient.email) {
    await updateClient(updatedClient.id, { bot_status: 'REGISTERING_EMAIL' });
    await sendMessage(
      `*(3/5)* What is your *Email Address*?\n_e.g., name@gmail.com_\n\n_Type *back* to go to previous step._`
    );
  } else if (!updatedClient.pan_media_url) {
    await updateClient(updatedClient.id, { bot_status: 'REGISTERING_PAN' });
    await sendMessage(
      `*(4/5)* Upload your *PAN Card* 📎\n_Photo or PDF_\n\n_Type *back* to go to previous step._`
    );
  } else if (!updatedClient.aadhaar_media_url) {
    await updateClient(updatedClient.id, { bot_status: 'REGISTERING_AADHAAR' });
    await sendMessage(
      `*(5/5)* Upload your *Aadhaar Card* 📎\n_Photo or PDF_\n\n_Type *back* to go to previous step._`
    );
  } else {
    await updateClient(updatedClient.id, {
      bot_status: isApproved ? 'REGISTERED' : 'PENDING_APPROVAL'
    });

    if (isApproved) {
      const { fy, ay } = getFinancialAndAssessmentYear();
      const filing = await getFiling(updatedClient.id, fy);
      if (filing && filing.status !== 'SERVICE_MENU' && filing.status !== 'COMPLETED') {
        await sendMessage(`👋 Welcome back, *${name}*! Resuming your ITR filing for *FY ${fy}*:`);
        await handleItrFlow(updatedClient, filing, '', false, null, fy, ay, name, sendMessage);
      } else {
        await sendMessage(
          `🎉 *Registration Complete!*\n\n` +
          `👋 Hi *${name}*! What service do you need?\n\n` +
          `*1* — 📊 ITR Filing for FY ${fy}\n` +
          `*2* — 🔑 DSC Application\n\n` +
          `Reply with the service number (1 or 2).`
        );
      }
    } else {
      await sendMessage(
        `🎉 *Registration Complete, ${name}!*\n\n` +
        `• PAN: ✅  |  Aadhaar: ✅\n\n` +
        `Your account is under review. We'll notify you once approved (1–2 business days).\n_Queries? ${SUPPORT_PHONE}_`
      );
    }
  }
};

const handleRegistration = async (
  client: any,
  isNewClient: boolean,
  incomingMessage: string,
  isMedia: boolean,
  mediaUrl: string | null,
  sendMessage: (text: string) => Promise<void>,
  rawMessage?: any
) => {
  const status: ClientBotStatus = client.bot_status || 'REGISTERING_NAME';

  switch (status) {

    // ── STEP 1: Collect Full Name ─────────────────────────────────
    case 'REGISTERING_NAME': {
      const greetings = ['hi', 'hello', 'hey', 'start', 'menu', 'yo', 'hii', 'hiii', 'namaste', 'help'];
      const lowerInput = incomingMessage.toLowerCase().trim();

      if (!incomingMessage || incomingMessage.length < 2 || isMedia || greetings.includes(lowerInput)) {
        await sendMessage(
          `🙏 *Welcome to ${COMPANY_NAME}!*\n_${COMPANY_TAGLINE}_\n\n` +
          `Let's set up your account (~2 min).\n\nPlease reply with your *Full Name* (as on PAN Card) 👇`
        );
        return;
      }

      const formattedName = incomingMessage
        .split(' ').filter(Boolean)
        .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
        .join(' ');

      await updateClient(client.id, { full_name: formattedName, bot_status: 'REGISTERING_PHONE' });

      await sendMessage(
        `Hi *${formattedName}*! 😊\n\n` +
        `*(1/5)* Reply with your *10-digit mobile number*\n_e.g., 9876543210_`
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

      // Extract the sender's actual phone number using resolvePhoneNumber helper
      const senderNumber = resolvePhoneNumber(client.whatsapp_jid, rawMessage) || '';

      if (fullNumber !== senderNumber) {
        await sendMessage(
          `⚠️ *Verification Failed*\n\nPlease enter the number linked to *this* WhatsApp account.`
        );
        return;
      }

      // Check if a client with this phone number already exists
      const { data: existingClient } = await supabase!
        .from('clients')
        .select('*')
        .eq('phone_number', fullNumber)
        .maybeSingle();

      if (existingClient) {
        console.log(`[Identity Link] Merging temporary registration JID "${client.whatsapp_jid}" into existing client ID "${existingClient.id}"`);

        // 1. Delete the temporary client record first to release the unique whatsapp_jid constraint
        const { error: delErr } = await supabase!
          .from('clients')
          .delete()
          .eq('id', client.id);

        if (delErr) {
          console.error('[Identity Link] Error deleting temporary registration client:', delErr);
        }

        // 2. Update existing client to link their active WhatsApp JID (which is now free!)
        const { error: linkErr } = await supabase!
          .from('clients')
          .update({
            whatsapp_jid: client.whatsapp_jid,
            full_name: existingClient.full_name || client.full_name || 'Anonymous'
          })
          .eq('id', existingClient.id);

        if (linkErr) {
          console.error('[Identity Link] Error linking JID to existing client:', linkErr);
          await sendMessage('⚠️ There was an error matching your number. Please try again.');
          return;
        }

        // 3. Continue onboarding session with the linked pre-existing client record
        console.log(`[Identity Link] Linked client routing to next onboarding step...`);
        await sendMessage(`✅ Verified! Welcome back, *${existingClient.full_name || client.full_name}*! 😊`);
        await routeToNextOnboardingStep(existingClient, sendMessage);
        return;
      }

      // If they are not already registered, perform the regular signup flow:
      const { data: updated, error } = await updateClient(client.id, { phone_number: fullNumber });

      if (error?.code === '23505') {
        await sendMessage(`⚠️ This phone number is already registered. Please provide a different number or contact ${SUPPORT_PHONE}.`);
        return;
      }
      if (!updated?.phone_number) {
        await sendMessage('⚠️ Error saving your number. Please try again.');
        return;
      }

      console.log(`✅ Phone "${fullNumber}" saved for client ${client.id}`);
      await sendMessage(`✅ Mobile number saved!`);
      await routeToNextOnboardingStep(updated, sendMessage);
      break;
    }

    // ── STEP 3: Collect Date of Birth ─────────────────────────────
    case 'REGISTERING_DOB': {
      if (isMedia || !incomingMessage) {
        await sendMessage('⚠️ Please enter your Date of Birth in *DD-MM-YYYY* format.');
        return;
      }

      // Normalize separators: accept -, /, ., or space
      const normalized = incomingMessage.trim().replace(/[\/\.\s]+/g, '-');
      const dateParts = normalized.split('-');

      if (dateParts.length !== 3) {
        await sendMessage('⚠️ Invalid format. Please reply in *DD-MM-YYYY* format (e.g., 15-08-1995 or 15/08/1995).');
        return;
      }

      // Zero-pad single-digit day/month (e.g. 5-8-1995 → 05-08-1995)
      const dd = dateParts[0].padStart(2, '0');
      const mm = dateParts[1].padStart(2, '0');
      const yyyy = dateParts[2];

      if (!/^\d{2}$/.test(dd) || !/^\d{2}$/.test(mm) || !/^\d{4}$/.test(yyyy)) {
        await sendMessage('⚠️ Invalid format. Please reply in *DD-MM-YYYY* format (e.g., 15-08-1995 or 15/08/1995).');
        return;
      }

      const d = parseInt(dd), mo = parseInt(mm), yr = parseInt(yyyy);
      const dateObj = new Date(yr, mo - 1, d);

      if (
        dateObj.getFullYear() !== yr || dateObj.getMonth() !== mo - 1 || dateObj.getDate() !== d ||
        yr < 1900 || yr > new Date().getFullYear()
      ) {
        await sendMessage("⚠️ That doesn't look like a valid date. Please use *DD-MM-YYYY* format.");
        return;
      }

      const { data: updated } = await updateClient(client.id, { date_of_birth: `${yyyy}-${mm}-${dd}` });
      if (!updated) {
        await sendMessage('⚠️ Error saving your Date of Birth. Please try again.');
        return;
      }
      await sendMessage(`✅ Date of birth saved!`);
      await routeToNextOnboardingStep(updated, sendMessage);
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

      const { data: updated } = await updateClient(client.id, { email: incomingMessage.toLowerCase() });
      if (!updated) {
        await sendMessage('⚠️ Error saving your Email Address. Please try again.');
        return;
      }
      await sendMessage(`✅ Email saved!`);
      await routeToNextOnboardingStep(updated, sendMessage);
      break;
    }

    // ── STEP 5a: Collect PAN Card ─────────────────────────────────
    case 'REGISTERING_PAN': {
      if (mediaUrl) {
        const { data: updated } = await updateClient(client.id, { pan_media_url: mediaUrl });
        if (!updated) {
          await sendMessage('⚠️ Error saving your PAN Card. Please try again.');
          return;
        }
        await sendMessage(`✅ *PAN Card received!*`);
        await routeToNextOnboardingStep(updated, sendMessage);
      } else {
        await sendMessage(`⚠️ Upload your *PAN Card* as an image or PDF 📎`);
      }
      break;
    }

    // ── STEP 5b: Collect Aadhaar Card ─────────────────────────────
    case 'REGISTERING_AADHAAR': {
      if (mediaUrl) {
        const { data: updated } = await updateClient(client.id, { aadhaar_media_url: mediaUrl });
        if (!updated) {
          await sendMessage('⚠️ Error saving your Aadhaar Card. Please try again.');
          return;
        }
        await sendMessage(`✅ *Aadhaar Card received!*`);
        await routeToNextOnboardingStep(updated, sendMessage);
      } else {
        await sendMessage(`⚠️ Upload your *Aadhaar Card* as an image or PDF 📎`);
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
        const currentServices = client.services || [];
        if (!currentServices.includes('ITR')) {
          const newServices = [...currentServices, 'ITR'];
          await updateClient(client.id, { services: newServices });
          client.services = newServices;
        }
        
        // Determine where to resume based on existing fields
        let nextStatus: ItrStatus = 'AWAITING_BANK_NAME';
        if (!filing.bank_name) {
          nextStatus = 'AWAITING_BANK_NAME';
        } else if (!filing.bank_account_number) {
          nextStatus = 'AWAITING_BANK_ACC';
        } else if (!filing.bank_ifsc) {
          nextStatus = 'AWAITING_BANK_IFSC';
        } else if (!filing.income_source) {
          nextStatus = 'AWAITING_INCOME_SOURCE';
        } else {
          if (filing.income_source === 'SALARIED') {
            nextStatus = filing.form16_media_url ? 'AWAITING_PROPERTY_SALE_DECISION' : 'AWAITING_FORM16';
          } else if (filing.income_source === 'BUSINESS') {
            nextStatus = filing.bank_statement_media_url ? 'AWAITING_PROPERTY_SALE_DECISION' : 'AWAITING_BANK_STATEMENT';
          } else {
            nextStatus = 'AWAITING_INCOME_SOURCE';
          }
        }

        const updated = await updateFiling(filing.id, { status: nextStatus });
        if (nextStatus === 'AWAITING_BANK_NAME') {
          await sendMessage(
            `📊 *ITR Filing — FY ${fy} (AY ${ay})*\n\n` +
            `What is the *Name of your Bank*?\n_e.g., HDFC Bank, SBI, ICICI_\n\n_Type *back* to go to previous step._`
          );
        } else {
          await sendMessage(`👋 Welcome back, *${client.full_name || 'there'}*! Resuming your ITR filing for *FY ${fy}*:`);
          if (updated) {
            await handleItrFlow(client, updated, '', false, null, fy, ay, client.full_name || 'there', sendMessage);
          }
        }
      } else if (choice === '2' || choice.toLowerCase().includes('dsc')) {
        if (!client.company_id) {
          await sendMessage('⚠️ Account configuration issue (missing Company ID). Please contact support.');
          return;
        }
        const currentServices = client.services || [];
        if (!currentServices.includes('DSC')) {
          const newServices = [...currentServices, 'DSC'];
          await updateClient(client.id, { services: newServices });
          client.services = newServices;
        }
        let dsc = await getDscApplication(client.id);
        if (!dsc) {
          dsc = await createDscApplication(client.id, client.company_id);
        }
        if (!dsc) {
          await sendMessage('⚠️ Failed to start DSC Application. Please try again.');
          return;
        }
        
        if (dsc.status === 'COMPLETED') {
          let expiryInfo = '';
          if (dsc.expiry_date) {
            expiryInfo = `\n📅 *Expiry Date:* ${dsc.expiry_date}`;
          }
          const typeStr = dsc.user_type === 'INDIVIDUAL' ? 'Individual' : 'Organization';
          await sendMessage(
            `✅ *Your DSC is Active*\n\n` +
            `• Type: *${typeStr}*\n` +
            `• Status: *Active / Completed*` +
            `${expiryInfo}\n\n` +
            `If you need to renew your DSC or make any changes, please contact our team.`
          );
        } else if (dsc.user_type) {
          const typeStr = dsc.user_type === 'INDIVIDUAL' ? 'Individual' : 'Organization';
          await sendMessage(
            `🔑 *DSC Application — ${typeStr}*\n\n` +
            `Your request is registered.\n\n` +
            `To complete the process, please record your *Video verification* using the link sent by our team.\n\n` +
            `_We will notify you once it's done!_`
          );
        } else {
          await updateDscApplication(dsc.id, { status: 'AWAITING_TYPE' });
          await sendMessage(
            `🔑 *DSC Application Type*\n\n` +
            `Please select the type of DSC:\n` +
            `*1* — Individual\n` +
            `*2* — Organization\n\n` +
            `Reply *1* or *2* to select.\n\n` +
            `_Type *back* to return to the Main Menu._`
          );
        }
      } else {
        await sendMessage(
          `👋 Hi *${client.full_name}*! What service do you need?\n\n` +
          `*1* — 📊 ITR Filing for FY ${fy}\n` +
          `*2* — 🔑 DSC Application\n\n` +
          `Reply with the service number (1 or 2).`
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
      const bankName = incomingMessage.trim();
      if (filing.bank_account_number && filing.bank_ifsc) {
        await updateFiling(filing.id, { bank_name: bankName, status: 'AWAITING_BANK_CONFIRMATION' });
        await sendMessage(
          `🏦 *Verify Bank Details:*\n\n` +
          `• Bank: *${bankName}*\n` +
          `• Account: *${filing.bank_account_number}*\n` +
          `• IFSC: *${filing.bank_ifsc}*\n\n` +
          `Is this correct?\n` +
          `*1* — Yes, proceed\n` +
          `*2* — Edit Bank Name\n` +
          `*3* — Edit Account Number\n` +
          `*4* — Edit IFSC Code\n\n` +
          `_Type *back* to go to previous step._`
        );
      } else {
        await updateFiling(filing.id, { bank_name: bankName, status: 'AWAITING_BANK_ACC' });
        await sendMessage(`✅ Bank: *${bankName}*\n\nNow enter your *Bank Account Number*\n\n_Type *back* to go to previous step._`);
      }
      break;
    }

    // ── COLLECT BANK ACCOUNT NUMBER ────────────────────────────────
    case 'AWAITING_BANK_ACC': {
      if (isMedia || !incomingMessage) {
        if (!incomingMessage) {
          await sendMessage(`🏦 *ITR Filing — Bank Details*\n\nPlease enter your *Bank Account Number*\n\n_Type *back* to go to previous step._`);
        } else {
          await sendMessage('⚠️ Please enter your *Bank Account Number* (digits only, 6–18 digits).');
        }
        return;
      }
      const acc = incomingMessage.replace(/\s/g, '');
      if (!/^\d{6,18}$/.test(acc)) {
        await sendMessage('⚠️ Account number must be digits only, 6–18 digits long. Please try again.');
        return;
      }
      if (filing.bank_name && filing.bank_ifsc) {
        await updateFiling(filing.id, { bank_account_number: acc, status: 'AWAITING_BANK_CONFIRMATION' });
        await sendMessage(
          `🏦 *Verify Bank Details:*\n\n` +
          `• Bank: *${filing.bank_name}*\n` +
          `• Account: *${acc}*\n` +
          `• IFSC: *${filing.bank_ifsc}*\n\n` +
          `Is this correct?\n` +
          `*1* — Yes, proceed\n` +
          `*2* — Edit Bank Name\n` +
          `*3* — Edit Account Number\n` +
          `*4* — Edit IFSC Code\n\n` +
          `_Type *back* to go to previous step._`
        );
      } else {
        await updateFiling(filing.id, { bank_account_number: acc, status: 'AWAITING_BANK_IFSC' });
        await sendMessage(`✅ Account saved!\n\nEnter your bank's *IFSC Code*\n_e.g., HDFC0001234_\n\n_Type *back* to go to previous step._`);
      }
      break;
    }

    // ── COLLECT IFSC CODE ──────────────────────────────────────────
    case 'AWAITING_BANK_IFSC': {
      if (isMedia || !incomingMessage) {
        if (!incomingMessage) {
          await sendMessage(`🏦 *ITR Filing — Bank Details*\n\nEnter your bank's *IFSC Code*\n_e.g., HDFC0001234_\n\n_Type *back* to go to previous step._`);
        } else {
          await sendMessage('⚠️ Please enter a valid *IFSC Code* (e.g., HDFC0001234).');
        }
        return;
      }
      const ifsc = incomingMessage.trim().toUpperCase();
      if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifsc)) {
        await sendMessage('⚠️ Invalid IFSC. It should be 11 characters: 4 letters + 0 + 6 alphanumeric (e.g., HDFC0001234). Try again.');
        return;
      }
      await updateFiling(filing.id, { bank_ifsc: ifsc, status: 'AWAITING_BANK_CONFIRMATION' });
      await sendMessage(
        `🏦 *Verify Bank Details:*\n\n` +
        `• Bank: *${filing.bank_name}*\n` +
        `• Account: *${filing.bank_account_number}*\n` +
        `• IFSC: *${ifsc}*\n\n` +
        `Is this correct?\n` +
        `*1* — Yes, proceed\n` +
        `*2* — Edit Bank Name\n` +
        `*3* — Edit Account Number\n` +
        `*4* — Edit IFSC Code\n\n` +
        `_Type *back* to go to previous step._`
      );
      break;
    }

    // ── VERIFY BANK DETAILS ─────────────────────────────────────────
    case 'AWAITING_BANK_CONFIRMATION': {
      const choice = incomingMessage.trim();
      if (choice === '1') {
        await updateFiling(filing.id, { status: 'AWAITING_INCOME_SOURCE' });
        await sendMessage(
          `*Select your income source:*\n\n` +
          `*1* — 👔 Salaried\n` +
          `*2* — 💼 Business / Freelancer\n\n` +
          `_Type *back* to go to previous step._`
        );
      } else if (choice === '2') {
        await updateFiling(filing.id, { bank_name: null, status: 'AWAITING_BANK_NAME' });
        await sendMessage(`What is the *Name of your Bank*?\n_e.g., HDFC Bank, SBI, ICICI_\n\n_Type *back* to go to previous step._`);
      } else if (choice === '3') {
        await updateFiling(filing.id, { bank_account_number: null, status: 'AWAITING_BANK_ACC' });
        await sendMessage(`Now enter your *Bank Account Number*\n\n_Type *back* to go to previous step._`);
      } else if (choice === '4') {
        await updateFiling(filing.id, { bank_ifsc: null, status: 'AWAITING_BANK_IFSC' });
        await sendMessage(`Enter your bank's *IFSC Code*\n_e.g., HDFC0001234_\n\n_Type *back* to go to previous step._`);
      } else {
        await sendMessage(
          `🏦 *Verify Bank Details:*\n\n` +
          `• Bank: *${filing.bank_name || 'N/A'}*\n` +
          `• Account: *${filing.bank_account_number || 'N/A'}*\n` +
          `• IFSC: *${filing.bank_ifsc || 'N/A'}*\n\n` +
          `Is this correct?\n` +
          `*1* — Yes, proceed\n` +
          `*2* — Edit Bank Name\n` +
          `*3* — Edit Account Number\n` +
          `*4* — Edit IFSC Code\n\n` +
          `_Type *back* to go to previous step._`
        );
      }
      break;
    }

    // ── SELECT INCOME SOURCE ────────────────────────────────────────
    case 'AWAITING_INCOME_SOURCE': {
      const choice = incomingMessage.trim();
      if (!choice) {
        await sendMessage(
          `*Select your income source:*\n\n` +
          `*1* — 👔 Salaried\n` +
          `*2* — 💼 Business / Freelancer\n\n` +
          `_Type *back* to go to previous step._`
        );
        break;
      }
      if (choice === '1') {
        await updateFiling(filing.id, { income_source: 'SALARIED', status: 'AWAITING_FORM16' });
        await sendMessage(`👔 Upload your *Form 16* 📎\n_PDF or photo._\n\n_Type *back* to go to previous step._`);
      } else if (choice === '2') {
        await updateFiling(filing.id, { income_source: 'BUSINESS', status: 'AWAITING_BANK_STATEMENT' });
        await sendMessage(`💼 Upload your *Bank Statement* for FY ${fy} 📎\n_PDF or photo. Upload more or reply *DONE* when finished._\n\n_Type *back* to go to previous step._`);
      } else {
        await sendMessage(
          `⚠️ Reply 1 or 2:\n\n` +
          `*1* — Salaried\n*2* — Business\n\n_Type *back* to go to previous step._`
        );
      }
      break;
    }

    // ── COLLECT FORM 16 (single upload) ───────────────────────────
    case 'AWAITING_FORM16': {
      if (mediaUrl) {
        await updateFiling(filing.id, { form16_media_url: mediaUrl, status: 'AWAITING_PROPERTY_SALE_DECISION' });
        await sendMessage(
          `✅ Form 16 received!\n\n` +
          `Any *property bought/sold* this year?\n\n` +
          `*1* — Yes\n` +
          `*2* — No`
        );
      } else if (!incomingMessage) {
        await sendMessage(`👔 Upload your *Form 16* 📎\n_PDF or photo._\n\n_Type *back* to go to previous step._`);
      } else {
        await sendMessage(`⚠️ Please upload your Form 16 file (PDF or photo) to proceed.`);
      }
      break;
    }

    // ── COLLECT BANK STATEMENT (multi-upload loop) ──────────────────
    case 'AWAITING_BANK_STATEMENT': {
      if (mediaUrl) {
        const existing = filing.bank_statement_media_url;
        const newUrls = existing ? `${existing},${mediaUrl}` : mediaUrl;
        await updateFiling(filing.id, { bank_statement_media_url: newUrls });
        await sendMessage(
          `✅ Bank Statement received!\n\nUpload more statements or reply *DONE* to continue.`
        );
      } else if (incomingMessage.trim().toUpperCase() === 'DONE') {
        if (!filing.bank_statement_media_url) {
          await sendMessage(`⚠️ Please upload at least one Bank Statement file before proceeding.`);
          return;
        }
        await updateFiling(filing.id, { status: 'AWAITING_PROPERTY_SALE_DECISION' });
        await sendMessage(`Any *property bought/sold* this year?\n\n*1* — Yes\n*2* — No`);
      } else if (!incomingMessage) {
        await sendMessage(`💼 Upload your *Bank Statement* for FY ${fy} 📎\n_PDF or photo. Upload more or reply *DONE* when finished._\n\n_Type *back* to go to previous step._`);
      } else {
        await sendMessage(`⚠️ Upload your Bank Statement or reply *DONE*.`);
      }
      break;
    }

    // ── COLLECT CAPITAL GAINS (multi-upload loop) ───────────────────
    case 'AWAITING_CAPITAL_GAINS': {
      if (mediaUrl) {
        const existing = filing.capital_gains_media_url;
        const newUrls = existing ? `${existing},${mediaUrl}` : mediaUrl;
        await updateFiling(filing.id, { capital_gains_media_url: newUrls });
        await sendMessage(
          `✅ Capital Gains received!\n\nUpload more or reply *DONE* to continue.`
        );
      } else if (incomingMessage.trim().toUpperCase() === 'DONE') {
        if (!filing.capital_gains_media_url) {
          await sendMessage(`⚠️ Please upload at least one Capital Gains Statement before proceeding.`);
          return;
        }
        await updateFiling(filing.id, { status: 'AWAITING_PROPERTY_SALE_DECISION' });
        await sendMessage(`Any *property bought/sold* this year?\n\n*1* — Yes\n*2* — No`);
      } else if (!incomingMessage) {
        await sendMessage(`📈 Upload your *Capital Gains Statement* 📎\n_Upload more or reply *DONE* when finished._\n\n_Type *back* to go to previous step._`);
      } else {
        await sendMessage(`⚠️ Upload your Capital Gains Statement or reply *DONE*.`);
      }
      break;
    }

    // ── COLLECT PROPERTY DOCUMENTS (multi-upload loop) ───────────
    case 'AWAITING_PROPERTY_DOCS': {
      if (mediaUrl) {
        const existing = filing.property_docs_media_url;
        const newUrls = existing ? `${existing},${mediaUrl}` : mediaUrl;
        await updateFiling(filing.id, { property_docs_media_url: newUrls });
        await sendMessage(
          `✅ Property doc received!\n\nUpload more or reply *DONE* to continue.`
        );
      } else if (incomingMessage.trim().toUpperCase() === 'DONE') {
        if (!filing.property_docs_media_url) {
          await sendMessage(`⚠️ Please upload at least one property document before proceeding.`);
          return;
        }
        await updateFiling(filing.id, { status: 'AWAITING_OTHER_DOCS_DECISION' });
        await sendMessage(`Any *other tax documents* to share?\n\n*1* — Yes\n*2* — No, I'm done`);
      } else if (!incomingMessage) {
        await sendMessage(`🏠 Upload your *Property Sale/Purchase Deeds* 📎\n_Upload more or reply *DONE* when finished._\n\n_Type *back* to go to previous step._`);
      } else {
        await sendMessage(`⚠️ Upload your property docs or reply *DONE*.`);
      }
      break;
    }

    // ── PROPERTY DECISION ──────────────────────────────────────────
    case 'AWAITING_PROPERTY_SALE_DECISION': {
      const choice = incomingMessage.trim();
      if (choice === '1') {
        await updateFiling(filing.id, { status: 'AWAITING_PROPERTY_DOCS' });
        await sendMessage(`🏠 Upload your *Property Sale/Purchase Deeds* 📎\n_Upload more or reply *DONE* when finished._`);
      } else if (choice === '2') {
        await updateFiling(filing.id, { status: 'AWAITING_OTHER_DOCS_DECISION' });
        await sendMessage(`Any *other tax documents* to share?\n\n*1* — Yes\n*2* — No, I'm done`);
      } else if (!incomingMessage) {
        await sendMessage(
          `🏠 Any *property bought/sold* this year?\n\n` +
          `*1* — Yes\n` +
          `*2* — No\n\n` +
          `_Type *back* to go to previous step._`
        );
      } else {
        await sendMessage(`⚠️ Reply *1* (Yes) or *2* (No).`);
      }
      break;
    }

    // ── OTHER DOCUMENTS DECISION ────────────────────────────────────
    case 'AWAITING_OTHER_DOCS_DECISION': {
      const choice = incomingMessage.trim();
      if (choice === '1') {
        await updateFiling(filing.id, { status: 'AWAITING_OTHER_DOCS' });
        await sendMessage(`📎 Upload your other tax docs. Send more or reply *DONE* when finished.`);
      } else if (choice === '2') {
        await updateFiling(filing.id, { status: 'COMPLETED' });
        await sendMessage(
          `🎉 *All done!* Your ITR filing for *FY ${filing.fy_year}* has been submitted.\n\n` +
          `Our CA team will review and get back to you. Thank you! 🙏`
        );
      } else if (!incomingMessage) {
        await sendMessage(
          `📎 Any *other tax documents* to share?\n\n` +
          `*1* — Yes\n` +
          `*2* — No, I'm done\n\n` +
          `_Type *back* to go to previous step._`
        );
      } else {
        await sendMessage(`⚠️ Reply *1* (Yes) or *2* (No, I'm done).`);
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
          `✅ Doc received!\n\nUpload more or reply *DONE* to submit.`
        );
      } else if (incomingMessage.trim().toUpperCase() === 'DONE') {
        await updateFiling(filing.id, { status: 'COMPLETED' });
        await sendMessage(
          `🎉 *All done!* Your ITR filing for *FY ${filing.fy_year}* has been submitted.\n\n` +
          `Our CA team will review and get back to you. Thank you! 🙏`
        );
      } else if (!incomingMessage) {
        await sendMessage(`📎 Upload your other tax docs. Send more or reply *DONE* when finished.\n\n_Type *back* to go to previous step._`);
      } else {
        await sendMessage(`⚠️ Upload a document or reply *DONE* to submit.`);
      }
      break;
    }

    // ── COMPLETED ──────────────────────────────────────────────────
    case 'COMPLETED': {
      if (filing.filing_status === 'FILED') {
        await sendMessage(
          `🎉 Your ITR for *FY ${filing.fy_year}* has been filed! ✅\n\n` +
          `Your ITR-V receipt was shared above. For queries, contact ${SUPPORT_PHONE}.`
        );
      } else if (filing.filing_status === 'DOCS_VERIFIED') {
        await sendMessage(
          `📑 Your docs for *FY ${filing.fy_year}* are verified!\n\n` +
          `CA team is preparing your return. We'll notify you once filed.\n_Queries? ${SUPPORT_PHONE}_`
        );
      } else {
        await sendMessage(
          `📊 Your ITR docs for *FY ${filing.fy_year}* are under review.\n_Queries? ${SUPPORT_PHONE}_`
        );
      }
      break;
    }

    default:
      await sendMessage('An unexpected error occurred. Please type *hi* to restart, or contact our support.');
  }
};

// ─────────────────────────────────────────────────────────────────
// DSC CONVERSATIONAL FLOW HANDLER
// ─────────────────────────────────────────────────────────────────

const handleDscFlow = async (
  client: any,
  dsc: any,
  incomingMessage: string,
  sendMessage: (text: string) => Promise<void>
) => {
  const dscId = dsc.id;

  switch (dsc.status) {
    case 'AWAITING_TYPE': {
      const choice = incomingMessage.trim();
      if (choice === '1' || choice.toLowerCase().includes('individual')) {
        await updateDscApplication(dscId, { user_type: 'INDIVIDUAL', status: 'AWAITING_VIDEO_VERIFICATION' });
        await sendMessage(
          `🔑 *DSC Application — Individual*\n\n` +
          `Your request has been registered.\n\n` +
          `To complete the process, please record your *Video verification* using the link sent by our team.\n\n` +
          `_We will notify you once it's done!_`
        );
      } else if (choice === '2' || choice.toLowerCase().includes('org') || choice.toLowerCase().includes('company')) {
        await updateDscApplication(dscId, { user_type: 'ORGANIZATION', status: 'AWAITING_VIDEO_VERIFICATION' });
        await sendMessage(
          `🔑 *DSC Application — Organization*\n\n` +
          `Your request has been registered.\n\n` +
          `To complete the process, please record your *Video verification* using the link sent by our team.\n\n` +
          `_We will notify you once it's done!_`
        );
      } else {
        await sendMessage(
          `🔑 *DSC Application Type*\n\n` +
          `Please select the type of DSC:\n` +
          `*1* — Individual\n` +
          `*2* — Organization\n\n` +
          `Reply *1* or *2* to select.\n\n` +
          `_Type *back* to return to the Main Menu._`
        );
      }
      break;
    }

    case 'AWAITING_VIDEO_VERIFICATION': {
      await sendMessage(
        `⏳ *Awaiting DSC Video Verification*\n\n` +
        `Please complete the Video KYC using the partner verification link sent to you.\n\n` +
        `If you haven't received the link yet, our CA team will message it to you shortly.\n\n` +
        `_Type *back* to edit DSC type._`
      );
      break;
    }

    case 'COMPLETED': {
      await sendMessage(
        `✅ *DSC Completed*\n\n` +
        `Your Digital Signature Certificate is ready and stored safely in our office.\n\n` +
        `If you need any changes, please contact us.`
      );
      break;
    }
  }
};
