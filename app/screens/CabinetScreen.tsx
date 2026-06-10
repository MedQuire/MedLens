import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, Alert, ActivityIndicator, Modal } from 'react-native';
import * as Sharing from 'expo-sharing';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme, ThemeContextType } from '../theme/ThemeProvider';
import { useAuth } from '../context/AuthContext';
import { useNavigation } from '@react-navigation/native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import * as api from '../services/api';
import { CabinetItem } from '../services/api';
import { LocalStorageService } from '../services/storage';
import EmptyState from '../components/EmptyState';
import SummaryCard from '../components/SummaryCard';
import UpgradeModal from '../components/UpgradeModal';
import { PDFService } from '../services/pdf';
import { useCabinet } from '../context/CabinetContext';

const DRUG_DESCRIPTIONS: Record<string, string> = {
  'advil': 'Pain & fever relief',
  'tylenol': 'Pain & fever reducer',
  'motrin': 'Pain & fever reducer',
  'aspirin': 'Pain relief & heart health',
  'metformin': 'Blood sugar management',
  'lisinopril': 'Blood pressure control',
  'levothyroxine': 'Thyroid hormone',
  'atorvastatin': 'Cholesterol management',
  'amlodipine': 'Blood pressure control',
  'metoprolol': 'Heart rate & BP',
  'albuterol': 'Rescue inhaler',
  'omeprazole': 'Acid reflux & heartburn',
  'losartan': 'Blood pressure control',
  'gabapentin': 'Nerve pain & seizures',
  'simvastatin': 'Cholesterol management',
  'zyrtec': 'Allergy relief',
  'benadryl': 'Allergy & sleep aid',
  'lipitor': 'Cholesterol management',
  'amoxicillin': 'Antibiotic',
  'xanax': 'Anxiety management',
  'augmentin': 'Antibiotic',
  'sertraline': 'Depression & anxiety',
  'tramadol': 'Pain management',
  'diclofenac': 'Pain & inflammation',
  'piroxicam': 'Pain & inflammation',
};

const getDrugDescription = (name: string): string => {
  const lowerName = name.toLowerCase();
  for (const [key, desc] of Object.entries(DRUG_DESCRIPTIONS)) {
    if (lowerName.includes(key)) return desc;
  }
  return 'Saved medication';
};

const CabinetScreen: React.FC = () => {
  const theme = useTheme();
  const { user, isPro, getToken } = useAuth();
  const navigation = useNavigation() as any;
  const { items, loading: cabinetLoading, removeItem: removeFromCabinet, refreshCabinet, savedDrugNames } = useCabinet();
  const [loading, setLoading] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [interactionCount, setInteractionCount] = useState(0);
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  const [isModalVisible, setIsModalVisible] = useState(false);
  const [viewingItem, setViewingItem] = useState<CabinetItem | null>(null);
  const [selectedDrugSummary, setSelectedDrugSummary] = useState<api.SearchResponse | null>(null);
  const [upgradeFeature, setUpgradeFeature] = useState<string | null>(null);

  const fetchStats = useCallback(async () => {
    try {
      const statsCount = await LocalStorageService.getInteractionCount();
      setInteractionCount(statsCount);
    } catch (error) {
      console.error('[Cabinet] Stats fetch failed:', error);
    }
  }, []);

  useEffect(() => {
    fetchStats();
    refreshCabinet(); // Ensure fresh data on mount
  }, [fetchStats, refreshCabinet]);

  const toggleSelection = (drugKey: string) => {
    setSelectedItems(prev => {
      const newSet = new Set(prev);
      if (newSet.has(drugKey)) newSet.delete(drugKey);
      else newSet.add(drugKey);
      return newSet;
    });
  };

  const handleCheckInteractions = () => {
    const selectedKeys = Array.from(selectedItems);
    navigation.navigate('Interaction', { drugKeys: selectedKeys });
  };

  const handleViewDrug = async (item: CabinetItem) => {
    setViewingItem(item);
    setSelectedDrugSummary(null); // Clear previous summary immediately to avoid mapping issues
    try {
      // 1. Check Cache
      const cached = await LocalStorageService.getCachedResult(item.drug_name);
      if (cached) {
        setSelectedDrugSummary(cached);
        setIsModalVisible(true);
        return;
      }

      // 2. Fetch from API
      const response = await api.searchMedication(item.drug_name);
      setSelectedDrugSummary(response);
      
      // 3. Cache it
      await LocalStorageService.setCachedResult(item.drug_name, response);
      
      setIsModalVisible(true);
    } catch (error: any) {
      console.error('Failed to fetch drug summary:', error);
      setViewingItem(null); // Clear on error since modal won't show
      
      const isNotFound = error.status === 404 || error.message?.includes('404');
      if (isNotFound) {
        Alert.alert(
          'Information Unavailable',
          'We do not have enough reliable information for this medication.'
        );
      } else {
        Alert.alert('Error', 'Failed to load medication details. Please check your connection.');
      }
    }
  };

  const handleExport = useCallback(async () => {
    if (!selectedDrugSummary) return;
    if (!isPro) {
      setUpgradeFeature('export');
      return;
    }
    
    try { 
      setLoading(true);
      
      const uri = await PDFService.generateMedicationReport({
        drugName: selectedDrugSummary.drug_name,
        source: selectedDrugSummary.source,
        isEli12: false,
        sections: {
          whatItDoes: selectedDrugSummary.summary.what_it_does,
          howToTake: selectedDrugSummary.summary.how_to_take,
          warnings: selectedDrugSummary.summary.warnings,
          sideEffects: selectedDrugSummary.summary.side_effects,
        }
      });

      await Sharing.shareAsync(uri, { 
        mimeType: 'application/pdf', 
        dialogTitle: `Medication Report: ${selectedDrugSummary.drug_name}`,
        UTI: 'com.adobe.pdf'
      });
    }
    catch (error: any) { 
      console.error('PDF export failed:', error); 
      Alert.alert('Export Failed', 'We could not generate the medical report PDF. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [selectedDrugSummary]);

  const handleDeleteDrug = async (item: CabinetItem) => {
    Alert.alert(
      'Remove Medication',
      `Are you sure you want to remove ${item.drug_name} from your cabinet?`,
      [
        { text: 'Cancel', style: 'cancel' },
        { 
          text: 'Remove', 
          style: 'destructive',
          onPress: async () => {
            try {
              await removeFromCabinet(item.id);
              console.log(`[Cabinet] Successfully hard deleted ${item.drug_name}`);
            } catch (error) {
              console.error('[Cabinet] Failed to delete drug:', error);
              Alert.alert('Error', 'Failed to remove medication. Please try again.');
            }
          }
        }
      ]
    );
  };

  const showActionMenu = (item: CabinetItem) => {
    Alert.alert(
      item.drug_name,
      'Select an action',
      [
        { 
          text: 'View summary', 
          onPress: () => handleViewDrug(item) 
        },
        { 
          text: 'Delete from cabinet', 
          style: 'destructive',
          onPress: () => handleDeleteDrug(item)
        },
        { text: 'Cancel', style: 'cancel' }
      ]
    );
  };

  const renderHeader = () => (
    <View style={styles.headerContent}>
      {/* Inline stats row */}
      <View style={styles.statsRow}>
        <View style={[styles.statPill, { backgroundColor: theme.colors.primary + '0C' }]}>
          <Text style={[styles.statValue, { color: theme.colors.primary }]}>{items.length}</Text>
          <Text style={[styles.statLabel, { color: theme.colors.primary }]}>saved</Text>
        </View>
        <View style={[styles.statPill, { backgroundColor: theme.colors.tertiary + '0C' }]}>
          <Text style={[styles.statValue, { color: theme.colors.tertiary }]}>{interactionCount}</Text>
          <Text style={[styles.statLabel, { color: theme.colors.tertiary }]}>checks</Text>
        </View>
      </View>

      {/* Section label */}
      <View style={styles.sectionHeader}>
        <Text style={[styles.sectionLabel, { color: theme.colors.onSurface }]}>Medications</Text>
        {selectedItems.size > 0 && (
          <Text style={[styles.selectionCount, { color: theme.colors.primary }]}>
            {selectedItems.size} selected
          </Text>
        )}
      </View>
    </View>
  );

  const renderInteractionCTA = () => {
    if (items.length < 2) return null;
    const canCheck = selectedItems.size >= 2;
    
    return (
      <View style={styles.ctaSection}>
        <View style={styles.ctaContent}>
          <View style={styles.ctaTextRow}>
            <Ionicons name="shield-checkmark-outline" size={18} color={theme.colors.onSurfaceVariant} />
            <Text style={[styles.ctaText, { color: theme.colors.onSurfaceVariant }]}>
              Select 2+ medications to check for interactions
            </Text>
          </View>
          <TouchableOpacity
            style={[
              styles.ctaButton,
              { 
                backgroundColor: canCheck ? theme.colors.primary : theme.colors.surfaceContainerHigh,
              }
            ]}
            disabled={!canCheck}
            onPress={handleCheckInteractions}
          >
            <Text style={[
              styles.ctaButtonText, 
              { color: canCheck ? theme.colors.onPrimary : theme.colors.outline }
            ]}>
              Check Interactions
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  const renderItem = ({ item }: { item: CabinetItem }) => {
    const isSelected = selectedItems.has(item.drug_key);
    return (
      <TouchableOpacity 
        style={[
          styles.medCard,
          { 
            backgroundColor: isSelected ? theme.colors.primary + '08' : theme.colors.surface,
            borderColor: isSelected ? theme.colors.primary + '25' : theme.colors.outlineVariant + '30',
          }
        ]}
        onPress={() => handleViewDrug(item)}
        activeOpacity={0.7}
      >
        {/* Checkbox */}
        <TouchableOpacity 
          style={styles.checkboxHit} 
          onPress={() => toggleSelection(item.drug_key)}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <View style={[
            styles.checkbox, 
            { 
              borderColor: isSelected ? theme.colors.primary : theme.colors.outlineVariant,
            },
            isSelected && { backgroundColor: theme.colors.primary, borderColor: theme.colors.primary }
          ]}>
            {isSelected && (
              <Ionicons name="checkmark" size={13} color={theme.colors.onPrimary} />
            )}
          </View>
        </TouchableOpacity>
        
        {/* Info */}
        <View style={styles.medInfo}>
          <Text style={[styles.medName, { color: theme.colors.onSurface }]} numberOfLines={1}>
            {item.drug_name}
          </Text>
          <Text style={[styles.medDesc, { color: theme.colors.outline }]} numberOfLines={1}>
            {item.description || getDrugDescription(item.drug_name)}
          </Text>
        </View>

        {/* Action */}
        <TouchableOpacity 
          style={styles.moreBtn}
          onPress={() => showActionMenu(item)}
          disabled={viewingItem !== null}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          {viewingItem?.id === item.id ? (
            <ActivityIndicator size="small" color={theme.colors.primary} />
          ) : (
            <Ionicons name="ellipsis-horizontal" size={18} color={theme.colors.outline} />
          )}
        </TouchableOpacity>
      </TouchableOpacity>
    );
  };

  if (cabinetLoading && items.length === 0) {
    return (
      <View style={[styles.container, { backgroundColor: theme.colors.background, justifyContent: 'center' }]}>
        <ActivityIndicator size="large" color={theme.colors.primary} />
      </View>
    );
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.colors.background }]} edges={['top']}>
      {/* Header */}
      <View style={[styles.topBar, { backgroundColor: theme.colors.background }]}>
        <View style={styles.headerTitleRow}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
            <Ionicons name="arrow-back" size={24} color={theme.colors.onSurface} />
          </TouchableOpacity>
          <Text style={[styles.title, { color: theme.colors.onSurface }]}>My Cabinet</Text>
        </View>
        <Text style={[styles.subtitle, { color: theme.colors.outline }]}>Your saved medications</Text>
      </View>

      <FlatList
        data={items}
        renderItem={renderItem}
        keyExtractor={item => item.id}
        ListHeaderComponent={renderHeader}
        ListFooterComponent={renderInteractionCTA}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={<EmptyState type="empty_cabinet" title="No medications saved" subtitle="Search and save drugs to populate your cabinet." />}
        showsVerticalScrollIndicator={false}
      />

      {/* Drug Summary Modal */}
      <Modal
        visible={isModalVisible}
        transparent={true}
        animationType="slide"
        onRequestClose={() => setIsModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: theme.colors.background }]}>
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: theme.colors.onSurface }]}>Medication Summary</Text>
              <TouchableOpacity
                onPress={() => {
                  setIsModalVisible(false);
                  setSelectedDrugSummary(null); 
                  setViewingItem(null); 
                }}
                style={styles.closeBtn}
              >
                <Ionicons name="close" size={24} color={theme.colors.onSurfaceVariant} />
              </TouchableOpacity>
            </View>

            <FlatList
              data={[selectedDrugSummary]}
              keyExtractor={(item) => item ? `${item.drug_name}-${item.source}` : 'summary-loading'}
              renderItem={() => selectedDrugSummary ? (
                <View style={styles.cardWrapper}>
                  <SummaryCard
                    drugName={viewingItem?.drug_name || selectedDrugSummary.drug_name}
                    drugKey={viewingItem?.drug_key || selectedDrugSummary.drug_name.toLowerCase().replace(/\s+/g, '-')}
                    source={selectedDrugSummary.source}
                    isSaved={true}
                    onExport={handleExport}
                    sections={{
                      whatItDoes: selectedDrugSummary.summary.what_it_does,
                      howToTake: selectedDrugSummary.summary.how_to_take,
                      warnings: selectedDrugSummary.summary.warnings,
                      sideEffects: selectedDrugSummary.summary.side_effects,
                    }}
                  />
                </View>
              ) : (
                <View style={styles.modalLoading}>
                  <ActivityIndicator size="large" color={theme.colors.primary} />
                  <Text style={[styles.loadingText, { color: theme.colors.outline }]}>Preparing summary…</Text>
                </View>
              )}
              contentContainerStyle={styles.modalScrollContent}
            />
          </View>
        </View>
      </Modal>

      <UpgradeModal
        visible={upgradeFeature !== null}
        feature={upgradeFeature || 'export'}
        onClose={() => setUpgradeFeature(null)}
      />
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingTop: 16,
  },

  // ── Top Bar ──
  topBar: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 12,
  },
  headerTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  backBtn: {
    marginRight: 12,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    fontFamily: 'Outfit',
    letterSpacing: -0.5,
  },
  subtitle: {
    fontSize: 14,
    fontWeight: '400',
    fontFamily: 'Outfit',
    marginTop: 4,
    marginLeft: 36,
  },

  // ── List Content ──
  listContent: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 40,
  },

  // ── Header / Stats ──
  headerContent: {
    paddingBottom: 8,
  },
  statsRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 24,
  },
  statPill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    gap: 5,
  },
  statValue: {
    fontSize: 17,
    fontWeight: '600',
    fontFamily: 'Outfit',
  },
  statLabel: {
    fontSize: 14,
    fontWeight: '400',
    fontFamily: 'Outfit',
    opacity: 0.8,
  },

  // ── Section Label ──
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    marginBottom: 12,
  },
  sectionLabel: {
    fontSize: 17,
    fontWeight: '600',
    fontFamily: 'Outfit',
    letterSpacing: -0.2,
  },
  selectionCount: {
    fontSize: 12,
    fontWeight: '600',
    fontFamily: 'Outfit',
  },

  // ── Medication Card ──
  medCard: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingLeft: 10,
    paddingRight: 12,
    borderRadius: 14,
    marginBottom: 6,
    borderWidth: 1,
  },
  checkboxHit: {
    padding: 4,
  },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 6,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  drugIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 8,
    marginRight: 10,
  },
  medInfo: {
    flex: 1,
    marginLeft: 12,
    marginRight: 8,
  },
  medName: {
    fontSize: 16,
    fontWeight: '600',
    fontFamily: 'Outfit',
    letterSpacing: -0.2,
  },
  medDesc: {
    fontSize: 14,
    fontWeight: '400',
    fontFamily: 'Outfit',
    marginTop: 2,
  },
  moreBtn: {
    width: 32,
    height: 32,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // ── Interaction CTA ──
  ctaSection: {
    marginTop: 20,
    paddingBottom: 8,
  },
  ctaDivider: {
    height: 1,
    marginBottom: 16,
  },
  ctaContent: {
    gap: 12,
  },
  ctaTextRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  ctaText: {
    fontSize: 14,
    fontWeight: '400',
    fontFamily: 'Outfit',
    flex: 1,
  },
  ctaButton: {
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctaButtonText: {
    fontSize: 16,
    fontWeight: '700',
    fontFamily: 'Outfit',
  },

  // ── Modal ──
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    height: '92%',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingTop: 20,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingBottom: 16,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
    fontFamily: 'Outfit',
    letterSpacing: -0.3,
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalScrollContent: {
    paddingHorizontal: 20,
    paddingBottom: 40,
  },
  cardWrapper: {
    paddingTop: 4,
  },
  modalLoading: {
    flex: 1,
    paddingTop: 100,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingText: {
    marginTop: 12,
    fontSize: 13,
    fontWeight: '600',
    fontFamily: 'Outfit',
  },
});

export default CabinetScreen;