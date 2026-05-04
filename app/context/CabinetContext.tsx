import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import { CabinetItem } from '../services/api';
import * as api from '../services/api';
import { LocalStorageService } from '../services/storage';
import { useAuth } from './AuthContext';

interface CabinetContextType {
  items: CabinetItem[];
  savedDrugNames: Set<string>;
  savedDrugKeys: Set<string>;
  loading: boolean;
  refreshCabinet: () => Promise<void>;
  addItem: (drugName: string, drugKey: string, description?: string) => Promise<void>;
  removeItem: (id: string) => Promise<void>;
}

const CabinetContext = createContext<CabinetContextType | undefined>(undefined);

export const CabinetProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, isGuest, getToken } = useAuth();
  const [items, setItems] = useState<CabinetItem[]>([]);
  const [loading, setLoading] = useState(true);

  // Derived state for O(1) lookups during search
  const savedDrugNames = useMemo(() => 
    new Set(items.map(item => item.drug_name.toLowerCase())),
  [items]);

  const savedDrugKeys = useMemo(() => 
    new Set(items.map(item => item.drug_key.toLowerCase())),
  [items]);

  const refreshCabinet = useCallback(async (isRetry = false) => {
    // Guest users have no cabinet
    if (isGuest || !user) {
      setItems([]);
      setLoading(false);
      return;
    }

    try {
      // 1. Local-First: Load from cache instantly (scoped to user)
      // Only do this on initial load, not on retries
      if (!isRetry) {
        const cached = await LocalStorageService.getCachedCabinet(user?.id);
        if (cached.length > 0 && items.length === 0) {
          setItems(cached);
        }
      }

      // 2. Background Revalidation: Sync with API
      const token = await getToken();
      if (token) {
        try {
          const response = await api.getCabinetItems(token);
          // Ensure unique items by ID to prevent duplicate key errors in UI
          const uniqueItems = Array.from(new Map(response.items.map(item => [item.id, item])).values());
          setItems(uniqueItems);
          await LocalStorageService.setCachedCabinet(uniqueItems, user?.id);
        } catch (apiError: any) {
          // If we get a 401 and we haven't retried yet, try refreshing the token and retrying
          if (apiError.status === 401 && !isRetry) {
            console.warn('[CabinetContext] 401 detected, attempting token refresh and retry...');
            // getToken() already handles refresh if token is stale, 
            // so just calling refreshCabinet(true) will trigger a fresh getToken call
            return refreshCabinet(true);
          }
          throw apiError;
        }
      }
    } catch (error: any) {
      console.error('[CabinetContext] Refresh failed:', error);
      
      // If we still get a 401 after retry, or any other critical auth error
      if (error.status === 401) {
        console.error('[CabinetContext] Persistent 401 error. Clearing local cabinet state.');
        setItems([]);
        // Optional: Trigger a logout or show a "Session Expired" alert here
      }
    } finally {
      setLoading(false);
    }
  }, [user, isGuest, getToken]);

  // Initial load and sync on auth change
  useEffect(() => {
    refreshCabinet();
  }, [refreshCabinet]);

  const addItem = useCallback(async (drugName: string, drugKey: string, description?: string) => {
    if (isGuest || !user) return;

    try {
      const token = await getToken();
      if (!token) return;

      const response = await api.saveCabinetItem(drugName, drugKey, token, description);
      if (response.success) {
        // Update state and cache immediately, ensuring no duplicate items are added
        setItems(prev => {
          if (prev.some(item => item.id === response.item.id)) return prev;
          const updated = [response.item, ...prev];
          LocalStorageService.setCachedCabinet(updated, user?.id);
          return updated;
        });
      }
    } catch (error) {
      console.error('[CabinetContext] Add failed:', error);
      throw error;
    }
  }, [user, isGuest, getToken]);

  const removeItem = useCallback(async (id: string) => {
    if (isGuest || !user) return;

    // Optimistic Update: Remove from UI immediately
    const previousItems = [...items];
    setItems(prev => {
      const updated = prev.filter(i => i.id !== id);
      LocalStorageService.setCachedCabinet(updated, user?.id);
      return updated;
    });

    try {
      const token = await getToken();
      if (!token) throw new Error('No token');

      const response = await api.deleteCabinetItem(id, token);
      if (!response.success) throw new Error('API delete failed');
      
      console.log(`[CabinetContext] Successfully deleted ${id}`);
    } catch (error) {
      console.error('[CabinetContext] Remove failed, rolling back:', error);
      // Rollback on failure
      setItems(previousItems);
      LocalStorageService.setCachedCabinet(previousItems, user?.id);
      throw error;
    }
  }, [user, isGuest, getToken, items]);

  return (
    <CabinetContext.Provider value={{ 
      items, 
      savedDrugNames, 
      savedDrugKeys,
      loading, 
      refreshCabinet, 
      addItem, 
      removeItem 
    }}>
      {children}
    </CabinetContext.Provider>
  );
};

export const useCabinet = () => {
  const context = useContext(CabinetContext);
  if (context === undefined) {
    throw new Error('useCabinet must be used within a CabinetProvider');
  }
  return context;
};
