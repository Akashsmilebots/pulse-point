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

async function checkCatalog() {
  const { data, error } = await supabase.from('pg_tables').select('*');
  if (error) {
    console.log('pg_tables query failed:', error.message);
  } else {
    console.log('pg_tables query succeeded! Data:', data);
  }
}

checkCatalog();
