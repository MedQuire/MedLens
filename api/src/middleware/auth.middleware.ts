import { Request, Response, NextFunction } from 'express';
import { createClient } from '@supabase/supabase-js';

export interface AuthenticatedRequest extends Request {
  userId?: string;
  userToken?: string;
}

export const requireAuth = async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      console.warn(`[Auth] No authorization header for ${req.url}`);
      return res.status(401).json({ error: 'Unauthorized: No token provided' });
    }

    const token = authHeader.split(' ')[1];
    if (!token) {
      console.warn(`[Auth] Malformed authorization header for ${req.url}`);
      return res.status(401).json({ error: 'Unauthorized: Malformed token' });
    }

    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_ANON_KEY;

    if (!supabaseUrl || !supabaseKey) {
      console.error('[Auth] Supabase configuration missing in API environment');
      return res.status(500).json({ error: 'Server configuration error' });
    }

    // Create a singleton-style client for verification
    const supabase = createClient(supabaseUrl, supabaseKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    });

    // Debug logging
    console.log(`[Auth] Validating token for ${req.url} (Key prefix: ${supabaseKey.substring(0, 10)}...)`);

    // Validate the token specifically with a timeout to prevent hanging
    console.log(`[Auth] Validating token for ${req.url}...`);
    
    const getUserWithTimeout = async () => {
      const { data, error } = await supabase.auth.getUser(token);
      return { data, error };
    };

    const timeoutPromise = new Promise<{ data: any, error: any }>((_, reject) => 
      setTimeout(() => reject(new Error('Supabase Auth Timeout')), 8000)
    );

    let authResult;
    try {
      authResult = await Promise.race([getUserWithTimeout(), timeoutPromise]);
    } catch (raceError: any) {
      console.error(`[Auth] validation failed or timed out for ${req.url}:`, raceError.message);
      return res.status(504).json({ error: 'Authentication timeout', message: 'The auth service took too long to respond. Please try again.' });
    }

    const { data: { user }, error } = authResult;

    if (error || !user) {
      console.error(`[Auth] Token validation failed for ${req.url}:`, error?.message || 'No user found');
      if (error) console.error(`[Auth] Error details:`, JSON.stringify(error));
      
      return res.status(401).json({ 
        error: 'Unauthorized', 
        details: error?.message || 'Invalid or expired session. Please sign in again.',
        code: error?.code
      });
    }

    console.log(`[Auth] Success: ${user.id} accessed ${req.url}`);
    req.userId = user.id;
    req.userToken = token;
    next();
  } catch (error: any) {
    console.error('[Auth] Unexpected error in middleware:', error.message);
    res.status(500).json({ error: 'Internal server error during authentication' });
  }
};
