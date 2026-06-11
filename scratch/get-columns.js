import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';

// Read env variables from .env.local
const envPath = path.resolve('.env.local');
if (!fs.existsSync(envPath)) {
  console.error('.env.local file not found!');
  process.exit(1);
}

const envContent = fs.readFileSync(envPath, 'utf8');
const env = {};
envContent.split('\n').forEach(line => {
  const parts = line.split('=');
  if (parts.length >= 2) {
    const key = parts[0].trim();
    const val = parts.slice(1).join('=').trim();
    env[key] = val;
  }
});

const url = env.VITE_SUPABASE_URL;
const key = env.VITE_SUPABASE_PUBLISHABLE_KEY;

const supabase = createClient(url, key);

async function inspectColumns() {
  const tables = ['polls', 'questions', 'participants', 'responses'];
  for (const table of tables) {
    console.log(`\n--- Inspecting Table: ${table} ---`);
    const { data, error } = await supabase.from(table).select('*').limit(1);
    if (error) {
      console.error(`Error querying ${table}:`, error.message);
    } else if (data && data.length > 0) {
      console.log(`Columns for ${table}:`, Object.keys(data[0]));
    } else {
      console.log(`Table ${table} is empty. Attempting to get columns via a dummy insert or schema probe...`);
      // For questions, we can fetch all rows because there might be some questions even if polls is empty.
      const { data: allData, error: allErr } = await supabase.from(table).select('*');
      if (allErr) {
        console.error(`Error fetching all from ${table}:`, allErr.message);
      } else if (allData && allData.length > 0) {
        console.log(`Columns for ${table} (from all data):`, Object.keys(allData[0]));
      } else {
        console.log(`Table ${table} has no rows at all.`);
      }
    }
  }
}

inspectColumns();
