import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim();
const supabasePublishableKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim();

export const relaySupabaseConfigError = [
  !supabaseUrl && 'VITE_SUPABASE_URL',
  !supabasePublishableKey && 'VITE_SUPABASE_ANON_KEY'
].filter(Boolean).length
  ? `Missing Supabase configuration: ${[
    !supabaseUrl && 'VITE_SUPABASE_URL',
    !supabasePublishableKey && 'VITE_SUPABASE_ANON_KEY'
  ].filter(Boolean).join(', ')}.`
  : '';

export const relaySupabase = supabaseUrl && supabasePublishableKey
  ? createClient(supabaseUrl, supabasePublishableKey, {
    auth: {
      autoRefreshToken: true,
      detectSessionInUrl: true,
      persistSession: true
    }
  })
  : null;

export const relayControlEnabled = import.meta.env.VITE_RELAY_CONTROL_ENABLED === 'true';
export const relayPairingEnabled = import.meta.env.VITE_RELAY_PAIRING_ENABLED === 'true';
