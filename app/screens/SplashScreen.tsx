import React, { useEffect, useState, useRef } from 'react';
import { View, StyleSheet, Animated, Text, StatusBar } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { useAuth } from '../context/AuthContext';
import { LocalStorageService } from '../services/storage';
import { SvgXml } from 'react-native-svg';
import { LOGO_SVG } from '../assets/logo_svg';

type SplashScreenProps = any;

const SplashScreen: React.FC<SplashScreenProps> = ({ navigation }) => {
  const theme = useTheme();
  const { session, loading: authLoading } = useAuth();
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const scaleAnim = useRef(new Animated.Value(0.95)).current;
  const screenOpacity = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    // Entrance animations: Slower and more graceful
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 1200,
        useNativeDriver: true,
      }),
      Animated.spring(scaleAnim, {
        toValue: 1,
        friction: 9,
        tension: 30,
        useNativeDriver: true,
      }),
    ]).start();

    const checkRouting = async () => {
      console.log('[Splash] Initializing routing check...');

      try {
        // FOR DEVELOPMENT: Reset onboarding so you can see the changes
        await LocalStorageService.resetOnboarding();

        // Balanced visibility time for premium feel (4 seconds)
        // This allows session checks to complete in the background while the user sees the brand
        const startTime = Date.now();

        const isAuthenticated = !!session?.user;
        const hasAuthenticatedBefore = await LocalStorageService.getHasAuthenticatedBefore();
        const onboardingCompleted = await LocalStorageService.getOnboardingCompleted();

        // Calculate remaining time to hit the ~4s mark
        const elapsed = Date.now() - startTime;
        const remaining = Math.max(4000 - elapsed, 500);
        await new Promise(resolve => setTimeout(resolve, remaining));

        console.log('[Splash] Routing Diagnosis:');
        console.log(`  - Session exists: ${!!session}`);
        console.log(`  - Authenticated user: ${isAuthenticated}`);
        console.log(`  - Has authenticated before: ${hasAuthenticatedBefore}`);
        console.log(`  - Onboarding completed: ${onboardingCompleted}`);

        // Smoothly fade out the entire splash content before transition
        Animated.timing(screenOpacity, {
          toValue: 0,
          duration: 600,
          useNativeDriver: true,
        }).start(() => {
          if (isAuthenticated) {
            console.log('[Splash] Result: Navigating directly to Home (Authenticated)');
            navigation.replace('Home');
          } else if (hasAuthenticatedBefore) {
            console.log('[Splash] Result: Navigating to Login (Returning User)');
            navigation.replace('Login');
          } else if (!onboardingCompleted) {
            console.log('[Splash] Result: Navigating to Onboarding (New User)');
            navigation.replace('Onboarding');
          } else {
            console.log('[Splash] Result: Navigating to Login (Onboarding done, but not authenticated)');
            navigation.replace('Login');
          }
        });
      } catch (error) {
        console.error('[Splash] Routing critical error:', error);
        navigation.replace('Onboarding');
      }
    };

    if (!authLoading) {
      checkRouting();
    }
  }, [authLoading, session, navigation]);

  return (
    <Animated.View style={[styles.container, { backgroundColor: '#F0F4FF', opacity: screenOpacity }]}>
      <StatusBar barStyle="dark-content" />
      <Animated.View
        style={[
          styles.content,
          {
            opacity: fadeAnim,
            transform: [{ scale: scaleAnim }]
          }
        ]}
      >
        <View style={styles.logoWrapper}>
          <SvgXml xml={LOGO_SVG} width={200} height={100} />
        </View>
      </Animated.View>

      <View style={styles.footer}>
        <Text style={[styles.footerText, { color: theme.colors.onPrimaryContainer }]}>
          Your Medication Simplified
        </Text>
      </View>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoWrapper: {
    marginBottom: 20,
  },
  footer: {
    position: 'absolute',
    bottom: 50,
  },
  footerText: {
    fontSize: 14,
    fontWeight: '500',
    opacity: 0.8,
    letterSpacing: 0.5,
  },
});

export default SplashScreen;