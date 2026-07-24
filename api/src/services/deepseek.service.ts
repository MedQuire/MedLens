import axios from 'axios';
import { NormalizedDrugData } from './openfda.service';
import RedisService from './redis/redis.service';
import crypto from 'crypto';

export interface AISummary {
  what_it_does: string;
  how_to_take: string;
  warnings: string;
  side_effects: string;
  eli12?: {
    what_it_does: string;
    how_to_take: string;
    warnings: string;
    side_effects: string;
  };
}

export class DeepSeekService {
  private readonly baseUrl = 'https://api.deepseek.com/v1/chat/completions';

  private get apiKey(): string | undefined {
    return process.env.DEEPSEEK_API_KEY;
  }

  private trimInput(text: string | undefined, maxLength: number = 4000): string {
    if (!text) return 'N/A';
    // Remove excessive whitespace and control characters
    const clean = text.replace(/\s+/g, ' ').trim();
    if (clean.length <= maxLength) return clean;
    return clean.substring(0, maxLength) + '... [Information truncated for brevity]';
  }

  async generateSummary(data: NormalizedDrugData): Promise<AISummary> {
    if (!this.apiKey) {
      throw new Error('DeepSeek API key is not configured');
    }

    const systemPrompt = `
      You are MedQuire, an AI assistant. You MUST return a JSON object containing TWO versions of medication info.
      
      REQUIRED JSON STRUCTURE:
      {
        "what_it_does": "Normal explanation",
        "how_to_take": "Normal explanation",
        "warnings": "Normal explanation",
        "side_effects": "Normal explanation",
        "eli12": {
          "what_it_does": "Simple child-friendly metaphor",
          "how_to_take": "Very simple steps",
          "warnings": "Simple 'be careful' talk",
          "side_effects": "Simple 'how you might feel' talk"
        }
      }
      
      RULES:
      - BASE version: Clear plain English for adults.
      - ELI12 version: Extremely simple (12-year-old level).
      - NEVER provide medical advice.
      - ALWAYS include the "eli12" object.
    `;

    const userPrompt = `
      Medication: ${data.drug_name}
      Indications: ${this.trimInput(data.indications)}
      Dosage: ${this.trimInput(data.dosage)}
      Warnings: ${this.trimInput(data.warnings)}
      Side Effects: ${this.trimInput(data.side_effects)}
    `;

    const cacheKey = `deepseek_summary_${crypto.createHash('md5').update(userPrompt).digest('hex')}`;
    const cachedResult = await RedisService.get<AISummary>(cacheKey);
    if (cachedResult) {
      console.log(`[DeepSeek] Cache hit for summary: ${data.drug_name}`);
      return cachedResult;
    }

    try {
      const response = await axios.post(
        this.baseUrl,
        {
          model: 'deepseek-chat',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
          ],
          response_format: { type: 'json_object' }
        },
        {
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json'
          },
          timeout: 60000 // 60s for AI to respond
        }
      );

      const result = JSON.parse(response.data.choices[0].message.content);
      
      // Cache for 24 hours (86400 seconds)
      await RedisService.set(cacheKey, result, 86400);

      return result;
    } catch (error: any) {
      console.error('DeepSeek AI error:', error.message);
      throw new Error(`AI generation failed: ${error.message}`);
    }
  }

  async generateELI12(summary: AISummary): Promise<AISummary> {
    if (!this.apiKey) {
      throw new Error('DeepSeek API key is not configured');
    }

    const systemPrompt = `
      You are MedQuire, an AI assistant specialized in extreme simplification (ELI12 mode).
      You are performing "Layer 2" simplification: taking a simplified medical summary and making it even MORE basic for a 12-year-old child.
      
      CRITICAL RULES:
      1. If the input summary contains phrases like "Information not available" or "Not enough information," IGNORE those phrases and try to provide a basic simplified explanation of the medication name provided instead.
      2. Use very simple language, metaphors, and short sentences.
      3. If there are still any medical terms, explain them like you're talking to a kid.
      4. DO NOT change the medical meaning.
      5. NEVER provide medical advice.
      
      OUTPUT FORMAT:
      Return a JSON object with the same four keys: what_it_does, how_to_take, warnings, side_effects.
    `;

    const userPrompt = `
      Simplify this summary even further for a 12-year-old child:
      
      What it does: ${summary.what_it_does}
      How to take: ${summary.how_to_take}
      Warnings: ${summary.warnings}
      Side effects: ${summary.side_effects}
    `;

    const cacheKey = `deepseek_eli12_${crypto.createHash('md5').update(userPrompt).digest('hex')}`;
    const cachedResult = await RedisService.get<AISummary>(cacheKey);
    if (cachedResult) {
      console.log(`[DeepSeek] Cache hit for ELI12`);
      return cachedResult;
    }

    try {
      const response = await axios.post(
        this.baseUrl,
        {
          model: 'deepseek-chat',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
          ],
          response_format: { type: 'json_object' }
        },
        {
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json'
          }
        }
      );

      const result = JSON.parse(response.data.choices[0].message.content);
      
      // Cache for 24 hours (86400 seconds)
      await RedisService.set(cacheKey, result, 86400);

      return result;
    } catch (error: any) {
      console.error('DeepSeek ELI12 error:', error.message);
      throw new Error(`ELI12 simplify failed: ${error.message}`);
    }
  }

  async analyzeInteractions(drug1: string, info1: string, drug2: string, info2: string): Promise<{ severity: string; summary: string }> {
    if (!this.apiKey) {
      throw new Error('DeepSeek API key is not configured');
    }

    const systemPrompt = `
      You are MedQuire, an AI pharmacological safety analyzer.
      Your goal is to analyze the interaction between two medications based on their FDA label text.
      
      CLASSIFICATION RULES:
      - risky: Serious or life-threatening interaction. Clear warning against combined use.
      - caution: Moderate interaction. Potential side effects or reduced effectiveness. Monitor closely.
      - safe: No known significant interaction found in the provided text.
      - unknown: No usable medical data provided to make a determination.
      
      OUTPUT RULES:
      1. If the label text mentions common interactions or reasons for caution, classify accordingly.
      2. If the text is present but does NOT mention an interaction between these specific classes or drugs, classify as "safe".
      3. Only use "unknown" if the provided info strings are generic placeholders like "N/A" or "No data".
      4. Provide a clear, plain-language summary in 2-3 sentences.
      
      OUTPUT FORMAT:
      Return a JSON object: { "severity": "risky|caution|safe|unknown", "summary": "..." }
    `;

    const userPrompt = `
      Analyze the interaction between:
      
      Drug 1: ${drug1}
      Interaction Info 1: ${info1}
      
      Drug 2: ${drug2}
      Interaction Info 2: ${info2}
      
      Determine the severity and provide a summary.
    `;

    const cacheKey = `deepseek_interaction_${crypto.createHash('md5').update(userPrompt).digest('hex')}`;
    const cachedResult = await RedisService.get<{ severity: string; summary: string }>(cacheKey);
    if (cachedResult) {
      console.log(`[DeepSeek] Cache hit for interaction: ${drug1} & ${drug2}`);
      return cachedResult;
    }

    try {
      const response = await axios.post(
        this.baseUrl,
        {
          model: 'deepseek-chat',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
          ],
          response_format: { type: 'json_object' }
        },
        {
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json'
          }
        }
      );

      const content = JSON.parse(response.data.choices[0].message.content);
      const result = {
        severity: content.severity || 'unknown',
        summary: content.summary || 'Unable to determine interaction details.'
      };

      // Cache for 24 hours (86400 seconds)
      await RedisService.set(cacheKey, result, 86400);

      return result;
    } catch (error: any) {
      console.error('DeepSeek Interaction Error:', error.message);
      return {
        severity: 'unknown',
        summary: 'We encountered an error analyzing these medications. Please consult a professional.'
      };
    }
  }

  async simplifyInteraction(summary: string): Promise<string> {
    if (!this.apiKey) {
      throw new Error('DeepSeek API key is not configured');
    }

    const systemPrompt = `
      You are MedQuire, an AI assistant specialized in extreme simplification (ELI12 mode).
      You are taking a medication interaction summary and making it even MORE basic for a 12-year-old child.
      
      CRITICAL RULES:
      1. Use very simple language, metaphors, and short sentences.
      2. If there are still any medical terms, explain them like you're talking to a kid.
      3. DO NOT change the medical meaning or severity.
      4. NEVER provide medical advice.
      5. Keep the output very concise (1-2 short sentences).
      
      OUTPUT FORMAT:
      Return a JSON object: { "eli12_summary": "..." }
    `;

    const userPrompt = `
      Simplify this interaction summary for a 12-year-old:
      
      Summary: ${summary}
    `;

    const cacheKey = `deepseek_interaction_eli12_${crypto.createHash('md5').update(userPrompt).digest('hex')}`;
    const cachedResult = await RedisService.get<string>(cacheKey);
    if (cachedResult) {
      console.log(`[DeepSeek] Cache hit for interaction ELI12`);
      return cachedResult;
    }

    try {
      const response = await axios.post(
        this.baseUrl,
        {
          model: 'deepseek-chat',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
          ],
          response_format: { type: 'json_object' }
        },
        {
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json'
          }
        }
      );

      const content = JSON.parse(response.data.choices[0].message.content);
      const result = content.eli12_summary || summary;

      // Cache for 24 hours (86400 seconds)
      await RedisService.set(cacheKey, result, 86400);

      return result;
    } catch (error: any) {
      console.error('DeepSeek Interaction ELI12 error:', error.message);
      return summary; // Fallback to original
    }
  }

  async generateChatResponse(messages: { role: 'user' | 'assistant' | 'system'; content: string }[]): Promise<string> {
    if (!this.apiKey) {
      throw new Error('DeepSeek API key is not configured');
    }

    const systemPrompt = `
      You are the MedQuire AI Support Assistant. Your goal is to help users understand their medication information, troubleshoot app issues, and navigate features.
      
      CAPABILITIES:
      - Troubleshooting: Help with cabinet issues, export errors, or account questions.
      - Simplification: Explain medication summaries or interaction results in simpler terms.
      - Navigation: Guide users on how to use the search, cabinet, and checker features.
      
      SAFETY & TRUST (NON-NEGOTIABLE):
      - DO NOT diagnose diseases.
      - DO NOT prescribe medications or suggest dosage changes.
      - DO NOT provide emergency medical advice.
      - ALWAYS include a disclaimer if the user asks for direct medical advice: "I can help explain medical information, but I cannot provide medical advice. Please consult a healthcare professional for clinical decisions."
      - If you are unsure or the issue is complex, say: "I'm not confident I can resolve this issue. This may require human support."
      
      TONE: Professional, empathetic, and clear.
    `;

    const fullMessages = [
      { role: 'system', content: systemPrompt },
      ...messages
    ];

    try {
      console.log(`[DeepSeekService] Sending ${fullMessages.length} messages to DeepSeek API...`);
      const response = await axios.post(
        this.baseUrl,
        {
          model: 'deepseek-chat',
          messages: fullMessages,
        },
        {
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json'
          },
          timeout: 30000
        }
      );

      if (!response.data || !response.data.choices || response.data.choices.length === 0) {
        console.error('[DeepSeekService] Invalid API response structure:', JSON.stringify(response.data));
        throw new Error('Invalid response from AI service');
      }

      console.log('[DeepSeekService] API call successful.');
      return response.data.choices[0].message.content;
    } catch (error: any) {
      if (error.response) {
        console.error('[DeepSeekService] API Error Response:', error.response.status, JSON.stringify(error.response.data));
      } else {
        console.error('[DeepSeekService] API Error:', error.message);
      }
      throw new Error('AI support is temporarily unavailable. Please try again later.');
    }
  }
}

export default new DeepSeekService();
