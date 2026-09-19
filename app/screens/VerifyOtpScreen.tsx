import React, { useState, useEffect } from 'react';
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

type Props = {
  navigation: any;
  route: {
    params: {
      email: string;
    };
  };
};

const VerifyOtpScreen = ({ navigation, route }: Props) => {
  const theme = useTheme();
  const styles = makeStyles(theme);
  const { email } = route.params;
  const { verifyResetOtp, sendResetOtp } = useAuth();

  const [otp, setOtp] = useState('');
  const [focusedInput, setFocusedInput] = useState<boolean>(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const [timer, setTimer] = useState(60);

  useEffect(() => {
    let interval: ReturnType<typeof setInterval>;
    if (timer > 0) {
      interval = setInterval(() => {
        setTimer((prev) => prev - 1);
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [timer]);

  const handleVerify = async () => {
    if (otp.length !== 6) {
      setError('Please enter the 6-digit code');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const { error: verifyError } = await verifyResetOtp(email, otp);
      if (verifyError) {
        setError(verifyError.message || 'Invalid code. Please try again.');
      } else {
        navigation.navigate('ResetPassword', { email });
      }
    } catch (err) {
      setError('An unexpected error occurred. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    if (timer > 0) return;
    
    setResending(true);
    setError('');
    
    try {
      const { error: resendError } = await sendResetOtp(email);
      if (resendError) {
        setError(resendError.message);
      } else {
        setTimer(60);
        Alert.alert('Code Sent', 'A new verification code has been sent to your email.');
      }
    } catch (err) {
      setError('Failed to resend code. Please try again.');
    } finally {
      setResending(false);
    }
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.colors.background }]} edges={['top', 'left', 'right']}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={{ flex: 1 }}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.header}>
            <Text style={[styles.title, { color: theme.colors.onSurface }]}>Verify Email</Text>
            <Text style={[styles.description, { color: theme.colors.onSurfaceVariant }]}>
              We've sent a 6-digit verification code to{' '}
              <Text style={{ fontWeight: '700', color: theme.colors.onSurface }}>{email}</Text>.
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
              <Text style={[styles.label, { color: theme.colors.onSurfaceVariant }]}>Verification Code</Text>
              <TextInput
                style={[
                  styles.input,
                  {
                    backgroundColor: focusedInput ? 'transparent' : theme.colors.surfaceContainerLow,
                    color: theme.colors.onSurface,
                    borderColor: error ? theme.colors.error : (focusedInput ? theme.colors.primaryContainer : theme.colors.outlineVariant),
                    letterSpacing: 8,
                    textAlign: 'center',
                    fontSize: 24,
                    fontWeight: '700',
                  }
                ]}
                placeholder="000000"
                placeholderTextColor={theme.colors.outlineVariant}
                keyboardType="number-pad"
                maxLength={6}
                value={otp}
                onChangeText={(text) => {
                  setOtp(text);
                  setError('');
                }}
                onFocus={() => setFocusedInput(true)}
                onBlur={() => setFocusedInput(false)}
              />
            </View>

            <TouchableOpacity
              style={[styles.submitButton, { backgroundColor: theme.colors.primary }]}
              onPress={handleVerify}
              disabled={loading}
            >
              {loading ? (
                <ActivityIndicator color={theme.colors.onPrimary} />
              ) : (
                <Text style={[styles.submitButtonText, { color: theme.colors.onPrimary }]}>Verify Code</Text>
              )}
            </TouchableOpacity>
          </View>

          <View style={styles.footer}>
            <Text style={[styles.footerText, { color: theme.colors.onSurfaceVariant }]}>
              Didn't receive the code?{' '}
              <Text 
                style={{ 
                  color: timer > 0 ? theme.colors.outlineVariant : theme.colors.primary, 
                  fontWeight: '600' 
                }} 
                onPress={handleResend}
              >
                {resending ? 'Sending...' : timer > 0 ? `Resend in ${timer}s` : 'Resend Code'}
              </Text>
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
  title: {
    fontSize: 28,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: 12,
  },
  description: {
    fontSize: 16,
    textAlign: 'center',
    lineHeight: 24,
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
    borderWidth: 1,
  },
  submitButton: {
    marginTop: 12,
    paddingVertical: 18,
    borderRadius: 16,
    alignItems: 'center',
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

export default VerifyOtpScreen;
