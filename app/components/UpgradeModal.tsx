import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Modal } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';

interface UpgradeModalProps {
  visible: boolean;
  onClose: () => void;
  feature: string;
  currentCount?: number;
  maxLimit?: number;
}

const FEATURE_LABELS: Record<string, { icon: string; title: string; desc: string }> = {
  search: {
    icon: 'search-outline',
    title: 'Search Limit Reached',
    desc: 'You\'ve used all your free searches for today.',
  },
  interaction: {
    icon: 'git-network-outline',
    title: 'Interaction Limit Reached',
    desc: 'You\'ve used all your free interaction checks for today.',
  },
  save: {
    icon: 'archive-outline',
    title: 'Cabinet Limit Reached',
    desc: 'Your cabinet is full. Free users can save up to 3 medications.',
  },
  export: {
    icon: 'share-outline',
    title: 'Export is Pro Only',
    desc: 'Exporting summaries is a premium feature.',
  },
};

const UpgradeModal: React.FC<UpgradeModalProps> = ({
  visible,
  onClose,
  feature,
  currentCount,
  maxLimit,
}) => {
  const theme = useTheme();
  const navigation = useNavigation();
  const info = FEATURE_LABELS[feature] || FEATURE_LABELS.search;

  const handleUpgrade = () => {
    onClose();
    (navigation as any).navigate('Upgrade');
  };

  return (
    <Modal visible={visible} animationType="slide" transparent>
      <View style={styles.overlay}>
        <View style={[styles.content, { backgroundColor: theme.colors.surface }]}>
          <View style={[styles.iconCircle, { backgroundColor: theme.colors.primaryContainer }]}>
            <Ionicons name={(info.icon + '') as any} size={32} color={theme.colors.primary} />
          </View>

          <Text style={[styles.title, { color: theme.colors.onSurface }]}>{info.title}</Text>
          <Text style={[styles.desc, { color: theme.colors.onSurfaceVariant }]}>{info.desc}</Text>

          {currentCount !== undefined && maxLimit !== undefined && (
            <View style={[styles.counter, { backgroundColor: theme.colors.surfaceVariant }]}>
              <Text style={[styles.counterText, { color: theme.colors.onSurfaceVariant }]}>
                {currentCount}/{maxLimit} used
              </Text>
              <View style={[styles.progressBg, { backgroundColor: theme.colors.outlineVariant }]}>
                <View
                  style={[
                    styles.progressFill,
                    {
                      backgroundColor: theme.colors.primary,
                      width: `${Math.min((currentCount / maxLimit) * 100, 100)}%`,
                    },
                  ]}
                />
              </View>
            </View>
          )}

          <TouchableOpacity
            style={[styles.upgradeButton, { backgroundColor: theme.colors.primary }]}
            onPress={handleUpgrade}
          >
            <Ionicons name="sparkles" size={18} color="#FFF" />
            <Text style={styles.upgradeText}>Upgrade to Pro</Text>
          </TouchableOpacity>

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
  counter: {
    width: '100%',
    borderRadius: 12,
    padding: 16,
    marginBottom: 24,
    gap: 8,
  },
  counterText: {
    fontSize: 13,
    fontWeight: '600',
    textAlign: 'center',
  },
  progressBg: {
    height: 6,
    borderRadius: 3,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 3,
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

export default UpgradeModal;
