import dotenv from 'dotenv';
import path from 'path';

// Load environment variables immediately before other imports
// Look in current directory and parent (for root-level starts)
dotenv.config();
dotenv.config({ path: path.join(__dirname, '../.env') });
dotenv.config({ path: path.join(__dirname, '../../.env') });

import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import { searchMedication, generateELI12, autocomplete, transcribeAudio, getRecentSearches, saveRecentSearch, syncRecentSearches, clearRecentSearches } from './controllers/search.controller';
import { getCabinetItems, saveCabinetItem, deleteCabinetItem } from './controllers/cabinet.controller';
import { deleteAccount } from './controllers/auth.controller';
import { handleSupportChat, getChatHistory, getSupportHistory, getConversationMessages, clearSupportHistory } from './controllers/support.controller';
import { createSubscription, getCurrentSubscription, cancelSubscription } from './controllers/subscriptions.controller';
import { handlePaystackWebhook } from './controllers/webhooks.controller';
import { requireAuth } from './middleware/auth.middleware';
import { requirePremium } from './middleware/premium.middleware';
import { rateLimiter } from './middleware/rate-limiter.middleware';
import { checkUsageLimit, requireProForExport } from './middleware/usage-limits.middleware';
import UsageLimitsService from './services/usage-limits.service';
import OpenFDAService from './services/openfda.service';
import DeepSeekService from './services/deepseek.service';

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());

// Capture raw body for webhook signature verification (needed before JSON parsing)
app.use((req, res, next) => {
  (req as any).rawBody = '';
  req.on('data', (chunk: Buffer) => {
    (req as any).rawBody += chunk.toString('utf8');
  });
  req.on('end', next);
});

app.use(express.json({ limit: '50mb' }));

// Global Request Logger
app.use((req, res, next) => {
  const start = Date.now();
  console.log(`[HTTP] ${req.method} ${req.url} started [${new Date().toISOString()}]`);
  res.on('finish', () => {
    const duration = Date.now() - start;
    console.log(`[HTTP] ${req.method} ${req.url} finished in ${duration}ms with status ${res.statusCode}`);
  });
  next();
});

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    env: {
      openfda: !!process.env.OPENFDA_API_KEY,
      deepseek: !!process.env.DEEPSEEK_API_KEY,
      supabase: !!process.env.SUPABASE_URL && process.env.SUPABASE_URL.startsWith('http'),
    },
  });
});

// ── Search Routes ────────────────────────────────────────────────────────────
app.post('/api/search', searchMedication);
app.get('/api/search', (req, res) => {
  res.status(405).json({ 
    error: 'Method Not Allowed', 
    message: 'Please use POST to search medications.',
    hint: 'If you are seeing this, your client might be performing a GET instead of a POST.'
  });
});
app.get('/api/autocomplete', autocomplete);
app.post('/api/eli12', generateELI12);
app.post('/api/search/transcribe', transcribeAudio);
app.get('/api/search/recent', requireAuth, getRecentSearches);
app.post('/api/search/recent', requireAuth, saveRecentSearch);
app.delete('/api/search/recent', requireAuth, clearRecentSearches);
app.post('/api/search/recent/sync', requireAuth, syncRecentSearches);

// ── Cabinet Routes (Auth Required) ───────────────────────────────────────────
app.get('/api/cabinet/items', requireAuth, getCabinetItems);
app.post('/api/cabinet/save', requireAuth, saveCabinetItem);
app.delete('/api/cabinet/items/:id', requireAuth, deleteCabinetItem);

// ── Subscription Routes ─────────────────────────────────────────────────────
app.post('/api/subscriptions/create', requireAuth, createSubscription);
app.get('/api/subscriptions/current', requireAuth, getCurrentSubscription);
app.post('/api/subscriptions/cancel', requireAuth, cancelSubscription);

// ── Paystack Webhook (public, signature verified in handler) ─────────────
app.post('/api/webhooks/paystack', handlePaystackWebhook);
app.post('/api/webhooks/flutterwave', (req, res) => res.status(410).json({ error: 'Gone', message: 'Migrated to Paystack. Use POST /api/webhooks/paystack.' }));

// ── Premium-Gated Routes ───────────────────────────────────────────────────
// Cabinet routes already use requireAuth; premium gates are enforced at the
// controller level or by applying requirePremium as needed.

// ── Auth Management ──────────────────────────────────────────────────────────
app.delete('/api/auth/account', requireAuth, deleteAccount);

app.post('/api/support/chat', rateLimiter(60000, 15), requireAuth, handleSupportChat);
app.get('/api/support/chat/history', requireAuth, getChatHistory);
app.get('/api/support/history', requireAuth, getSupportHistory);
app.get('/api/support/conversations/:conversationId/messages', requireAuth, getConversationMessages);
app.delete('/api/support/history', requireAuth, clearSupportHistory);

// ── Usage Status ────────────────────────────────────────────────────────────
app.get('/api/usage/status', requireAuth, async (req: any, res) => {
  try {
    const isPremium = await UsageLimitsService.isPremium(req.userId);
    const usage = isPremium
      ? []
      : await UsageLimitsService.getUsageCounts(req.userId);
    res.json({ plan: isPremium ? 'premium' : 'free', usage });
  } catch (error: any) {
    console.error('[Usage] Status error:', error.message);
    res.status(500).json({ error: 'Failed to get usage status' });
  }
});

// ── Interaction Checker ──────────────────────────────────────────────────────
app.post('/api/interactions', rateLimiter(60000, 20), async (req: any, res) => {
  const { drug_keys } = req.body;

  if (!drug_keys || !Array.isArray(drug_keys) || drug_keys.length < 2) {
    return res.status(400).json({ error: 'At least two drug names are required' });
  }

  // Check interaction limit for authenticated free users
  if (req.userId) {
    const isPremium = await UsageLimitsService.isPremium(req.userId);
    if (!isPremium) {
      const limitCheck = await UsageLimitsService.checkLimit(req.userId, 'interaction');
      if (!limitCheck.allowed) {
        return res.status(403).json({
          error: 'free_plan_limit',
          message: `Free plan limit reached. You've used ${limitCheck.current_count}/${limitCheck.max_limit} interaction checks today. Upgrade to Pro for unlimited access.`,
          feature: 'interaction',
          current_count: limitCheck.current_count,
          max_limit: limitCheck.max_limit,
        });
      }
    }
  }

  // MedQuire currently supports pairwise check for simplicity
  const drug1Name = drug_keys[0];
  const drug2Name = drug_keys[1];

  try {
    const [drug1Data, drug2Data] = await Promise.all([
      OpenFDAService.searchDrug(drug1Name),
      OpenFDAService.searchDrug(drug2Name)
    ]);

    const info1 = drug1Data?.drug_interactions || 'N/A';
    const info2 = drug2Data?.drug_interactions || 'N/A';

    // If both have no data at all, return unknown
    if (info1 === 'N/A' && info2 === 'N/A') {
      return res.json({
        status: 'unknown',
        message: 'No interaction data is available for these medications in the FDA database.',
        summary: 'We could not find interaction records for these medications. Please consult a pharmacist or doctor.',
        severity: 'unknown'
      });
    }

    // Call DeepSeek for analysis
    const analysis = await DeepSeekService.analyzeInteractions(
      drug1Name, info1,
      drug2Name, info2
    );

    // Generate ELI12 version
    const eli12Summary = await DeepSeekService.simplifyInteraction(analysis.summary);

    // Track interaction usage for free users
    if (req.userId) {
      const isPremium = await UsageLimitsService.isPremium(req.userId);
      if (!isPremium) {
        UsageLimitsService.incrementUsage(req.userId, 'interaction').catch((e: any) =>
          console.warn('[Usage] Failed to track interaction:', e.message)
        );
      }
    }

    res.json({
      status: analysis.severity, // 'safe', 'caution', 'risky', 'unknown'
      message: analysis.summary,
      summary: analysis.summary,
      eli12_summary: eli12Summary,
      severity: analysis.severity
    });

  } catch (error: any) {
    console.error('Interaction API Error:', error.message);
    res.status(500).json({ error: 'Failed to check interactions' });
  }
});

// 404 Handler for debugging
app.use((req, res) => {
  const fullUrl = `${req.protocol}://${req.get('host')}${req.originalUrl}`;
  console.warn(`[404] No route found for: ${req.method} ${req.originalUrl} (Full: ${fullUrl})`);
  
  res.status(404).json({
    error: 'Not Found',
    message: `The endpoint ${req.method} ${req.originalUrl} does not exist on this server.`,
    available_routes: [
      'POST /api/search',
      'GET /api/autocomplete',
      'POST /api/eli12',
      'GET /api/cabinet/items',
      'POST /api/cabinet/save',
      'POST /api/interactions',
      'POST /api/subscriptions/create',
      'GET /api/subscriptions/current',
      'POST /api/subscriptions/cancel',
      'POST /api/webhooks/paystack',
      'GET /api/usage/status',
      'GET /health'
    ]
  });
});

// Global Error Handler
app.use((err: any, req: Request, res: Response, next: NextFunction) => {
  console.error('[Global Error Handler]:', err);
  const status = err.status || 500;
  res.status(status).json({
    error: 'Internal Server Error',
    message: err.message || 'An unexpected error occurred on the server.',
    details: process.env.NODE_ENV === 'development' ? err.stack : undefined
  });
});

// ── Server Start ─────────────────────────────────────────────────────────────

const server = app.listen(Number(PORT), '0.0.0.0', () => {
  console.log(`🚀 MedQuire API server running on port ${PORT}`);
  console.log(`🏥 Health check: http://localhost:${PORT}/health`);
  
  // Log configuration status
  console.log('--- Configuration Status ---');
  console.log(`PORT: ${PORT}`);
  console.log(`SUPABASE_URL: ${process.env.SUPABASE_URL ? 'PRESENT' : 'MISSING'}`);
  console.log(`SUPABASE_ANON_KEY: ${process.env.SUPABASE_ANON_KEY ? `PRESENT (Prefix: ${process.env.SUPABASE_ANON_KEY.substring(0, 10)}...)` : 'MISSING'}`);
  console.log(`SUPABASE_SERVICE_ROLE_KEY: ${process.env.SUPABASE_SERVICE_ROLE_KEY ? 'PRESENT' : 'MISSING'}`);
  console.log(`OPENFDA_API_KEY: ${process.env.OPENFDA_API_KEY ? 'PRESENT' : 'MISSING'}`);
  console.log(`DEEPSEEK_API_KEY: ${process.env.DEEPSEEK_API_KEY ? 'PRESENT' : 'MISSING'}`);
  console.log('---------------------------');
});

// Catch unhandled rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('[Unhandled Rejection] at:', promise, 'reason:', reason);
});

// ── Stability Heartbeat ──────────────────────────────────────────────────────
// This keeps the Node.js event loop active even when there is no traffic,
// preventing "clean exit" issues on certain environments/Windows.
const HEARTBEAT_INTERVAL = 30000; // 30 seconds
const heartbeat = setInterval(() => {
  console.log(`💓 Heartbeat: MedQuire API is still alive and listening on port ${PORT} [${new Date().toISOString()}]`);
}, HEARTBEAT_INTERVAL);

// ── Entry Point Confirmation ──────────────────────────────────────────────────
console.log('🏁 Entry point initialization complete. Server is ready to receive traffic.');


export default app;
