import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Modal } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { Ionicons } from '@expo/vector-icons';
import { FEATURES } from '../config/features';
import type { UsageFeature } from '../services/usage';
import { UsageService } from '../services/usage';

interface UsageLimitCardProps {
  visible: boolean;
  onClose: () => void;
  feature: UsageFeature;
}

const FEATURE_META: Record<UsageFeature, { icon: string; label: string }> = {
  search: { icon: 'search-outline', label: 'searches' },
  save: { icon: 'archive-outline', label: 'saves' },
  export: { icon: 'share-outline', label: 'exports' },
  interaction: { icon: 'git-network-outline', label: 'interaction checks' },
};

const UsageLimitCard: React.FC<UsageLimitCardProps> = ({ visible, onClose, feature }) => {
  const theme = useTheme();
  const meta = FEATURE_META[feature];
  const [usageData, setUsageData] = useState<Record<UsageFeature, { used: number; remaining: number }>>({
    search: { used: 0, remaining: 5 },
    save: { used: 0, remaining: 3 },
    export: { used: 0, remaining: 2 },
    interaction: { used: 0, remaining: 2 },
  });

  useEffect(() => {
    if (visible) {
      UsageService.getAllUsage().then(setUsageData);
    }
  }, [visible]);

  return (
    <Modal visible={visible} animationType="slide" transparent>
      <View style={styles.overlay}>
        <View style={[styles.content, { backgroundColor: theme.colors.surface }]}>
          <View style={[styles.iconCircle, { backgroundColor: theme.colors.primaryContainer }]}>
            <Ionicons name={meta.icon as any} size={32} color={theme.colors.primary} />
          </View>

          <Text style={[styles.title, { color: theme.colors.onSurface }]}>Daily Limit Reached</Text>
          <Text style={[styles.desc, { color: theme.colors.onSurfaceVariant }]}>
            You've reached today's limit for this feature.
          </Text>

          <View style={[styles.limitBox, { backgroundColor: theme.colors.surfaceVariant }]}>
            <Text style={[styles.limitTitle, { color: theme.colors.onSurface }]}>Today's usage</Text>
            {(Object.keys(FEATURE_META) as UsageFeature[]).map((f) => (
              <View key={f} style={styles.limitRow}>
                <Ionicons name={FEATURE_META[f].icon as any} size={14} color={theme.colors.onSurfaceVariant} />
                <Text style={[styles.limitText, { color: theme.colors.onSurfaceVariant }]}>
                  {usageData[f].used} of {UsageService.DAILY_LIMITS[f]} {FEATURE_META[f].label} used
                </Text>
              </View>
            ))}
          </View>

          <Text style={[styles.resetNote, { color: theme.colors.onSurfaceVariant }]}>
            Your limits will automatically reset after 24 hours.
          </Text>

          {FEATURES.ENABLE_PRO && (
            <TouchableOpacity
              style={[styles.upgradeButton, { backgroundColor: theme.colors.primary }]}
              onPress={onClose}
            >
              <Ionicons name="sparkles" size={18} color="#FFF" />
              <Text style={styles.upgradeText}>Upgrade to MedQuire Pro</Text>
            </TouchableOpacity>
          )}

          <TouchableOpacity style={styles.laterButton} onPress={onClose}>
            <Text style={[styles.laterText, { color: theme.colors.onSurfaceVariant }]}>Maybe Later</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
  },
  content: {
    width: '100%',
    maxWidth: 340,
    borderRadius: 24,
    padding: 32,
    alignItems: 'center',
  },
  iconCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    fontFamily: 'Outfit',
    textAlign: 'center',
    marginBottom: 8,
  },
  desc: {
    fontSize: 15,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 20,
  },
  limitBox: {
    width: '100%',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    gap: 8,
  },
  limitTitle: {
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 4,
  },
  limitRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  limitText: {
    fontSize: 14,
    fontWeight: '500',
  },
  resetNote: {
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 18,
    marginBottom: 24,
  },
  upgradeButton: {
    width: '100%',
    height: 52,
    borderRadius: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginBottom: 12,
  },
  upgradeText: {
    color: '#FFF',
    fontSize: 16,
    fontWeight: '700',
  },
  laterButton: {
    padding: 12,
  },
  laterText: {
    fontSize: 14,
    fontWeight: '600',
  },
});

export default UsageLimitCard;
