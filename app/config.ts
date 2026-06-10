// API Configuration
import Constants from 'expo-constants';

const getApiBaseUrl = (): string => {
  // 1. Use explicit environment variable if set
  const envUrl = process.env.EXPO_PUBLIC_API_BASE_URL;
  
  if (envUrl && envUrl.trim() !== '') return envUrl;

  // 2. Development mode - try to detect host machine IP for physical device testing
  if (__DEV__) {
    // Try expoConfig first (Expo SDK 49+)
    const hostUri = Constants.expoConfig?.hostUri || Constants.manifest?.hostUri;
    
    if (hostUri) {
      // hostUri format: "192.168.1.100:8082" or "localhost:8082"
      const [hostname] = hostUri.split(':');
      
      // If hostname is localhost, keep it (for simulator/emulator)
      if (hostname === 'localhost' || hostname === '127.0.0.1') {
        return 'http://localhost:3001';
      }
      
      // Otherwise use the detected IP for physical device

      return `http://${hostname}:3001`;
    }
  }

  // 3. Default fallback
  return 'http://localhost:3001';
};

const API_BASE_URL = getApiBaseUrl();

// Debug logging for configuration
console.log('[Config] API_BASE_URL:', API_BASE_URL);
if (API_BASE_URL.includes('api.trycloudflare.com')) {
  console.warn('[Config] WARNING: API_BASE_URL appears to be a placeholder!');
}
console.log('[Config] Supabase URL:', process.env.EXPO_PUBLIC_SUPABASE_URL ? 'PRESENT' : 'MISSING');
console.log('[Config] Supabase Key:', process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ? 'PRESENT' : 'MISSING');



export const Config = {
  API_BASE_URL,
  ENDPOINTS: {
    SEARCH: `${API_BASE_URL}/api/search`,
    ELI12: `${API_BASE_URL}/api/eli12`,
    INTERACTIONS: `${API_BASE_URL}/api/interactions`,
    AUTOCOMPLETE: `${API_BASE_URL}/api/autocomplete`,
    CABINET_SAVE: `${API_BASE_URL}/api/cabinet/save`,
    CABINET_ITEMS: `${API_BASE_URL}/api/cabinet/items`,
    CABINET_DELETE: (id: string) => `${API_BASE_URL}/api/cabinet/items/${id}`,
    AUTH_DELETE: `${API_BASE_URL}/api/auth/account`,
    RECENT_SEARCHES: `${API_BASE_URL}/api/search/recent`,
    SYNC_RECENT_SEARCHES: `${API_BASE_URL}/api/search/recent/sync`,
    SUBSCRIPTIONS: {
      CREATE: `${API_BASE_URL}/api/subscriptions/create`,
      CURRENT: `${API_BASE_URL}/api/subscriptions/current`,
      CANCEL: `${API_BASE_URL}/api/subscriptions/cancel`,
    },
    USAGE_STATUS: `${API_BASE_URL}/api/usage/status`,
  },
  SUPABASE: {
    URL: process.env.EXPO_PUBLIC_SUPABASE_URL || '',
    ANON_KEY: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '',
  },
} as const;