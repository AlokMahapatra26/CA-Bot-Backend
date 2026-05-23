import { createClient } from '@supabase/supabase-js';
import { config } from '../config/env';

const supabaseUrl = config.SUPABASE_URL;
const supabaseKey = config.SUPABASE_KEY;

export const supabase = supabaseUrl && supabaseKey
  ? createClient(supabaseUrl, supabaseKey)
  : null;

// ─────────────────────────────────────────────────────────────────
// STATUS TYPES
// ─────────────────────────────────────────────────────────────────

/**
 * Bot conversation state stored on clients.bot_status.
 *
 * REGISTRATION PHASE (one-time per new user):
 *   REGISTERING_NAME → REGISTERING_PHONE → REGISTERING_DOB
 *   → REGISTERING_EMAIL → REGISTERING_PAN → REGISTERING_AADHAAR
 *   → PENDING_APPROVAL  (CA team must approve from dashboard)
 *   → REGISTERED        (set by CA when they approve)
 *
 * After REGISTERED: service menu and ITR flow begin.
 */
export type ClientBotStatus =
  | 'REGISTERING_NAME'
  | 'REGISTERING_PHONE'
  | 'REGISTERING_DOB'
  | 'REGISTERING_EMAIL'
  | 'REGISTERING_PAN'
  | 'REGISTERING_AADHAAR'
  | 'PENDING_APPROVAL'
  | 'REGISTERED';

/**
 * Account approval status — set by CA team from the dashboard.
 *   PENDING  → awaiting CA review
 *   APPROVED → can use services
 *   REJECTED → account rejected, user notified
 */
export type AccountStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

/**
 * ITR filing status — tracks progress within the ITR service.
 */
export type ItrStatus =
  | 'SERVICE_MENU'
  | 'AWAITING_BANK_NAME'
  | 'AWAITING_BANK_ACC'
  | 'AWAITING_BANK_IFSC'
  | 'AWAITING_INCOME_SOURCE'
  | 'AWAITING_FORM16'
  | 'AWAITING_BANK_STATEMENT'
  | 'AWAITING_CAPITAL_GAINS'
  | 'AWAITING_PROPERTY_SALE_DECISION'
  | 'AWAITING_PROPERTY_DOCS'
  | 'AWAITING_OTHER_DOCS_DECISION'
  | 'AWAITING_OTHER_DOCS'
  | 'COMPLETED';

// ─────────────────────────────────────────────────────────────────
// INTERFACES
// ─────────────────────────────────────────────────────────────────

export interface Client {
  id: string;
  phone_number: string | null;
  whatsapp_jid: string | null;
  full_name: string | null;
  date_of_birth: string | null;
  email: string | null;
  pan_media_url: string | null;
  aadhaar_media_url: string | null;
  bot_status: ClientBotStatus | null;
  account_status: AccountStatus | null;
  created_at: string;
  updated_at: string;
}

export interface ItrFiling {
  id: string;
  client_id: string;
  fy_year: string;
  status: ItrStatus;
  bank_name: string | null;
  bank_account_number: string | null;
  bank_ifsc: string | null;
  income_source: string | null; // 'SALARIED' | 'BUSINESS' | 'INVESTOR' | 'PROPERTY'
  form16_media_url: string | null;
  bank_statement_media_url: string | null;
  capital_gains_media_url: string | null;
  property_docs_media_url: string | null;
  other_docs_media_url: string | null;
  notes: string | null;
  filing_status: string;
  created_at: string;
  updated_at: string;
}

// ─────────────────────────────────────────────────────────────────
// CLIENT OPERATIONS
// ─────────────────────────────────────────────────────────────────

export const getClient = async (senderJid: string): Promise<Client | null> => {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from('clients')
    .select('*')
    .eq('whatsapp_jid', senderJid)
    .maybeSingle();
  if (error) console.error('Error fetching client:', error);
  return data ?? null;
};

export const createClientRecord = async (senderJid: string): Promise<Client | null> => {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from('clients')
    .insert([{
      whatsapp_jid: senderJid,
      phone_number: null,
      bot_status: 'REGISTERING_NAME',
      account_status: 'PENDING',
    }])
    .select()
    .single();
  if (error) console.error('Error creating client:', error);
  return data;
};

export const updateClient = async (clientId: string, updates: Partial<Client>): Promise<{ data: Client | null; error: any }> => {
  if (!supabase) return { data: null, error: new Error('Supabase client not initialized') };
  const { data, error } = await supabase
    .from('clients')
    .update(updates)
    .eq('id', clientId)
    .select()
    .single();
  if (error) console.error('Error updating client:', error);
  return { data, error };
};

// ─────────────────────────────────────────────────────────────────
// ITR FILING OPERATIONS
// ─────────────────────────────────────────────────────────────────

export const getFiling = async (clientId: string, fyYear: string): Promise<ItrFiling | null> => {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from('itr_filings')
    .select('*')
    .eq('client_id', clientId)
    .eq('fy_year', fyYear)
    .maybeSingle();
  if (error) console.error('Error fetching filing:', error);
  return data;
};

export const createFiling = async (clientId: string, fyYear: string): Promise<ItrFiling | null> => {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from('itr_filings')
    .insert([{ client_id: clientId, fy_year: fyYear, status: 'SERVICE_MENU' }])
    .select()
    .single();
  if (error) console.error('Error creating filing:', error);
  return data;
};

export const updateFiling = async (filingId: string, updates: Partial<ItrFiling>): Promise<ItrFiling | null> => {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from('itr_filings')
    .update(updates)
    .eq('id', filingId)
    .select()
    .single();
  if (error) console.error('Error updating filing:', error);
  return data;
};

// ─────────────────────────────────────────────────────────────────
// DOCUMENT UPLOAD
// ─────────────────────────────────────────────────────────────────

export const uploadDocument = async (
  storageKey: string,
  buffer: Buffer,
  mimetype: string,
  extension: string
): Promise<string | null> => {
  if (!supabase) return null;
  try {
    const timestamp = Date.now();
    const folderName = storageKey.replace(/[@.]/g, '_');
    const filePath = `${folderName}/${timestamp}.${extension}`;
    const { error } = await supabase.storage
      .from('itr-documents')
      .upload(filePath, buffer, { contentType: mimetype, upsert: true });
    if (error) {
      console.error('Error uploading document:', error);
      return null;
    }
    const { data: publicUrlData } = supabase.storage
      .from('itr-documents')
      .getPublicUrl(filePath);
    return publicUrlData.publicUrl;
  } catch (error) {
    console.error('Exception during document upload:', error);
    return null;
  }
};
