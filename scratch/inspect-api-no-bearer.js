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

async function getSwagger() {
  const targetUrl = `${url}/rest/v1/`;
  console.log('Fetching REST metadata from:', targetUrl);
  
  try {
    const response = await fetch(targetUrl, {
      headers: {
        'apikey': key
      }
    });
    
    if (!response.ok) {
      console.error('Failed to fetch:', response.status, response.statusText);
      const body = await response.text();
      console.error('Body:', body);
      return;
    }
    
    const data = await response.json();
    console.log('Tables exposed in schema:');
    if (data.definitions) {
      Object.keys(data.definitions).forEach(tableName => {
        console.log(`- ${tableName}`);
      });
    } else {
      console.log('No definitions found.');
    }
  } catch (err) {
    console.error('Error fetching swagger:', err);
  }
}

getSwagger();
