import dotenv from 'dotenv';
import path from 'path';
dotenv.config();
dotenv.config({ path: path.join(__dirname, '../../.env') });

import { createClient } from '@supabase/supabase-js';

function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error('Supabase configuration missing');
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

async function expirePastDueSubscriptions() {
  console.log('[Cron] Starting expire_past_due_subscriptions...');
  const supabase = getSupabase();

  const { data, error } = await supabase.rpc('expire_past_due_subscriptions');

  if (error) {
    console.error('[Cron] Error expiring subscriptions:', error.message);
    process.exit(1);
  }

  console.log('[Cron] Expired past-due subscriptions successfully:', data);
  process.exit(0);
}

expirePastDueSubscriptions();
