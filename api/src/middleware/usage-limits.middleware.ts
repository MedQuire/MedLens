import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from './auth.middleware';
import UsageLimitsService from '../services/usage-limits.service';

export function checkUsageLimit(feature: string) {
  return async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    const userId = req.userId;
    if (!userId) {
      // Unauthenticated — skip limit check (rate limiter handles this)
      return next();
    }

    const isPremium = await UsageLimitsService.isPremium(userId);
    if (isPremium) {
      return next();
    }

    const result = await UsageLimitsService.checkLimit(userId, feature);
    if (!result.allowed) {
      return res.status(403).json({
        error: 'free_plan_limit',
        message: `Free plan limit reached. You've used ${result.current_count}/${result.max_limit} ${feature}s today. Upgrade to Pro for unlimited access.`,
        feature,
        current_count: result.current_count,
        max_limit: result.max_limit,
      });
    }

    next();
  };
}

export async function requireProForExport(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const userId = req.userId;
  if (!userId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const isPremium = await UsageLimitsService.isPremium(userId);
  if (!isPremium) {
    return res.status(403).json({
      error: 'free_plan_limit',
      message: 'Exporting summaries is a Pro feature. Upgrade to unlock.',
      feature: 'export',
      current_count: 0,
      max_limit: 0,
    });
  }

  next();
}
