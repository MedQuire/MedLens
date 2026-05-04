import { Config } from '../config';
import COMMON_DRUGS from '../assets/data/common_drugs.json';

export interface SearchResponse {
  drug_name: string;
  source: string;
  data?: DrugData;
  summary: {
    what_it_does: string | null;
    how_to_take: string | null;
    warnings: string | null;
    side_effects: string | null;
  };
  ai_provider?: string;
  eli12: {
    enabled: boolean;
    content: string | {
      what_it_does: string;
      how_to_take: string;
      warnings: string;
      side_effects: string;
    } | null;
  };
}

export interface AutocompleteResponse {
  query: string;
  suggestions: Array<{
    name: string;
    type: 'brand' | 'generic';
    drug_name: string;
  }>;
}

export interface InteractionResponse {
  status: 'safe' | 'caution' | 'risky' | 'unknown' | 'potential_interaction' | 'insufficient_data';
  severity?: 'safe' | 'caution' | 'risky' | 'unknown';
  message: string;
  eli12_summary?: string;
  details?: {
    interactions: Array<{
      drugKey: string;
      interactions: string[];
    }>;
  };
}

export interface CabinetItem {
  id: string;
  user_id: string;
  drug_name: string;
  drug_key: string;
  source: string;
  created_at: string;
  updated_at: string;
  last_accessed_at?: string;
  description?: string;
}

export interface DrugData {
  drug_name?: string;
  indications_and_usage?: string[];
  dosage_and_administration?: string[];
  warnings?: string[];
  adverse_reactions?: string[];
  [key: string]: unknown;
}

const DEFAULT_TIMEOUT = 90000; // Increased to 90s for dual-summary generation // 60 seconds - allowed for AI and multi-modal generation
const MAX_RETRIES = 2;

async function fetchWithRetry(url: string, options: RequestInit, retries = MAX_RETRIES, timeout = DEFAULT_TIMEOUT): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    console.warn(`[API] Request timed out after ${timeout}ms: ${url}`);
    controller.abort();
  }, timeout);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    return response;
  } catch (error) {
    clearTimeout(timeoutId);

    const isAbortError = error instanceof Error && error.name === 'AbortError';

    if (retries > 0 && !isAbortError) {
      // Wait before retry (exponential backoff)
      await new Promise(resolve => setTimeout(resolve, 1000 * (MAX_RETRIES - retries + 1)));
      return fetchWithRetry(url, options, retries - 1, timeout);
    }

    throw error;
  }
}

async function apiRequest<T>(endpoint: string, options: (RequestInit & { timeout?: number }) = {}): Promise<T> {
  const headers = {
    'Content-Type': 'application/json',
    'Bypass-Tunnel-Reminder': 'true',
    'User-Agent': 'MedQuire-App',
    ...options.headers,
  };

  try {
    const response = await fetchWithRetry(endpoint, {
      ...options,
      headers,
    }, MAX_RETRIES, options.timeout || DEFAULT_TIMEOUT);

    const text = await response.text();
    let data: any;
    
    try {
      data = text ? JSON.parse(text) : null;
    } catch (e) {
      // If parsing fails, and the response is not OK, throw the raw text or status
      if (!response.ok) {
        const error = new Error(`API Error ${response.status}: ${text.substring(0, 150) || response.statusText}`);
        (error as any).status = response.status;
        (error as any).data = text;
        throw error;
      }
      // If it's a 200 but not JSON, that's also an error in our system
      throw new Error(`Invalid JSON response: ${text.substring(0, 100)}`);
    }

    if (!response.ok) {
      const error = new Error(`API Error: ${response.status}`);
      (error as any).status = response.status;
      (error as any).data = data;
      throw error;
    }

    return data;
  } catch (error: any) {
    if (error.status !== 404) {
      console.error(`[API] Request failed for URL: ${endpoint}`, error);
    }
    if (error.status) throw error;
    if (error.name === 'AbortError') throw error;
    
    // Extract status code from message if possible (e.g. "HTTP 404")
    const message = error instanceof Error ? error.message : 'Unknown error';
    const statusMatch = message.match(/HTTP (\d+)/);
    const apiError = new Error(`API request failed: ${message}`);
    if (statusMatch) {
      (apiError as any).status = parseInt(statusMatch[1], 10);
    }
    throw apiError;
  }
}

// Medication search
export async function searchMedication(query: string, eli12Enabled = false): Promise<SearchResponse> {
  return apiRequest<SearchResponse>(Config.ENDPOINTS.SEARCH, {
    method: 'POST',
    body: JSON.stringify({ query, eli12: eli12Enabled }),
  });
}

// Autocomplete suggestions
export async function getAutocomplete(query: string): Promise<AutocompleteResponse> {
  const normalizedQuery = query.toLowerCase().trim();
  if (!normalizedQuery) return { query, suggestions: [] };

  // 1. Local Search First (Instant, Zero API Cost)
  const localSuggestions = (COMMON_DRUGS as any[])
    .filter(d => 
      d.name.toLowerCase().startsWith(normalizedQuery) || 
      d.drug_name.toLowerCase().startsWith(normalizedQuery)
    )
    .slice(0, 5)
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

export async function deleteCabinetItem(id: string, token: string): Promise<{ success: boolean; message: string }> {
  return apiRequest<{ success: boolean; message: string }>(Config.ENDPOINTS.CABINET_DELETE(id), {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
}

export async function transcribeAudio(audioBase64: string, mimeType: string = 'audio/m4a'): Promise<{ text: string }> {
  return apiRequest<{ text: string }>(Config.ENDPOINTS.SEARCH + '/transcribe', {
    method: 'POST',
    body: JSON.stringify({ audio: audioBase64, mimeType }),
    timeout: 120000, // 2 minutes for audio + AI processing
  });
}

// Recent Searches
export async function getRecentSearches(token: string): Promise<string[]> {
  return apiRequest<string[]>(Config.ENDPOINTS.RECENT_SEARCHES, {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` },
  });
}

export async function saveRecentSearch(query: string, token: string): Promise<string[]> {
  return apiRequest<string[]>(Config.ENDPOINTS.RECENT_SEARCHES, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({ query }),
  });
}

export async function syncRecentSearches(queries: string[], token: string): Promise<{ success: boolean }> {
  return apiRequest<{ success: boolean }>(Config.ENDPOINTS.SYNC_RECENT_SEARCHES, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({ queries }),
  });
}
export async function clearRecentSearches(token: string): Promise<{ success: boolean }> {
  return apiRequest<{ success: boolean }>(Config.ENDPOINTS.RECENT_SEARCHES, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
}
