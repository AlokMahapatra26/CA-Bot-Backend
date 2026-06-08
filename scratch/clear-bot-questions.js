const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

async function main() {
  console.log("Attempting to delete all questions from public.bot_questions...");
  
  // In Supabase, deleting with .neq('id', '_none_') is a safe way to target all rows without error
  const { data, error } = await supabase
    .from('bot_questions')
    .delete()
    .neq('id', '_none_');

  if (error) {
    console.error("Error clearing bot_questions table:", error);
    return;
  }

  console.log("Success! All questions in bot_questions table have been cleared.");
}

main();
