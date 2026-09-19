import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Dimensions, TextInput, ScrollView, KeyboardAvoidingView, Platform, ActivityIndicator, Image, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialIcons, FontAwesome } from '@expo/vector-icons';
import { SvgXml } from 'react-native-svg';
import { GOOGLE_SVG } from '../assets/google_svg';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { RootStackParamList } from '../navigation/AppNavigator';
import { useTheme, ThemeContextType } from '../theme/ThemeProvider';
import { useAuth } from '../context/AuthContext';
import { getPasswordRequirements, isPasswordValid } from '../utils/validation';
import PasswordRequirements from '../components/PasswordRequirements';

type SignUpScreenProps = any;

const SignUpScreen = ({ navigation }: SignUpScreenProps) => {
  const theme = useTheme();
  const styles = makeStyles(theme);
  const [form, setForm] = useState({
    name: '',
    email: '',
    password: '',
  });
  const [showPassword, setShowPassword] = useState(false);
  const [focusedInput, setFocusedInput] = useState<string | null>(null);
  const [errors, setErrors] = useState({
    name: '',
    email: '',
    password: '',
  });
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const { signUp, signInWithGoogle, isGuest, continueAsGuest } = useAuth();
  const [signUpSuccess, setSignUpSuccess] = useState(false);

  // Safe navigation: Wait for global auth state to catch up before navigating
  React.useEffect(() => {
    if (signUpSuccess && !isGuest && !loading) {
      navigation.reset({
        index: 0,
        routes: [{ name: 'Home' }],
      });
    }
  }, [signUpSuccess, isGuest, loading, navigation]);

  // Password requirements logic moved to shared utility

  const requirements = getPasswordRequirements(form.password);

  const handleBlur = (field: keyof typeof form) => {
    setFocusedInput(null);
    if (form[field].trim() === '') {
      setErrors((prev) => ({ ...prev, [field]: 'Field must not be empty' }));
    }
  };

  const handleChangeText = (field: keyof typeof form, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));

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
    } else if (field === 'name') {
      const nameParts = value.trim().split(/\s+/);
      const isValidName = nameParts.length >= 2 && nameParts.every(part => part.length >= 2);

      if (value.trim() === '') {
        setErrors((prev) => ({ ...prev, name: '' }));
      } else if (!isValidName) {
        setErrors((prev) => ({ ...prev, name: 'Enter your full name' }));
      } else {
        setErrors((prev) => ({ ...prev, name: '' }));
      }
    } else {
      if (value.trim() !== '') {
        setErrors((prev) => ({ ...prev, [field]: '' }));
      }
    }
  };

  const handleSignUp = async () => {
    // Basic validation check before starting loading
    const hasErrors = Object.values(errors).some(err => err !== '');
    const isComplete = form.name && form.email && form.password;
    const isPassValid = isPasswordValid(form.password);

    if (!hasErrors && isComplete && isPassValid) {
      setLoading(true);
      try {
        const { error, needsEmailConfirmation } = await signUp(form.email, form.password, form.name);
        
        if (error) {
          if (error.message?.includes('already registered') || error.message?.includes('User already registered')) {
            Alert.alert(
              'Account Exists',
              'An account with this email already exists. Would you like to log in?',
              [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Log In', onPress: () => navigation.navigate('Login') }
              ]
            );
          } else {
            Alert.alert('Sign Up Failed', error.message);
          }
        } else if (needsEmailConfirmation) {
          navigation.navigate('VerifyOtp', { email: form.email, mode: 'signup' });
        } else {
          // Success! Mark as success and wait for useEffect to navigate
          setSignUpSuccess(true);
        }
      } catch (err) {
        Alert.alert('Error', 'An unexpected error occurred. Please try again.');
      } finally {
        setLoading(false);
      }
    } else {
      // Trigger empty field errors if user tries to submit incomplete form
      const newErrors = { ...errors };
      if (!form.name) newErrors.name = 'Field must not be empty';
      if (!form.email) newErrors.email = 'Field must not be empty';
      if (!form.password) {
        newErrors.password = 'Field must not be empty';
      } else if (!isPassValid) {
        newErrors.password = 'Password does not meet requirements';
      }
      setErrors(newErrors);
    }
  };

  const handleGoogleAuth = async () => {
    setGoogleLoading(true);
    const { error } = await signInWithGoogle();
    setGoogleLoading(false);

    if (error && error.message !== 'User cancelled sign-in') {
      Alert.alert('Authentication Failed', error.message);
    } else if (!error) {
      navigation.reset({
        index: 0,
        routes: [{ name: 'Home' }],
      });
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
          scrollEnabled={false} // Disable scrolling when idle
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.header}>
            <Text style={[styles.title, { color: theme.colors.onSurface }]}>Create your Account</Text>
          </View>

          <View style={styles.formContainer}>
            <View style={styles.inputGroup}>
              <Text style={[styles.label, { color: theme.colors.onSurfaceVariant }]}>Full Name</Text>
              <TextInput
                style={[
                  styles.input,
                  {
                    backgroundColor: focusedInput === 'name' ? 'transparent' : theme.colors.surfaceContainerLow,
                    color: focusedInput === 'name' ? theme.colors.onPrimaryContainer : theme.colors.onSurface,
                    borderColor: errors.name ? theme.colors.error : (focusedInput === 'name' ? theme.colors.primaryContainer : theme.colors.outlineVariant)
                  }
                ]}
                placeholder="John Doe"
                placeholderTextColor={theme.colors.outlineVariant}
                value={form.name}
                onChangeText={(text) => handleChangeText('name', text)}
                onFocus={() => setFocusedInput('name')}
                onBlur={() => handleBlur('name')}
              />
              {errors.name ? (
                <Text style={[styles.errorText, { color: theme.colors.error }]}>{errors.name}</Text>
              ) : null}
            </View>

            <View style={styles.inputGroup}>
              <Text style={[styles.label, { color: theme.colors.onSurfaceVariant }]}>Email</Text>
              <TextInput
                style={[
                  styles.input,
                  {
                    backgroundColor: focusedInput === 'email' ? 'transparent' : theme.colors.surfaceContainerLow,
                    color: focusedInput === 'email' ? theme.colors.onPrimaryContainer : theme.colors.onSurface,
                    borderColor: errors.email ? theme.colors.error : (focusedInput === 'email' ? theme.colors.primaryContainer : theme.colors.outlineVariant)
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
              <Text style={[styles.label, { color: theme.colors.onSurfaceVariant }]}>Create Password</Text>
              <View style={styles.passwordContainer}>
                <TextInput
                  style={[
                    styles.input,
                    styles.passwordInput,
                    {
                      backgroundColor: focusedInput === 'password' ? 'transparent' : theme.colors.surfaceContainerLow,
                      color: focusedInput === 'password' ? theme.colors.onPrimaryContainer : theme.colors.onSurface,
                      borderColor: errors.password ? theme.colors.error : (focusedInput === 'password' ? theme.colors.primaryContainer : theme.colors.outlineVariant)
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

              {(form.password.length > 0 || focusedInput === 'password') && (
                <PasswordRequirements requirements={requirements} theme={theme} />
              )}
            </View>

            <TouchableOpacity
              style={[styles.submitButton, { backgroundColor: theme.colors.primary }]}
              onPress={handleSignUp}
              disabled={loading}
            >
              {loading ? (
                <ActivityIndicator color={theme.colors.onPrimary} />
              ) : (
                <Text style={[styles.submitButtonText, { color: theme.colors.onPrimary }]}>Create Account</Text>
              )}
            </TouchableOpacity>
          </View>

          <View style={styles.socialSection}>
            <View style={styles.dividerContainer}>
              <View style={[styles.divider, { backgroundColor: theme.colors.outlineVariant }]} />
              <Text style={[styles.dividerText, { color: theme.colors.onSurfaceVariant }]}>or</Text>
              <View style={[styles.divider, { backgroundColor: theme.colors.outlineVariant }]} />
            </View>

            <TouchableOpacity
              style={[
                styles.socialButton,
                {
                  backgroundColor: theme.colors.background,
                  borderColor: theme.colors.primary,
                }
              ]}
              activeOpacity={0.7}
              onPress={handleGoogleAuth}
              disabled={loading || googleLoading}
            >
              {googleLoading ? (
                <ActivityIndicator color={theme.colors.primary} />
              ) : (
                <>
                  <SvgXml 
                    xml={GOOGLE_SVG} 
                    width={24} 
                    height={24} 
                  />
                  <Text style={[styles.socialButtonText, { color: theme.colors.primary }]}>Continue with Google</Text>
                </>
              )}
            </TouchableOpacity>
          </View>

          <View style={styles.footer}>
            <Text style={[styles.footerText, { color: theme.colors.onSurfaceVariant }]}>
              Already have an account? <Text style={{ color: theme.colors.primary, fontWeight: '600' }} onPress={() => navigation.navigate('Login')}>Log In</Text>
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
    marginBottom: 0,
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
  socialSection: {
    marginTop: 24,
  },
  dividerContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 32,
    gap: 16,
  },
  divider: {
    flex: 1,
    height: 1,
    opacity: 0.5,
  },
  dividerText: {
    fontSize: 14,
    fontWeight: '500',
  },
  socialButton: {
    flexDirection: 'row',
    width: '100%',
    paddingVertical: 16,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    gap: 8,
  },
  socialButtonText: {
    fontSize: 18,
    fontWeight: '600',
  },
  googleIcon: {
    width: 24,
    height: 24,
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

export default SignUpScreen;
