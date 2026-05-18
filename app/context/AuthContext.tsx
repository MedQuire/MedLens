import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { User, Session, AuthError } from '@supabase/supabase-js';
import * as WebBrowser from 'expo-web-browser';
import * as Linking from 'expo-linking';
import * as AuthSession from 'expo-auth-session';
import { supabase } from '../services/supabase';
import { Config } from '../config';
import { Platform, Alert } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { LocalStorageService } from '../services/storage';
import * as api from '../services/api';

if (Platform.OS === 'web') {
  WebBrowser.maybeCompleteAuthSession();
}

interface AuthContextType {
  user: User | null;
  session: Session | null;
  isGuest: boolean;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<{ error: AuthError | null }>;
  signUp: (email: string, password: string, displayName?: string) => Promise<{ error: AuthError | null, needsEmailConfirmation?: boolean }>;
  signInWithGoogle: () => Promise<{ error: Error | null }>;
  signOut: () => Promise<void>;
  continueAsGuest: () => Promise<void>;
  getToken: (forceRefresh?: boolean) => Promise<string | null>;
  updateProfile: (data: { full_name?: string; email?: string }) => Promise<{ error: Error | null }>;
  deleteAccount: () => Promise<{ error: Error | null }>;
  resetPassword: (email: string) => Promise<{ error: AuthError | null }>;
  sendResetOtp: (email: string) => Promise<{ error: AuthError | null }>;
  verifyResetOtp: (email: string, token: string) => Promise<{ error: AuthError | null }>;
  updatePassword: (password: string) => Promise<{ error: AuthError | null }>;
  completeOnboarding: () => Promise<void>;
  isPro: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

interface AuthProviderProps {
  children: ReactNode;
}

export const AuthProvider: React.FC<AuthProviderProps> = ({ children }) => {
  const [session, setSession] = useState<Session | null>(null);
  const [isGuest, setIsGuest] = useState(false);
  const [loading, setLoading] = useState(true);
  
  // Derived user state
  const user = session?.user ?? null;
  const isPro = user?.user_metadata?.plan === 'pro';

  // Persist guest state
  const setGuestState = async (value: boolean) => {
    setIsGuest(value);
    // Persisting guest state across restarts is no longer desired per PRD logic
  };

  const syncGuestSearches = async (token: string) => {
    const guestSearches = await LocalStorageService.getGuestSearchesAndClear();
    if (guestSearches.length > 0) {
      try {
        await api.syncRecentSearches(guestSearches, token);
        console.log('[Auth] Synced guest searches to account');
      } catch (err) {
        console.error('[Auth] Failed to sync guest searches', err);
      }
    }
  };

  useEffect(() => {
    // Check active sessions and subscribe to auth changes
    const checkSession = async () => {
      setLoading(true);

      try {
        // Guest info is now memory-only and resets on launch

        // Race the session check against a timeout to prevent hanging
        const sessionPromise = supabase.auth.getSession();
        const timeoutPromise = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Session check timeout')), 3000)
        );

        const { data: { session }, error } = await Promise.race([sessionPromise, timeoutPromise]);

        if (error) {
          console.error('Session check error:', error);
          if (error.message.includes('Refresh Token Not Found')) {
            console.log('[Auth] Refresh Token Not Found on startup, clearing session');
            await supabase.auth.signOut();
          }
        }
        
        setSession(session ?? null);
      } catch (error) {
        console.error('Auth initialization error:', error);
        // On timeout/error, set as guest and continue
        setSession(null);
      } finally {
        setLoading(false);
      }
    };

    checkSession();

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, currentSession) => {
      console.log(`[Auth] Event: ${event}`);
      setSession(currentSession);
      if (currentSession?.user) {
        setGuestState(false);
        await LocalStorageService.setHasAuthenticatedBefore();
        // Migrate guest searches to account
        await syncGuestSearches(currentSession.access_token);
      }
      setLoading(false);
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  const signIn = async (email: string, password: string) => {
    try {
      const { data: { session: newSession }, error } = await supabase.auth.signInWithPassword({ email, password });
      if (newSession) {
        setSession(newSession);
        await setGuestState(false);
        await LocalStorageService.setOnboardingCompleted();
        await LocalStorageService.setHasAuthenticatedBefore();
        await syncGuestSearches(newSession.access_token);
      }
      return { error };
    } catch (error) {
      console.error('Sign in error:', error);
      return { error: error as AuthError };
    }
  };

  const signUp = async (email: string, password: string, displayName?: string) => {
    try {
      const { data: signUpData, error: signUpError } = await supabase.auth.signUp({ 
        email, 
        password,
        options: {
          data: {
            full_name: displayName,
          }
        }
      });

      if (signUpError) throw signUpError;

      if (signUpData.user) {
        console.log('[Auth] SignUp successful, creating profile for user:', signUpData.user.id);
        
        // Explicitly create profile in database
        const { error: profileError } = await supabase
          .from('profiles')
          .insert({
            id: signUpData.user.id,
            email: signUpData.user.email,
            full_name: displayName,
            created_at: new Date().toISOString(),
          });

        if (profileError) {
          console.error('[Auth] Profile creation failed:', profileError.message);
          // We don't throw here to avoid blocking the user if they've technically signed up
        } else {
          console.log('[Auth] Profile created successfully');
        }

        // Force session update/refresh logic
        const { data: { session: refreshedSession }, error: sessionError } = await supabase.auth.getSession();
        
        if (refreshedSession) {
          console.log('[Auth] Session active, updating state');
          setSession(refreshedSession);
          await setGuestState(false);
          await LocalStorageService.setOnboardingCompleted();
          await LocalStorageService.setHasAuthenticatedBefore();
          await syncGuestSearches(refreshedSession.access_token);
        } else if (signUpData.session) {
          console.log('[Auth] Using initial session from signUp');
          setSession(signUpData.session);
          await setGuestState(false);
          await LocalStorageService.setOnboardingCompleted();
          await LocalStorageService.setHasAuthenticatedBefore();
          await syncGuestSearches(signUpData.session.access_token);
        } else {
          console.log('[Auth] No immediate session (normal if email confirmation enabled)');
          return { error: null, needsEmailConfirmation: true };
        }
      }

      return { error: signUpError };
    } catch (error) {
      console.error('Sign up error:', error);
      return { error: error as AuthError };
    }
  };

  const signOut = async () => {
    console.log('[Auth] Sign out triggered');
    try {
      const userId = user?.id;
      const onboardingCompleted = await LocalStorageService.getOnboardingCompleted();
      const hasAuthenticatedBefore = await LocalStorageService.getHasAuthenticatedBefore();
      
      console.log(`[Auth] Sign out state: Onboarding done=${onboardingCompleted}, Auth history=${hasAuthenticatedBefore}`);
      
      await supabase.auth.signOut();
      setSession(null);
      await setGuestState(false);
      
      // Clear sensitive local data for this user
      if (userId) {
        await LocalStorageService.clearUserSessionData(userId);
      }
      console.log('[Auth] Sign out complete, tokens cleared. Navigation destination: Login');
    } catch (error) {
      console.error('Sign out error:', error);
    }
  };
  
  const continueAsGuest = async () => {
    try {
      const userId = user?.id;
      // Clear any existing session to ensure clean guest state
      await supabase.auth.signOut();
      setSession(null);
      
      // Clear sensitive local data for the user that just logged out
      if (userId) {
        await LocalStorageService.clearUserSessionData(userId);
      } else {
        // Also clear any guest data to ensure a fresh start
        await LocalStorageService.clearUserSessionData(null);
      }

      await setGuestState(true);
      await LocalStorageService.setOnboardingCompleted();
      console.log('[Auth] Continued as guest - session cleared and onboarding marked complete');
    } catch (error) {
      console.error('Guest transition error:', error);
      setSession(null);
    }
  };

  const signInWithGoogle = async () => {
    try {
      console.log('[GoogleAuth] Starting Google Auth...');

      const redirectUrl = Linking.createURL('/');
      console.log('[GoogleAuth] Redirect URL:', redirectUrl);

      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: redirectUrl,
          skipBrowserRedirect: true,
        },
      });

      if (error) {
        console.error('[GoogleAuth] Supabase OAuth Error:', error);
        return { error };
      }

      if (data?.url) {
        const res = await WebBrowser.openAuthSessionAsync(data.url, redirectUrl);
        console.log('[GoogleAuth] WebBrowser result type:', res.type);

        if (res.type === 'success' && res.url) {
          console.log('[GoogleAuth] Full callback URL:', res.url); // ADD THIS
          const paramsStr = res.url.split('#')[1] || res.url.split('?')[1];
          console.log('[GoogleAuth] Params string:', paramsStr); // ADD THIS
          if (paramsStr) {
            const searchParams = new URLSearchParams(paramsStr.replace(/\?/g, '&'));
            const access_token = searchParams.get('access_token');
            const refresh_token = searchParams.get('refresh_token');

            if (access_token && refresh_token) {
              const { error: sessionError } = await supabase.auth.setSession({
                access_token,
                refresh_token,
              });
              if (sessionError) return { error: sessionError };
              await LocalStorageService.setOnboardingCompleted();
              await LocalStorageService.setHasAuthenticatedBefore();
            } else {
              return { error: new Error('No tokens received') };
            }
          }
        } else if (res.type === 'cancel' || res.type === 'dismiss') {
          return { error: new Error('User cancelled sign-in') };
        }
      }
      return { error: null };
    } catch (error) {
      console.error('[GoogleAuth] Unexpected error:', error);
      return { error: error instanceof Error ? error : new Error('Unknown error') };
    }
  };

  const getToken = React.useCallback(async (forceRefresh = false): Promise<string | null> => {
    try {
      const { data: { session }, error } = await supabase.auth.getSession();
      
      // Handle the "Refresh Token Not Found" error which can happen if the session is unrecoverable
      if (error?.message?.includes('Refresh Token Not Found')) {
        console.error('[Auth] Terminal session error, signing out:', error.message);
        await signOut();
        return null;
      }

      if (error || !session) {
        if (error) console.error('[Auth] getSession error:', error.message);
        return null;
      }
      
      // Check if token is expired or expiring soon (within 60 seconds) or if refresh is forced
      const now = Math.floor(Date.now() / 1000);
      const expiresAt = session.expires_at || 0;
      const isExpiring = expiresAt - now < 60;
      
      if (isExpiring || forceRefresh) {
        console.log(`[Auth] ${forceRefresh ? 'Forced refresh' : 'Token expiring'}, refreshing session...`);
        const { data: { session: refreshed }, error: refreshError } = await supabase.auth.refreshSession();
        
        if (refreshError) {
          console.error('[Auth] Token refresh failed:', refreshError.message);
          
          // Handle the "Refresh Token Not Found" error during manual refresh
          if (refreshError.message.includes('Refresh Token Not Found')) {
            console.log('[Auth] Refresh token missing during refresh call, signing out...');
            await signOut();
          }
          
          return null;
        }
        
        return refreshed?.access_token || null;
      }
      
      return session.access_token;
    } catch (error: any) {
      console.error('[Auth] Get token error:', error.message);
      return null;
    }
  }, [signOut]);

  const updateProfile = async (data: { full_name?: string; email?: string }) => {
    try {
      const { data: updated, error } = await supabase.auth.updateUser({
        email: data.email,
        data: { full_name: data.full_name }
      });
      
      if (error) throw error;
      
      // Refresh session
      const { data: { session: refreshed } } = await supabase.auth.getSession();
      setSession(refreshed);
      
      return { error: null };
    } catch (error: any) {
      console.error('Update profile error:', error);
      return { error };
    }
  };

  const deleteAccount = async () => {
    try {
      if (!user) return { error: new Error('No user to delete') };

      // 1. Call backend to permanently delete user from auth.users
      const token = await getToken();
      if (token) {
        try {
          const response = await fetch(Config.ENDPOINTS.AUTH_DELETE, {
            method: 'DELETE',
            headers: {
              'Authorization': `Bearer ${token}`,
              'Content-Type': 'application/json'
            }
          });
          
          if (!response.ok) {
            const errorData = await response.json();
            console.warn('[Auth] Backend deletion failed:', errorData.error);
            
            // Show a friendly alert instead of a red screen
            if (errorData.error?.includes('Server configuration error')) {
              Alert.alert(
                "Deletion Partially Failed",
                "Your local data was cleared, but the backend account couldn't be deleted due to a server configuration error (Missing SUPABASE_SERVICE_ROLE_KEY).",
                [{ text: "OK" }]
              );
            } else {
              Alert.alert(
                "Deletion Error",
                `The backend account could not be deleted: ${errorData.error}`,
                [{ text: "OK" }]
              );
            }
          } else {
            console.log('[Auth] Permanent account deletion triggered successfully');
          }
        } catch (e) {
          console.warn('[Auth] Failed to reach deletion API:', e);
        }
      }

      // 2. Safe Wipe: Delete Cabinet Data (via RLS/Cascade usually, but being explicit)
      const { error: cabinetError } = await supabase
        .from('cabinet_items')
        .delete()
        .eq('user_id', user.id);
      
      if (cabinetError) console.warn('Failed to clear cabinet data during deletion:', cabinetError);

      // 3. Wipe all local storage (onboarding, history, settings)
      await LocalStorageService.clearAllData();

      // 4. Sign out
      await signOut();
      
      return { error: null };
    } catch (error: any) {
      console.error('Delete account error:', error);
      return { error };
    }
  };

  const resetPassword = async (email: string) => {
    try {
      const redirectUrl = AuthSession.makeRedirectUri({
        scheme: 'medquire',
        path: 'reset-password'
      });
      
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: redirectUrl,
      });
      return { error };
    } catch (error) {
      console.error('Reset password error:', error);
      return { error: error as AuthError };
    }
  };

  const sendResetOtp = async (email: string) => {
    try {
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: { shouldCreateUser: false }
      });
      return { error };
    } catch (error) {
      console.error('Send reset OTP error:', error);
      return { error: error as AuthError };
    }
  };

  const verifyResetOtp = async (email: string, token: string) => {
    try {
      const { error } = await supabase.auth.verifyOtp({
        email,
        token,
        type: 'email'
      });
      return { error };
    } catch (error) {
      console.error('Verify reset OTP error:', error);
      return { error: error as AuthError };
    }
  };

  const updatePassword = async (password: string) => {
    try {
      const { error } = await supabase.auth.updateUser({
        password
      });
      return { error };
    } catch (error) {
      console.error('Update password error:', error);
      return { error: error as AuthError };
    }
  };

  const completeOnboarding = async () => {
    await LocalStorageService.setOnboardingCompleted();
  };

  const value = {
    user,
    session,
    isGuest,
    loading,
    signIn,
    signUp,
    signInWithGoogle,
    signOut,
    continueAsGuest,
    getToken,
    updateProfile,
    deleteAccount,
    resetPassword,
    sendResetOtp,
    verifyResetOtp,
    updatePassword,
    completeOnboarding,
    isPro,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};