import React, { useState } from 'react';
import { 
  View, 
  Text, 
  StyleSheet, 
  TouchableOpacity, 
  Alert, 
  LayoutAnimation, 
  Platform, 
  UIManager, 
  ScrollView,
  Modal,
  TextInput,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '../theme/ThemeProvider';
import { useAuth } from '../context/AuthContext';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import SupportModal from '../components/SupportModal';
import { FEATURES } from '../config/features';

type SettingsItem = 
  | { label: string; value: string; type: 'info' }
  | { label: string; type: 'button'; action?: () => void; content?: string; destructive?: boolean; disabled?: boolean };

type SettingsSection = {
  title: string;
  items: SettingsItem[];
};

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

const SettingsScreen: React.FC = () => {
  const theme = useTheme();
  const navigation = (useNavigation as any)();
  const { user, signOut, isGuest, isPro, subscription, updateProfile, deleteAccount } = useAuth();
  const [activeAccordion, setActiveAccordion] = useState<string | null>(null);
  
  // Edit Profile States
  const [isEditModalVisible, setIsEditModalVisible] = useState(false);
  const [editName, setEditName] = useState(user?.user_metadata?.full_name || '');
  const [editEmail, setEditEmail] = useState(user?.email || '');
  const [isUpdating, setIsUpdating] = useState(false);
  const [isSupportModalVisible, setIsSupportModalVisible] = useState(false);

  const toggleAccordion = (label: string) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setActiveAccordion(prev => prev === label ? null : label);
  };

  const handleSignOut = () => {
    Alert.alert('Sign Out', 'Are you sure you want to sign out?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign Out', style: 'destructive', onPress: async () => {
        try {
          await signOut();
          navigation.reset({ index: 0, routes: [{ name: 'Login' }] });
        } catch (error) {
          Alert.alert('Error', 'Failed to sign out.');
        }
      }},
    ]);
  };

  const handleSignUp = () => {
    navigation.navigate('SignUp');
  };

  const handleUpdateProfile = async () => {
    if (!editName.trim() || !editEmail.trim()) {
      Alert.alert('Validation', 'Name and Email are required.');
      return;
    }

    setIsUpdating(true);
    const { error } = await updateProfile({ full_name: editName, email: editEmail });
    setIsUpdating(false);

    if (error) {
      Alert.alert('Error', 'Failed to update profile. ' + error.message);
    } else {
      setIsEditModalVisible(false);
      Alert.alert('Success', 'Profile updated successfully.');
    }
  };

  const handleDeleteAccount = () => {
    Alert.alert(
      'Delete Account',
      'This will permanently remove your cabinet items and sign you out. This action cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        { 
          text: 'Delete Everything', 
          style: 'destructive', 
          onPress: async () => {
            setIsUpdating(true);
            const { error } = await deleteAccount();
            setIsUpdating(false);
            if (!error) {
              navigation.reset({ index: 0, routes: [{ name: 'Onboarding' }] });
            }
          }
        }
      ]
    );
  };

  const handleUpgrade = () => {
    navigation.navigate('Upgrade');
  };

  const handleSupport = () => {
    setIsSupportModalVisible(true);
  };

  const sections: SettingsSection[] = [
    {
      title: 'Account',
      items: [
        { label: 'Status', value: isGuest ? 'Guest' : (isPro ? 'Premium' : subscription?.status === 'PAST_DUE' ? 'Past Due' : 'Free'), type: 'info' },
        { label: 'Email', value: isGuest ? 'Not signed in' : (user?.email || 'Not signed in'), type: 'info' },
      ],
    },
    {
      title: 'About',
      items: [
        { label: 'Version', value: '1.2.0', type: 'info' },
        { 
          label: 'Privacy Policy', 
          type: 'button', 
          content: 'We do not store sensitive health data. All medication information is fetched from OpenFDA in real-time. Your recent searches are stored locally on your device.' 
        },
        { 
          label: 'Disclaimer', 
          type: 'button', 
          content: 'MedQuire simplifies complex medical data for educational purposes. It is not a clinical tool and does not replace professional medical advice, diagnosis, or treatment. Always consult with a licensed healthcare provider.' 
        },
        { label: 'Support', type: 'button', action: isGuest ? undefined : handleSupport, disabled: isGuest },
      ],
    },
    {
      title: '',
      items: [
        { label: isGuest ? 'Sign Up' : 'Sign Out', type: 'button', action: isGuest ? handleSignUp : handleSignOut, destructive: !isGuest },
      ],
    },
  ];

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.colors.background }]} edges={['top']}>
      {/* Fixed Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
          <Ionicons name="arrow-back" size={24} color={theme.colors.onSurface} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: theme.colors.onSurface }]}>Settings</Text>
      </View>

      <ScrollView showsVerticalScrollIndicator={false}>

        {/* Profile Section (Centered) */}
        {!isGuest && user && (
          <View style={styles.centeredProfile}>
            <View style={[styles.avatarCircle, { backgroundColor: theme.colors.onSurfaceVariant }]}>
              <Text style={[styles.avatarText, { color: theme.colors.surface }]}>
                {(() => {
                  const name = user.user_metadata?.full_name;
                  if (name) {
                    const parts = name.trim().split(/\s+/);
                    return (parts.length >= 2 ? parts[0][0] + parts[parts.length - 1][0] : parts[0][0]).toUpperCase();
                  }
                  return user.email?.[0].toUpperCase() || '?';
                })()}
              </Text>
            </View>
            <View style={styles.centerInfo}>
              <Text style={[styles.profileName, { color: theme.colors.onSurface }]}>
                {user.user_metadata?.full_name || 'User'}
              </Text>
              <Text style={[styles.profileEmail, { color: theme.colors.onSurfaceVariant }]}>
                {user.email}
              </Text>
              <TouchableOpacity 
                style={[styles.editButton, { backgroundColor: theme.colors.surfaceVariant }]}
                onPress={() => setIsEditModalVisible(true)}
              >
                <Text style={[styles.editButtonText, { color: theme.colors.onSurfaceVariant }]}>Edit Profile</Text>
              </TouchableOpacity>
            </View>

            {!isPro && FEATURES.ENABLE_PRO && (
              <TouchableOpacity style={styles.upgradeBanner} onPress={handleUpgrade}>
                <Ionicons name="sparkles" size={16} color={theme.colors.onTertiary} />
                <Text style={[styles.upgradeText, { color: theme.colors.onTertiary }]}>Upgrade to Pro</Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        {/* Content Sections */}
        <View style={[styles.contentPadding, isGuest && { paddingTop: 24 }]}>
          {sections.map((section, sIndex) => (
            <View key={sIndex} style={styles.section}>
              {section.title ? (
                <Text style={[styles.sectionTitle, { color: theme.colors.onSurfaceVariant }]}>{section.title}</Text>
              ) : null}
              <View style={[styles.sectionCard, { backgroundColor: theme.colors.surfaceContainer }]}>
                {section.items.map((item, iIndex) => (
                  <View key={iIndex}>
                    {item.type === 'info' ? (
                      <View style={styles.infoRow}>
                        <Text style={[styles.infoLabel, { color: theme.colors.onSurfaceVariant }]}>{item.label}</Text>
                        <Text style={[styles.infoValue, { color: theme.colors.outline }]}>{item.value}</Text>
                      </View>
                    ) : (
                      <View>
                        <TouchableOpacity 
                          style={[styles.buttonRow, item.disabled && { opacity: 0.5 }]} 
                          onPress={() => item.content ? toggleAccordion(item.label) : item.action?.()}
                          disabled={item.disabled}
                        >
                          <View style={[styles.buttonRowContent, item.destructive && { justifyContent: 'center' }]}>
                            <Text style={[styles.buttonLabel, { color: item.destructive ? theme.colors.error : theme.colors.primary }]}>
                              {item.label}
                            </Text>
                            {item.content && <Ionicons name={activeAccordion === item.label ? "chevron-up" : "chevron-down"} size={18} color={theme.colors.outline} />}
                          </View>
                        </TouchableOpacity>
                        {activeAccordion === item.label && item.content && (
                          <View style={[styles.accordionContent, { backgroundColor: theme.colors.surfaceContainerLow }]}>
                            <Text style={[styles.accordionText, { color: theme.colors.onSurfaceVariant }]}>{item.content}</Text>
                          </View>
                        )}
                      </View>
                    )}
                    {iIndex < section.items.length - 1 && <View style={[styles.separator, { backgroundColor: theme.colors.outlineVariant }]} />}
                  </View>
                ))}
              </View>
            </View>
          ))}
        </View>

        <View style={[styles.disclaimerContainer, { backgroundColor: theme.colors.accentContainer }]}>
          <Ionicons name="information-circle-outline" size={24} color={theme.colors.onAccentContainer} />
          <Text style={[styles.disclaimerText, { color: theme.colors.onAccentContainer }]}>
            MedQuire simplifies medical information for understanding. It does not replace professional medical advice.
          </Text>
        </View>
      </ScrollView>

      {/* Edit Profile Modal */}
      <Modal visible={isEditModalVisible} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: theme.colors.background }]}>
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: theme.colors.onSurface }]}>Edit Profile</Text>
              <TouchableOpacity onPress={() => setIsEditModalVisible(false)}>
                <Ionicons name="close" size={28} color={theme.colors.onSurface} />
              </TouchableOpacity>
            </View>

            <View style={styles.modalBody}>
              <View style={styles.inputGroup}>
                <Text style={[styles.inputLabel, { color: theme.colors.outline }]}>Full Name</Text>
                <TextInput 
                  style={[styles.input, { color: theme.colors.onSurface, borderColor: theme.colors.outlineVariant }]} 
                  value={editName}
                  onChangeText={setEditName}
                  placeholder="Your name"
                />
              </View>
              <View style={styles.inputGroup}>
                <Text style={[styles.inputLabel, { color: theme.colors.outline }]}>Email Address</Text>
                <TextInput 
                  style={[styles.input, { color: theme.colors.onSurface, borderColor: theme.colors.outlineVariant }]} 
                  value={editEmail}
                  onChangeText={setEditEmail}
                  keyboardType="email-address"
                  autoCapitalize="none"
                />
              </View>

              <TouchableOpacity 
                style={[styles.saveButton, { backgroundColor: theme.colors.primary }]}
                onPress={handleUpdateProfile}
                disabled={isUpdating}
              >
                {isUpdating ? <ActivityIndicator color="#FFF" /> : <Text style={styles.saveButtonText}>Save Changes</Text>}
              </TouchableOpacity>

              <View style={styles.modalFooter}>
                <TouchableOpacity style={styles.deleteLink} onPress={handleDeleteAccount}>
                  <Text style={[styles.deleteLinkText, { color: theme.colors.error }]}>Delete Account</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </View>
      </Modal>

      {/* Support Modal */}
      <SupportModal 
        visible={isSupportModalVisible} 
        onClose={() => setIsSupportModalVisible(false)} 
      />
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, paddingTop: 16 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 12,
  },
  headerTitle: { fontSize: 28, fontWeight: 'bold', fontFamily: 'Outfit', letterSpacing: -0.5 },
  backButton: { 
    marginRight: 16,
    marginLeft: -4,
  },
  centeredProfile: {
    alignItems: 'center',
    paddingBottom: 40,
    paddingTop: 20,
  },
  avatarCircle: {
    width: 100,
    height: 100,
    borderRadius: 50,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 10,
    elevation: 4,
  },
  avatarText: { color: '#FFF', fontSize: 36, fontWeight: '700' },
  centerInfo: { alignItems: 'center', gap: 6 },
  profileName: { fontSize: 24, fontWeight: '700' },
  profileEmail: { fontSize: 16, opacity: 0.7 },
  editButton: {
    marginTop: 12,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
  },
  editButtonText: { fontSize: 14, fontWeight: '600' },
  upgradeBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#6750A4', // Fixed tertiary color for pro
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 20,
    marginTop: 16,
    gap: 6,
  },
  upgradeText: { fontSize: 13, fontWeight: '700' },
  contentPadding: { paddingHorizontal: 16 },
  section: { marginBottom: 32 },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '700',
    marginBottom: 12,
    textTransform: 'uppercase',
    letterSpacing: 1.2,
    paddingLeft: 4,
  },
  sectionCard: { borderRadius: 24, overflow: 'hidden' },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    padding: 20,
  },
  infoLabel: { fontSize: 16, fontWeight: '600' },
  infoValue: { fontSize: 16 },
  buttonRow: { padding: 20 },
  buttonRowContent: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  buttonLabel: { fontSize: 16, fontWeight: '600' },
  separator: { height: 1, marginHorizontal: 20 },
  accordionContent: { paddingHorizontal: 20, paddingBottom: 20, marginTop: -10 },
  accordionText: { fontSize: 14, lineHeight: 22 },
  disclaimerContainer: {
    marginHorizontal: 16,
    marginVertical: 40,
    padding: 20,
    borderRadius: 24,
    flexDirection: 'row',
    gap: 16,
    alignItems: 'center',
  },
  disclaimerText: { fontSize: 14, lineHeight: 20, flex: 1, opacity: 0.8 },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    height: '80%',
    borderTopLeftRadius: 32,
    borderTopRightRadius: 32,
    padding: 24,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 32,
  },
  modalTitle: { fontSize: 24, fontWeight: '700' },
  modalBody: { gap: 24 },
  inputGroup: { gap: 8 },
  inputLabel: { fontSize: 14, fontWeight: '600' },
  input: {
    height: 56,
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: 16,
    fontSize: 16,
  },
  saveButton: {
    height: 56,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
  },
  saveButtonText: { color: '#FFF', fontSize: 16, fontWeight: '700' },
  modalFooter: { alignItems: 'center', marginTop: 24 },
  deleteLink: { padding: 12 },
  deleteLinkText: { fontSize: 15, fontWeight: '600' },
});

export default SettingsScreen;