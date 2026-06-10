import React, { useState, useEffect, useCallback, useRef } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Alert, KeyboardAvoidingView, Platform, Keyboard, DeviceEventEmitter } from 'react-native';
import * as Sharing from 'expo-sharing';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { DrawerNavigationProp } from '@react-navigation/drawer';
import { DrawerParamList, RootStackParamList } from '../navigation/AppNavigator';

import { useTheme, ThemeContextType } from '../theme/ThemeProvider';
import { useAuth } from '../context/AuthContext';
import { Ionicons } from '@expo/vector-icons';

import SummaryCard from '../components/SummaryCard';
import SummaryCardSkeleton from '../components/SummaryCardSkeleton';
import Skeleton from '../components/Skeleton';
import InputBar, { InputBarHandle } from '../components/InputBar';
import EmptyState from '../components/EmptyState';
import Disclaimer from '../components/Disclaimer';
import TrustBadges from '../components/TrustBadges';
import UpgradeModal from '../components/UpgradeModal';
import { PDFService } from '../services/pdf';
import * as api from '../services/api';
import { LocalStorageService } from '../services/storage';
import RecentSearches from '../components/RecentSearches';
import { useCabinet } from '../context/CabinetContext';
import { supabase } from '../services/supabase';


type AppState = 'empty' | 'loading' | 'success' | 'partial' | 'notFound' | 'error';

const HomeScreen: React.FC = () => {
  const theme = useTheme();
  const { user, isGuest, isPro, getToken } = useAuth();
  const navigation = (useNavigation as any)() as DrawerNavigationProp<DrawerParamList>;
  const route = useRoute() as { params?: { searchQuery?: string } };
  const insets = useSafeAreaInsets();
  const styles = makeStyles(theme);

  const [query, setQuery] = useState('');
  const inputBarRef = useRef<InputBarHandle>(null);
  const [state, setState] = useState<AppState>('empty');
  const [exportLoading, setExportLoading] = useState(false);
  const [pendingAction, setPendingAction] = useState<string>('');
  const { savedDrugNames, addItem: addToCabinet } = useCabinet();
  const [baseResult, setBaseResult] = useState<api.SearchResponse | null>(null);
  const [eli12Result, setEli12Result] = useState<api.SearchResponse['summary'] | null>(null);
  const [isELI12, setIsELI12] = useState(false);
  const [recentSearches, setRecentSearches] = useState<string[]>([]);
  const [isKeyboardVisible, setKeyboardVisible] = useState(false);
  const [upgradeFeature, setUpgradeFeature] = useState<string | null>(null);

  // Performance and Cache Refs
  const sessionCache = useRef<Map<string, api.SearchResponse>>(new Map());
  const abortController = useRef<AbortController | null>(null);
  const suggestionAbortController = useRef<AbortController | null>(null);
  const searchStartTime = useRef<number>(0);

  const prefetchELI12 = useCallback(async (data: any, summary: any) => {
    if (!data || !summary) return;

    // 1. If we already have the ELI12 result from the initial search, skip the call
    if (baseResult?.eli12?.enabled && baseResult.eli12.content) {
      console.log('[Perf] Using pre-generated ELI12 content');
      const content = baseResult.eli12.content;
      setEli12Result(typeof content === 'string' ? JSON.parse(content) : content);
      return;
    }

    try {
      const response = await api.getELI12(data, summary);
      if (response.eli12.content) {
        const content = response.eli12.content;
        setEli12Result(typeof content === 'string' ? JSON.parse(content) : content);
      }
    } catch (error) {
      // Don't log abort or common timeout errors as failures for background tasks
      const isAbort = error instanceof Error && (error.name === 'AbortError' || error.message.includes('Aborted'));
      if (isAbort) return;

      console.warn('Background ELI12 prefetch failed (will retry on manual toggle):', error);
    }
  }, [baseResult]);

  const handleToggleELI12 = useCallback(async (enabled: boolean) => {
    setIsELI12(enabled);
    LocalStorageService.updateSettings({ eli12Enabled: enabled });

    if (!baseResult) return;

    if (enabled && !eli12Result) {
      setState('loading');
      await prefetchELI12(baseResult.data, baseResult.summary);
      setState('success');
    }
  }, [baseResult, eli12Result, prefetchELI12]);

  const handleSearch = useCallback(async (searchQuery: string) => {
    if (!searchQuery.trim()) return;
    const cleanQuery = searchQuery.trim().toLowerCase();

    // 1. Cancel previous in-flight request
    if (abortController.current) {
      abortController.current.abort();
    }
    abortController.current = new AbortController();

    setQuery(searchQuery.trim());
    setState('loading');
    setEli12Result(null);
    searchStartTime.current = performance.now();

    // 2. Drug Resolution Layer: Check Supabase mapping first
    let finalSearchTerm = searchQuery.trim();
    try {
      const { data: mapping } = await supabase
        .from('drug_mappings')
        .select('mapped_name')
        .ilike('local_name', cleanQuery)
        .single();

      if (mapping?.mapped_name) {
        console.log(`[Search] Mapped query: "${cleanQuery}" -> "${mapping.mapped_name}"`);
        finalSearchTerm = mapping.mapped_name;
      }
    } catch (e) {
      // Ignore mapping errors, fallback to original query
    }

    try {
      // 3. Memory Cache Check (Instant) using the resolved term
      const cacheKey = finalSearchTerm.toLowerCase();
      if (sessionCache.current.has(cacheKey)) {
        const cached = sessionCache.current.get(cacheKey)!;

        setBaseResult(cached);

        if (cached.eli12?.enabled && cached.eli12.content) {
          const content = cached.eli12.content;
          setEli12Result(typeof content === 'string' ? JSON.parse(content) : content);
        }

        setState('success');
        console.log(`[Perf] Memory cache hit for: ${cacheKey}`);
        return;
      }

      // 4. Disk Cache Check
      const diskCached = await LocalStorageService.getCachedResult(cacheKey);
      if (diskCached) {
        sessionCache.current.set(cacheKey, diskCached);
        setBaseResult(diskCached);

        if (diskCached.eli12?.enabled && diskCached.eli12.content) {
          const content = diskCached.eli12.content;
          setEli12Result(typeof content === 'string' ? JSON.parse(content) : content);
        } else {
          prefetchELI12(diskCached.data, diskCached.summary);
        }

        setState('success');
        console.log(`[Perf] Disk cache hit for: ${cacheKey}`);
        return;
      }

      // 5. API Fetch with Timeout handling
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('TIMEOUT')), 60000) // Increased to 60s to allow deep AI response time
      );

      const slowIndicatorPromise = new Promise((resolve) =>
        setTimeout(() => resolve('SLOW'), 12000) // Show status after 12s
      );

      const fetchPromise = api.searchMedication(finalSearchTerm, false);


      // Use a more nuanced race to handle the slow status
      let response: api.SearchResponse;
      const result = await Promise.race([fetchPromise, timeoutPromise, slowIndicatorPromise]);

      if (result === 'SLOW') {
        console.log('[Perf] Search is slow, showing status update...');
        // Here we could update a status state if we had one, 
        // but for now we'll just wait for the actual fetchPromise
        response = await Promise.race([fetchPromise, timeoutPromise]) as api.SearchResponse;
      } else {
        response = result as api.SearchResponse;
      }

      const duration = Math.round(performance.now() - searchStartTime.current);
      console.log(`[Perf] API Search took ${duration}ms for: ${cacheKey}`);

      sessionCache.current.set(cacheKey, response);
      setBaseResult(response);


      // 5. If ELI12 was pre-generated, set it immediately
      if (response.eli12?.enabled && response.eli12.content) {
        console.log('[Perf] Instant ELI12 loaded from initial search');
        const content = response.eli12.content;
        setEli12Result(typeof content === 'string' ? JSON.parse(content) : content);
      } else {
        // No auto-prefetch here anymore to avoid background timeout errors
        // We only fetch ELI12 if the initial dual-generation failed AND the user clicks the button
        console.log('[Search] ELI12 not included in initial response, will fetch on demand');
      }

      setState('success');

      // Async persistence
      LocalStorageService.setCachedResult(cacheKey, response);


      const queryToSave = searchQuery.trim();
      // Save to local storage for instant availability in the drawer
      LocalStorageService.addRecentSearch(queryToSave, user?.id)
        .then(updated => {
          console.log(`[History] Local saved, updated count: ${updated.length}`);
          if (!user) {
            setRecentSearches(updated);
            DeviceEventEmitter.emit('history_updated');
          }
        });

      // Synchronize with server if authenticated
      if (user) {
        const syncHistory = async (isRetry = false) => {
          const token = await getToken(isRetry);
          if (token) {
            try {
              console.log(`[History] Syncing search with server: ${queryToSave} (retry=${isRetry})`);
              const updated = await api.saveRecentSearch(queryToSave, token);
              console.log(`[History] Server sync success, count: ${updated.length}`);
              setRecentSearches(updated);
              DeviceEventEmitter.emit('history_updated');
            } catch (err: any) {
              if (err.status === 401 && !isRetry) {
                console.warn('[History] 401 detected during sync, retrying with fresh token...');
                return syncHistory(true);
              }
              console.error('[History] Server sync failed:', err);
            }
          }
        };
        syncHistory();
      }


    } catch (error: any) {
      if (error.name === 'AbortError') return;

      // Handle known 404 (Medication not found) cases without triggering error screens
      const isNotFound = error.status === 404 || error.message?.includes('404');
      if (isNotFound) {
        console.log(`[Search] Medication not found: ${cleanQuery}`);
        setState('notFound');
        return;
      }

      // Handle free plan limit
      if (error.status === 403 && error.error === 'free_plan_limit') {
        console.log(`[Search] Free plan limit hit: ${error.feature}`);
        setUpgradeFeature(error.feature || 'search');
        setState('empty');
        return;
      }

      console.error('Search error:', error);
      if (error.message === 'TIMEOUT') {
        Alert.alert(
          'Still Working',
          'The clinical summary is taking a bit longer to generate than usual. We are still working on it!',
          [{ text: 'Wait', style: 'default' }, { text: 'Cancel', style: 'cancel', onPress: () => setState('error') }]
        );
        // Try one last time to wait for the actual promise if it was just a frontend timeout
        try {
          const finalResponse = await api.searchMedication(searchQuery.trim(), false);
          sessionCache.current.set(cleanQuery, finalResponse);
          setBaseResult(finalResponse);
          setState('success');
          return;
        } catch (e) { }
      }

      const message = error.message || '';
      setState(message.includes('not found') || message.includes('404') ? 'notFound' : 'error');
    }
  }, [prefetchELI12]);

  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';

    const showSub = Keyboard.addListener(showEvent, () => setKeyboardVisible(true));
    const hideSub = Keyboard.addListener(hideEvent, () => setKeyboardVisible(false));

    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  useEffect(() => {
    // Check for navigation params if we came from drawer search
    const searchQuery = route.params?.searchQuery;

    if (searchQuery) {
      console.log(`[Home] Navigation query detected: ${searchQuery}`);
      handleSearch(searchQuery);
      // Clear navigation params to prevent re-triggering on every mount/update
      navigation.setParams({ searchQuery: undefined });
    }
  }, [route.params?.searchQuery, handleSearch, navigation]);

  useEffect(() => {
    // Load local data on mount or user change
    const loadData = async () => {
      if (user) {
        const token = await getToken();
        if (token) {
          try {
            const recent = await api.getRecentSearches(token);
            setRecentSearches(recent);
          } catch (err) {
            console.error('Failed to load recent searches from API', err);
          }
        }
      } else {
        const recent = await LocalStorageService.getRecentSearches(null);
        setRecentSearches(recent);
      }
    };
    loadData();
  }, [user]);


  const handleSave = useCallback(async () => {
    if (!baseResult) return;
    if (isGuest) {
      // Save context before auth transition
      LocalStorageService.setPendingSearch(query, isELI12, 'save');
      navigation.navigate('SignUp');
      return;
    }

    const drugName = baseResult.drug_name;
    const drugNameLower = drugName.toLowerCase();
    const drugKey = drugNameLower.replace(/\s+/g, '-');

    // 1. Optimistic Update is handled inside CabinetContext via state updates

    // 2. Immediate Feedback: Show alert right away
    Alert.alert('Saved', `${drugName} has been saved to your cabinet.`);

    // 3. Trigger context method
    (async () => {
      try {
        const description = baseResult.summary.what_it_does || undefined;
        await addToCabinet(drugName, drugKey, description);
        console.log(`[Cabinet] Add successful for: ${drugName} with desc: ${description}`);
      } catch (error: any) {
        console.error('[Cabinet] Save failed:', error);
        if (error.status === 403 && error.error === 'free_plan_limit') {
          setUpgradeFeature(error.feature || 'save');
        }
      }
    })();

    // 4. Reset search state immediately to return to default/empty state
    setState('empty');
    setBaseResult(null);
    setEli12Result(null);
    setQuery('');
  }, [baseResult, isGuest, getToken]);

  const handleExport = useCallback(async () => {
    if (!baseResult) return;
    if (isGuest) {
      // Save context before auth transition
      LocalStorageService.setPendingSearch(query, isELI12, 'export');
      navigation.navigate('SignUp');
      return;
    }
    if (!isPro) {
      setUpgradeFeature('export');
      return;
    }
    const currentSummary = isELI12 && eli12Result ? eli12Result : baseResult.summary;

    try {
      setExportLoading(true);
      const uri = await PDFService.generateMedicationReport({
        drugName: baseResult.drug_name,
        source: baseResult.source,
        isEli12: isELI12,
        sections: {
          whatItDoes: currentSummary.what_it_does,
          howToTake: currentSummary.how_to_take,
          warnings: currentSummary.warnings,
          sideEffects: currentSummary.side_effects,
        }
      });

      await Sharing.shareAsync(uri, {
        mimeType: 'application/pdf',
        dialogTitle: `Medication Report: ${baseResult.drug_name}`,
        UTI: 'com.adobe.pdf'
      });
    }
    catch (error: any) {
      console.error('PDF export failed:', error);
      Alert.alert('Export Failed', 'We could not generate the medical report PDF. Please try again.');
    } finally {
      setExportLoading(false);
    }
  }, [baseResult, isELI12, eli12Result, isGuest, query, navigation]);

  // Restore pending search context after Auth transition
  useEffect(() => {
    const restoreContext = async () => {
      if (user && state === 'empty') {
        const pending = await LocalStorageService.getPendingSearch();
        if (pending && pending.query) {
          console.log(`[Home] Restoring pending search context: ${pending.query}`);
          setIsELI12(pending.eli12);

          // Execute search
          await handleSearch(pending.query);

          // Handle pending action if any
          if (pending.action === 'save') {
            setPendingAction('save');
          } else if (pending.action === 'export') {
            setPendingAction('export');
          }

          await LocalStorageService.clearPendingSearch();
        }
      }
    };
    restoreContext();
  }, [user, state, handleSearch]);

  // Handle pending actions after search is restored
  useEffect(() => {
    if (state === 'success' && pendingAction) {
      if (pendingAction === 'save') handleSave();
      else if (pendingAction === 'export') handleExport();
      setPendingAction('');
    }
  }, [state, pendingAction, handleSave, handleExport]);

  const fetchSuggestions = useCallback(async (suggestionQuery: string) => {
    if (suggestionAbortController.current) {
      suggestionAbortController.current.abort();
    }
    suggestionAbortController.current = new AbortController();

    try {
      // suggestions are already debounced in InputBar component
      const response = await api.getAutocomplete(suggestionQuery);
      return response.suggestions || [];
    } catch (error: any) {
      if (error.name === 'AbortError') return [];
      return [];
    }
  }, []);

  const renderContent = () => {
    if (state === 'empty') {
      return null; // Headline is now static in the background
    }

    switch (state) {
      case 'loading':
        return (
          <View style={styles.resultContainer}>
            <SummaryCardSkeleton />
          </View>
        );

      case 'success':
      case 'partial':
        if (!baseResult) return null;
        const currentSummary = (isELI12 && eli12Result) ? eli12Result : baseResult.summary;

        return (
          <View style={styles.resultContainer}>
            <SummaryCard
              drugName={baseResult.drug_name}
              drugKey={baseResult.drug_name.toLowerCase().replace(/\s+/g, '-')}
              source={baseResult.source}
              sections={{
                whatItDoes: currentSummary.what_it_does || null,
                howToTake: currentSummary.how_to_take || null,
                warnings: currentSummary.warnings || null,
                sideEffects: currentSummary.side_effects || null,
              }}
              isEli12={isELI12}
              onSave={handleSave}
              onExport={handleExport}
              onClose={() => {
                setState('empty');
                setBaseResult(null);
                setEli12Result(null);
                setQuery('');
              }}
              requiresAuth={isGuest}
            />
          </View>
        );

      case 'notFound':
      case 'error':
        return (
          <EmptyState
            type={state === 'notFound' ? 'not_found' : 'error'}
            onRetry={() => query.trim() && handleSearch(query)}
          />
        );

      default:
        return null;
    }
  };

  const content = (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      {/* Static Background Headline */}
      {state === 'empty' && (
        <View style={styles.staticHeadlineWrapper} pointerEvents="none">
          <Text style={[styles.headlineText, { color: theme.colors.onSurfaceVariant }]}>
            How can I help you with your medication today?
          </Text>
        </View>
      )}

      {/* Top Navigation */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.openDrawer()}>
          <Ionicons name="menu-outline" size={28} color={theme.colors.onSurfaceVariant} />
        </TouchableOpacity>
        <View style={styles.headerActions}>
          <TouchableOpacity
            style={[styles.cabinetPill, { backgroundColor: theme.colors.primaryContainer, borderWidth: 0 }]}
            onPress={() => {
              if (isGuest) {
                if (query) LocalStorageService.setPendingSearch(query, isELI12);
                navigation.navigate('SignUp');
              } else {
                navigation.navigate('Cabinet');
              }
            }}
          >
            <Ionicons name="briefcase" size={18} color={theme.colors.onPrimaryContainer} />
            <Text style={[styles.cabinetText, { color: theme.colors.onPrimaryContainer }]}>Cabinet</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[
              styles.profileCircle,
              {
                backgroundColor: user ? theme.colors.onSurfaceVariant : theme.colors.outlineVariant,
                borderWidth: 0
              }
            ]}
            onPress={() => navigation.navigate('Settings')}
          >
            {user ? (
              <Text style={[styles.initialsText, { color: theme.colors.surface }]}>
                {(() => {
                  const name = user.user_metadata?.full_name;
                  if (name) {
                    const parts = name.trim().split(/\s+/);
                    if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
                    return parts[0][0].toUpperCase();
                  }
                  return user.email?.[0].toUpperCase() || '?';
                })()}
              </Text>
            ) : (
              <Ionicons name="person" size={20} color={theme.colors.onSurfaceVariant} />
            )}
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {renderContent()}
      </ScrollView>

      {/* Floating Bottom Bar */}
      <View style={[
        styles.floatingFooter, 
        { 
          paddingBottom: isKeyboardVisible 
            ? 2
            : insets.bottom > 0 ? insets.bottom : 8
        }
      ]}>
        <InputBar
          ref={inputBarRef}
          onSubmit={handleSearch}
          loading={state === 'loading'}
          fetchSuggestions={fetchSuggestions}
          eli12Enabled={isELI12}
          onToggleEli12={handleToggleELI12}
        />
      </View>
    </SafeAreaView>
  );

  return (
    <KeyboardAvoidingView
      style={styles.keyboardView}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={0}
    >
      {content}

      <UpgradeModal
        visible={upgradeFeature !== null}
        feature={upgradeFeature || 'search'}
        onClose={() => setUpgradeFeature(null)}
      />
    </KeyboardAvoidingView>
  );
};

const makeStyles = (theme: ThemeContextType) => StyleSheet.create({
  keyboardView: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  container: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingTop: 8,
    paddingBottom: 8,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  cabinetPill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 99,
    gap: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 5,
    elevation: 2,
  },
  cabinetText: {
    fontSize: 14,
    fontWeight: '700',
  },
  profileCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  initialsText: {
    fontSize: 16,
    fontWeight: '700',
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    paddingBottom: 40,
  },
  emptyContent: {
    flex: 1,
    justifyContent: 'center',
    paddingBottom: 60, // Balance for floating footer
  },
  resultContainer: {
    paddingHorizontal: 20,
    paddingTop: 12,
  },
  loadingState: {
    padding: 24,
  },
  skeletonSpacing: {
    height: 20,
  },
  floatingFooter: {
    paddingHorizontal: 0,
    paddingTop: 4,
    backgroundColor: theme.colors.background,
    gap: 10,
  },
  headlineText: {
    fontSize: 28,
    fontWeight: '300',
    textAlign: 'center',
    paddingHorizontal: 32,
    lineHeight: 38,
  },
  staticHeadlineWrapper: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 0,
  },
});


export default HomeScreen;
