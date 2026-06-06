const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

async function main() {
  console.log("Checking public.profiles table...");
  const { data: profiles, error } = await supabase
    .from('profiles')
    .select('*');

  if (error) {
    console.error("Error fetching profiles:", error);
  } else {
    console.log("Profiles list:", profiles);
  }

  console.log("\nChecking auth.users table...");
  const { data: { users }, error: authError } = await supabase.auth.admin.listUsers();
  if (authError) {
    console.error("Error fetching auth users:", authError);
  } else {
    console.log("Auth users list:", users.map(u => ({ id: u.id, email: u.email, user_metadata: u.user_metadata })));
  }
}

main();
