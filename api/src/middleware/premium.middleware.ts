import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from './auth.middleware';
import PremiumService from '../services/premium.service';

export const requirePremium = async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.userId;
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const hasAccess = await PremiumService.checkPremiumAccess(userId);
    if (!hasAccess) {
      return res.status(403).json({
        error: 'Premium required',
        message: 'This feature requires a Premium subscription. Please upgrade to access.',
      });
    }

    next();
  } catch (error: any) {
    console.error('[PremiumMiddleware] Error:', error.message);
    res.status(500).json({ error: 'Failed to verify premium status' });
  }
};
