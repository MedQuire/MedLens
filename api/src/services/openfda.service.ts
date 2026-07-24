import axios from 'axios';
import RedisService from './redis/redis.service';

export interface NormalizedDrugData {
  drug_name: string;
  indications?: string;
  dosage?: string;
  warnings?: string;
  side_effects?: string;
  drug_interactions?: string;
}

export class OpenFDAService {
  private readonly baseUrl = 'https://api.fda.gov/drug/label.json';

  private get apiKey(): string | undefined {
    return process.env.OPENFDA_API_KEY;
  }

  async searchDrug(query: string): Promise<NormalizedDrugData | null> {
    try {
      const trimmedQuery = query.trim().toLowerCase();
      const cacheKey = `openfda_search_${trimmedQuery}`;
      
      const cachedResult = await RedisService.get<NormalizedDrugData | null>(cacheKey);
      if (cachedResult !== null) {
        console.log(`[OpenFDA] Cache hit for "${trimmedQuery}"`);
        return cachedResult;
      }

      const encodedQuery = encodeURIComponent(trimmedQuery);
      
      const hasSpaces = trimmedQuery.includes(' ');
      let searchStr = `openfda.brand_name:"${encodedQuery}"+OR+openfda.generic_name:"${encodedQuery}"`;
      
      if (!hasSpaces) {
        searchStr = `openfda.brand_name:"${encodedQuery}"+OR+openfda.generic_name:"${encodedQuery}"+OR+openfda.brand_name:${encodedQuery}*+OR+openfda.generic_name:${encodedQuery}*`;
      }
      
      const url = `${this.baseUrl}?search=(${searchStr})&limit=5${this.apiKey ? `&api_key=${this.apiKey}` : ''}`;
      
      const response = await axios.get(url);
      
      if (!response.data.results || response.data.results.length === 0) {
        return null;
      }

      // Find the best match among results
      // Sometimes the first result isn't the best match for the specific string
      const results = response.data.results;
      let bestResult = results[0];
      
      for (const res of results) {
        const brandNames = (res.openfda?.brand_name || []).map((n: string) => n.toLowerCase());
        const genericNames = (res.openfda?.generic_name || []).map((n: string) => n.toLowerCase());
        
        // Exact match priority
        if (brandNames.includes(trimmedQuery) || genericNames.includes(trimmedQuery)) {
          bestResult = res;
          break;
        }
      }

      // Verify relevance: ensure the query is at least a partial match for the found drug
      const brandNames = (bestResult.openfda?.brand_name || []).map((n: string) => n.toLowerCase());
      const genericNames = (bestResult.openfda?.generic_name || []).map((n: string) => n.toLowerCase());
      const allNames = [...brandNames, ...genericNames];
      
      const isRelevant = allNames.some(name => 
        name.includes(trimmedQuery) || trimmedQuery.includes(name)
      );

      if (!isRelevant && results.length > 0) {
        console.warn(`[OpenFDA] Best match for "${query}" (found "${brandNames[0]}") failed relevance check.`);
        return null;
      }

      const sanitize = (text?: string) => {
        if (!text) return undefined;
        // Remove excessive whitespace and clean up common label markers
        return text.replace(/\s+/g, ' ').trim();
      };

      const finalData: NormalizedDrugData = {
        drug_name: this.capitalizeWords(brandNames[0] || genericNames[0] || query),
        indications: sanitize(bestResult.indications_and_usage?.[0] || bestResult.purpose?.[0] || bestResult.indications?.[0] || bestResult.description?.[0] || bestResult.usage?.[0]),
        dosage: sanitize(bestResult.dosage_and_administration?.[0] || bestResult.how_to_use?.[0] || bestResult.instructions_for_use?.[0] || bestResult.dosage?.[0]),
        warnings: sanitize(bestResult.warnings?.[0] || bestResult.boxed_warning?.[0] || bestResult.precautions?.[0] || bestResult.do_not_use?.[0] || bestResult.warnings_and_precautions?.[0] || bestResult.stop_use?.[0]),
        side_effects: sanitize(bestResult.adverse_reactions?.[0] || bestResult.side_effects?.[0] || bestResult.adverse_reactions_table?.[0]),
        drug_interactions: sanitize(bestResult.drug_interactions?.[0] || bestResult.interactions?.[0])
      };

      // Cache the result for 24 hours (86400 seconds)
      await RedisService.set(cacheKey, finalData, 86400);

      return finalData;
    } catch (error: any) {
      if (error.response?.status === 404) {
        return null;
      }
      console.error('OpenFDA API error:', error.message);
      throw new Error(`OpenFDA search failed: ${error.message}`);
    }
  }

  async getAutocomplete(query: string): Promise<string[]> {
    try {
      const trimmedQuery = query.trim().toLowerCase();
      if (!trimmedQuery) return [];

      const cacheKey = `openfda_autocomplete_${trimmedQuery}`;
      const cachedResult = await RedisService.get<string[]>(cacheKey);
      if (cachedResult) {
        return cachedResult;
      }

      const encodedQuery = encodeURIComponent(trimmedQuery);
      
      // We perform two counts to get both brand and generic suggestions
      const brandUrl = `${this.baseUrl}?search=openfda.brand_name:${encodedQuery}*&limit=10${this.apiKey ? `&api_key=${this.apiKey}` : ''}&count=openfda.brand_name.exact`;
      const genericUrl = `${this.baseUrl}?search=openfda.generic_name:${encodedQuery}*&limit=10${this.apiKey ? `&api_key=${this.apiKey}` : ''}&count=openfda.generic_name.exact`;
      
      const [brandRes, genericRes] = await Promise.all([
        axios.get(brandUrl).catch(() => ({ data: { results: [] } })),
        axios.get(genericUrl).catch(() => ({ data: { results: [] } }))
      ]);
      
      const suggestions = new Set<string>();
      
      // Add brand names
      if (brandRes.data.results) {
        brandRes.data.results.forEach((r: any) => {
          if (r.term) suggestions.add(this.capitalizeWords(r.term));
        });
      }
      
      // Add generic names
      if (genericRes.data.results) {
        genericRes.data.results.forEach((r: any) => {
          if (r.term) suggestions.add(this.capitalizeWords(r.term));
        });
      }

      const finalSuggestions = Array.from(suggestions).slice(0, 10);
      
      // Cache for 24 hours (86400 seconds)
      await RedisService.set(cacheKey, finalSuggestions, 86400);

      return finalSuggestions;
    } catch (error: any) {
      console.error('OpenFDA Autocomplete error:', error.message);
      return [];
    }
  }

  private capitalizeWords(str: string): string {
    return str.toLowerCase().replace(/(^|\s)\S/g, l => l.toUpperCase());
  }
}

export default new OpenFDAService();
