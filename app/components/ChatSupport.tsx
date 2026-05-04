import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Animated,
  Keyboard,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../theme/ThemeProvider';
import { SupportService, SupportMessage, SupportConversation } from '../services/support';

interface ChatSupportProps {
  autoFocus?: boolean;
}

const ChatSupport: React.FC<ChatSupportProps> = ({ autoFocus }) => {
  const theme = useTheme();
  const [messages, setMessages] = useState<SupportMessage[]>([]);
  const [inputText, setInputText] = useState('');
  const [loading, setLoading] = useState(false);
  const [isTyping, setIsTyping] = useState(false);
  const [conversationId, setConversationId] = useState<string | undefined>();
  const [isError, setIsError] = useState(false);
  
  const flatListRef = useRef<FlatList>(null);
  const inputRef = useRef<TextInput>(null);

  useEffect(() => {
    if (autoFocus) {
      const timer = setTimeout(() => {
        inputRef.current?.focus();
      }, 500); // Small delay for modal transition
      return () => clearTimeout(timer);
    }
  }, [autoFocus]);

  useEffect(() => {
    loadHistory();
  }, []);

  const loadHistory = async () => {
    setLoading(true);
    try {
      const history = await SupportService.getChatHistory();
      if (history.conversation) {
        setConversationId(history.conversation.id);
        setMessages(history.messages);
      }
    } catch (error) {
      console.error('[Chat] Load history failed:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSend = async () => {
    if (!inputText.trim() || isTyping) return;

    // Dismiss keyboard immediately for smoother flow
    Keyboard.dismiss();

    const userMessage = inputText.trim();
    setInputText('');
    setIsError(false);

    // Optimistic UI update
    const tempId = Date.now().toString();
    const newUserMsg: SupportMessage = {
      id: tempId,
      role: 'user',
      content: userMessage,
      created_at: new Date().toISOString()
    };
    
    setMessages(prev => [...prev, newUserMsg]);
    setIsTyping(true);

    try {
      const response = await SupportService.sendChatMessage(userMessage, conversationId);
      
      setConversationId(response.conversationId);
      
      const assistantMsg: SupportMessage = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: response.message,
        created_at: new Date().toISOString()
      };

      setMessages(prev => [...prev, assistantMsg]);

      // Check for escalation keywords
      if (response.message.includes("require human support")) {
        // Handled by UI rendering escalation buttons
      }

    } catch (error) {
      console.error('[Chat] Send failed:', error);
      setIsError(true);
    } finally {
      setIsTyping(false);
    }
  };

  const renderMessage = ({ item }: { item: SupportMessage }) => {
    const isUser = item.role === 'user';
    const time = new Date(item.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    return (
      <View style={[styles.messageRow, isUser ? styles.userRow : styles.assistantRow]}>
        {!isUser && (
          <View style={[styles.avatar, { backgroundColor: theme.colors.primary }]}>
            <Ionicons name="sparkles" size={12} color="#FFF" />
          </View>
        )}
        <View style={styles.messageContent}>
          <View style={[
            styles.bubble,
            isUser ? 
              { backgroundColor: theme.colors.primary, borderBottomRightRadius: 4 } : 
              { backgroundColor: theme.colors.surfaceContainerHigh, borderBottomLeftRadius: 4 }
          ]}>
            <Text style={[styles.messageText, { color: isUser ? '#FFF' : theme.colors.onSurface }]}>
              {item.content}
            </Text>
          </View>
          <Text style={[styles.timestamp, { color: theme.colors.onSurfaceVariant, alignSelf: isUser ? 'flex-end' : 'flex-start' }]}>
            {time}
          </Text>
          
        </View>
      </View>
    );
  };

  if (loading && messages.length === 0) {
    return (
      <View style={styles.centerContainer}>
        <ActivityIndicator size="large" color={theme.colors.primary} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <FlatList
        ref={flatListRef}
        data={messages}
        renderItem={renderMessage}
        keyExtractor={item => item.id}
        contentContainerStyle={styles.listContent}
        onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: true })}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Text style={[styles.emptyTitle, { color: theme.colors.onSurface }]}>Hi 👋 How can we help you today?</Text>
            <Text style={[styles.emptySubtitle, { color: theme.colors.onSurfaceVariant }]}>
              Ask me about medications, app features, or troubleshoot issues.
            </Text>
          </View>
        }
        ListFooterComponent={
          <>
            {isTyping && (
              <View style={styles.typingContainer}>
                <View style={[styles.typingBubble, { backgroundColor: theme.colors.surfaceContainerHigh }]}>
                  <ActivityIndicator size="small" color={theme.colors.primary} />
                  <Text style={[styles.typingText, { color: theme.colors.onSurfaceVariant }]}>MedQuire AI is thinking...</Text>
                </View>
              </View>
            )}
            {isError && (
              <View style={styles.errorContainer}>
                <Text style={styles.errorText}>AI support is temporarily unavailable. Please try again later.</Text>
                <TouchableOpacity onPress={handleSend} style={styles.retryBtn}>
                  <Text style={[styles.retryText, { color: theme.colors.primary }]}>Retry</Text>
                </TouchableOpacity>
              </View>
            )}
          </>
        }
      />

      <View style={[styles.inputWrapper, { borderTopColor: theme.colors.outlineVariant, backgroundColor: theme.colors.background }]}>
        <TextInput
          ref={inputRef}
          style={[styles.input, { 
            backgroundColor: theme.colors.surfaceContainerLow, 
            color: theme.colors.onSurface,
            borderColor: theme.colors.outlineVariant 
          }]}
          placeholder="Type your message..."
          placeholderTextColor={theme.colors.outlineVariant}
          value={inputText}
          onChangeText={setInputText}
          multiline
        />
        <TouchableOpacity 
          style={[styles.sendBtn, { backgroundColor: inputText.trim() ? theme.colors.primary : theme.colors.surfaceContainerHigh }]}
          onPress={handleSend}
          disabled={!inputText.trim() || isTyping}
        >
          <Ionicons name="send" size={20} color={inputText.trim() ? "#FFF" : theme.colors.onSurfaceVariant} />
        </TouchableOpacity>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  centerContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  listContent: {
    paddingHorizontal: 8,
    paddingTop: 12,
    paddingBottom: 16,
  },
  messageRow: {
    flexDirection: 'row',
    marginBottom: 12,
    maxWidth: '94%',
  },
  userRow: {
    alignSelf: 'flex-end',
  },
  assistantRow: {
    alignSelf: 'flex-start',
  },
  avatar: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 6,
    marginTop: 4,
  },
  messageContent: {
    flexShrink: 1,
  },
  bubble: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 18,
  },
  messageText: {
    fontSize: 15,
    lineHeight: 21,
    fontFamily: 'Outfit',
  },
  timestamp: {
    fontSize: 11,
    marginTop: 4,
    marginHorizontal: 4,
    fontFamily: 'Outfit',
  },
  typingContainer: {
    paddingHorizontal: 8,
    marginBottom: 12,
  },
  typingBubble: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 16,
    gap: 8,
    alignSelf: 'flex-start',
  },
  typingText: {
    fontSize: 13,
    fontFamily: 'Outfit',
  },
  errorContainer: {
    padding: 16,
    alignItems: 'center',
    gap: 8,
  },
  errorText: {
    color: '#FF5252',
    fontSize: 14,
    textAlign: 'center',
    fontFamily: 'Outfit',
  },
  retryBtn: {
    padding: 8,
  },
  retryText: {
    fontWeight: '700',
    fontFamily: 'Outfit',
  },
  emptyState: {
    paddingTop: 80,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: 8,
    fontFamily: 'Outfit',
  },
  emptySubtitle: {
    fontSize: 14,
    textAlign: 'center',
    fontFamily: 'Outfit',
    lineHeight: 20,
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: 12,
    paddingTop: 12,
    paddingBottom: 24,
    gap: 8,
  },
  input: {
    flex: 1,
    minHeight: 44,
    maxHeight: 120,
    borderRadius: 22,
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 12,
    fontSize: 15,
    borderWidth: 1,
    fontFamily: 'Outfit',
  },
  sendBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 0,
  },
});

export default ChatSupport;
