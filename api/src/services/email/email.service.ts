import { Resend } from 'resend';

class EmailService {
  private resend: Resend | null = null;
  private fromEmail: string = '';
  private fromName: string = '';

  constructor() {
    const apiKey = process.env.RESEND_API_KEY;
    if (apiKey) {
      this.resend = new Resend(apiKey);
      this.fromEmail = process.env.RESEND_FROM_EMAIL || 'noreply@medquire.app';
      this.fromName = process.env.RESEND_FROM_NAME || 'MedQuire';
      console.log('[Email] Resend initialized successfully');
    } else {
      console.warn('[Email] RESEND_API_KEY missing, emails will not be sent');
    }
  }

  /**
   * Send an email using Resend
   */
  async sendEmail({ to, subject, html }: { to: string; subject: string; html: string }): Promise<boolean> {
    if (!this.resend) {
      console.warn(`[Email] Cannot send to ${to}, Resend not configured`);
      return false;
    }

    try {
      const { data, error } = await this.resend.emails.send({
        from: `${this.fromName} <${this.fromEmail}>`,
        to,
        subject,
        html
      });

      if (error) {
        console.error('[Email] Failed to send email:', error);
        return false;
      }
      
      console.log(`[Email] Successfully sent email to ${to} (ID: ${data?.id})`);
      return true;
    } catch (err: any) {
      console.error('[Email] Unexpected error sending email:', err.message);
      return false;
    }
  }
}

export default new EmailService();
