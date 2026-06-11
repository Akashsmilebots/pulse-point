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

console.log('Testing connection to:', url);
console.log('Using Key:', key ? key.substring(0, 15) + '...' : 'undefined');

const supabase = createClient(url, key);

async function runTest() {
  console.log('\n--- 1. Querying polls nested relation like Dashboard ---');
  const { data: pollsData, error: pollsError } = await supabase
    .from('polls')
    .select(`
      id,
      title,
      join_code,
      status,
      created_at,
      questions:questions!questions_poll_id_fkey (
        id
      )
    `)
    .eq('host_id', 'd69ef249-0f9b-4e6b-8a42-9be37c3e201e')
    .order('created_at', { ascending: false });

  if (pollsError) {
    console.error('Error fetching polls:', pollsError);
  } else {
    console.log('Polls table query succeeded! Result:', JSON.stringify(pollsData, null, 2));
  }
}

runTest();
