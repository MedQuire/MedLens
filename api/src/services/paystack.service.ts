import axios, { AxiosInstance } from 'axios';
import crypto from 'crypto';

interface PaystackInitializeResponse {
  status: boolean;
  message: string;
  data: {
    authorization_url: string;
    access_code: string;
    reference: string;
  };
}

interface PaystackVerifyResponse {
  status: boolean;
  message: string;
  data: {
    id: number;
    status: string;
    reference: string;
    amount: number;
    currency: string;
    customer: {
      id: number;
      customer_code: string;
      email: string;
    };
    paid_at: string;
    metadata: {
      user_id: string;
      plan: string;
    };
    plan: {
      id: number;
      name: string;
      plan_code: string;
    };
  };
}

class PaystackService {
  private api: AxiosInstance;

  constructor() {
    this.api = axios.create({
      baseURL: 'https://api.paystack.co',
      headers: {
        Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
        'Content-Type': 'application/json',
      },
      timeout: 15000,
    });
  }

  async initializeTransaction(payload: {
    email: string;
    amount: number;
    currency: string;
    reference: string;
    callback_url: string;
    metadata: Record<string, string>;
    plan?: string;
  }): Promise<PaystackInitializeResponse> {
    const response = await this.api.post<PaystackInitializeResponse>(
      '/transaction/initialize',
      payload
    );
    return response.data;
  }

  async verifyTransaction(reference: string): Promise<PaystackVerifyResponse> {
    const response = await this.api.get<PaystackVerifyResponse>(
      `/transaction/verify/${reference}`
    );
    return response.data;
  }

  async disableSubscription(subscriptionCode: string): Promise<void> {
    await this.api.post(`/subscription/${subscriptionCode}/disable`, {
      code: subscriptionCode,
      token: process.env.PAYSTACK_SECRET_KEY,
    });
  }

  verifyWebhookSignature(signature: string | undefined, rawBody: string): boolean {
    const secret = process.env.PAYSTACK_SECRET_KEY;
    if (!secret || !signature) return false;
    const hash = crypto
      .createHmac('sha512', secret)
      .update(rawBody)
      .digest('hex');
    return hash === signature;
  }
}

export default new PaystackService();
