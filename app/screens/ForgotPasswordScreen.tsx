import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import { useTheme, ThemeContextType } from '../theme/ThemeProvider';
import { useAuth } from '../context/AuthContext';
import { RootStackParamList } from '../navigation/AppNavigator';

type Props = any;

const ForgotPasswordScreen = ({ navigation }: Props) => {
  const theme = useTheme();
  const styles = makeStyles(theme);
  const { sendResetOtp } = useAuth();

  const [email, setEmail] = useState('');
  const [focusedInput, setFocusedInput] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  const handleReset = async () => {
    if (!email.trim()) {
      setError('Please enter your email address');
      return;
    }

    const isValidDomain = email.toLowerCase().endsWith('@gmail.com') || 
                          email.toLowerCase().endsWith('@yahoo.com') || 
                          email.toLowerCase().endsWith('@icloud.com');
    
    if (!isValidDomain) {
      setError('Enter a valid email address');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const { error: resetError } = await sendResetOtp(email);
      if (resetError) {
        setError(resetError.message);
      } else {
        navigation.navigate('VerifyOtp', { email, mode: 'recovery' });
      }
    } catch (err) {
      setError('An unexpected error occurred. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  if (success) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: theme.colors.background }]}>
        <View style={styles.successContainer}>
          <View style={[styles.successIconBg, { backgroundColor: theme.colors.primaryContainer }]}>
            <MaterialIcons name="mark-email-read" size={48} color={theme.colors.primary} />
          </View>
          <Text style={[styles.title, { color: theme.colors.onSurface }]}>Check your email</Text>
          <Text style={[styles.description, { color: theme.colors.onSurfaceVariant }]}>
            We've sent a password reset link to <Text style={{ fontWeight: '700', color: theme.colors.onSurface }}>{email}</Text>.
          </Text>
          <TouchableOpacity
            style={[styles.submitButton, { backgroundColor: theme.colors.primary, width: '100%', marginTop: 32 }]}
            onPress={() => navigation.navigate('Login')}
          >
            <Text style={[styles.submitButtonText, { color: theme.colors.onPrimary }]}>Back to Login</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.colors.background }]} edges={['top', 'left', 'right']}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={{ flex: 1 }}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          scrollEnabled={false}
        >
          <View style={styles.header}>
            <Text style={[styles.title, { color: theme.colors.onSurface }]}>Reset Password</Text>
            <Text style={[styles.description, { color: theme.colors.onSurfaceVariant }]}>
              Enter your email address and we'll send you a verification code to reset your password.
            </Text>
          </View>

          <View style={styles.formContainer}>
            {error ? (
              <View style={[styles.errorBox, { backgroundColor: theme.colors.errorContainer }]}>
                <MaterialIcons name="error-outline" size={20} color={theme.colors.error} />
                <Text style={[styles.errorText, { color: theme.colors.error }]}>{error}</Text>
              </View>
            ) : null}

            <View style={styles.inputGroup}>
              <Text style={[styles.label, { color: theme.colors.onSurfaceVariant }]}>Email</Text>
              <TextInput
                style={[
                  styles.input,
                  {
                    backgroundColor: focusedInput === 'email' ? 'transparent' : theme.colors.surfaceContainerLow,
                    color: focusedInput === 'email' ? theme.colors.onPrimaryContainer : theme.colors.onSurface,
                    borderColor: error ? theme.colors.error : (focusedInput === 'email' ? theme.colors.primaryContainer : theme.colors.outlineVariant)
                  }
                ]}
                placeholder="johndoe@gmail.com"
                placeholderTextColor={theme.colors.outlineVariant}
                keyboardType="email-address"
                autoCapitalize="none"
                value={email}
                onChangeText={(text) => {
                  setEmail(text);
                  setError('');
                }}
                onFocus={() => setFocusedInput('email')}
                onBlur={() => setFocusedInput(null)}
              />
            </View>

            <TouchableOpacity
              style={[styles.submitButton, { backgroundColor: theme.colors.primary }]}
              onPress={handleReset}
              disabled={loading}
            >
              {loading ? (
                <ActivityIndicator color={theme.colors.onPrimary} />
              ) : (
                <Text style={[styles.submitButtonText, { color: theme.colors.onPrimary }]}>Send Verification Code</Text>
              )}
            </TouchableOpacity>
          </View>

          <View style={styles.footer}>
            <Text style={[styles.footerText, { color: theme.colors.onSurfaceVariant }]}>
              Remembered your password? <Text style={{ color: theme.colors.primary, fontWeight: '600' }} onPress={() => navigation.navigate('Login')}>Log In</Text>
            </Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};

const makeStyles = (theme: ThemeContextType) => StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: 24,
    justifyContent: 'flex-start',
    paddingTop: 40,
    paddingBottom: 40,
  },

  header: {
    alignItems: 'center',
    marginBottom: 40,
    paddingHorizontal: 12,
  },
  successContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  successIconBg: {
    width: 100,
    height: 100,
    borderRadius: 50,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 24,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    fontFamily: 'Outfit',
    textAlign: 'center',
    marginBottom: 12,
  },
  description: {
    fontSize: 16,
    textAlign: 'center',
    lineHeight: 24,
    fontFamily: 'Outfit',
  },
  formContainer: {
    gap: 20,
    marginBottom: 40,
  },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderRadius: 16,
    gap: 12,
    marginBottom: 8,
  },
  errorText: {
    fontSize: 14,
    fontWeight: '600',
    fontFamily: 'Outfit',
    flex: 1,
  },
  inputGroup: {
    gap: 8,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    marginLeft: 4,
  },
  input: {
    paddingHorizontal: 16,
    paddingVertical: 16,
    borderRadius: 16,
    fontSize: 16,
    borderWidth: 1,
  },
  submitButton: {
    marginTop: 12,
    paddingVertical: 18,
    borderRadius: 16,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 4,
  },
  submitButtonText: {
    fontSize: 18,
    fontWeight: '600',
  },
  footer: {
    alignItems: 'center',
  },
  footerText: {
    fontSize: 14,
  },
});

export default ForgotPasswordScreen;
