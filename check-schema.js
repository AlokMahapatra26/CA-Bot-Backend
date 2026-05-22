const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

async function main() {
  console.log("Checking columns for clients table...");
  const { data: clientsCols, error: err1 } = await supabase.rpc('get_table_columns', { table_name: 'clients' });
  if (err1) {
    // If RPC doesn't exist, we can try running a raw SQL query or fetching one record to see keys
    console.log("RPC get_table_columns failed, trying fetching single record...");
    const { data: cData, error: ce } = await supabase.from('clients').select('*').limit(1);
    if (ce) console.error("Error fetching clients:", ce);
    else console.log("Clients columns:", Object.keys(cData[0] || {}));
  } else {
    console.log("Clients columns:", clientsCols);
  }

  console.log("\nChecking columns for itr_filings table...");
  const { data: filingCols, error: err2 } = await supabase.rpc('get_table_columns', { table_name: 'itr_filings' });
  if (err2) {
    const { data: fData, error: fe } = await supabase.from('itr_filings').select('*').limit(1);
    if (fe) console.error("Error fetching filings:", fe);
    else console.log("Filings columns:", Object.keys(fData[0] || {}));
  } else {
    console.log("Filings columns:", filingCols);
  }
}

main();
