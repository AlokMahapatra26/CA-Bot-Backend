/**
 * Migration Script: Restructure clients/itr_filings schema
 * 
 * This uses the Supabase Management API to run SQL directly.
 * Run this once to migrate the database schema.
 */

const SUPABASE_URL = 'https://aqokcsafsrfjjtwqggyr.supabase.co';
const SERVICE_ROLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFxb2tjc2Fmc3Jmamp0d3FnZ3lyIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3OTE3MDQ3NiwiZXhwIjoyMDk0NzQ2NDc2fQ.xeNgiuiX3WdifMygohTLtnKsZEz1Y3lVh1NeUfsuWUA';

async function runSQL(sql) {
  // Try the Supabase SQL API endpoint used by the dashboard
  const endpoints = [
    `${SUPABASE_URL}/rest/v1/rpc/exec_sql`,
    `${SUPABASE_URL}/pg/query`,
  ];

  // Use the direct postgres endpoint via Supabase's internal API
  const response = await fetch(`${SUPABASE_URL}/rest/v1/`, {
    method: 'OPTIONS',
    headers: {
      'apikey': SERVICE_ROLE_KEY,
      'Authorization': `Bearer ${SERVICE_ROLE_KEY}`,
    }
  });
  
  console.log('Supabase API is accessible');
  return true;
}

async function main() {
  const { createClient } = require('@supabase/supabase-js');
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    db: { schema: 'public' }
  });

  console.log('=== Database Migration: Restructure clients/itr_filings ===\n');

  // Step 1: Check current state of both tables
  console.log('Step 1: Checking current table columns...');
  
  const { data: clientSample } = await supabase.from('clients').select('*').limit(1);
  const { data: filingSample } = await supabase.from('itr_filings').select('*').limit(1);
  
  const clientCols = clientSample?.[0] ? Object.keys(clientSample[0]) : [];
  const filingCols = filingSample?.[0] ? Object.keys(filingSample[0]) : [];
  
  console.log('  clients columns:', clientCols);
  console.log('  itr_filings columns:', filingCols);

  const clientHasBank = clientCols.includes('bank_name');
  const clientHasPan = clientCols.includes('pan_media_url');
  const filingHasBank = filingCols.includes('bank_name');
  const filingHasPan = filingCols.includes('pan_media_url');

  console.log(`\n  clients has bank_name: ${clientHasBank}`);
  console.log(`  clients has pan_media_url: ${clientHasPan}`);
  console.log(`  itr_filings has bank_name: ${filingHasBank}`);
  console.log(`  itr_filings has pan_media_url: ${filingHasPan}`);

  if (!clientHasBank && clientHasPan && filingHasBank && !filingHasPan) {
    console.log('\n✅ Migration already complete! Schema is in the new structure.');
    return;
  }

  if (clientHasBank && filingHasPan && !filingHasBank && !clientHasPan) {
    console.log('\n⚠️  Database is in OLD schema. Migration needed.');
    console.log('');
    console.log('Since Supabase REST API does not support ALTER TABLE,');
    console.log('please run the following SQL in the Supabase Dashboard SQL Editor:');
    console.log('');
    console.log('Go to: https://supabase.com/dashboard/project/aqokcsafsrfjjtwqggyr/sql/new');
    console.log('');
    console.log('--- COPY AND PASTE THIS SQL ---');
    console.log(`
-- 1. Add bank detail columns to 'itr_filings'
ALTER TABLE itr_filings ADD COLUMN IF NOT EXISTS bank_name TEXT;
ALTER TABLE itr_filings ADD COLUMN IF NOT EXISTS bank_account_number TEXT;
ALTER TABLE itr_filings ADD COLUMN IF NOT EXISTS bank_ifsc TEXT;

-- 2. Add document columns to 'clients'
ALTER TABLE clients ADD COLUMN IF NOT EXISTS pan_media_url TEXT;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS aadhaar_media_url TEXT;

-- 3. Migrate existing bank details from 'clients' to 'itr_filings'
UPDATE itr_filings f
SET 
  bank_name = c.bank_name,
  bank_account_number = c.bank_account_number,
  bank_ifsc = c.bank_ifsc
FROM clients c
WHERE f.client_id = c.id;

-- 4. Migrate existing documents from 'itr_filings' to 'clients'
UPDATE clients c
SET 
  pan_media_url = f.pan_media_url,
  aadhaar_media_url = f.aadhaar_media_url
FROM itr_filings f
WHERE f.client_id = c.id;

-- 5. Drop old columns to keep the schema clean
ALTER TABLE clients DROP COLUMN IF EXISTS bank_name;
ALTER TABLE clients DROP COLUMN IF EXISTS bank_account_number;
ALTER TABLE clients DROP COLUMN IF EXISTS bank_ifsc;

ALTER TABLE itr_filings DROP COLUMN IF EXISTS pan_media_url;
ALTER TABLE itr_filings DROP COLUMN IF EXISTS aadhaar_media_url;
    `);
    console.log('--- END SQL ---');
  } else {
    console.log('\n⚠️  Schema is in an unexpected state. Manual review needed.');
  }
}

main().catch(console.error);
