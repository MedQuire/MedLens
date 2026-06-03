import { Config } from '../config';
import { createClient } from '@supabase/supabase-js';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Initialize Supabase client
export const supabase = createClient(
  Config.SUPABASE.URL,
  Config.SUPABASE.ANON_KEY,
  {
    auth: {
      storage: AsyncStorage,
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      flowType: 'pkce',
    },
  }
);

// Helper functions
export const auth = supabase.auth;

export const getValidToken = async (): Promise<string | null> => {
  const { data: { session }, error } = await supabase.auth.getSession();
  
  if (error || !session) return null;
  
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = session.expires_at || 0;
  
  // Refresh if expiring within 60 seconds
  if (expiresAt - now < 60) {
    const { data: { session: refreshed }, error: refreshError } = await supabase.auth.refreshSession();
    if (refreshError) return null;
    return refreshed?.access_token || null;
  }
  
  return session.access_token;
};