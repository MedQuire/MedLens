import React, { useState, useEffect, useRef } from 'react';
import { View, TextInput, TouchableOpacity, StyleSheet, FlatList, Platform, Animated, Keyboard, ActivityIndicator, Alert } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { Vibration } from 'react-native';
// Safe import: expo-speech-recognition requires a development build (not available in Expo Go)
let SpeechModule: any = null;
let useSpeechEvent: any = () => { };
try {
  const speech = require('expo-speech-recognition');
  SpeechModule = speech.ExpoSpeechRecognitionModule;
  useSpeechEvent = speech.useSpeechRecognitionEvent;
} catch (e) {
  console.log('[Voice] expo-speech-recognition not available (Expo Go). Voice search disabled.');
}

import COMMON_DRUGS from '../assets/data/common_drugs.json';

interface Suggestion {
  name: string;
  type: 'brand' | 'generic';
  drug_name: string;
}

export interface InputBarHandle {
  clear: () => void;
}

interface InputBarProps {
  onSubmit: (query: string, withEli?: boolean) => void;
  loading?: boolean;
  onSuggestionSelect?: (suggestion: Suggestion) => void;
  fetchSuggestions?: (query: string) => Promise<Suggestion[]>;
  autoFocus?: boolean;
  eli12Enabled?: boolean;
  onToggleEli12?: (enabled: boolean) => void;
}

const InputBar = React.forwardRef<InputBarHandle, InputBarProps>(({
  onSubmit,
  loading = false,
  onSuggestionSelect,
  fetchSuggestions,
  autoFocus = false,
  eli12Enabled = false,
  onToggleEli12,
}, ref) => {
  const theme = useTheme();
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [isSuggestionsLoading, setIsSuggestionsLoading] = useState(false);

  const debounceTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestFetchId = useRef(0);
  const inputShadow = useRef(new Animated.Value(0)).current;
  const micScale = useRef(new Animated.Value(1)).current;
  const pulseAnimation = useRef<Animated.CompositeAnimation | null>(null);
  const inputRef = useRef<TextInput>(null);

  // ── On-Device Speech Recognition Events ──
  const handleResult = (event: any) => {
    const transcript = event.results[0]?.transcript;
    if (transcript && transcript.length > 0) {
      setQuery(transcript);
      if (event.isFinal) {
        setIsTranscribing(false);
        Vibration.vibrate(100);
      }
    }
  };

  const handleEnd = () => {
    setIsListening(false);
    setIsTranscribing(false);
  };

  const handleError = (event: any) => {
    setIsListening(false);
    setIsTranscribing(false);
    if (event.error === 'not-allowed') {
      Alert.alert(
        "Permission Required",
        "MedQuire needs microphone and speech recognition access. Please enable them in your settings.",
        [{ text: "OK" }]
      );
    }
  };

  // Only call hooks at top level, not inside useEffect
  useSpeechEvent('result', SpeechModule ? handleResult : () => { });
  useSpeechEvent('end', SpeechModule ? handleEnd : () => { });
  useSpeechEvent('error', SpeechModule ? handleError : () => { });

  React.useImperativeHandle(ref, () => ({
    clear: () => {
      setQuery('');
      setSuggestions([]);
      setShowSuggestions(false);
      inputRef.current?.blur();
      Keyboard.dismiss();
    }
  }));

  // ── Helper: Merge Results ──
  const mergeResults = (local: Suggestion[], remote: Suggestion[]) => {
    const seen = new Set(local.map(s => s.name?.toLowerCase() || ''));
    const merged = [...local];

    if (Array.isArray(remote)) {
      remote.forEach(r => {
        const normalizedName = r.name?.toLowerCase();
        if (normalizedName && !seen.has(normalizedName)) {
          merged.push(r);
          seen.add(normalizedName);
        }
      });
    }

    setSuggestions(merged.slice(0, 10));
  };

  // ── Autocomplete Logic ──
  useEffect(() => {
    const trimmed = query.trim().toLowerCase();

    // Clear any pending API calls
    if (debounceTimeout.current) {
      clearTimeout(debounceTimeout.current);
    }

    // IMMEDIATELY clear suggestions and hide dropdown if query is empty
    if (!trimmed || !fetchSuggestions) {
      setSuggestions([]);
      setShowSuggestions(false);
      setIsSuggestionsLoading(false);
      return;
    }

    // 1. Instant Local Filter (Synchronous)
    // Strictly filter based on current query
    const localMatches: Suggestion[] = (COMMON_DRUGS as any[])
      .filter(d =>
        (d.name?.toLowerCase() || '').startsWith(trimmed) ||
        (d.drug_name?.toLowerCase() || '').startsWith(trimmed)
      )
      .slice(0, 5)
      .map(d => ({
        name: d.name || d.drug_name || 'Unknown',
        drug_name: d.drug_name || d.name || 'Unknown',
        type: (d.type === 'brand' || d.type === 'generic') ? d.type : 'brand'
      }));

    // 2. Sync results strictly with current input
    setSuggestions(localMatches);
    setShowSuggestions(true);
    setIsSuggestionsLoading(localMatches.length === 0);

    // 3. API Fetch (Debounced)
    // We increment the fetch ID to ignore results from previous keystrokes
    const currentFetchId = ++latestFetchId.current;

    debounceTimeout.current = setTimeout(async () => {
      setIsSuggestionsLoading(true);
      try {
        const results = await fetchSuggestions(query);

        // ONLY update if this is still the latest fetch request
        if (currentFetchId === latestFetchId.current) {
          mergeResults(localMatches, results);
        }
      } catch (error) {
        console.error('[InputBar] Suggestions fetch error:', error);
      } finally {
        if (currentFetchId === latestFetchId.current) {
          setIsSuggestionsLoading(false);
        }
      }
    }, 250);

    return () => {
      if (debounceTimeout.current) {
        clearTimeout(debounceTimeout.current);
      }
    };
  }, [query, fetchSuggestions, loading]);

  useEffect(() => {
    if (isListening) {
      pulseAnimation.current = Animated.loop(
        Animated.sequence([
          Animated.timing(micScale, {
            toValue: 1.2,
            duration: 500,
            useNativeDriver: true,
          }),
          Animated.timing(micScale, {
            toValue: 1,
            duration: 500,
            useNativeDriver: true,
          }),
        ])
      );
      pulseAnimation.current.start();
    } else {
      pulseAnimation.current?.stop();
      Animated.spring(micScale, {
        toValue: 1,
        useNativeDriver: true,
      }).start();
    }
  }, [isListening]);

  const startListening = async () => {
    // Check if native speech recognition is available
    if (!SpeechModule) {
      Alert.alert(
        "Voice Search Unavailable",
        "Voice search requires a development build. You can type medication names instead.",
        [{ text: "OK" }]
      );
      return;
    }

    try {
      const { status } = await SpeechModule.requestPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert(
          "Permission Required",
          "MedQuire needs microphone and speech recognition access to use voice search.",
          [{ text: "OK" }]
        );
        return;
      }

      console.log('[Voice] Starting on-device speech recognition...');
      SpeechModule.start({
        lang: 'en-US',
        interimResults: true,
        contextualStrings: [
          'ibuprofen', 'acetaminophen', 'amoxicillin', 'metformin',
          'lisinopril', 'atorvastatin', 'omeprazole', 'losartan',
          'gabapentin', 'sertraline', 'montelukast', 'escitalopram',
          'medication', 'prescription', 'medicine', 'tablet', 'capsule',
        ],
      });
      setIsListening(true);
      setIsTranscribing(true);
      Vibration.vibrate(50);
    } catch (err) {
      console.error('[Voice] Failed to start:', err);
      Alert.alert("Voice Error", "Could not start speech recognition. Please type your search instead.");
    }
  };

  const stopListening = () => {
    if (!SpeechModule) return;
    console.log('[Voice] Stopping speech recognition...');
    SpeechModule.stop();
    setIsListening(false);
  };

  const toggleListening = () => {
    if (isTranscribing && !isListening) return;

    if (isListening) {
      stopListening();
    } else {
      startListening();
    }
  };

  const handleSubmit = () => {
    if (query.trim()) {
      onSubmit(query.trim(), eli12Enabled);
      setQuery('');
      setShowSuggestions(false);
      Keyboard.dismiss();
    }
  };

  const handleSuggestionPress = (suggestion: Suggestion) => {
    if (!suggestion || !suggestion.name) return;

    const drugName = suggestion.name.trim();

    // 1. Instantly hide suggestions and clear state
    setShowSuggestions(false);
    setSuggestions([]);
    setIsSuggestionsLoading(false);
    if (debounceTimeout.current) clearTimeout(debounceTimeout.current);

    // 2. Sync input value
    setQuery('');

    // 3. Dismiss keyboard
    Keyboard.dismiss();

    // 4. Trigger search instantly in parent (behaving like 'send')
    if (drugName) {
      onSubmit(drugName, eli12Enabled);
    }
  };

  const handleFocus = () => {
    Animated.timing(inputShadow, {
      toValue: 1,
      duration: 300,
      useNativeDriver: false,
    }).start();
  };

  const handleBlur = () => {
    Animated.timing(inputShadow, {
      toValue: 0,
      duration: 300,
      useNativeDriver: false,
    }).start();
  };

  const renderSuggestion = ({ item }: { item: Suggestion }) => (
    <TouchableOpacity
      style={[styles.suggestionItem, { borderBottomColor: theme.colors.outlineVariant }]}
      onPress={() => handleSuggestionPress(item)}
    >
      <Ionicons name="search-outline" size={18} color={theme.colors.onSurfaceVariant} style={styles.suggestionIcon} />
      <View>
        <Animated.Text style={[styles.suggestionName, { color: theme.colors.onSurface }]}>
          {item.name}
        </Animated.Text>
        <Animated.Text style={[styles.suggestionType, { color: theme.colors.onSurfaceVariant }]}>
          {item.type === 'brand' ? 'Brand name' : 'Generic name'}
        </Animated.Text>
      </View>
    </TouchableOpacity>
  );

  const shadowOpacity = inputShadow.interpolate({
    inputRange: [0, 1],
    outputRange: [0.04, 0.08],
  });

  return (
    <View
      style={styles.container}
    >
      <View style={styles.mainWrapper}>
        <Animated.View
          style={[
            styles.inputWrapper,
            {
              backgroundColor: theme.colors.surface,
              shadowOpacity: shadowOpacity,
              borderColor: query.trim() ? theme.colors.primaryContainer : theme.colors.outlineVariant,
            }
          ]}
        >
          <TextInput
            ref={inputRef}
            style={[styles.input, { color: theme.colors.onSurface, textAlign: 'left' }]}
            placeholder="Search medication..."
            placeholderTextColor={theme.colors.outlineVariant}
            cursorColor="#000000"
            selectionColor="#000000"
            value={query}
            onChangeText={setQuery}
            onFocus={handleFocus}
            onBlur={handleBlur}
            onSubmitEditing={handleSubmit}
            editable={true}
            returnKeyType="search"
            autoFocus={autoFocus}
          />
          <View style={styles.actionButtons}>
            <TouchableOpacity
              style={[styles.micButton, isListening && { backgroundColor: theme.colors.primaryContainer + '40', borderRadius: 20 }]}
              onPress={query.trim().length > 0 ? handleSubmit : toggleListening}
              disabled={isTranscribing}
            >
              <Animated.View style={{ transform: [{ scale: micScale }] }}>
                {isTranscribing ? (
                  <ActivityIndicator size="small" color={theme.colors.primary} />
                ) : (
                  <Ionicons
                    name={query.trim().length > 0 ? "send" : (isListening ? "mic" : "mic-outline")}
                    size={22}
                    color={(isListening || query.trim().length > 0) ? theme.colors.primary : theme.colors.onSurfaceVariant}
                  />
                )}
              </Animated.View>
            </TouchableOpacity>
          </View>
        </Animated.View>

        <TouchableOpacity
          style={[
            styles.eliButton,
            {
              backgroundColor: eli12Enabled ? theme.colors.primary : theme.colors.surface,
              borderColor: theme.colors.primary,
              borderWidth: 1,
              shadowOpacity: eli12Enabled ? 0.2 : 0.05
            }
          ]}
          onPress={() => onToggleEli12?.(!eli12Enabled)}
        >
          {eli12Enabled && (
            <Ionicons name="checkmark-circle" size={16} color={theme.colors.onPrimary} />
          )}
          <Animated.Text style={[
            styles.eliButtonText,
            { color: eli12Enabled ? theme.colors.onPrimary : theme.colors.primary }
          ]}>
            ELI 12
          </Animated.Text>
        </TouchableOpacity>
      </View>

      {showSuggestions && (suggestions.length > 0 || isSuggestionsLoading) && (
        <View style={[styles.suggestionsContainer, { backgroundColor: theme.colors.surface, borderColor: theme.colors.outlineVariant }]}>
          {isSuggestionsLoading && suggestions.length === 0 ? (
            <View style={styles.suggestionsLoading}>
              <ActivityIndicator size="small" color={theme.colors.primary} />
              <Animated.Text style={[styles.loadingText, { color: theme.colors.outline }]}>Searching medications...</Animated.Text>
            </View>
          ) : (
            <FlatList
              data={suggestions}
              renderItem={renderSuggestion}
              keyExtractor={(item, index) => `${item.name}-${index}`}
              style={styles.suggestionsList}
              keyboardShouldPersistTaps="handled"
              scrollEnabled={suggestions.length > 3}
              ListFooterComponent={isSuggestionsLoading ? (
                <View style={styles.inlineLoading}>
                  <ActivityIndicator size="small" color={theme.colors.primary} />
                </View>
              ) : null}
            />
          )}
        </View>
      )}
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    width: '100%',
    paddingHorizontal: 24,
    paddingBottom: 4,
  },
  mainWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  inputWrapper: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 99,
    paddingHorizontal: 16,
    height: 56,
    borderWidth: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 10,
    elevation: 2,
  },
  searchIcon: {
    marginRight: 10,
  },
  input: {
    flex: 1,
    fontSize: 16,
    fontWeight: '500',
    height: '100%',
    paddingVertical: 0,
  },
  actionButtons: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  micButton: {
    padding: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendButton: {
    padding: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  eliButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    height: 48,
    borderRadius: 24,
    gap: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 5,
    elevation: 3,
  },
  eliButtonText: {
    fontSize: 14,
    fontWeight: '700',
  },
  suggestionsContainer: {
    position: 'absolute',
    bottom: 80,
    left: 20,
    right: 20,
    maxHeight: 250,
    borderRadius: 20,
    borderWidth: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.1,
    shadowRadius: 12,
    elevation: 8,
    overflow: 'hidden',
  },
  suggestionsList: {
    width: '100%',
  },
  suggestionItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 1,
  },
  suggestionIcon: {
    marginRight: 14,
  },
  suggestionName: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 2,
  },
  suggestionType: {
    fontSize: 12,
  },
  suggestionsLoading: {
    padding: 30,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  loadingText: {
    fontSize: 14,
    fontWeight: '500',
  },
  inlineLoading: {
    paddingVertical: 12,
    alignItems: 'center',
  },
});

export default InputBar;