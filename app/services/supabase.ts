import { Config } from '../config';
import { createClient } from '@supabase/supabase-js';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Custom fetch with timeout to prevent hanging on network/connectivity issues
const fetchWithTimeout = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8000); // 8 seconds timeout

  return fetch(input, {
    ...init,
    signal: controller.signal,
  }).finally(() => {
    clearTimeout(timeoutId);
  });
};

// Initialize Supabase client
export const supabase = createClient(
  Config.SUPABASE.URL,
  Config.SUPABASE.ANON_KEY,
  {
    auth: {
      storage: AsyncStorage,
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
      flowType: 'implicit',
    },
    global: {
      fetch: fetchWithTimeout,
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

const redirectUrl = 'medquire://callback';

export const signInWithGoogle = async () => {
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: redirectUrl,
      skipBrowserRedirect: true,
      scopes: 'email profile',
    },
  });

  if (error) throw error;

  // Extract session from OAuth response
  const { data: { session }, error: sessionError } = await supabase.auth.getSession();
  if (sessionError) throw sessionError;

  return { data, session };
};