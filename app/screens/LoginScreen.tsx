import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Dimensions, TextInput, ScrollView, KeyboardAvoidingView, Platform, ActivityIndicator, BackHandler } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { RootStackParamList } from '../navigation/AppNavigator';
import { useTheme, ThemeContextType } from '../theme/ThemeProvider';
import { useAuth } from '../context/AuthContext';

type LoginScreenProps = any;

const LoginScreen = ({ navigation }: LoginScreenProps) => {
  const theme = useTheme();
  const styles = makeStyles(theme);

  useFocusEffect(
    React.useCallback(() => {
      const onBackPress = () => {
        return true;
      };

      const backHandler = BackHandler.addEventListener('hardwareBackPress', onBackPress);

      return () => backHandler.remove();
    }, [])
  );

  const [form, setForm] = useState({
    email: '',
    password: '',
  });
  const [showPassword, setShowPassword] = useState(false);
  const [focusedInput, setFocusedInput] = useState<string | null>(null);
  const [errors, setErrors] = useState({
    email: '',
    password: '',
    general: '',
  });
  const [loading, setLoading] = useState(false);
  const { signIn, isGuest } = useAuth();
  const [loginSuccess, setLoginSuccess] = useState(false);

  // Safe navigation: Wait for global auth state to catch up before navigating
  React.useEffect(() => {
    if (loginSuccess && !isGuest && !loading) {
      navigation.reset({
        index: 0,
        routes: [{ name: 'Home' }],
      });
    }
  }, [loginSuccess, isGuest, loading, navigation]);

  const handleBlur = (field: keyof typeof form) => {
    setFocusedInput(null);
    if (form[field].trim() === '') {
      setErrors((prev) => ({ ...prev, [field]: 'Field must not be empty' }));
    }
  };

  const handleChangeText = (field: keyof typeof form, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
    setErrors((prev) => ({ ...prev, general: '' })); // Clear general error when user types

    if (field === 'email') {
      if (value.trim() === '') {
        setErrors((prev) => ({ ...prev, email: '' }));
      } else {
        const isValidDomain = value.toLowerCase().endsWith('@gmail.com') || 
                              value.toLowerCase().endsWith('@yahoo.com') || 
                              value.toLowerCase().endsWith('@icloud.com');
        if (!isValidDomain) {
          setErrors((prev) => ({ ...prev, email: 'Enter a valid email address' }));
        } else {
          setErrors((prev) => ({ ...prev, email: '' }));
        }
      }
    } else {
      if (value.trim() !== '') {
        setErrors((prev) => ({ ...prev, [field]: '' }));
      }
    }
  };

  const handleLogin = async () => {
    // If both fields are empty, do nothing and don't show the general error
    if (!form.email.trim() && !form.password.trim()) {
      return;
    }

    setLoading(true);
    try {
      const { error } = await signIn(form.email, form.password);
      
      if (error) {
        let errorMsg = error.message;
        if (errorMsg === 'Invalid login credentials') {
          errorMsg = 'Account does not exist or invalid credentials.';
        }
        setErrors((prev) => ({ ...prev, general: errorMsg }));
      } else {
        // Success! Mark as success and wait for useEffect to navigate
        setLoginSuccess(true);
      }
    } catch (err) {
      setErrors((prev) => ({ ...prev, general: 'An unexpected error occurred. Please try again.' }));
    } finally {
      setLoading(false);
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
          showsVerticalScrollIndicator={false}
          bounces={false}
          scrollEnabled={false}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.header}>
            <Text style={[styles.title, { color: theme.colors.onSurface }]}>Log in to MedQuire</Text>
          </View>

          <View style={styles.formContainer}>
            {errors.general ? (
              <View style={[styles.errorBox, { backgroundColor: theme.colors.errorContainer }]}>
                <MaterialIcons name="error-outline" size={20} color={theme.colors.error} />
                <Text style={[styles.generalErrorText, { color: theme.colors.error }]}>{errors.general}</Text>
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
                    borderColor: (errors.email || errors.general) ? theme.colors.error : (focusedInput === 'email' ? theme.colors.primaryContainer : theme.colors.outlineVariant)
                  }
                ]}
                placeholder="johndoe@gmail.com"
                placeholderTextColor={theme.colors.outlineVariant}
                keyboardType="email-address"
                autoCapitalize="none"
                value={form.email}
                onChangeText={(text) => handleChangeText('email', text)}
                onFocus={() => setFocusedInput('email')}
                onBlur={() => handleBlur('email')}
              />
              {errors.email ? (
                <Text style={[styles.errorText, { color: theme.colors.error }]}>{errors.email}</Text>
              ) : null}
            </View>

            <View style={styles.inputGroup}>
              <View style={styles.labelRow}>
                <Text style={[styles.label, { color: theme.colors.onSurfaceVariant }]}>Enter Password</Text>
                <TouchableOpacity onPress={() => navigation.navigate('ForgotPassword')}>
                  <Text style={[styles.forgotPasswordText, { color: theme.colors.primary }]}>Forgot Password?</Text>
                </TouchableOpacity>
              </View>
              <View style={styles.passwordContainer}>
                <TextInput
                  style={[
                    styles.input,
                    styles.passwordInput,
                    { 
                      backgroundColor: focusedInput === 'password' ? 'transparent' : theme.colors.surfaceContainerLow, 
                      color: focusedInput === 'password' ? theme.colors.onPrimaryContainer : theme.colors.onSurface,
                      borderColor: (errors.password || errors.general) ? theme.colors.error : (focusedInput === 'password' ? theme.colors.primaryContainer : theme.colors.outlineVariant)
                    }
                  ]}
                  placeholder="Password"
                  placeholderTextColor={theme.colors.outlineVariant}
                  secureTextEntry={!showPassword}
                  value={form.password}
                  onChangeText={(text) => handleChangeText('password', text)}
                  onFocus={() => setFocusedInput('password')}
                  onBlur={() => handleBlur('password')}
                />
                <TouchableOpacity 
                  style={styles.eyeButton}
                  onPress={() => setShowPassword(!showPassword)}
                >
                  <MaterialIcons 
                    name={showPassword ? 'visibility' : 'visibility-off'} 
                    size={20} 
                    color={theme.colors.onSurfaceVariant} 
                  />
                </TouchableOpacity>
              </View>
              {errors.password ? (
                <Text style={[styles.errorText, { color: theme.colors.error }]}>{errors.password}</Text>
              ) : null}
            </View>

            <TouchableOpacity 
              style={[styles.submitButton, { backgroundColor: theme.colors.primary }]}
              onPress={handleLogin}
              disabled={loading}
            >
              {loading ? (
                <ActivityIndicator color={theme.colors.onPrimary} />
              ) : (
                <Text style={[styles.submitButtonText, { color: theme.colors.onPrimary }]}>Log In</Text>
              )}
            </TouchableOpacity>
          </View>

          <View style={styles.footer}>
            <Text style={[styles.footerText, { color: theme.colors.onSurfaceVariant }]}>
              Don't have an account? <Text style={{ color: theme.colors.primary, fontWeight: '600' }} onPress={() => navigation.navigate('SignUp')}>Create Account</Text>
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
    marginBottom: 48,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    fontFamily: 'Outfit',
    textAlign: 'center',
  },
  formContainer: {
    gap: 20,
    marginBottom: 12,
  },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderRadius: 16,
    gap: 12,
    marginBottom: 8,
  },
  generalErrorText: {
    fontSize: 14,
    fontWeight: '600',
    fontFamily: 'Outfit',
  },
  inputGroup: {
    gap: 8,
  },
  labelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingRight: 4,
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
  passwordContainer: {
    position: 'relative',
    justifyContent: 'center',
  },
  passwordInput: {
    paddingRight: 50,
  },
  eyeButton: {
    position: 'absolute',
    right: 16,
    padding: 4,
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
  forgotPasswordText: {
    fontSize: 13,
    fontWeight: '600',
  },
  footer: {
    marginTop: 32,
    alignItems: 'center',
  },
  footerText: {
    fontSize: 14,
  },
  errorText: {
    fontSize: 12,
    marginTop: 4,
    marginLeft: 4,
    fontFamily: 'Outfit',
  },
  guestLink: {
    marginTop: 20,
    paddingVertical: 8,
  },
  guestLinkText: {
    fontSize: 15,
    fontWeight: '600',
    textAlign: 'center',
  },
});

export default LoginScreen;
