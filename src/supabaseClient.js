import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || '';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY || '';

export const hasValidConfig = !!(supabaseUrl && supabaseAnonKey);

if (!hasValidConfig) {
  console.warn(
    'Supabase URL and/or Anon Key are missing. Please set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY in your .env.local file.'
  );
}

// Fallback to placeholder values to prevent createClient from throwing a validation error on load
const urlToUse = supabaseUrl || 'https://placeholder-project.supabase.co';
const keyToUse = supabaseAnonKey || 'placeholder-anon-key';

export const supabase = createClient(urlToUse, keyToUse);
export default supabase;
