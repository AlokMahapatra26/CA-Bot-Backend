import dotenv from 'dotenv';

dotenv.config();

export const config = {
  PORT: process.env.PORT || 3000,
  SUPABASE_URL: process.env.SUPABASE_URL || '',
  SUPABASE_KEY: process.env.SUPABASE_KEY || '',
  /** Which WhatsApp provider to use: 'baileys' (default) or 'cloud' */
  WHATSAPP_PROVIDER: (process.env.WHATSAPP_PROVIDER || 'baileys') as 'baileys' | 'cloud',
  META_ACCESS_TOKEN: (process.env.META_ACCESS_TOKEN || '').trim(),
  META_PHONE_NUMBER_ID: (process.env.META_PHONE_NUMBER_ID || '').trim(),
  META_VERIFY_TOKEN: (process.env.META_VERIFY_TOKEN || '').trim(),
};

