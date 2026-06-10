import { createClient } from '@supabase/supabase-js';

interface SubscriptionRecord {
  id: string;
  user_id: string;
  plan: string;
  status: string;
  current_period_end: string | null;
}

class PremiumService {
  private getClient() {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
    if (!url || !key) throw new Error('Supabase configuration missing');
    return createClient(url, key, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  }

  isPremium(subscription: SubscriptionRecord | null): boolean {
    if (!subscription) return false;
    return (
      subscription.status === 'ACTIVE' &&
      !!subscription.current_period_end &&
      new Date(subscription.current_period_end) > new Date()
    );
  }

  async getUserSubscription(userId: string): Promise<SubscriptionRecord | null> {
    const supabase = this.getClient();
    const { data, error } = await supabase
      .from('subscriptions')
      .select('*')
      .eq('user_id', userId)
      .in('status', ['ACTIVE', 'PAST_DUE'])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      console.error('[PremiumService] Error fetching subscription:', error.message);
      return null;
    }
    return data;
  }

  async checkPremiumAccess(userId: string): Promise<boolean> {
    const subscription = await this.getUserSubscription(userId);
    return this.isPremium(subscription);
  }
}

export default new PremiumService();
