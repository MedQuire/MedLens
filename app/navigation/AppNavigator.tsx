import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Alert, ActivityIndicator, DeviceEventEmitter } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createDrawerNavigator, DrawerContentScrollView, DrawerItemList, DrawerContentComponentProps, useDrawerStatus } from '@react-navigation/drawer';
import { Ionicons } from '@expo/vector-icons';
import { useTheme, ThemeContextType } from '../theme/ThemeProvider';
import { LocalStorageService } from '../services/storage';
import * as api from '../services/api';
import { useNavigation } from '@react-navigation/native';
import {
  SplashScreen,
  OnboardingScreen,
  HomeScreen,
  CabinetScreen,
  InteractionScreen,
  SettingsScreen,
  SignUpScreen,
  LoginScreen,
  ForgotPasswordScreen,
  VerifyOtpScreen,
  ResetPasswordScreen,
} from '../screens';
import { useAuth } from '../context/AuthContext';
import { CabinetProvider } from '../context/CabinetContext';

export type RootStackParamList = {
  Splash: undefined;
  Onboarding: undefined;
  SignUp: undefined;
  Login: undefined;
  Home: undefined;
  Cabinet: undefined;
  Settings: undefined;
  ForgotPassword: undefined;
  VerifyOtp: { email: string };
  ResetPassword: { email: string };
  Interaction: { drugKeys?: string[] };
};

export type DrawerParamList = {
  HomeDrawer: { searchQuery?: string };
  CabinetDrawer: undefined;
  SettingsDrawer: undefined;
};

const Stack = (createNativeStackNavigator as any)();
const Drawer = (createDrawerNavigator as any)();

// Global cache to avoid flicker when drawer opens
let drawerHistoryCache: string[] | null = null;

const clearDrawerHistoryCache = () => {
  drawerHistoryCache = null;
};

import { SvgXml } from 'react-native-svg';
import { LOGO_SVG } from '../assets/logo_svg';

const CustomDrawerContent: React.FC<DrawerContentComponentProps> = (props) => {
  const theme = useTheme();
  const navigation = useNavigation();
  const { signOut, isGuest, user, getToken } = useAuth();
  const [history, setHistory] = React.useState<string[] | null>(drawerHistoryCache);
  const [isLoading, setIsLoading] = React.useState(drawerHistoryCache === null);
  const drawerStatus = useDrawerStatus();

  const loadHistory = React.useCallback(async (isRetry = false) => {
    // If not authenticated or in guest mode, don't attempt API call
    if (!user || isGuest) {
      const searches = await LocalStorageService.getRecentSearches(null);
      setHistory(searches);
      drawerHistoryCache = searches;
      setIsLoading(false);
      return;
    }

    try {
      console.log(`[Drawer] Refreshing history for ${user ? (isGuest ? 'Guest' : user.id) : 'Unauthenticated'}`);
      let serverSearches: string[] = [];
      let localSearches: string[] = await LocalStorageService.getRecentSearches(isGuest ? null : user?.id);
      
      // Start with local searches for instant feedback
      setHistory(localSearches);
      setIsLoading(true);

      const token = await getToken();
      if (token && !isGuest) {
        try {
          serverSearches = await api.getRecentSearches(token);
          console.log(`[Drawer] API fetch success: ${serverSearches.length} items`);
          
          // Merge server and local, prioritizing server but keeping unique items
          const combined = Array.from(new Set([...serverSearches, ...localSearches])).slice(0, 10);
          setHistory(combined);
          drawerHistoryCache = combined;
        } catch (apiErr: any) {
          if (apiErr.status === 401 && !isRetry) {
            console.warn('[Drawer] 401 detected, attempting token refresh and retry...');
            return loadHistory(true);
          }
          console.warn('[Drawer] API fetch failed, staying with local data');
        }
      } else {
        // Just local searches for Guest
        setHistory(localSearches);
        drawerHistoryCache = localSearches;
      }
    } catch (error) {
      console.error('[Drawer] Failed to load history:', error);
    } finally {
      setIsLoading(false);
    }
  }, [user, isGuest, getToken]);

  // Update history whenever drawer opens or state changes
  React.useEffect(() => {
    if (drawerStatus === 'open') {
      loadHistory();
    }
  }, [drawerStatus, loadHistory]);

  React.useEffect(() => {
    const historySub = DeviceEventEmitter.addListener('history_updated', () => loadHistory());
    return () => {
      historySub.remove();
    };
  }, [loadHistory]);

  const handleHistoryPress = (query: string) => {
    props.navigation.navigate('HomeDrawer', { searchQuery: query });
    props.navigation.closeDrawer();
  };

  const clearHistory = async () => {
    try {
      // 1. Clear local storage instantly
      await LocalStorageService.clearRecentSearches(user?.id);
      setHistory([]);
      drawerHistoryCache = [];

      // 2. Clear server if authenticated
      const token = await getToken();
      if (token && !isGuest) {
        await api.clearRecentSearches(token);
        console.log('[Drawer] Server history cleared');
      }
    } catch (error) {
      console.error('[Drawer] Failed to clear history:', error);
    }
  };

  const handleLogout = () => {
    Alert.alert('Sign Out', 'Are you sure you want to sign out?', [
      { text: 'Cancel', style: 'cancel' },
      { 
        text: 'Sign Out', 
        style: 'destructive', 
        onPress: async () => {
          try {
            await signOut();
            clearDrawerHistoryCache();
            props.navigation.closeDrawer();
            (navigation as any).reset({
              index: 0,
              routes: [{ name: 'Login' }],
            });
          } catch (error) {
            console.error('Logout error:', error);
          }
        } 
      },
    ]);
  };

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <View style={styles.drawerHeader}>
        <View style={styles.logoWrapper}>
          <SvgXml xml={LOGO_SVG} width={120} height={40} preserveAspectRatio="xMinYMid meet" />
        </View>
      </View>

      <View style={styles.historySection}>
        <View style={styles.sectionHeader}>
          <Text style={[styles.sectionTitle, { color: theme.colors.outline }]}>Recent Searches</Text>
          {history && history.length > 0 && (
            <TouchableOpacity onPress={clearHistory}>
              <Text style={[styles.clearText, { color: theme.colors.primary }]}>Clear</Text>
            </TouchableOpacity>
          )}
        </View>

        {isLoading && (!history || history.length === 0) ? (
          <View style={styles.loadingHistory}>
            <ActivityIndicator size="small" color={theme.colors.primary} />
            <Text style={[styles.loadingText, { color: theme.colors.outline }]}>Refreshing...</Text>
          </View>
        ) : !history || history.length === 0 ? (
          <View style={styles.emptyHistory}>
            <Ionicons name="time-outline" size={48} color={theme.colors.outlineVariant} />
            <Text style={[styles.emptyText, { color: theme.colors.onSurfaceVariant }]}>
              You do not have any recent searches yet
            </Text>
          </View>
        ) : (
          <ScrollView style={styles.historyList} showsVerticalScrollIndicator={false}>
            {history.map((item, index) => (
              <TouchableOpacity
                key={index}
                style={styles.historyItem}
                onPress={() => handleHistoryPress(item)}
              >
                <Text style={[styles.historyText, { color: theme.colors.onSurface }]} numberOfLines={1}>
                  {item}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        )}
      </View>

    </View>
  );
};

const DrawerNavigator: React.FC = () => {
  const theme = useTheme();
  return (
    <Drawer.Navigator
      useLegacyImplementation={false}
      drawerContent={(props: DrawerContentComponentProps) => <CustomDrawerContent {...props} />}
      screenOptions={{
        headerShown: false,
        drawerStyle: { backgroundColor: theme.colors.background, width: 300 },
        swipeEnabled: false,
      }}
    >
      <Drawer.Screen
        name="HomeDrawer"
        component={HomeScreen}
        options={{
          drawerLabel: 'Home',
        }}
      />
    </Drawer.Navigator>
  );
};

const AppNavigator = () => {
  return (
    <CabinetProvider>
      <NavigationContainer>
        <Stack.Navigator initialRouteName="Splash" screenOptions={{ headerShown: false }}>
          <Stack.Screen name="Splash" component={SplashScreen} />
          <Stack.Screen name="Onboarding" component={OnboardingScreen} />
          <Stack.Screen 
            name="SignUp" 
            component={SignUpScreen} 
            options={{ gestureEnabled: false }}
          />
          <Stack.Screen 
            name="Login" 
            component={LoginScreen} 
            options={{ gestureEnabled: false, headerBackVisible: false }} 
          />
          <Stack.Screen 
            name="ForgotPassword" 
            component={ForgotPasswordScreen} 
            options={{ presentation: 'push', gestureEnabled: false }} 
          />
          <Stack.Screen 
            name="VerifyOtp" 
            component={VerifyOtpScreen} 
            options={{ presentation: 'push', gestureEnabled: false }} 
          />
          <Stack.Screen 
            name="ResetPassword" 
            component={ResetPasswordScreen} 
            options={{ presentation: 'push', gestureEnabled: false }} 
          />
          <Stack.Screen name="Home" component={DrawerNavigator} />
          <Stack.Screen name="Cabinet" component={CabinetScreen} />
          <Stack.Screen 
            name="Settings" 
            component={SettingsScreen} 
            options={{ gestureEnabled: false }}
          />
          <Stack.Screen
            name="Interaction"
            component={InteractionScreen}
            options={{ presentation: 'modal', gestureEnabled: false }}
          />
        </Stack.Navigator>
      </NavigationContainer>
    </CabinetProvider>
  );
};

const styles = StyleSheet.create({
  drawerHeader: {
    padding: 24,
    paddingTop: 80,
    paddingBottom: 16,
  },
  logoWrapper: {
    height: 40,
    justifyContent: 'center',
    alignItems: 'flex-start',
    backgroundColor: '#F0F4FF',
    borderRadius: 8,
    paddingHorizontal: 8,
  },
  userEmail: {
    fontSize: 12,
    marginTop: 2,
  },
  historySection: {
    flex: 1,
    paddingTop: 24,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 24,
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1,
  },
  clearText: {
    fontSize: 12,
    fontWeight: '600',
  },
  historyList: {
    flex: 1,
  },
  historyItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingVertical: 14,
  },
  historyIcon: {
    marginRight: 16,
  },
  historyText: {
    fontSize: 16,
    fontWeight: '500',
    flex: 1,
  },
  emptyHistory: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 40,
    paddingBottom: 100,
  },
  emptyText: {
    marginTop: 16,
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
  },
  loadingHistory: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingBottom: 100,
  },
  loadingText: {
    marginTop: 12,
    fontSize: 12,
    fontWeight: '600',
  },
});

export default AppNavigator;