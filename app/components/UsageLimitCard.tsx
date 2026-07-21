import React from 'react';
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

const FEATURE_META: Record<UsageFeature, { icon: string; label: string; limit: number }> = {
  search: { icon: 'search-outline', label: 'searches/day', limit: 5 },
  save: { icon: 'archive-outline', label: 'saves/day', limit: 3 },
  export: { icon: 'share-outline', label: 'exports/day', limit: 2 },
  interaction: { icon: 'git-network-outline', label: 'checks/day', limit: 2 },
};

const UsageLimitCard: React.FC<UsageLimitCardProps> = ({ visible, onClose, feature }) => {
  const theme = useTheme();
  const meta = FEATURE_META[feature];

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
            <Text style={[styles.limitTitle, { color: theme.colors.onSurface }]}>Your free plan allows:</Text>
            <View style={styles.limitRow}>
              <Ionicons name="search-outline" size={14} color={theme.colors.onSurfaceVariant} />
              <Text style={[styles.limitText, { color: theme.colors.onSurfaceVariant }]}>5 searches/day</Text>
            </View>
            <View style={styles.limitRow}>
              <Ionicons name="archive-outline" size={14} color={theme.colors.onSurfaceVariant} />
              <Text style={[styles.limitText, { color: theme.colors.onSurfaceVariant }]}>3 medicine saves/day</Text>
            </View>
            <View style={styles.limitRow}>
              <Ionicons name="share-outline" size={14} color={theme.colors.onSurfaceVariant} />
              <Text style={[styles.limitText, { color: theme.colors.onSurfaceVariant }]}>2 exports/day</Text>
            </View>
            <View style={styles.limitRow}>
              <Ionicons name="git-network-outline" size={14} color={theme.colors.onSurfaceVariant} />
              <Text style={[styles.limitText, { color: theme.colors.onSurfaceVariant }]}>2 interaction checks/day</Text>
            </View>
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
