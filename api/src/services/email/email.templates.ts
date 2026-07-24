// Base layout for all emails to ensure consistent branding
const baseLayout = (content: string) => `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body { font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f6f9fc; margin: 0; padding: 0; }
    .container { max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 8px; overflow: hidden; margin-top: 40px; margin-bottom: 40px; box-shadow: 0 4px 6px rgba(0,0,0,0.05); }
    .header { background-color: #4077f1; padding: 24px; text-align: center; color: white; }
    .header h1 { margin: 0; font-size: 24px; font-weight: 700; letter-spacing: -0.5px; }
    .content { padding: 32px; color: #334155; line-height: 1.6; font-size: 16px; }
    .footer { background-color: #f8fafc; padding: 24px; text-align: center; color: #64748b; font-size: 13px; border-top: 1px solid #e2e8f0; }
    .button { display: inline-block; background-color: #4077f1; color: #ffffff; text-decoration: none; padding: 12px 24px; border-radius: 6px; font-weight: 600; margin-top: 16px; margin-bottom: 16px; }
    .disclaimer { margin-top: 32px; padding-top: 16px; border-top: 1px solid #e2e8f0; font-size: 13px; color: #64748b; }
    h2 { color: #0f172a; margin-top: 0; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>MedQuire</h1>
    </div>
    <div class="content">
      ${content}
      <div class="disclaimer">
        MedQuire simplifies medical information for understanding. It does not replace professional medical advice. Always consult a healthcare professional.
      </div>
    </div>
    <div class="footer">
      &copy; ${new Date().getFullYear()} MedQuire. All rights reserved.
    </div>
  </div>
</body>
</html>
`;

// Helper for premium highlight cards
const highlightCard = (content: string, isCode = false) => `
<div style="text-align: center; margin: 24px 0;">
  <div style="display: inline-block; background-color: #f1f5f9; padding: 16px 32px; border-radius: 8px; font-size: ${isCode ? '28px' : '20px'}; font-weight: 700; letter-spacing: ${isCode ? '4px' : '0.5px'}; color: #4077f1; box-shadow: 0 2px 4px rgba(0,0,0,0.02);">
    ${content}
  </div>
</div>
`;

/**
 * Supabase Auth Templates 
 * 
 * NOTE: These are static HTML strings meant to be configured directly in the 
 * Supabase Dashboard -> Authentication -> Email Templates.
 * They use Go text/template syntax (e.g. {{ .Token }}) as required by Supabase.
 */
export const AuthTemplates = {
  welcome: baseLayout(`
    <h2>Welcome to MedQuire!</h2>
    <p>Hi there,</p>
    <p>Thanks for joining MedQuire! We're excited to help you understand your medication information clearly and safely.</p>
    <p>Please enter the following 6-digit verification code in the app to confirm your email address:</p>
    ${highlightCard('{{ .Token }}', true)}
  `),
  passwordReset: baseLayout(`
    <h2>Reset Your Password</h2>
    <p>We received a request to reset your password for your MedQuire account.</p>
    <p>Please enter the following 6-digit verification code in the app to reset your password:</p>
    ${highlightCard('{{ .Token }}', true)}
    <p>This code will expire shortly. If you didn't request a password reset, you can safely ignore this email.</p>
  `),
  passwordChanged: baseLayout(`
    <h2>Password Successfully Changed</h2>
    <p>Hi there,</p>
    <p>This is a confirmation that the password for your account ({{ .Email }}) has just been changed.</p>
    ${highlightCard('Password Updated')}
    <p>If you did not make this change, please contact our support team immediately to secure your account.</p>
  `)
};

/**
 * Transactional Templates
 * 
 * Functions returning HTML strings for various application events.
 * Used programmatically by EmailService.
 */
export const TransactionalTemplates = {
  // --- Account Security ---
  passwordChanged: (userName: string) => baseLayout(`
    <h2>Password Successfully Changed</h2>
    <p>Hi ${userName},</p>
    <p>Your MedQuire account password has been successfully updated.</p>
    ${highlightCard('Password Updated')}
    <p>If you did not make this change, please contact our support team immediately to secure your account.</p>
  `),
  emailChanged: (userName: string) => baseLayout(`
    <h2>Email Address Changed</h2>
    <p>Hi ${userName},</p>
    <p>The email address associated with your MedQuire account has been successfully updated.</p>
    ${highlightCard('Email Updated')}
    <p>If you did not make this change, please contact our support team immediately to secure your account.</p>
  `),
  accountDeleted: (userName: string) => baseLayout(`
    <h2>Account Successfully Deleted</h2>
    <p>Hi ${userName},</p>
    <p>We're writing to confirm that your MedQuire account has been permanently deleted as requested.</p>
    ${highlightCard('Account Deleted')}
    <p>All of your personal data and saved medications have been removed from our systems.</p>
    <p>We're sorry to see you go! If you ever need us again, you can always create a new account.</p>
  `),

  // --- Cabinet ---
  medicationSaved: (userName: string, drugName: string) => baseLayout(`
    <h2>Medication Saved</h2>
    <p>Hi ${userName},</p>
    <p>A new medication has been successfully added to your Medicine Cabinet.</p>
    ${highlightCard(drugName)}
    <p>You can access its simplified summary anytime from your app.</p>
  `),
  medicationUpdated: (userName: string, drugName: string) => baseLayout(`
    <h2>Medication Updated</h2>
    <p>Hi ${userName},</p>
    <p>A medication in your Medicine Cabinet has been updated with new information.</p>
    ${highlightCard(drugName)}
    <p>Please open the app to review the latest simplified summary.</p>
  `),
  medicationRemoved: (userName: string, drugName: string) => baseLayout(`
    <h2>Medication Removed</h2>
    <p>Hi ${userName},</p>
    <p>A medication has been removed from your Medicine Cabinet.</p>
    ${highlightCard(drugName)}
    <p>If this was a mistake, you can always search for it and save it again.</p>
  `),
  
  // --- AI Features ---
  aiSummaryReady: (userName: string, drugName: string) => baseLayout(`
    <h2>AI Summary Ready</h2>
    <p>Hi ${userName},</p>
    <p>Your simplified medication summary is ready for review.</p>
    ${highlightCard(drugName)}
    <p>Open the app to read the plain-language explanation of this medication.</p>
  `),
  exportReady: (userName: string, drugName: string, downloadLink: string) => baseLayout(`
    <h2>Your Summary is Ready</h2>
    <p>Hi ${userName},</p>
    <p>Your exported medication summary is ready to download.</p>
    ${highlightCard(drugName)}
    <div style="text-align: center;">
      <a href="${downloadLink}" class="button">Download PDF</a>
    </div>
  `),
  interactionReportReady: (userName: string) => baseLayout(`
    <h2>Interaction Report Ready</h2>
    <p>Hi ${userName},</p>
    <p>The drug interaction report you requested has finished processing.</p>
    ${highlightCard('Report Complete')}
    <p>Please open the MedQuire app to view your full results safely.</p>
  `),

  // --- Subscriptions ---
  subscriptionActivated: (userName: string, planName: string) => baseLayout(`
    <h2>Welcome to MedQuire Premium!</h2>
    <p>Hi ${userName},</p>
    <p>Your subscription has been successfully activated. Thank you for upgrading!</p>
    ${highlightCard(planName)}
    <p>You now have unlimited access to all premium features, including advanced interaction checks and unlimited searches.</p>
  `),
  paymentSuccessful: (userName: string, amount: string) => baseLayout(`
    <h2>Payment Successful</h2>
    <p>Hi ${userName},</p>
    <p>We have successfully received your payment for your MedQuire Premium subscription.</p>
    ${highlightCard(amount)}
    <p>Thank you for your continued support! Your premium features are active.</p>
  `),
  paymentFailed: (userName: string) => baseLayout(`
    <h2>Payment Failed</h2>
    <p>Hi ${userName},</p>
    <p>We were unable to process your recent payment for your MedQuire subscription.</p>
    ${highlightCard('Action Required')}
    <p>Please update your payment method in the app to prevent any interruption in your premium access.</p>
  `),
  subscriptionRenewed: (userName: string, planName: string) => baseLayout(`
    <h2>Subscription Renewed</h2>
    <p>Hi ${userName},</p>
    <p>Your MedQuire subscription has been successfully renewed.</p>
    ${highlightCard(planName)}
    <p>Thank you for your continued support!</p>
  `),
  subscriptionCancelled: (userName: string) => baseLayout(`
    <h2>Subscription Cancelled</h2>
    <p>Hi ${userName},</p>
    <p>Your MedQuire premium subscription has been cancelled.</p>
    ${highlightCard('Subscription Ended')}
    <p>You will continue to have access to premium features until the end of your current billing cycle.</p>
  `)
};
