import { createClient } from '@supabase/supabase-js';

export interface UsageStatus {
  feature: string;
  count: number;
  limit: number;
  resets_at: string | null;
}

export interface CheckResult {
  allowed: boolean;
  current_count: number;
  max_limit: number;
}

class UsageLimitsService {
  private getClient() {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
    if (!url || !key) throw new Error('Supabase configuration missing');
    return createClient(url, key, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  }

  async checkLimit(userId: string, feature: string): Promise<CheckResult> {
    const supabase = this.getClient();
    const { data, error } = await supabase.rpc('check_usage_limit', {
      p_user_id: userId,
      p_feature: feature,
    });

    if (error) {
      console.error(`[UsageLimits] check error for ${feature}:`, error.message);
      return { allowed: true, current_count: 0, max_limit: 999 };
    }

    return {
      allowed: data?.[0]?.allowed ?? true,
      current_count: data?.[0]?.current_count ?? 0,
      max_limit: data?.[0]?.max_limit ?? 999,
    };
  }

  async incrementUsage(userId: string, feature: string): Promise<{ current_count: number; limit_reached: boolean }> {
    const supabase = this.getClient();
    const { data, error } = await supabase.rpc('increment_usage', {
      p_user_id: userId,
      p_feature: feature,
    });

    if (error) {
      console.error(`[UsageLimits] increment error for ${feature}:`, error.message);
      return { current_count: 0, limit_reached: false };
    }

    return {
      current_count: data?.[0]?.current_count ?? 0,
      limit_reached: data?.[0]?.limit_reached ?? false,
    };
  }

  async getUsageCounts(userId: string): Promise<UsageStatus[]> {
    const supabase = this.getClient();
    const { data, error } = await supabase.rpc('get_usage_counts', {
      p_user_id: userId,
    });

    if (error) {
      console.error('[UsageLimits] get counts error:', error.message);
      return [];
    }

    return (data || []).map((row: any) => ({
      feature: row.feature,
      count: row.count,
      limit: row.max_limit,
      resets_at: row.resets_at,
    }));
  }

  async isPremium(userId: string): Promise<boolean> {
    const supabase = this.getClient();
    const { data } = await supabase
      .from('users')
      .select('plan')
      .eq('id', userId)
      .maybeSingle();

    return data?.plan === 'PREMIUM';
  }
}

export default new UsageLimitsService();
