import React, { useEffect, useState, useRef } from 'react';
import {
  View,
  Text,
  FlatList,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Modal,
  Alert,
} from 'react-native';
import { useRoute, useNavigation } from '@react-navigation/native';
import { useChatStore, ChatMessage } from '../../store/chatStore';
import { useTaskStore } from '../../store/taskStore';
import { COLORS, SPACING, RADIUS } from '../../constants/theme';
import { Icon } from '../../components/common/Icon';


export type MessageListItem =
  | { type: 'date_header'; id: string; dateLabel: string }
  | (ChatMessage & { type?: 'message' });

const parseMessageDate = (dateStr?: string): Date | null => {
  if (!dateStr) return null;
  let str = dateStr;
  if (!str.includes('T') && !str.endsWith('Z')) {
    str = `${str.replace(' ', 'T')}Z`;
  }
  const d = new Date(str);
  return isNaN(d.getTime()) ? null : d;
};

const getDateHeaderLabel = (date: Date): string => {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  const msgDay = new Date(date.getFullYear(), date.getMonth(), date.getDate());

  if (msgDay.getTime() === today.getTime()) {
    return 'TODAY';
  }
  if (msgDay.getTime() === yesterday.getTime()) {
    return 'YESTERDAY';
  }

  const day = date.getDate();
  const monthNames = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ];
  const month = monthNames[date.getMonth()];
  const year = date.getFullYear();
  return `${day} ${month} ${year}`;
};

const groupMessagesByDate = (rawMessages: ChatMessage[]): MessageListItem[] => {
  if (!rawMessages || rawMessages.length === 0) return [];

  // Sort chronologically (oldest first, newest at the bottom)
  const sorted = [...rawMessages].sort((a, b) => {
    const timeA = parseMessageDate(a.timestamp)?.getTime() || 0;
    const timeB = parseMessageDate(b.timestamp)?.getTime() || 0;
    return timeA - timeB;
  });

  const listItems: MessageListItem[] = [];
  let lastDateKey = '';

  for (const msg of sorted) {
    const dateObj = parseMessageDate(msg.timestamp);
    if (dateObj) {
      const dateKey = `${dateObj.getFullYear()}-${dateObj.getMonth()}-${dateObj.getDate()}`;
      if (dateKey !== lastDateKey) {
        lastDateKey = dateKey;
        const label = getDateHeaderLabel(dateObj);
        listItems.push({
          type: 'date_header',
          id: `date_header_${dateKey}_${msg.id}`,
          dateLabel: label,
        });
      }
    }
    listItems.push({ ...msg, type: 'message' });
  }

  return listItems;
};

export const ChatDetailScreen: React.FC = () => {
  const route = useRoute<any>();
  const navigation = useNavigation();
  const { conversationId, customerName } = route.params || {};

  const {
    messages,
    fetchMessages,
    sendMessage,
    activeConversation,
    isSending,
    isLoading,
  } = useChatStore();

  const { addTask } = useTaskStore();

  const [inputMessage, setInputMessage] = useState('');
  const flatListRef = useRef<FlatList>(null);

  // Quick Task Modal
  const [taskModalVisible, setTaskModalVisible] = useState(false);
  const [taskOriginalMessage, setTaskOriginalMessage] = useState('');
  const [taskStaffNote, setTaskStaffNote] = useState('');
  const [taskTime, setTaskTime] = useState('10:00 AM');
  const [taskDueDate, setTaskDueDate] = useState(
    new Date(Date.now() + 24 * 3600 * 1000).toISOString().split('T')[0]
  );

  useEffect(() => {
    if (conversationId) {
      fetchMessages(conversationId);
    }
  }, [conversationId, fetchMessages]);

  const groupedMessages = groupMessagesByDate(messages);

  useEffect(() => {
    if (groupedMessages.length > 0) {
      const timer = setTimeout(() => {
        flatListRef.current?.scrollToEnd({ animated: true });
      }, 120);
      return () => clearTimeout(timer);
    }
  }, [messages.length]);

  const handleSend = async (textToSend?: string) => {
    const text = (textToSend || inputMessage).trim();
    if (!text) return;
    setInputMessage('');
    await sendMessage(conversationId, text);
    flatListRef.current?.scrollToEnd({ animated: true });
  };

  const handleOpenCreateTask = (messageText: string) => {
    setTaskOriginalMessage(messageText);
    setTaskStaffNote(`Follow up on customer request: "${messageText.slice(0, 40)}..."`);
    setTaskModalVisible(true);
  };

  const handleSaveTask = async () => {
    const custName = customerName || activeConversation?.customer_name || 'Customer';
    const custPhone = activeConversation?.phone_number || '+910000000000';

    await addTask({
      customerId: conversationId,
      customerName: custName,
      customerPhone: custPhone,
      originalMessage: taskOriginalMessage,
      staffNote: taskStaffNote,
      dueDate: taskDueDate,
    });

    setTaskModalVisible(false);
    Alert.alert('Task Created 📌', `CRM task added for ${custName}.`);
  };

  const formatTime = (isoString?: string) => {
    if (!isoString) return '';
    const date = parseMessageDate(isoString);
    if (!date) return '';
    return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true });
  };

  const renderMessageBubble = (item: ChatMessage) => {
    const isStaff = item.sender === 'staff';

    return (
      <View
        style={[
          styles.bubbleWrapper,
          isStaff ? styles.bubbleWrapperRight : styles.bubbleWrapperLeft,
        ]}
      >
        <View
          style={[
            styles.bubbleContainer,
            isStaff ? styles.bubbleStaff : styles.bubbleCustomer,
          ]}
        >
          {/* Sender indicator for customer */}
          {!isStaff ? (
            <View style={styles.customerHeaderRow}>
              <Text style={styles.customerSenderLabel}>Customer (WhatsApp)</Text>
              {/* One-Tap 📌 Create Task button directly on customer message */}
              <TouchableOpacity
                style={styles.taskConvertBtn}
                onPress={() => handleOpenCreateTask(item.text)}
                activeOpacity={0.7}
              >
                <Text style={styles.taskConvertBtnText}>📌 Create Task</Text>
              </TouchableOpacity>
            </View>
          ) : null}

          <Text style={[styles.bubbleText, isStaff ? styles.textWhite : styles.textDark]}>
            {item.text}
          </Text>

          <View style={styles.bubbleMeta}>
            <Text style={[styles.bubbleTime, isStaff ? styles.timeStaff : styles.timeCustomer]}>
              {formatTime(item.timestamp)}
            </Text>
            {isStaff ? (
              <View style={styles.checkmarkIcon}>
                <Icon
                  name="check-double"
                  size={14}
                  color={item.status === 'delivered' ? COLORS.accentLime : 'rgba(255,255,255,0.7)'}
                />
              </View>
            ) : null}
          </View>
        </View>
      </View>
    );
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
    >
      {/* Top Chat Subheader */}
      <View style={styles.chatSubheader}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Text style={styles.backBtnText}>‹ Back</Text>
        </TouchableOpacity>
        <View style={styles.headerInfo}>
          <Text style={styles.headerCustomerName} numberOfLines={1}>
            {customerName || activeConversation?.customer_name || 'Customer'}
          </Text>
          <Text style={styles.headerCustomerPhone}>
            {activeConversation?.phone_number || 'Live WhatsApp'}
          </Text>
        </View>
        <TouchableOpacity
          style={styles.headerTaskBtn}
          onPress={() => handleOpenCreateTask(messages[messages.length - 1]?.text || '')}
          activeOpacity={0.8}
        >
          <Text style={styles.headerTaskBtnText}>📌 Task</Text>
        </TouchableOpacity>
      </View>

      {/* Message List */}
      {isLoading && messages.length === 0 ? (
        <View style={styles.centerLoading}>
          <ActivityIndicator size="large" color={COLORS.primary} />
        </View>
      ) : (
        <FlatList
          ref={flatListRef}
          data={groupedMessages}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => {
            if (item.type === 'date_header') {
              return (
                <View style={styles.dateHeaderPillContainer}>
                  <View style={styles.dateHeaderPill}>
                    <Text style={styles.dateHeaderPillText}>{item.dateLabel}</Text>
                  </View>
                </View>
              );
            }
            return renderMessageBubble(item as ChatMessage);
          }}
          contentContainerStyle={styles.messagesList}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={
            <View style={styles.noMessagesBox}>
              <Icon name="chat" size={40} color={COLORS.borderColor} />
              <Text style={styles.noMessagesTitle}>No Data</Text>
              <Text style={styles.noMessagesSub}>No messages in this conversation yet.</Text>
            </View>
          }
        />
      )}

      {/* Bottom Input Box */}
      <View style={styles.inputContainer}>
        <TextInput
          style={styles.textInput}
          placeholder="Type WhatsApp reply to customer..."
          placeholderTextColor={COLORS.textSubtle}
          value={inputMessage}
          onChangeText={setInputMessage}
          multiline
          maxLength={1000}
        />
        <TouchableOpacity
          style={[styles.sendButton, (!inputMessage.trim() || isSending) && styles.sendButtonDisabled]}
          onPress={() => handleSend()}
          disabled={!inputMessage.trim() || isSending}
          activeOpacity={0.8}
        >
          {isSending ? (
            <ActivityIndicator size="small" color={COLORS.bgWhite} />
          ) : (
            <Icon name="send" size={18} color={COLORS.bgWhite} />
          )}
        </TouchableOpacity>
      </View>

      {/* Convert to Task Modal */}
      <Modal
        visible={taskModalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setTaskModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Convert Message to Task 📌</Text>
              <TouchableOpacity onPress={() => setTaskModalVisible(false)}>
                <Text style={styles.modalCloseText}>✕</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.formGroup}>
              <Text style={styles.formLabel}>Customer</Text>
              <Text style={styles.readOnlyCustomer}>
                {customerName || activeConversation?.customer_name} (
                {activeConversation?.phone_number})
              </Text>
            </View>

            <View style={styles.formGroup}>
              <Text style={styles.formLabel}>Original Message</Text>
              <View style={styles.quoteBoxModal}>
                <Text style={styles.quoteBoxText}>"{taskOriginalMessage}"</Text>
              </View>
            </View>

            <View style={styles.formGroup}>
              <Text style={styles.formLabel}>Notes</Text>
              <TextInput
                style={[styles.formInput, { height: 70, textAlignVertical: 'top' }]}
                value={taskStaffNote}
                onChangeText={setTaskStaffNote}
                multiline
              />
            </View>

            <View style={styles.formGroup}>
              <Text style={styles.formLabel}>Due Date</Text>
              <TextInput
                style={styles.formInput}
                value={taskDueDate}
                onChangeText={setTaskDueDate}
                placeholder="YYYY-MM-DD"
                placeholderTextColor={COLORS.textSubtle}
              />
            </View>

            <View style={styles.formGroup}>
              <Text style={styles.formLabel}>Time</Text>
              <TextInput
                style={styles.formInput}
                value={taskTime}
                onChangeText={setTaskTime}
                placeholder="10:00 AM"
                placeholderTextColor={COLORS.textSubtle}
              />
            </View>

            <TouchableOpacity style={styles.modalSubmitBtn} onPress={handleSaveTask}>
              <Text style={styles.modalSubmitText}>Save</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.bgLinen,
  },
  chatSubheader: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.primaryNavy,
    paddingHorizontal: SPACING.md,
    paddingVertical: 12,
    gap: 12,
  },
  backBtn: {
    paddingVertical: 4,
    paddingHorizontal: 6,
  },
  backBtnText: {
    color: COLORS.bgWhite,
    fontSize: 16,
    fontWeight: '700',
  },
  headerInfo: {
    flex: 1,
  },
  headerCustomerName: {
    color: COLORS.bgWhite,
    fontSize: 16,
    fontWeight: '700',
  },
  headerCustomerPhone: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 12,
    marginTop: 1,
  },
  verifiedDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: COLORS.whatsappGreenBright,
  },
  headerTaskBtn: {
    backgroundColor: 'rgba(255, 255, 255, 0.18)',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: RADIUS.full,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.3)',
  },
  headerTaskBtnText: {
    color: COLORS.bgWhite,
    fontSize: 12,
    fontWeight: '700',
  },
  centerLoading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  messagesList: {
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.md,
  },
  bubbleWrapper: {
    marginVertical: 4,
    maxWidth: '82%',
  },
  bubbleWrapperLeft: {
    alignSelf: 'flex-start',
  },
  bubbleWrapperRight: {
    alignSelf: 'flex-end',
  },
  bubbleContainer: {
    borderRadius: RADIUS.lg,
    paddingHorizontal: 14,
    paddingVertical: 10,
    shadowColor: COLORS.shadowColor,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 3,
    elevation: 1,
  },
  bubbleCustomer: {
    backgroundColor: COLORS.bgWhite,
    borderBottomLeftRadius: 2,
    borderWidth: 1,
    borderColor: COLORS.borderColor,
  },
  bubbleStaff: {
    backgroundColor: COLORS.primary,
    borderBottomRightRadius: 2,
  },
  customerHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
    gap: 8,
  },
  customerSenderLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: COLORS.whatsappGreen,
    textTransform: 'uppercase',
  },
  taskConvertBtn: {
    backgroundColor: 'rgba(26, 59, 113, 0.08)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: RADIUS.full,
    borderWidth: 1,
    borderColor: COLORS.borderColor,
  },
  taskConvertBtnText: {
    fontSize: 10,
    fontWeight: '700',
    color: COLORS.primary,
  },
  bubbleText: {
    fontSize: 14,
    lineHeight: 20,
  },
  textWhite: {
    color: COLORS.bgWhite,
  },
  textDark: {
    color: COLORS.textDark,
  },
  bubbleMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    marginTop: 4,
    gap: 4,
  },
  bubbleTime: {
    fontSize: 10,
    fontWeight: '500',
  },
  timeStaff: {
    color: 'rgba(255,255,255,0.75)',
  },
  timeCustomer: {
    color: COLORS.textMuted,
  },
  checkmarkIcon: {
    marginLeft: 2,
  },
  noMessagesBox: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
    gap: 10,
  },
  noMessagesTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.textMuted,
    marginTop: 4,
  },
  noMessagesSub: {
    fontSize: 13,
    color: COLORS.textSubtle,
    textAlign: 'center',
    paddingHorizontal: 32,
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: SPACING.md,
    paddingVertical: 8,
    backgroundColor: COLORS.bgWhite,
    borderTopWidth: 1,
    borderTopColor: COLORS.borderColor,
    gap: 10,
  },
  textInput: {
    flex: 1,
    minHeight: 40,
    maxHeight: 100,
    backgroundColor: COLORS.inputBg,
    borderRadius: RADIUS.md,
    paddingHorizontal: 14,
    paddingVertical: 8,
    fontSize: 14,
    color: COLORS.textDark,
    borderWidth: 1,
    borderColor: COLORS.borderColor,
  },
  sendButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendButtonDisabled: {
    opacity: 0.5,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(7, 15, 30, 0.65)',
    justifyContent: 'flex-end',
  },
  modalCard: {
    backgroundColor: COLORS.bgWhite,
    borderTopLeftRadius: RADIUS.xl,
    borderTopRightRadius: RADIUS.xl,
    padding: SPACING.xl,
    paddingBottom: SPACING.xxxl,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: SPACING.lg,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: COLORS.primaryNavy,
  },
  modalCloseText: {
    fontSize: 18,
    color: COLORS.textMuted,
    fontWeight: '700',
    padding: 4,
  },
  formGroup: {
    marginBottom: SPACING.md,
  },
  formLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: COLORS.textDark,
    marginBottom: 4,
  },
  readOnlyCustomer: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.primary,
  },
  quoteBoxModal: {
    backgroundColor: COLORS.bgLinen,
    padding: 10,
    borderRadius: RADIUS.sm,
    borderLeftWidth: 3,
    borderLeftColor: COLORS.primary,
  },
  quoteBoxText: {
    fontSize: 12,
    fontStyle: 'italic',
    color: COLORS.textDark,
  },
  formInput: {
    borderWidth: 1,
    borderColor: COLORS.borderColor,
    borderRadius: RADIUS.md,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 14,
    color: COLORS.textDark,
    backgroundColor: COLORS.inputBg,
  },
  modalSubmitBtn: {
    backgroundColor: COLORS.primary,
    height: 48,
    borderRadius: RADIUS.md,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: SPACING.sm,
  },
  modalSubmitText: {
    color: COLORS.bgWhite,
    fontSize: 15,
    fontWeight: '700',
  },
  dateHeaderPillContainer: {
    alignItems: 'center',
    marginVertical: 12,
  },
  dateHeaderPill: {
    backgroundColor: 'rgba(255, 255, 255, 0.92)',
    paddingHorizontal: 14,
    paddingVertical: 5,
    borderRadius: RADIUS.full,
    borderWidth: 1,
    borderColor: COLORS.borderColor,
    shadowColor: COLORS.shadowColor,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 2,
    elevation: 1,
  },
  dateHeaderPillText: {
    fontSize: 11,
    fontWeight: '700',
    color: COLORS.primaryNavy,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
});
