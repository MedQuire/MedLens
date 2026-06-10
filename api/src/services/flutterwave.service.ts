import axios, { AxiosInstance } from 'axios';

export interface FlutterwaveCreateSubscriptionResponse {
  status: string;
  message: string;
  data: {
    id: number;
    tx_ref: string;
    amount: number;
    currency: string;
    redirect_url: string;
    payment_options?: string;
    meta?: any;
    link: string; // the checkout URL
  };
}

export interface FlutterwaveVerifyTransactionResponse {
  status: string;
  message: string;
  data: {
    id: number;
    tx_ref: string;
    amount: number;
    currency: string;
    status: string;
    customer?: any;
    plan?: number;
  };
}

export interface FlutterwaveCreateSubscriptionPayload {
  tx_ref: string;
  amount: number;
  currency: string;
  redirect_url: string;
  customer: {
    email: string;
    name: string;
  };
  customizations: {
    title: string;
    description: string;
  };
  meta: {
    user_id: string;
    plan: string;
  };
}

class FlutterwaveService {
  private api: AxiosInstance;

  constructor() {
    this.api = axios.create({
      baseURL: 'https://api.flutterwave.com/v3',
      headers: {
        Authorization: `Bearer ${process.env.FLUTTERWAVE_SECRET_KEY}`,
        'Content-Type': 'application/json',
      },
      timeout: 15000,
    });
  }

  async createSubscription(
    payload: FlutterwaveCreateSubscriptionPayload
  ): Promise<FlutterwaveCreateSubscriptionResponse> {
    const response = await this.api.post<FlutterwaveCreateSubscriptionResponse>(
      '/subscriptions',
      payload
    );
    return response.data;
  }

  async verifyTransaction(transactionId: number): Promise<FlutterwaveVerifyTransactionResponse> {
    const response = await this.api.get<FlutterwaveVerifyTransactionResponse>(
      `/transactions/${transactionId}/verify`
    );
    return response.data;
  }

  verifyWebhookSignature(signature: string | undefined): boolean {
    const secretHash = process.env.FLUTTERWAVE_SECRET_HASH;
    if (!secretHash || !signature) return false;
    return signature === secretHash;
  }
}

export default new FlutterwaveService();
