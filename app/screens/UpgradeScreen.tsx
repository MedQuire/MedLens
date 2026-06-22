import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  ScrollView,
} from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '../theme/ThemeProvider';
import { useAuth } from '../context/AuthContext';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import * as api from '../services/api';

const PRICES: Record<string, Record<string, { price: string, raw: number }>> = {
  PREMIUM_MONTHLY: {
    USD: { price: '$9.99', raw: 9.99 },
    NGN: { price: '₦1,500', raw: 1500 },
  },
  PREMIUM_YEARLY: {
    USD: { price: '$89.99', raw: 89.99 },
    NGN: { price: '₦13,500', raw: 13500 },
  },
};

const PLANS = [
  {
    id: 'PREMIUM_MONTHLY' as const,
    name: 'Monthly',
    badge: null,
  },
  {
    id: 'PREMIUM_YEARLY' as const,
    name: 'Yearly',
    badge: 'Save 25%',
  },
];

const FEATURES = [
  { icon: 'infinite', text: 'Unlimited AI conversations' },
  { icon: 'medkit-outline', text: 'Advanced medication insights' },
  { icon: 'archive-outline', text: 'Unlimited cabinet storage' },
  { icon: 'git-network-outline', text: 'Premium interaction analysis' },
  { icon: 'share-outline', text: 'Export & share summaries' },
];

const UpgradeScreen: React.FC = () => {
  const theme = useTheme();
  const navigation = useNavigation();
  const { getToken, refreshSubscription } = useAuth();
  const [selectedPlan, setSelectedPlan] = useState<'PREMIUM_MONTHLY' | 'PREMIUM_YEARLY'>('PREMIUM_YEARLY');
  const [selectedCurrency, setSelectedCurrency] = useState<'USD' | 'NGN'>('USD');
  const [isLoading, setIsLoading] = useState(false);

  const handleUpgrade = async () => {
    setIsLoading(true);
    try {
      const token = await getToken();
      if (!token) {
        Alert.alert('Error', 'Please sign in to upgrade.');
        return;
      }

      const response = await api.createSubscription(selectedPlan, selectedCurrency, token);

      if (response.checkout_url) {
        await WebBrowser.openBrowserAsync(response.checkout_url);
        await refreshSubscription();
        const token2 = await getToken();
        if (token2) {
          try {
            const sub = await api.getCurrentSubscription(token2);
            if (sub.status === 'ACTIVE') {
              Alert.alert('Welcome to Premium!', 'Your subscription is now active.', [
                { text: 'Great!', onPress: () => navigation.goBack() },
              ]);
            } else {
              Alert.alert(
                'Still Processing',
                'Your payment may still be processing. Check your subscription status in Settings.'
              );
            }
          } catch (_) {}
        }
      }
    } catch (error: any) {
      const msg = error?.data?.message || error?.message || 'Something went wrong.';
      Alert.alert('Upgrade Failed', msg);
    } finally {
      setIsLoading(false);
    }
  };

  const handleRestore = () => {
    Alert.alert('Restore', 'Please sign in to the account you used for your original purchase.');
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.colors.background }]} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
          <Ionicons name="arrow-back" size={24} color={theme.colors.onSurface} />
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.hero}>
          <Ionicons name="sparkles" size={48} color={theme.colors.primary} />
          <Text style={[styles.title, { color: theme.colors.onSurface }]}>Upgrade to Premium</Text>
          <Text style={[styles.subtitle, { color: theme.colors.onSurfaceVariant }]}>
            Unlock the full MedQuire experience
          </Text>
        </View>

        <View style={styles.features}>
          {FEATURES.map((f, i) => (
            <View key={i} style={styles.featureRow}>
              <Ionicons name={f.icon as any} size={20} color={theme.colors.primary} />
              <Text style={[styles.featureText, { color: theme.colors.onSurface }]}>{f.text}</Text>
            </View>
          ))}
        </View>

        <View style={styles.currencyToggle}>
          <TouchableOpacity
            style={[
              styles.currencyOption,
              {
                backgroundColor: selectedCurrency === 'USD' ? theme.colors.primary : theme.colors.surfaceContainer,
              },
            ]}
            onPress={() => setSelectedCurrency('USD')}
          >
            <Text style={[styles.currencyText, { color: selectedCurrency === 'USD' ? '#FFF' : theme.colors.onSurface }]}>USD</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[
              styles.currencyOption,
              {
                backgroundColor: selectedCurrency === 'NGN' ? theme.colors.primary : theme.colors.surfaceContainer,
              },
            ]}
            onPress={() => setSelectedCurrency('NGN')}
          >
            <Text style={[styles.currencyText, { color: selectedCurrency === 'NGN' ? '#FFF' : theme.colors.onSurface }]}>NGN</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.plansContainer}>
          {PLANS.map((plan) => {
            const pricing = PRICES[plan.id][selectedCurrency];
            const periodLabel = selectedCurrency === 'USD'
              ? (plan.id === 'PREMIUM_MONTHLY' ? '/month' : '/year')
              : (plan.id === 'PREMIUM_MONTHLY' ? '/mo' : '/yr');
            return (
              <TouchableOpacity
                key={plan.id}
                style={[
                  styles.planCard,
                  {
                    backgroundColor: theme.colors.surfaceContainer,
                    borderColor: selectedPlan === plan.id ? theme.colors.primary : 'transparent',
                  },
                ]}
                onPress={() => setSelectedPlan(plan.id)}
              >
                <View style={styles.planTop}>
                  <View style={styles.planInfo}>
                    <Text style={[styles.planName, { color: theme.colors.onSurface }]}>{plan.name}</Text>
                    {plan.badge && selectedCurrency === 'USD' && (
                      <View style={[styles.badge, { backgroundColor: theme.colors.primaryContainer }]}>
                        <Text style={[styles.badgeText, { color: theme.colors.primary }]}>{plan.badge}</Text>
                      </View>
                    )}
                  </View>
                  <View style={styles.radioOuter}>
                    {selectedPlan === plan.id && (
                      <View style={[styles.radioInner, { backgroundColor: theme.colors.primary }]} />
                    )}
                  </View>
                </View>
                <View style={styles.priceRow}>
                  <Text style={[styles.price, { color: theme.colors.onSurface }]}>{pricing.price}</Text>
                  <Text style={[styles.period, { color: theme.colors.onSurfaceVariant }]}>{periodLabel}</Text>
                </View>
              </TouchableOpacity>
            );
          })}
        </View>

        <TouchableOpacity
          style={[styles.upgradeButton, { backgroundColor: theme.colors.primary, opacity: isLoading ? 0.7 : 1 }]}
          onPress={handleUpgrade}
          disabled={isLoading}
        >
          {isLoading ? (
            <ActivityIndicator color="#FFF" />
          ) : (
            <Text style={styles.upgradeButtonText}>
              {selectedPlan === 'PREMIUM_YEARLY' ? 'Upgrade Yearly' : 'Upgrade Monthly'}
            </Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity style={styles.restoreButton} onPress={handleRestore}>
          <Text style={[styles.restoreText, { color: theme.colors.primary }]}>Restore Purchase</Text>
        </TouchableOpacity>

        <Text style={[styles.disclaimer, { color: theme.colors.onSurfaceVariant }]}>
          Payment is processed securely by Paystack. Your card details never reach MedQuire.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 8,
  },
  backButton: { padding: 4, marginLeft: -4 },
  content: { padding: 24, paddingBottom: 48 },
  hero: { alignItems: 'center', marginBottom: 32, gap: 8 },
  title: { fontSize: 28, fontWeight: '700', fontFamily: 'Outfit' },
  subtitle: { fontSize: 16, textAlign: 'center' },
  features: { gap: 16, marginBottom: 32 },
  featureRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  featureText: { fontSize: 16 },
  plansContainer: { gap: 12, marginBottom: 24 },
  planCard: {
    borderRadius: 16,
    padding: 20,
    borderWidth: 2,
  },
  planTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  planInfo: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  planName: { fontSize: 18, fontWeight: '600' },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 8,
  },
  badgeText: { fontSize: 12, fontWeight: '700' },
  radioOuter: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: '#ccc',
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioInner: {
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  currencyToggle: {
    flexDirection: 'row',
    alignSelf: 'center',
    marginBottom: 24,
    borderRadius: 12,
    overflow: 'hidden',
  },
  currencyOption: {
    paddingHorizontal: 32,
    paddingVertical: 10,
  },
  currencyText: { fontSize: 15, fontWeight: '700' },
  priceRow: { flexDirection: 'row', alignItems: 'baseline', gap: 4 },
  price: { fontSize: 28, fontWeight: '700' },
  period: { fontSize: 14 },
  upgradeButton: {
    height: 56,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  upgradeButtonText: { color: '#FFF', fontSize: 18, fontWeight: '700' },
  restoreButton: { alignItems: 'center', padding: 12, marginBottom: 24 },
  restoreText: { fontSize: 15, fontWeight: '600' },
  disclaimer: { fontSize: 12, textAlign: 'center', lineHeight: 18 },
});

export default UpgradeScreen;
