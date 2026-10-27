import { createClient } from '@supabase/supabase-js';

const DEFAULT_SUPABASE_URL = 'https://ditnksmvcacnzdguqcgz.supabase.co';
const DEFAULT_SUPABASE_ANON_KEY = 'sb_publishable_33KQl1SmvaBaqNzxWJiyzw_HuLMgWAl';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim() || DEFAULT_SUPABASE_URL;
const supabasePublishableKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim() || DEFAULT_SUPABASE_ANON_KEY;

export const relaySupabaseConfigError = [
  !supabaseUrl && 'VITE_SUPABASE_URL',
  !supabasePublishableKey && 'VITE_SUPABASE_ANON_KEY'
].filter(Boolean).length
  ? `Missing Supabase configuration: ${[
    !supabaseUrl && 'VITE_SUPABASE_URL',
    !supabasePublishableKey && 'VITE_SUPABASE_ANON_KEY'
  ].filter(Boolean).join(', ')}.`
  : '';

export const relaySupabase = createClient(supabaseUrl, supabasePublishableKey, {
  auth: {
    autoRefreshToken: true,
    detectSessionInUrl: true,
    persistSession: true
  }
});

export const relayControlEnabled = import.meta.env.VITE_RELAY_CONTROL_ENABLED !== 'false';
export const relayPairingEnabled = import.meta.env.VITE_RELAY_PAIRING_ENABLED === 'true';

