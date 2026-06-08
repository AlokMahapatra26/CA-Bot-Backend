const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

async function main() {
  const { data, error } = await supabase
    .from('clients')
    .select('id, full_name, company_id')
    .limit(5);
  
  if (error) {
    console.error("Error fetching clients:", error);
    return;
  }
  
  console.log("Existing clients sample:");
  console.log(data);
}

main();
