const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

async function main() {
  const { data, error } = await supabase
    .from('clients')
    .select('id, whatsapp_jid, phone_number, full_name, bot_status')
    .order('created_at', { ascending: false })
    .limit(10);
  
  if (error) {
    console.error("Error fetching clients:", error);
    return;
  }
  
  console.log("Recent clients:");
  console.log(JSON.stringify(data, null, 2));
}

main();
