import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Alert, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { useAuth } from '../context/AuthContext';
import { useRoute, useNavigation } from '@react-navigation/native';
import type { RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../navigation/AppNavigator';
import * as api from '../services/api';
import { useTheme, ThemeContextType } from '../theme/ThemeProvider';
import { LocalStorageService } from '../services/storage';
import InteractionSkeleton from '../components/InteractionSkeleton';
import UpgradeModal from '../components/UpgradeModal';



interface DrugItem {
  id: string;
  name: string;
  key: string;
}

const InteractionScreen: React.FC = () => {
  const theme = useTheme();
  const { user, getToken } = useAuth();
  const route = (useRoute as any)();
  const navigation = (useNavigation as any)();
  const [selectedDrugs, setSelectedDrugs] = useState<string[]>([]);
  const [availableDrugs, setAvailableDrugs] = useState<DrugItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState(false);
  const [isELI12, setIsELI12] = useState(false);
  const [result, setResult] = useState<api.InteractionResponse | null>(null);
  const [upgradeFeature, setUpgradeFeature] = useState<string | null>(null);

  // Load cabinet items for selection
  useEffect(() => {
    const loadCabinetItems = async () => {
      // If drugKeys provided via params, use those directly — no DB call needed
      const paramDrugKeys = route.params?.drugKeys;
      if (paramDrugKeys && paramDrugKeys.length > 0) {
        const drugItems = paramDrugKeys.map((key: string, index: number) => ({
          id: `param-${index}`,
          name: key.charAt(0).toUpperCase() + key.slice(1),
          key,
        }));
        setAvailableDrugs(drugItems);
        setSelectedDrugs(paramDrugKeys);
        setLoading(false);
        return;
      }
      
      // No user = no cabinet = no DB call needed
      if (!user) {
        setAvailableDrugs([]);
        setLoading(false);
        return;
      }

      setLoading(true);
      
      try {
        const token = await getToken();
        if (!token) {
          Alert.alert('Error', 'Authentication required.');
          setAvailableDrugs([]);
          setLoading(false);
          return;
        }
        
        const response = await api.getCabinetItems(token);
        const drugItems = response.items.map(item => ({
          id: item.id,
          name: item.drug_name,
          key: item.drug_key,
        }));
        setAvailableDrugs(drugItems);
        
        // Auto-select first two if less than 5 total
        if (drugItems.length >= 2 && drugItems.length <= 5) {
          setSelectedDrugs([drugItems[0].key, drugItems[1].key]);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        console.error('Failed to load drugs:', message);
        Alert.alert('Error', 'Failed to load medications. Please try again.');
        setAvailableDrugs([]);
      } finally {
        setLoading(false);
      }
    };
    
    loadCabinetItems();
  }, [user, getToken, route.params?.drugKeys]);

  const toggleDrug = (key: string) => {
    setSelectedDrugs(prev =>
      prev.includes(key)
        ? prev.filter(k => k !== key)
        : [...prev, key]
    );
    setResult(null);
  };

  const handleCheck = useCallback(async () => {
    if (selectedDrugs.length < 2) {
      Alert.alert('Select Medications', 'Please select at least two medications to check interactions.');
      return;
    }

    setChecking(true);
    setResult(null);
    
    try {
      // 1. Check Local Cache
      const cached = await LocalStorageService.getCachedInteraction(selectedDrugs);
      if (cached) {
        setResult(cached);
        LocalStorageService.incrementInteractionCount();
        return;
      }

      // 2. Fetch from API
      const response = await api.checkInteractions(selectedDrugs);
      setResult(response);
      LocalStorageService.incrementInteractionCount();

      // 3. Save to Cache
      await LocalStorageService.setCachedInteraction(selectedDrugs, response);
    } catch (error: any) {
      if (error.status === 403 && error.error === 'free_plan_limit') {
        setUpgradeFeature(error.feature || 'interaction');
        return;
      }
      const message = error instanceof Error ? error.message : 'Unknown error';
      console.error('Interaction check failed:', message);
      Alert.alert('Error', 'Failed to check interactions. Please try again.');
    } finally {
      setChecking(false);
    }
  }, [selectedDrugs]);

  if (loading) {
    return (
      <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
        <View style={styles.header}>
          <View style={styles.headerTop}>
            <Text style={[styles.headerTitle, { color: theme.colors.onSurface }]}>Interaction Checker</Text>
            <TouchableOpacity onPress={() => navigation.goBack()} style={styles.closeButton}>
              <Ionicons name="close" size={28} color={theme.colors.onSurface} />
            </TouchableOpacity>
          </View>
        </View>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={theme.colors.primary} />
          <Text style={[styles.loadingText, { color: theme.colors.onSurfaceVariant }]}>
            Loading medications...
          </Text>
        </View>
      </View>
    );
  }

  if (availableDrugs.length === 0) {
    return (
      <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
        <View style={styles.header}>
          <View style={styles.headerTop}>
            <Text style={[styles.headerTitle, { color: theme.colors.onSurface }]}>Interaction Checker</Text>
            <TouchableOpacity onPress={() => navigation.goBack()} style={styles.closeButton}>
              <Ionicons name="close" size={28} color={theme.colors.onSurface} />
            </TouchableOpacity>
          </View>
          <Text style={[styles.headerSubtitle, { color: theme.colors.outline }]}>
            Select two or more medications to check for potential interactions
          </Text>
        </View>
        <View style={styles.emptyContainer}>
          <Text style={[styles.emptyTitle, { color: theme.colors.onSurface }]}>
            No medications available
          </Text>
          <Text style={[styles.emptySubtitle, { color: theme.colors.onSurfaceVariant }]}>
            {user 
              ? 'Save medications to your cabinet first to check interactions.'
              : 'Sign in and save medications to check interactions.'}
          </Text>
          <TouchableOpacity
            style={[styles.cabinetButton, { backgroundColor: theme.colors.primary }]}
            onPress={() => navigation.navigate(user ? 'Cabinet' : 'Settings')}
          >
            <Text style={[styles.cabinetButtonText, { color: theme.colors.onPrimary }]}>
              {user ? 'Go to Cabinet' : 'Go to Settings'}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <>
    <ScrollView style={[styles.container, { backgroundColor: theme.colors.background }]}>
      <View style={styles.header}>
        <View style={styles.headerTop}>
          <View>
            <Text style={[styles.headerTitle, { color: theme.colors.onSurface }]}>Interaction Checker</Text>
            <Text style={[styles.headerSubtitle, { color: theme.colors.outline }]}>
              Safety check for combined meds
            </Text>
          </View>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.closeButton}>
            <Ionicons name="close" size={24} color={theme.colors.onSurfaceVariant} />
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.drugSelection}>
        <View style={styles.sectionHeader}>
          <Text style={[styles.sectionLabel, { color: theme.colors.onSurface }]}>Select Medications</Text>
          <Text style={[styles.selectedCount, { color: theme.colors.primary }]}>
            {selectedDrugs.length} selected
          </Text>
        </View>
        <View style={styles.drugList}>
          {availableDrugs.map(drug => {
            const isSelected = selectedDrugs.includes(drug.key);
            return (
              <TouchableOpacity
                key={drug.id}
                style={[
                  styles.drugChip,
                  { 
                    backgroundColor: isSelected ? theme.colors.primary + '10' : theme.colors.surface,
                    borderColor: isSelected ? theme.colors.primary : theme.colors.outlineVariant,
                  },
                ]}
                onPress={() => toggleDrug(drug.key)}
              >
                <Text style={[
                  styles.drugChipText,
                  { color: isSelected ? theme.colors.primary : theme.colors.onSurfaceVariant },
                ]}>
                  {drug.name}
                </Text>
                {isSelected && (
                  <Ionicons name="checkmark" size={14} color={theme.colors.primary} />
                )}
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

      <View style={styles.buttonContainer}>
        <TouchableOpacity
          style={[
            styles.checkButton,
            { 
              backgroundColor: selectedDrugs.length >= 2 && !checking 
                ? theme.colors.primary 
                : theme.colors.surfaceContainerHigh 
            },
          ]}
          onPress={handleCheck}
          disabled={selectedDrugs.length < 2 || checking}
        >
          {checking ? (
            <ActivityIndicator size="small" color={theme.colors.onPrimary} />
          ) : (
            <Text style={[
              styles.checkButtonText,
              { color: selectedDrugs.length >= 2 ? theme.colors.onPrimary : theme.colors.outline },
            ]}>
              Check Interaction
            </Text>
          )}
        </TouchableOpacity>
      </View>

      {checking && <InteractionSkeleton />}

      {result && (
        <View style={styles.resultWrapper}>
          <View style={styles.resultHeader}>
            <Text style={[styles.sectionLabel, { color: theme.colors.onSurface }]}>
              Findings
            </Text>
            <TouchableOpacity 
              style={[
                styles.eliToggle,
                { backgroundColor: isELI12 ? theme.colors.primary + '15' : theme.colors.surfaceVariant + '30' }
              ]}
              onPress={() => setIsELI12(!isELI12)}
            >
              <Text style={[styles.eliToggleText, { color: isELI12 ? theme.colors.primary : theme.colors.onSurfaceVariant }]}>
                Simple Mode (ELI12)
              </Text>
              <View style={[styles.toggleTrack, { backgroundColor: isELI12 ? theme.colors.primary : theme.colors.outlineVariant }]}>
                <View style={[styles.toggleThumb, isELI12 ? styles.toggleThumbActive : styles.toggleThumbInactive, { backgroundColor: '#FFF' }]} />
              </View>
            </TouchableOpacity>
          </View>

          <View style={[
            styles.resultCard,
            { 
              backgroundColor: 
                result.status === 'risky' || result.status === 'potential_interaction' ? theme.colors.errorContainer + '15' : 
                result.status === 'caution' ? theme.colors.accentContainer + '15' :
                result.status === 'safe' ? theme.colors.successContainer + '15' :
                theme.colors.surfaceContainerLow,
              borderColor: 
                result.status === 'risky' || result.status === 'potential_interaction' ? theme.colors.error + '40' : 
                result.status === 'caution' ? theme.colors.accent + '40' :
                result.status === 'safe' ? theme.colors.success + '40' :
                theme.colors.outlineVariant,
              borderWidth: 1,
            },
          ]}>
            <View style={styles.resultTitleRow}>
              <View style={[
                styles.statusDot, 
                { 
                  backgroundColor: 
                    result.status === 'risky' || result.status === 'potential_interaction' ? theme.colors.error : 
                    result.status === 'caution' ? theme.colors.accent :
                    result.status === 'safe' ? theme.colors.success :
                    theme.colors.outline
                }
              ]} />
              <Text style={[
                styles.resultTitle,
                { 
                  color: 
                    result.status === 'risky' || result.status === 'potential_interaction' ? theme.colors.error : 
                    result.status === 'caution' ? theme.colors.accent :
                    result.status === 'safe' ? theme.colors.success :
                    theme.colors.onSurface
                },
              ]}>
                {
                  result.status === 'risky' || result.status === 'potential_interaction' ? 'Risky Interaction' : 
                  result.status === 'caution' ? 'Use with Caution' :
                  result.status === 'safe' ? 'No Known Interactions' :
                  'Unknown Result'
                }
              </Text>
            </View>
          <Text style={[
            styles.resultMessage,
            { color: theme.colors.outline },
          ]}>
            {isELI12 && result.eli12_summary ? result.eli12_summary : result.message}
          </Text>
          {result.details?.interactions && result.details.interactions.length > 0 && (
            <View style={[styles.interactionDetails, { borderTopColor: theme.colors.outlineVariant + '40' }]}>
              <Text style={[styles.detailsTitle, { color: theme.colors.onSurface }]}>
                Interaction Details:
              </Text>
              {result.details.interactions.map((interaction, index) => (
                <View key={index} style={styles.interactionItem}>
                  <Text style={[styles.drugKey, { color: theme.colors.primary }]}>
                    {interaction.drugKey}
                  </Text>
                  {interaction.interactions.length > 0 ? (
                    interaction.interactions.map((text, textIndex) => (
                      <Text key={textIndex} style={[styles.interactionText, { color: theme.colors.onSurfaceVariant }]}>
                        • {text}
                      </Text>
                    ))
                  ) : (
                    <Text style={[styles.noInteractionText, { color: theme.colors.onSurfaceVariant }]}>
                      No specific interaction data available.
                    </Text>
                  )}
                </View>
              ))}
            </View>
          )}

        </View>

        <View style={styles.disclaimerContainer}>
          <Ionicons name="shield-checkmark-outline" size={18} color={theme.colors.onSurfaceVariant} />
          <Text style={[styles.disclaimerText, { color: theme.colors.onSurfaceVariant }]}>
            MedQuire simplifies FDA data for understanding. It does not replace professional medical advice.
          </Text>
        </View>
      </View>
    )}
    </ScrollView>
      <UpgradeModal
        visible={upgradeFeature !== null}
        feature={upgradeFeature || 'interaction'}
        onClose={() => setUpgradeFeature(null)}
      />
    </>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    paddingHorizontal: 24,
    paddingTop: 32,
    paddingBottom: 40,
  },
  headerTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  closeButton: {
    padding: 4,
    marginTop: -4,
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: '700',
    fontFamily: 'Outfit',
    letterSpacing: -0.5,
  },
  headerSubtitle: {
    fontSize: 14,
    fontWeight: '500',
    fontFamily: 'Outfit',
    marginTop: 2,
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
  },
  loadingText: {
    fontSize: 16,
  },
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 40,
    paddingVertical: 60,
  },
  emptyTitle: {
    fontSize: 24,
    fontWeight: '600',
    marginBottom: 12,
    textAlign: 'center',
  },
  emptySubtitle: {
    fontSize: 16,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 32,
  },
  cabinetButton: {
    paddingHorizontal: 32,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    minWidth: 160,
  },
  cabinetButtonText: {
    fontSize: 16,
    fontWeight: '600',
    fontFamily: 'Outfit',
  },
  drugSelection: {
    paddingHorizontal: 24,
    marginBottom: 32,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    marginBottom: 16,
  },
  sectionLabel: {
    fontSize: 16,
    fontWeight: '700',
    fontFamily: 'Outfit',
    letterSpacing: -0.2,
  },
  selectedCount: {
    fontSize: 13,
    fontWeight: '600',
    fontFamily: 'Outfit',
  },
  drugList: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  drugChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    gap: 6,
  },
  drugChipText: {
    fontSize: 14,
    fontWeight: '600',
    fontFamily: 'Outfit',
  },
  buttonContainer: {
    paddingHorizontal: 24,
    marginBottom: 40,
  },
  checkButton: {
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 3,
  },
  checkButtonText: {
    fontSize: 16,
    fontWeight: '700',
    fontFamily: 'Outfit',
  },
  resultWrapper: {
    marginTop: 8,
  },
  resultHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginHorizontal: 24,
    marginBottom: 12,
  },
  eliToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 12,
    paddingRight: 6,
    height: 32,
    borderRadius: 16,
    gap: 8,
  },
  eliToggleText: {
    fontSize: 12,
    fontWeight: '700',
    fontFamily: 'Outfit',
  },
  toggleTrack: {
    width: 32,
    height: 18,
    borderRadius: 9,
    padding: 2,
    justifyContent: 'center',
  },
  toggleThumb: {
    width: 14,
    height: 14,
    borderRadius: 7,
  },
  toggleThumbActive: {
    alignSelf: 'flex-end',
  },
  toggleThumbInactive: {
    alignSelf: 'flex-start',
  },
  resultCard: {
    marginHorizontal: 24,
    marginBottom: 0,
    padding: 20,
    borderRadius: 24,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  resultTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  resultTitle: {
    fontSize: 18,
    fontWeight: '700',
    fontFamily: 'Outfit',
  },
  resultMessage: {
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '500',
    fontFamily: 'Outfit',
  },
  interactionDetails: {
    marginTop: 20,
    paddingTop: 20,
    borderTopWidth: 1,
    borderTopColor: 'rgba(0,0,0,0.05)',
  },
  detailsTitle: {
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 12,
  },
  interactionItem: {
    marginBottom: 16,
  },
  drugKey: {
    fontSize: 12,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 6,
  },
  interactionText: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '500',
    fontFamily: 'Outfit',
    opacity: 0.8,
  },
  noInteractionText: {
    fontSize: 14,
    fontStyle: 'italic',
    fontFamily: 'Outfit',
    opacity: 0.6,
  },
  disclaimerContainer: {
    marginTop: 48,
    paddingTop: 24,
    paddingBottom: 40,
    marginHorizontal: 24,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  disclaimerText: {
    fontSize: 12,
    lineHeight: 18,
    fontWeight: '500',
    fontFamily: 'Outfit',
    flex: 1,
    opacity: 0.7,
  },
});

export default InteractionScreen;