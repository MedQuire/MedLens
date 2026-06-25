import { Config } from '../config';

const MAX_RETRIES = 3;
const DEFAULT_TIMEOUT = 45000; // 45 seconds

export interface SearchResponse {
  drug_name: string;
  source: string;
  ai_provider: string;
  data: DrugData;
  summary: AISummary;
  eli12: {
    enabled: boolean;
    content: AISummary | string | null;
  };
  disclaimer: string;
}

export interface DrugData {
  drug_name: string;
  indications: string;
  dosage: string;
  warnings: string;
  side_effects: string;
  active_ingredients: string[];
  manufacturer?: string;
  generic_name?: string;
}

export interface AISummary {
  what_it_does: string;
  how_to_take: string;
  warnings: string;
  side_effects: string;
}

export interface InteractionResponse {
  interactions: {
    severity: 'high' | 'moderate' | 'low';
    description: string;
    drugs: string[];
  }[];
  summary: string;
}

export interface AutocompleteResponse {
  query: string;
  suggestions: {
    name: string;
    type: 'brand' | 'generic';
    drug_name: string;
  }[];
}

export interface CabinetItem {
  id: string;
  user_id: string;
  drug_name: string;
  drug_key: string;
  description?: string;
  created_at: string;
}

interface ApiRequestOptions extends RequestInit {
  timeout?: number;
}

// Helper to handle fetch with timeout
async function fetchWithTimeout(url: string, options: RequestInit, timeout: number = DEFAULT_TIMEOUT) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    clearTimeout(id);
    return response;
  } catch (error: any) {
    clearTimeout(id);
    if (error.name === 'AbortError') {
      throw new Error('TIMEOUT');
    }
    throw error;
  }
}

// Helper for exponential backoff on retryable errors
async function fetchWithRetry(url: string, options: RequestInit, retries: number, timeout: number): Promise<Response> {
  try {
    const response = await fetchWithTimeout(url, options, timeout);
    
    // Only retry on network errors or 5xx, not on 4xx (client errors like 401)
    if (response.status >= 500 && retries > 0) {
        console.warn(`[API] Server error ${response.status}, retrying... (${retries} left)`);
        await new Promise(resolve => setTimeout(resolve, 1000 * (MAX_RETRIES - retries + 1)));
        return fetchWithRetry(url, options, retries - 1, timeout);
    }
    
    return response;
  } catch (error: any) {
    const isAbortError = error.message === 'TIMEOUT' || error.name === 'AbortError';
    
    if (retries > 0 && !isAbortError) {
      // Wait before retry (exponential backoff)
      await new Promise(resolve => setTimeout(resolve, 1000 * (MAX_RETRIES - retries + 1)));
      return fetchWithRetry(url, options, retries - 1, timeout);
    }
    throw error;
  }
}

async function apiRequest<T>(url: string, options: ApiRequestOptions = {}): Promise<T> {
  const { timeout, ...fetchOptions } = options;
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {}),
  };

  try {
    const response = await fetchWithRetry(url, {
      ...fetchOptions,
      headers,
    }, MAX_RETRIES, timeout || DEFAULT_TIMEOUT);

    const text = await response.text();
    let data: any;
    
    try {
      data = text ? JSON.parse(text) : null;
    } catch (e) {
      if (!response.ok) {
        console.error(`[API] Request failed for URL: ${url} [Status: ${response.status}] [Raw text: ${text.substring(0, 200)}]`);
        const error = new Error(`API Error ${response.status}: ${response.statusText}`);
        (error as any).status = response.status;
        (error as any).data = text;
        throw error;
      }
      throw new Error(`Invalid JSON response: ${text.substring(0, 100)}`);
    }

    if (!response.ok) {
      const errorData = data || {};
      const detailMsg = errorData.details || errorData.error || `Error ${response.status}`;
      console.error(`[API] Request failed for URL: ${url} [Status: ${response.status}] [Details: ${detailMsg}]`);
      
      const error = new Error(`API Error ${response.status}: ${detailMsg}`);
      (error as any).status = response.status;
      (error as any).data = data;
      throw error;
    }

    return data;
  } catch (error: any) {
    if (error.name === 'AbortError' || error.message === 'TIMEOUT') {
      console.error(`[API] Request timed out for URL: ${url}`);
    }
    throw error;
  }
}

// Medication search
export async function searchMedication(query: string, eli12: boolean = false): Promise<SearchResponse> {
  return apiRequest<SearchResponse>(Config.ENDPOINTS.SEARCH, {
    method: 'POST',
    body: JSON.stringify({ query, eli12 }),
  });
}

// Autocomplete suggestions
export async function getAutocomplete(query: string): Promise<AutocompleteResponse> {
  // 1. Local common drug fallback (to ensure instant results even if API is slow)
  const commonDrugs = [
    { name: 'Advil', drug_name: 'Ibuprofen', type: 'brand' },
    { name: 'Tylenol', drug_name: 'Acetaminophen', type: 'brand' },
    { name: 'Allegra', drug_name: 'Fexofenadine', type: 'brand' },
    { name: 'Zyrtec', drug_name: 'Cetirizine', type: 'brand' },
    { name: 'Claritin', drug_name: 'Loratadine', type: 'brand' },
    { name: 'Benadryl', drug_name: 'Diphenhydramine', type: 'brand' },
    { name: 'Motrin', drug_name: 'Ibuprofen', type: 'brand' },
    { name: 'Lipitor', drug_name: 'Atorvastatin', type: 'brand' },
    { name: 'Nexium', drug_name: 'Esomeprazole', type: 'brand' },
    { name: 'Amoxicillin', drug_name: 'Amoxicillin', type: 'generic' },
  ];

  const localSuggestions = commonDrugs
    .filter(d => d.name.toLowerCase().includes(query.toLowerCase()))
    .map(d => ({
      name: d.name,
      drug_name: d.drug_name,
      type: d.type as 'brand' | 'generic'
    }));

  try {
    // 2. Attempt API Search for more comprehensive results
    const apiResponse = await apiRequest<AutocompleteResponse>(`${Config.ENDPOINTS.AUTOCOMPLETE}?q=${encodeURIComponent(query)}`, {
      method: 'GET',
    });
    
    // Merge results: prioritizing local hits, then adding unique API suggestions
    const combined = [...localSuggestions];
    const seenNames = new Set(localSuggestions.map(s => s.name.toLowerCase()));

    apiResponse.suggestions.forEach(apiSug => {
      const normalizedName = apiSug.name.toLowerCase();
      if (!seenNames.has(normalizedName)) {
        combined.push(apiSug);
        seenNames.add(normalizedName);
      }
    });

    return {
      query,
      suggestions: combined.slice(0, 10),
    };
  } catch (error) {
    // 3. Fallback: If offline or API fails, return current local matches
    console.warn('Autocomplete API failed, using local fallback:', error);
    return {
      query,
      suggestions: localSuggestions,
    };
  }
}

// ELI12 toggle
export async function getELI12(drugData: DrugData, currentSummary?: SearchResponse['summary']): Promise<SearchResponse> {
  return apiRequest<SearchResponse>(Config.ENDPOINTS.ELI12, {
    method: 'POST',
    body: JSON.stringify({ 
      drug_data: drugData,
      current_summary: currentSummary 
    }),
  });
}

// Interaction checker
export async function checkInteractions(drugKeys: string[]): Promise<InteractionResponse> {
  return apiRequest<InteractionResponse>(Config.ENDPOINTS.INTERACTIONS, {
    method: 'POST',
    body: JSON.stringify({ drug_keys: drugKeys }),
  });
}

// Cabinet operations
export async function saveCabinetItem(drugName: string, drugKey: string, token: string, description?: string): Promise<{ success: boolean; item: CabinetItem }> {
  return apiRequest<{ success: boolean; item: CabinetItem }>(Config.ENDPOINTS.CABINET_SAVE, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ drug_name: drugName, drug_key: drugKey, description }),
  });
}

export async function getCabinetItems(token: string): Promise<{ items: CabinetItem[]; count: number }> {
  return apiRequest<{ items: CabinetItem[]; count: number }>(Config.ENDPOINTS.CABINET_ITEMS, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
}

export async function deleteCabinetItem(id: string, token: string): Promise<{ success: boolean }> {
  return apiRequest<{ success: boolean }>(Config.ENDPOINTS.CABINET_DELETE(id), {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
}

// Search History
export async function getRecentSearches(token: string): Promise<string[]> {
  return apiRequest<string[]>(Config.ENDPOINTS.RECENT_SEARCHES, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
}

export async function saveRecentSearch(query: string, token: string): Promise<string[]> {
  return apiRequest<string[]>(Config.ENDPOINTS.RECENT_SEARCHES, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ query }),
  });
}

export async function syncRecentSearches(queries: string[], token: string): Promise<{ success: boolean }> {
  return apiRequest<{ success: boolean }>(Config.ENDPOINTS.SYNC_RECENT_SEARCHES, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ queries }),
  });
}

export async function clearRecentSearches(token: string): Promise<{ success: boolean }> {
  return apiRequest<{ success: boolean }>(Config.ENDPOINTS.RECENT_SEARCHES, {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
}

// ── Subscription API ───────────────────────────────────────────────────────

export interface CurrentSubscriptionResponse {
  plan: 'FREE' | 'PREMIUM_MONTHLY' | 'PREMIUM_YEARLY';
  status: 'NONE' | 'PENDING' | 'ACTIVE' | 'PAST_DUE' | 'CANCELLED' | 'EXPIRED';
  current_period_end: string | null;
}

export interface CreateSubscriptionResponse {
  checkout_url: string;
  subscription_id: string;
  tx_ref: string;
}

export interface CancelSubscriptionResponse {
  status: string;
  access_until: string | null;
}

export async function createSubscription(
  plan: 'PREMIUM_MONTHLY' | 'PREMIUM_YEARLY',
  currency: 'USD' | 'NGN',
  token: string,
  redirect_url?: string
): Promise<CreateSubscriptionResponse> {
  return apiRequest<CreateSubscriptionResponse>(Config.ENDPOINTS.SUBSCRIPTIONS.CREATE, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({ plan, currency, redirect_url }),
  });
}

export async function getCurrentSubscription(token: string): Promise<CurrentSubscriptionResponse> {
  return apiRequest<CurrentSubscriptionResponse>(Config.ENDPOINTS.SUBSCRIPTIONS.CURRENT, {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` },
  });
}

export async function cancelSubscriptionRequest(token: string): Promise<CancelSubscriptionResponse> {
  return apiRequest<CancelSubscriptionResponse>(Config.ENDPOINTS.SUBSCRIPTIONS.CANCEL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });
}

// ── Usage Tracking API ─────────────────────────────────────────────────────

export interface UsageStatusItem {
  feature: string;
  count: number;
  limit: number;
  resets_at: string | null;
}

export interface UsageStatusResponse {
  plan: 'free' | 'premium';
  usage: UsageStatusItem[];
}

export async function getUsageStatus(token: string): Promise<UsageStatusResponse> {
  return apiRequest<UsageStatusResponse>(Config.ENDPOINTS.USAGE_STATUS, {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` },
  });
}
