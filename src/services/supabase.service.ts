import { createClient } from '@supabase/supabase-js';
import { config } from '../config/env';

// Initialize the Supabase client
const supabaseUrl = config.SUPABASE_URL;
const supabaseKey = config.SUPABASE_KEY;

export const supabase = supabaseUrl && supabaseKey 
  ? createClient(supabaseUrl, supabaseKey) 
  : null;

export type ItrStatus = 
  | 'AWAITING_NAME' 
  | 'AWAITING_PHONE'    // Only triggered for LID (privacy-protected) users
  | 'AWAITING_DOB' 
  | 'AWAITING_EMAIL' 
  | 'AWAITING_BANK_NAME'
  | 'AWAITING_BANK_ACC'
  | 'AWAITING_BANK_IFSC'
  | 'AWAITING_PAN' 
  | 'AWAITING_AADHAAR' 
  | 'AWAITING_FORM16' 
  | 'COMPLETED';

export interface Client {
  id: string;
  // Clean phone number e.g. "917383149649". NULL until a LID user provides their real number.
  phone_number: string | null;
  // Raw WhatsApp JID stored only for LID users e.g. "200433658294422@lid". NULL for normal users.
  whatsapp_jid: string | null;
  full_name: string | null;
  date_of_birth: string | null;
  email: string | null;
  bank_name: string | null;
  bank_account_number: string | null;
  bank_ifsc: string | null;
  created_at: string;
  updated_at: string;
}

export interface ItrFiling {
  id: string;
  client_id: string;
  fy_year: string;
  status: ItrStatus;
  pan_media_url: string | null;
  aadhaar_media_url: string | null;
  form16_media_url: string | null;
  notes: string | null;
  filing_status: string;
  created_at: string;
  updated_at: string;
}

/**
 * Look up a client by their raw sender JID.
 *
 * whatsapp_jid ALWAYS stores the full raw JID (e.g. "917383149649@s.whatsapp.net" or "200433@lid").
 * phone_number is ONLY user-provided data collected during the conversation.
 * Lookup is always done by whatsapp_jid — the unique routing identifier.
 */
export const getClient = async (senderJid: string): Promise<Client | null> => {
  if (!supabase) return null;

  const { data, error } = await supabase
    .from('clients')
    .select('*')
    .eq('whatsapp_jid', senderJid)
    .maybeSingle();
  if (error) console.error('Error fetching client by whatsapp_jid:', error);
  return data ?? null;
};

/**
 * Create a new client profile.
 *
 * whatsapp_jid = ALWAYS the raw sender JID (for routing messages back).
 * phone_number = null (will be collected explicitly from the user during conversation).
 */
export const createClientRecord = async (senderJid: string): Promise<Client | null> => {
  if (!supabase) return null;

  const { data, error } = await supabase
    .from('clients')
    .insert([{ whatsapp_jid: senderJid, phone_number: null }])
    .select()
    .single();

  if (error) {
    console.error('Error creating client:', error);
  }
  return data;
};

// Update client profile
export const updateClient = async (clientId: string, updates: Partial<Client>): Promise<{ data: Client | null; error: any }> => {
  if (!supabase) return { data: null, error: new Error('Supabase client not initialized') };
  const { data, error } = await supabase
    .from('clients')
    .update(updates)
    .eq('id', clientId)
    .select()
    .single();

  if (error) {
    console.error('Error updating client:', error);
  }
  return { data, error };
};

// Fetch current ITR filing for client
export const getFiling = async (clientId: string, fyYear: string): Promise<ItrFiling | null> => {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from('itr_filings')
    .select('*')
    .eq('client_id', clientId)
    .eq('fy_year', fyYear)
    .maybeSingle();

  if (error) {
    console.error('Error fetching filing:', error);
  }
  return data;
};

// Create new ITR filing for client
export const createFiling = async (clientId: string, fyYear: string): Promise<ItrFiling | null> => {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from('itr_filings')
    .insert([{ client_id: clientId, fy_year: fyYear, status: 'AWAITING_NAME' }])
    .select()
    .single();

  if (error) {
    console.error('Error creating filing:', error);
  }
  return data;
};

// Update existing ITR filing
export const updateFiling = async (filingId: string, updates: Partial<ItrFiling>): Promise<ItrFiling | null> => {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from('itr_filings')
    .update(updates)
    .eq('id', filingId)
    .select()
    .single();

  if (error) {
    console.error('Error updating filing:', error);
  }
  return data;
};

// Upload media to Supabase Storage
export const uploadDocument = async (
  storageKey: string,
  buffer: Buffer,
  mimetype: string,
  extension: string
): Promise<string | null> => {
  if (!supabase) return null;

  try {
    const timestamp = Date.now();
    // Sanitize storageKey for use as a folder name (strip @ and special chars)
    const folderName = storageKey.replace(/[@.]/g, '_');
    const filePath = `${folderName}/${timestamp}.${extension}`;

    const { error } = await supabase.storage
      .from('itr-documents')
      .upload(filePath, buffer, {
        contentType: mimetype,
        upsert: true,
      });

    if (error) {
      console.error('Error uploading document to Supabase Storage:', error);
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
