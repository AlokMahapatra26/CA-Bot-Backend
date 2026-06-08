const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

async function main() {
  const { data, error } = await supabase.from('clients').select('id').limit(1);
  if (error) {
    console.error("Supabase connection error:", error);
    return;
  }
  
  // Query all tables using postgres schema table
  // Since we cannot run raw sql directly without RPC or postgres client, we can check if there are common tables by querying them
  const tables = ['clients', 'profiles', 'itr_filings', 'gst_filings', 'dsc_filings', 'companies', 'chats', 'messages'];
  for (const table of tables) {
    const { error: tableError } = await supabase.from(table).select('id').limit(1);
    if (!tableError) {
      console.log(`Table exists: ${table}`);
    } else {
      if (tableError.code === 'PGS01' || tableError.message.includes('does not exist')) {
        console.log(`Table does not exist: ${table}`);
      } else {
        console.log(`Table exists (but error): ${table} - code: ${tableError.code}, msg: ${tableError.message}`);
      }
    }
  }
}

main();
