import React, { useEffect, useState, useRef } from 'react';
import {
  View,
  Text,
  Image,
  FlatList,
  ScrollView,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Modal,
  Alert,
  Keyboard,
  StatusBar,
  RefreshControl,
  Linking,
} from 'react-native';
import { useRoute, useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useChatStore, ChatMessage } from '../../store/chatStore';
import { useTaskStore, TeamMember } from '../../store/taskStore';
import { useAuthStore } from '../../store/authStore';
import { COLORS, SPACING, RADIUS } from '../../constants/theme';
import { Icon } from '../../components/common/Icon';
import apiClient from '../../services/api';


export type MessageListItem =
  | { type: 'date_header'; id: string; dateLabel: string }
  | (ChatMessage & { type?: 'message' });

const parseMessageDate = (dateVal?: string | number, waTimestamp?: number | null): Date | null => {
  if (waTimestamp && Number(waTimestamp) > 0) {
    const d = new Date(Number(waTimestamp));
    if (!isNaN(d.getTime())) return d;
  }
  if (!dateVal) return null;
  if (typeof dateVal === 'number') {
    const num = dateVal > 1e11 ? dateVal : dateVal * 1000;
    const d = new Date(num);
    return isNaN(d.getTime()) ? null : d;
  }
  const str = String(dateVal).trim();
  if (!str || str === '2000-01-01 00:00:00' || str.startsWith('1970') || str.startsWith('2000-01-01')) return null;
  if (/^\d{10,13}$/.test(str)) {
    const num = Number(str);
    const d = new Date(num > 1e11 ? num : num * 1000);
    if (!isNaN(d.getTime())) return d;
  }
  const normalized = str.includes('T') || str.endsWith('Z')
    ? (str.endsWith('Z') ? str : `${str}Z`)
    : `${str.replace(' ', 'T')}Z`;
  const d = new Date(normalized);
  if (!isNaN(d.getTime())) return d;
  const dRaw = new Date(str);
  return isNaN(dRaw.getTime()) ? null : dRaw;
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
    const timeA = (a.whatsapp_timestamp && Number(a.whatsapp_timestamp) > 0)
      ? Number(a.whatsapp_timestamp)
      : (parseMessageDate(a.timestamp, a.whatsapp_timestamp)?.getTime() || 0);
    const timeB = (b.whatsapp_timestamp && Number(b.whatsapp_timestamp) > 0)
      ? Number(b.whatsapp_timestamp)
      : (parseMessageDate(b.timestamp, b.whatsapp_timestamp)?.getTime() || 0);
    if (timeA !== timeB) return timeA - timeB;
    const idA = typeof a.id === 'number' ? a.id : parseInt(String(a.id), 10) || 0;
    const idB = typeof b.id === 'number' ? b.id : parseInt(String(b.id), 10) || 0;
    return idA - idB;
  });

  const listItems: MessageListItem[] = [];
  let lastDateKey = '';

  for (const msg of sorted) {
    const dateObj = parseMessageDate(msg.timestamp, msg.whatsapp_timestamp);
    if (dateObj) {
      const dateKey = `${dateObj.getFullYear()}-${dateObj.getMonth()}-${dateObj.getDate()}`;
      if (dateKey !== lastDateKey) {
        lastDateKey = dateKey;
        const label = getDateHeaderLabel(dateObj);
        listItems.push({
          type: 'date_header',
          id: `date_header_${dateKey}`,
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
  const insets = useSafeAreaInsets();
  const { conversationId, customerName } = route.params || {};

  const {
    messages,
    fetchMessages,
    fetchOlderMessages,
    hasMoreMessages,
    isLoadingOlder,
    sendMessage,
    activeConversation,
    isSending,
    isLoading,
    clearMessages,
  } = useChatStore();

  const { addTask, teamMembers, fetchTeamMembers } = useTaskStore();
  const { user } = useAuthStore();

  const [isInitialLoading, setIsInitialLoading] = useState(true);
  const [inputMessage, setInputMessage] = useState('');
  const [isKeyboardVisible, setKeyboardVisible] = useState(false);
  const flatListRef = useRef<FlatList>(null);
  const isInitialScrollDone = useRef(false);

  useEffect(() => {
    const showSub = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow',
      () => {
        setKeyboardVisible(true);
        setTimeout(() => {
          flatListRef.current?.scrollToEnd({ animated: true });
        }, 100);
      }
    );
    const hideSub = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide',
      () => setKeyboardVisible(false)
    );
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  // Quick Task Modal
  const [taskModalVisible, setTaskModalVisible] = useState(false);
  const [taskOriginalMessage, setTaskOriginalMessage] = useState('');
  const [taskStaffNote, setTaskStaffNote] = useState('');
  const [taskMessageDate, setTaskMessageDate] = useState('');
  const [taskMessageTime, setTaskMessageTime] = useState('');
  const [assignDropdownOpen, setAssignDropdownOpen] = useState(false);
  const [isSubmittingTask, setIsSubmittingTask] = useState(false);
  const taskModalScrollRef = useRef<any>(null);
  const [taskKeyboardHeight, setTaskKeyboardHeight] = useState(0);

  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';

    const showSub = Keyboard.addListener(showEvent, (e) => {
      setTaskKeyboardHeight(e.endCoordinates.height);
    });
    const hideSub = Keyboard.addListener(hideEvent, () => {
      setTaskKeyboardHeight(0);
    });
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  const getTodayDateStr = () => {
    const now = new Date();
    const day = String(now.getDate()).padStart(2, '0');
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const year = now.getFullYear();
    return `${day}/${month}/${year}`;
  };

  const getCurrentTimeStr = () => {
    const now = new Date();
    let hours = now.getHours();
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const ampm = hours >= 12 ? 'pm' : 'am';
    hours = hours % 12;
    hours = hours ? hours : 12;
    return `${hours}:${minutes}${ampm}`;
  };

  const [taskTime, setTaskTime] = useState(getCurrentTimeStr());
  const [taskDueDate, setTaskDueDate] = useState(getTodayDateStr());
  const [assignedUser, setAssignedUser] = useState<TeamMember | null>(null);

  const availableAssignMembers = teamMembers.filter((m) => {
    if (user) {
      if (user.id && String(m.id) === String(user.id)) return false;
      if (user.email && m.email && m.email.toLowerCase() === user.email.toLowerCase()) return false;
      if (user.name && m.name && m.name.toLowerCase().trim() === user.name.toLowerCase().trim()) return false;
    }
    return true;
  });

  const activeConvId = conversationId || (route.params && route.params.id);

  useEffect(() => {
    let isMounted = true;
    if (activeConvId) {
      setIsInitialLoading(true);
      isInitialScrollDone.current = false;
      fetchMessages(String(activeConvId))
        .catch(() => {})
        .finally(() => {
          if (isMounted) {
            setIsInitialLoading(false);
          }
        });
    } else {
      setIsInitialLoading(false);
    }
  }, [activeConvId]);

  const groupedMessages = groupMessagesByDate(messages);

  useEffect(() => {
    if (!isInitialLoading && groupedMessages.length > 0) {
      requestAnimationFrame(() => {
        flatListRef.current?.scrollToEnd({ animated: false });
      });
      const timer = setTimeout(() => {
        flatListRef.current?.scrollToEnd({ animated: false });
        isInitialScrollDone.current = true;
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [isInitialLoading, activeConvId]);
  
  const handleLoadOlder = async () => {
    if (isLoadingOlder || !conversationId || !hasMoreMessages) return;
    await fetchOlderMessages(conversationId);
  };

  const handleSend = async (textToSend?: string) => {
    const text = (textToSend || inputMessage).trim();
    if (!text) return;
    setInputMessage('');
    await sendMessage(conversationId, text);
    flatListRef.current?.scrollToEnd({ animated: true });
  };

  const handleOpenCreateTask = (messageText: string, timestamp?: string, eventType?: string) => {
    fetchTeamMembers();
    setAssignedUser(null);
    setAssignDropdownOpen(false);
    setTaskDueDate(getTodayDateStr());
    setTaskTime(getCurrentTimeStr());
    setTaskOriginalMessage(messageText || '');
    setTaskStaffNote('');

    if (timestamp) {
      const d = parseMessageDate(timestamp);
      if (d && !isNaN(d.getTime())) {
        const day = String(d.getDate()).padStart(2, '0');
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const year = d.getFullYear();
        setTaskMessageDate(`${day}/${month}/${year}`);
        setTaskMessageTime(formatTime(timestamp));
      } else {
        setTaskMessageDate(getTodayDateStr());
        setTaskMessageTime(getCurrentTimeStr());
      }
    } else {
      setTaskMessageDate(getTodayDateStr());
      setTaskMessageTime(getCurrentTimeStr());
    }
    setTaskModalVisible(true);
  };

  const handleSaveTask = async () => {
    if (isSubmittingTask) return;
    try {
      setIsSubmittingTask(true);
      const custName = customerName || activeConversation?.customer_name || 'Customer';
      const custPhone = activeConversation?.phone_number || '+910000000000';
      const combinedDue = taskTime?.trim() ? `${taskDueDate.trim()} ${taskTime.trim()}` : taskDueDate.trim();
      await addTask({
        customerId: conversationId,
        customerName: custName,
        customerPhone: custPhone,
        originalMessage: taskOriginalMessage,
        staffNote: taskStaffNote,
        dueDate: combinedDue,
        assignedToUserId: assignedUser ? assignedUser.id : null,
        eventType: 'WhatsappChat',
      });

      setAssignedUser(null);
      setAssignDropdownOpen(false);
      setTaskModalVisible(false);
      Alert.alert('Task Created 📌', `CRM task added for ${custName}.`);
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'Failed to create task');
    } finally {
      setIsSubmittingTask(false);
    }
  };

  const formatTime = (isoString?: string, waTimestamp?: number | null) => {
    if (!isoString && !waTimestamp) return '';
    const date = parseMessageDate(isoString, waTimestamp);
    if (!date) return '';
    return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true });
  };

  const formatCallDuration = (seconds?: number | null): string => {
    if (seconds === null || seconds === undefined || isNaN(seconds) || seconds <= 0) {
      return '';
    }
    const s = Math.round(seconds);
    if (s < 60) {
      return `${s}s`;
    }
    const mins = Math.floor(s / 60);
    const remSecs = s % 60;
    return `${mins}:${remSecs.toString().padStart(2, '0')}`;
  };

  const getCallInfo = (rawText: string) => {
    if (!rawText) return { isCall: false, isVideo: false, isMissed: false, title: '', subtitle: '' };
    const text = rawText.trim();
    const lower = text.toLowerCase();

    // A call is ONLY matched if it is an explicit call string or emoji marker
    const isExplicitCall = text.startsWith('📹') || text.startsWith('📞') || text === '[call_log]' ||
      lower === 'video call' || lower === 'missed video call' || lower === 'outgoing video call' || lower === 'incoming video call' || lower === 'declined video call' ||
      lower === 'voice call' || lower === 'missed voice call' || lower === 'outgoing voice call' || lower === 'incoming voice call' || lower === 'declined voice call' ||
      lower === 'call' || lower.includes('tap to call back');

    if (!isExplicitCall) {
      return { isCall: false, isVideo: false, isMissed: false, title: '', subtitle: '' };
    }

    const isVideoCall = lower.includes('video') || text.includes('📹');
    const isMissed = lower.includes('missed') || lower.includes('no answer') || lower.includes('declined') || lower.includes('tap to call back');

    let title = '';
    if (isVideoCall) {
      title = isMissed ? 'Missed video call' : (lower.includes('outgoing') ? 'Outgoing video call' : 'Video call');
    } else {
      title = isMissed ? 'Missed voice call' : (lower.includes('outgoing') ? 'Outgoing voice call' : 'Voice call');
    }

    let subtitle = '';
    if (lower.includes('tap to call back') || isMissed) {
      subtitle = 'Tap to call back';
    } else if (lower.includes('declined')) {
      subtitle = 'Declined';
    } else {
      const durMatch = text.match(/(\d+\s*(?:sec|min|s|m|\:\d{2}))/i);
      if (durMatch) {
        subtitle = durMatch[1];
      } else {
        subtitle = '';
      }
    }

    return { isCall: true, isVideo: isVideoCall, isMissed, title, subtitle };
  };

  const getStructuredCallInfo = (item: ChatMessage) => {
    const metadata = item.metadata;
    const isStaff = item.sender === 'staff';
    const rawText = item.text || (item as any).message || '';
    const lowerText = String(rawText).toLowerCase();

    // Priority 1: Structured metadata from API
    if (metadata && metadata.isCall) {
      const isOutgoing = metadata.callType === 'outgoing' || isStaff || lowerText.includes('outgoing');
      const isVideo = metadata.mediaType === 'video' || lowerText.includes('video') || rawText.includes('📹');
      const isMissed = metadata.status === 'missed' || (!isOutgoing && metadata.status === 'unknown' && (!metadata.duration || metadata.duration <= 0)) || lowerText.includes('missed') || lowerText.includes('tap to call back') || lowerText.includes('no answer');
      const isRejected = !isMissed && (metadata.status === 'rejected' || lowerText.includes('declined') || lowerText.includes('rejected'));
      const isAnswered = metadata.status === 'answered' || (metadata.duration !== null && metadata.duration !== undefined && metadata.duration > 0);
      const isUnknown = !isMissed && !isRejected && !isAnswered;

      let title = '';
      if (isVideo) {
        if (isMissed) title = 'Missed video call';
        else if (isRejected) title = 'Declined video call';
        else if (isOutgoing) title = 'Outgoing video call';
        else title = 'Video call';
      } else {
        if (isMissed) title = 'Missed voice call';
        else if (isRejected) title = 'Declined voice call';
        else if (isOutgoing) title = 'Outgoing voice call';
        else title = 'Voice call';
      }

      let subtitle = '';
      if (isMissed) {
        subtitle = 'Tap to call back';
      } else if (isRejected) {
        subtitle = 'Declined';
      } else if (metadata.duration !== null && metadata.duration !== undefined && metadata.duration > 0) {
        subtitle = formatCallDuration(metadata.duration);
      } else if (isOutgoing) {
        subtitle = 'No answer';
      } else {
        subtitle = '';
      }

      return {
        isCall: true,
        isVideo,
        isMissed,
        isRejected,
        isAnswered,
        isUnknown,
        title,
        subtitle,
        duration: metadata.duration
      };
    }

    // Priority 2: message_type === 'call'
    if (item.message_type === 'call') {
      const fallback = getCallInfo(rawText);
      return {
        ...fallback,
        isRejected: fallback.title.includes('Declined'),
        isAnswered: !fallback.isMissed,
        isUnknown: false,
        duration: null
      };
    }

    // Priority 3: Legacy getCallInfo fallback for old messages without metadata
    const legacy = getCallInfo(rawText);
    return {
      ...legacy,
      isRejected: legacy.title.includes('Declined'),
      isAnswered: legacy.isCall && !legacy.isMissed,
      isUnknown: false,
      duration: null
    };
  };

  const handleDirectCall = (type: 'voice' | 'video') => {
    const rawPhone = activeConversation?.phone_number || '';
    const phone = rawPhone.replace(/[^0-9+]/g, '');
    const name = customerName || activeConversation?.customer_name || 'Customer';

    if (!phone) {
      Alert.alert('Phone Number Unavailable', 'Customer phone number is not available for call.');
      return;
    }

    Alert.alert(
      type === 'video' ? 'Video Call' : 'Voice Call',
      `Choose call option for ${name}:`,
      [
        {
          text: 'Call via WhatsApp',
          onPress: () => {
            if (activeConversation?.id) {
              apiClient.post('/api/whatsapp/log-call', {
                conversationId: activeConversation.id,
                phoneNumber: phone,
                mediaType: type,
                callType: 'outgoing',
              }).catch(() => {});
            }
            const clean = phone.replace('+', '');
            const waUrl = `https://wa.me/${clean}`;
            Linking.openURL(waUrl).catch(() => {
              Alert.alert('Error', 'Unable to open WhatsApp application.');
            });
          },
        },
        {
          text: 'Call via Phone',
          onPress: () => {
            if (activeConversation?.id) {
              apiClient.post('/api/whatsapp/log-call', {
                conversationId: activeConversation.id,
                phoneNumber: phone,
                mediaType: type,
                callType: 'outgoing',
              }).catch(() => {});
            }
            Linking.openURL(`tel:${phone}`).catch(() => {
              Alert.alert('Error', 'Unable to open Phone dialer.');
            });
          },
        },
        { text: 'Cancel', style: 'cancel' },
      ]
    );
  };

  const getDisplayText = (text: string): string => {
    // Normalize legacy DB values to readable labels
    if (!text) return '';
    if (text === '📹 Video call' || text === 'Video Call' || text === 'Video call') return 'Video Call';
    if (text === '📞 Voice call' || text === 'Voice call' || text === 'Call' || text === '[call_log]') return 'Voice Call';
    if (text === 'Images' || text === 'Image') return '🖼️ Image';
    if (text === 'Video') return '🎥 Video';
    if (text === 'Album') return '🗂️ Album';
    if (text === 'Voice message') return '🎤 Voice Message';
    if (text === 'Sticker') return '🎭 Sticker';
    if (text === 'Document') return '📄 Document';
    if (text === 'Location') return '📍 Location';
    if (text === 'Contact') return '👤 Contact';
    if (text === '[gp2]') return '🔔 Group update';
    if (text === '[e2e_notification]') return '🔒 End-to-end encrypted';
    if (text === '[notification_template]') return 'Notification';
    return text;
  };

  const parseGroupSender = (text: string) => {
    if (!text) return { senderName: null, contentText: text };
    const match = text.match(/^([^:\n]+):\s*([\s\S]*)$/);
    if (match) {
      const potentialSender = match[1].trim();
      const rest = match[2];
      if (
        !potentialSender.startsWith('http') &&
        !potentialSender.startsWith('https') &&
        !potentialSender.startsWith('ftp') &&
        potentialSender.length < 50
      ) {
        return { senderName: potentialSender, contentText: rest };
      }
    }
    return { senderName: null, contentText: text };
  };

  const renderMessageBubble = (item: ChatMessage) => {
    const isStaff = item.sender === 'staff';
    const rawText = item.text || (item as any).message || '';
    const { senderName, contentText } = !isStaff ? parseGroupSender(rawText) : { senderName: null, contentText: rawText };
    const displaySenderName = senderName || customerName || activeConversation?.customer_name || 'Customer';
    const callInfo = getStructuredCallInfo(item);

    if (callInfo.isCall) {
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
              styles.callBubbleCard,
            ]}
          >
            {!isStaff ? (
              <View style={styles.customerHeaderRow}>
                <Text style={styles.groupSenderNameText} numberOfLines={1}>
                  {displaySenderName}
                </Text>
                <TouchableOpacity
                  style={styles.taskConvertBtn}
                  onPress={() => handleOpenCreateTask(callInfo.title, item.timestamp, callInfo.isVideo ? 'Video Call' : 'WhatsApp Call')}
                  activeOpacity={0.7}
                >
                  <Text style={styles.taskConvertBtnText}>📌 Task</Text>
                </TouchableOpacity>
              </View>
            ) : null}

            <TouchableOpacity
              style={styles.callCardMain}
              onPress={() => handleDirectCall(callInfo.isVideo ? 'video' : 'voice')}
              activeOpacity={0.8}
            >
              <View
                style={[
                  styles.callIconContainer,
                  callInfo.isMissed
                    ? styles.callIconBoxMissed
                    : isStaff
                    ? styles.callIconBoxStaff
                    : styles.callIconBoxCustomer,
                ]}
              >
                <Icon
                  name={callInfo.isVideo ? 'video' : 'phone'}
                  size={18}
                  color={callInfo.isMissed ? '#EF4444' : isStaff ? '#FFFFFF' : COLORS.primary}
                />
              </View>

              <View style={styles.callDetailsCol}>
                <Text
                  style={[
                    styles.callTitleText,
                    callInfo.isMissed && !isStaff ? styles.missedCallText : isStaff ? styles.textWhite : styles.textDark,
                  ]}
                >
                  {callInfo.title}
                </Text>
                {callInfo.subtitle ? (
                  <Text
                    style={[
                      styles.callSubtitleText,
                      isStaff ? styles.timeStaff : styles.timeCustomer,
                    ]}
                  >
                    {callInfo.subtitle}
                  </Text>
                ) : null}
              </View>
            </TouchableOpacity>

            <View style={styles.bubbleMeta}>
              <Text style={[styles.bubbleTime, isStaff ? styles.timeStaff : styles.timeCustomer]}>
                {formatTime(item.timestamp, item.whatsapp_timestamp)}
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
    }

    const isImage = item.message_type === 'image' || !!item.metadata?.isImage || !!item.metadata?.mediaUrl || rawText.startsWith('data:image') || rawText.startsWith('/9j/');
    const imageUri = item.metadata?.mediaUrl || (rawText.startsWith('data:image') ? rawText : (rawText.startsWith('/9j/') ? `data:image/jpeg;base64,${rawText}` : null));
    const captionText = item.metadata?.caption || (!rawText.startsWith('data:image') && !rawText.startsWith('/9j/') && rawText !== '📷 Photo' && rawText !== 'Images' && rawText !== 'Image' && rawText !== '🖼️ Image' ? contentText : '');

    const displayText = getDisplayText(contentText);

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
            isImage && styles.bubbleImageContainer,
          ]}
        >
          {/* Sender indicator on top left side of Create Task */}
          {!isStaff ? (
            <View style={styles.customerHeaderRow}>
              <Text style={styles.groupSenderNameText} numberOfLines={1}>
                {displaySenderName}
              </Text>

              {/* One-Tap 📌 Create Task button directly on customer message */}
              <TouchableOpacity
                style={styles.taskConvertBtn}
                onPress={() => handleOpenCreateTask(captionText || displayText, item.timestamp, isImage ? 'WhatsApp Image' : 'WhatsApp Chat')}
                activeOpacity={0.7}
              >
                <Text style={styles.taskConvertBtnText}>📌 Create Task</Text>
              </TouchableOpacity>
            </View>
          ) : null}

          {isImage ? (
            <View style={styles.mediaContentBox}>
              {imageUri ? (
                <Image
                  source={{ uri: imageUri }}
                  style={styles.chatImagePreview}
                  resizeMode="cover"
                />
              ) : (
                <View style={styles.placeholderImageBox}>
                  <Icon name="image" size={36} color={isStaff ? '#FFFFFF' : COLORS.primary} />
                  <Text style={[styles.placeholderImageLabel, isStaff ? styles.textWhite : styles.textDark]}>
                    Photo
                  </Text>
                </View>
              )}
              {captionText ? (
                <Text style={[styles.bubbleText, styles.mediaCaptionText, isStaff ? styles.textWhite : styles.textDark]}>
                  {captionText}
                </Text>
              ) : null}
            </View>
          ) : (
            <Text style={[styles.bubbleText, isStaff ? styles.textWhite : styles.textDark]}>
              {displayText}
            </Text>
          )}

          <View style={styles.bubbleMeta}>
            <Text style={[styles.bubbleTime, isStaff ? styles.timeStaff : styles.timeCustomer]}>
              {formatTime(item.timestamp, item.whatsapp_timestamp)}
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

  const statusBarHeight = Platform.OS === 'android' ? (StatusBar.currentHeight || 28) : 0;
  const headerTopPadding = Math.max(insets.top, statusBarHeight) + 10;

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 0}
    >
      <StatusBar barStyle="light-content" />

      {/* Top Chat Subheader */}
      <View style={[styles.chatSubheader, { paddingTop: headerTopPadding }]}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={styles.backBtn}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          activeOpacity={0.7}
        >
          <Icon name="arrow-left" size={22} color={COLORS.bgWhite} strokeWidth={2.5} />
        </TouchableOpacity>
        <View style={styles.headerInfo}>
          <Text style={styles.headerCustomerName} numberOfLines={1}>
            {customerName || activeConversation?.customer_name || 'Customer'}
          </Text>
          <Text style={styles.headerCustomerPhone}>
            {activeConversation?.phone_number || 'Live WhatsApp'}
          </Text>
        </View>
      </View>

      {/* Message List */}
      {isInitialLoading ? (
        <View style={styles.centerLoading}>
          <ActivityIndicator size="large" color={COLORS.primary} />
        </View>
      ) : (
        <FlatList
          ref={flatListRef}
          data={groupedMessages}
          keyExtractor={(item) => item.id}
          initialNumToRender={20}
          maxToRenderPerBatch={15}
          windowSize={9}
          removeClippedSubviews={Platform.OS === 'android'}
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
          style={styles.flatListFlex}
          contentContainerStyle={[styles.messagesList, { flexGrow: 1 }]}
          showsVerticalScrollIndicator={false}
          bounces={true}
          alwaysBounceVertical={true}
          overScrollMode="always"
          keyboardDismissMode="on-drag"
          keyboardShouldPersistTaps="handled"
          maintainVisibleContentPosition={{ minIndexForVisible: 1, autoscrollToTopThreshold: 10 }}
          onContentSizeChange={() => {
            if (!isInitialScrollDone.current && groupedMessages.length > 0) {
              flatListRef.current?.scrollToEnd({ animated: false });
              isInitialScrollDone.current = true;
            }
          }}
          onLayout={() => {
            if (!isInitialScrollDone.current && groupedMessages.length > 0) {
              flatListRef.current?.scrollToEnd({ animated: false });
            }
          }}
          onScroll={(event) => {
            const offsetY = event.nativeEvent.contentOffset.y;
            if (offsetY <= 40 && hasMoreMessages && !isLoadingOlder && !isInitialLoading && isInitialScrollDone.current) {
              handleLoadOlder();
            }
          }}
          scrollEventThrottle={16}
          refreshControl={
            <RefreshControl
              refreshing={isLoadingOlder}
              onRefresh={handleLoadOlder}
              tintColor={COLORS.primary}
              colors={[COLORS.primary]}
            />
          }
          ListHeaderComponent={
            isLoadingOlder ? (
              <View style={styles.listHeaderContainer}>
                <View style={styles.loadOlderRow}>
                  <ActivityIndicator size="small" color={COLORS.primary} />
                </View>
              </View>
            ) : !hasMoreMessages && groupedMessages.length > 0 ? (
              <View style={styles.listHeaderContainer}>
                <View style={styles.beginningContainer}>
                  <View style={styles.beginningLine} />
                  <Text style={styles.beginningText}>Beginning of conversation</Text>
                  <View style={styles.beginningLine} />
                </View>
              </View>
            ) : undefined
          }
          ListEmptyComponent={
            <View style={styles.noMessagesBox}>
              <Icon name="chat" size={40} color={COLORS.borderColor} />
              <Text style={styles.noMessagesTitle}>No messages yet</Text>
              <Text style={styles.noMessagesSub}>No messages in this conversation yet.</Text>
            </View>
          }
        />
      )}

      {/* Bottom Input Box */}
      <View
        style={[
          styles.inputContainer,
          {
            paddingBottom: isKeyboardVisible
              ? 10
              : Math.max(insets.bottom, 12) + 6,
          },
        ]}
      >
        <TextInput
          style={styles.textInput}
          placeholder="Type Here..."
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

      {/* Create Task Modal */}
      <Modal
        visible={taskModalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => {
          Keyboard.dismiss();
          setTaskModalVisible(false);
        }}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={[
            styles.modalOverlay,
            Platform.OS === 'android' && taskKeyboardHeight > 0
              ? { paddingBottom: taskKeyboardHeight }
              : null,
          ]}
        >
          <TouchableOpacity
            style={StyleSheet.absoluteFill}
            activeOpacity={1}
            onPress={() => {
              Keyboard.dismiss();
              if (assignDropdownOpen) setAssignDropdownOpen(false);
            }}
          />
          <View style={styles.modalCard}>
            {/* Header: Title "Create Task 📌 " & Close Button */}
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Create Task 📌 </Text>
              <TouchableOpacity
                onPress={() => {
                  Keyboard.dismiss();
                  setTaskModalVisible(false);
                }}
                hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              >
                <Text style={styles.modalCloseText}>✕</Text>
              </TouchableOpacity>
            </View>

            <ScrollView
              ref={taskModalScrollRef}
              style={{ maxHeight: 520 }}
              contentContainerStyle={{
                paddingBottom: taskKeyboardHeight > 0 ? 120 : 36,
                flexGrow: 1,
              }}
              showsVerticalScrollIndicator={true}
              keyboardShouldPersistTaps="handled"
              nestedScrollEnabled={true}
            >
              {/* Task Info Section */}
              <View style={styles.taskInfoSection}>
                <Text style={styles.taskInfoHeading}>Task Info</Text>

                {/* Details Card */}
                <View style={styles.infoDetailsBox}>
                  {/* Name */}
                  <View style={styles.infoDetailRow}>
                    <Text style={styles.infoDetailLabel}>Name :</Text>
                    <Text style={styles.infoDetailValue} numberOfLines={1}>
                      {customerName || activeConversation?.customer_name || 'Customer'}
                    </Text>
                  </View>

                  {/* Phone Number */}
                  <View style={styles.infoDetailRow}>
                    <Text style={styles.infoDetailLabel}>Phone Number :</Text>
                    <Text style={styles.infoDetailValue}>
                      {activeConversation?.phone_number || 'N/A'}
                    </Text>
                  </View>

                  {/* Message Date */}
                  <View style={styles.infoDetailRow}>
                    <Text style={styles.infoDetailLabel}>Date :</Text>
                    <Text style={styles.infoDetailValue}>
                      {taskMessageDate || getTodayDateStr()}
                    </Text>
                  </View>

                  {/* Message Time */}
                  <View style={styles.infoDetailRow}>
                    <Text style={styles.infoDetailLabel}>Time :</Text>
                    <Text style={styles.infoDetailValue}>
                      {taskMessageTime || getCurrentTimeStr()}
                    </Text>
                  </View>

                  {/* Event Type */}
                  <View style={styles.infoDetailRow}>
                    <Text style={styles.infoDetailLabel}>Event Type :</Text>
                    <Text style={styles.infoDetailValue}>WhatsappChat</Text>
                  </View>

                  {/* Message / Description */}
                  {taskOriginalMessage ? (
                    <View style={[styles.infoDetailRow, { borderBottomWidth: 0, paddingBottom: 0 }]}>
                      <Text style={styles.infoDetailLabel}>Message :</Text>
                      <Text style={styles.infoDetailDescValue} numberOfLines={3}>
                        "{taskOriginalMessage}"
                      </Text>
                    </View>
                  ) : null}
                </View>
              </View>

              {/* Date & Time Row */}
              <View style={styles.dateTimeRow}>
                <View style={styles.dateTimeCol}>
                  <Text style={styles.fieldHeading}>Create Task Date :</Text>
                  <View style={styles.dateTimeInputContainer}>
                    <Icon name="calendar" size={14} color={COLORS.primary} />
                    <TextInput
                      style={styles.dateTimeInput}
                      value={taskDueDate}
                      onChangeText={setTaskDueDate}
                      placeholder="DD/MM/YYYY"
                      placeholderTextColor={COLORS.textSubtle}
                      onFocus={() => {
                        setTimeout(() => {
                          taskModalScrollRef.current?.scrollTo({ y: 160, animated: true });
                        }, 180);
                      }}
                    />
                  </View>
                </View>

                <View style={styles.dateTimeCol}>
                  <Text style={styles.fieldHeading}>Create Task Time :</Text>
                  <View style={styles.dateTimeInputContainer}>
                    <Icon name="clock" size={14} color={COLORS.primary} />
                    <TextInput
                      style={styles.dateTimeInput}
                      value={taskTime}
                      onChangeText={setTaskTime}
                      placeholder="2:37pm"
                      placeholderTextColor={COLORS.textSubtle}
                      onFocus={() => {
                        setTimeout(() => {
                          taskModalScrollRef.current?.scrollTo({ y: 160, animated: true });
                        }, 180);
                      }}
                    />
                  </View>
                </View>
              </View>

              {/* Our Notes */}
              <View style={styles.formGroup}>
                <Text style={styles.fieldHeading}>Our Notes:</Text>
                <TextInput
                  style={styles.notesTextarea}
                  value={taskStaffNote}
                  onChangeText={setTaskStaffNote}
                  placeholder="Write your Notes here (5 to 10 lines).."
                  placeholderTextColor={COLORS.textSubtle}
                  multiline={true}
                  numberOfLines={6}
                  textAlignVertical="top"
                  onFocus={() => {
                    setTimeout(() => {
                      taskModalScrollRef.current?.scrollToEnd({ animated: true });
                    }, 180);
                  }}
                />
              </View>

              {/* Assign Task To */}
              <View style={styles.formGroup}>
                <Text style={styles.fieldHeading}>Assign Task To:</Text>
                <TouchableOpacity
                  style={[
                    styles.dropdownTrigger,
                    assignDropdownOpen && styles.dropdownTriggerActive,
                  ]}
                  onPress={() => {
                    Keyboard.dismiss();
                    fetchTeamMembers();
                    setAssignDropdownOpen(!assignDropdownOpen);
                  }}
                  activeOpacity={0.8}
                >
                  <View style={styles.dropdownTriggerLeft}>
                    <Text style={styles.dropdownTriggerText} numberOfLines={1}>
                      {assignedUser ? assignedUser.name : 'Unassigned'}
                    </Text>
                  </View>
                  <Icon
                    name={assignDropdownOpen ? 'chevron-up' : 'chevron-down'}
                    size={18}
                    color={COLORS.textDark}
                  />
                </TouchableOpacity>

                {/* Dropdown Menu */}
                {assignDropdownOpen && (
                  <View style={styles.dropdownMenu}>
                    {/* Default Unassigned option */}
                    <TouchableOpacity
                      style={[
                        styles.dropdownItem,
                        !assignedUser && styles.dropdownItemActive,
                      ]}
                      onPress={() => {
                        setAssignedUser(null);
                        setAssignDropdownOpen(false);
                      }}
                      activeOpacity={0.7}
                    >
                      <View style={styles.dropdownItemContent}>
                        <View>
                          <Text
                            style={[
                              styles.dropdownItemName,
                              !assignedUser && styles.dropdownItemNameActive,
                            ]}
                          >
                            Unassigned
                          </Text>
                          <Text style={styles.dropdownItemRole}>Default</Text>
                        </View>
                      </View>
                      {!assignedUser ? (
                        <Icon name="check" size={16} color={COLORS.primary} strokeWidth={2.5} />
                      ) : null}
                    </TouchableOpacity>

                    {/* Team Member Options */}
                    {availableAssignMembers.length === 0 ? (
                      <View style={{ padding: 14, alignItems: 'center' }}>
                        <Text style={{ fontSize: 13, color: COLORS.textMuted }}>
                          No other users found
                        </Text>
                      </View>
                    ) : (
                      availableAssignMembers.map((member) => {
                        const isSelected = assignedUser?.id === member.id;
                        return (
                          <TouchableOpacity
                            key={member.id}
                            style={[
                              styles.dropdownItem,
                              isSelected && styles.dropdownItemActive,
                            ]}
                            onPress={() => {
                              setAssignedUser(member);
                              setAssignDropdownOpen(false);
                            }}
                            activeOpacity={0.7}
                          >
                            <View style={styles.dropdownItemContent}>
                              <View>
                                <Text
                                  style={[
                                    styles.dropdownItemName,
                                    isSelected && styles.dropdownItemNameActive,
                                  ]}
                                >
                                  {member.name}
                                </Text>
                                <Text style={styles.dropdownItemRole}>
                                  {member.role ? member.role.toUpperCase() : 'USER'}
                                </Text>
                              </View>
                            </View>
                            {isSelected ? (
                              <Icon name="check" size={16} color={COLORS.primary} strokeWidth={2.5} />
                            ) : null}
                          </TouchableOpacity>
                        );
                      })
                    )}
                  </View>
                )}
              </View>

              {/* Submit button */}
              <TouchableOpacity
                style={[styles.modalSubmitBtn, isSubmittingTask && { opacity: 0.7 }]}
                onPress={handleSaveTask}
                disabled={isSubmittingTask}
                activeOpacity={0.85}
              >
                {isSubmittingTask ? (
                  <ActivityIndicator size="small" color={COLORS.bgWhite} />
                ) : (
                  <Text style={styles.modalSubmitText}>Submit</Text>
                )}
              </TouchableOpacity>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
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
    paddingVertical: 6,
    paddingHorizontal: 8,
    alignItems: 'center',
    justifyContent: 'center',
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
    paddingHorizontal: SPACING.sm,
    paddingVertical: SPACING.xs,
  },
  bubbleWrapper: {
    marginVertical: 4,
    maxWidth: '85%',
  },
  bubbleWrapperLeft: {
    alignSelf: 'flex-start',
  },
  bubbleWrapperRight: {
    alignSelf: 'flex-end',
  },
  bubbleContainer: {
    borderRadius: RADIUS.lg,
    paddingHorizontal: 12,
    paddingVertical: 8,
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
    marginBottom: 4,
    gap: 8,
  },
  groupSenderNameText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#008477',
    flex: 1,
    marginRight: 6,
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
    paddingVertical: 2,
    borderRadius: RADIUS.full,
    borderWidth: 1,
    borderColor: COLORS.borderColor,
    flexShrink: 0,
  },
  taskConvertBtnText: {
    fontSize: 10,
    fontWeight: '700',
    color: COLORS.primary,
  },
  bubbleText: {
    fontSize: 14,
    lineHeight: 19,
  },
  bubbleImageContainer: {
    paddingHorizontal: 6,
    paddingTop: 6,
    paddingBottom: 6,
  },
  mediaContentBox: {
    borderRadius: RADIUS.md,
    overflow: 'hidden',
    marginBottom: 4,
  },
  chatImagePreview: {
    width: 220,
    height: 180,
    borderRadius: RADIUS.md,
    backgroundColor: '#E2E8F0',
  },
  placeholderImageBox: {
    width: 200,
    height: 120,
    borderRadius: RADIUS.md,
    backgroundColor: 'rgba(0,0,0,0.06)',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  placeholderImageLabel: {
    fontSize: 12,
    fontWeight: '600',
  },
  mediaCaptionText: {
    marginTop: 6,
    paddingHorizontal: 4,
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
    marginTop: 2,
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
    paddingTop: 8,
    backgroundColor: COLORS.bgWhite,
    borderTopWidth: 1,
    borderTopColor: COLORS.borderColor,
    gap: 10,
  },
  textInput: {
    flex: 1,
    minHeight: 40,
    backgroundColor: COLORS.inputBg,
    borderRadius: 20,
    paddingHorizontal: SPACING.md,
    paddingTop: 10,
    paddingBottom: 10,
    maxHeight: 100,
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
    maxHeight: '92%',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: SPACING.md,
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
  taskInfoSection: {
    backgroundColor: '#F8FAFC',
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: 14,
    marginBottom: SPACING.md,
  },
  taskInfoHeading: {
    fontSize: 14,
    fontWeight: '800',
    color: COLORS.primaryNavy,
    marginBottom: 10,
    textTransform: 'capitalize',
  },
  infoDetailsBox: {
    backgroundColor: COLORS.bgWhite,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 8,
  },
  infoDetailRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    paddingBottom: 6,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  infoDetailLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.textMuted,
    flex: 0.42,
  },
  infoDetailValue: {
    fontSize: 13,
    fontWeight: '700',
    color: COLORS.textDark,
    flex: 0.58,
    textAlign: 'right',
  },
  infoDetailDescValue: {
    fontSize: 13,
    fontWeight: '600',
    color: '#D97706',
    flex: 0.58,
    textAlign: 'right',
    fontStyle: 'italic',
  },
  fieldHeading: {
    fontSize: 13,
    fontWeight: '700',
    color: COLORS.primaryNavy,
    marginBottom: 6,
  },
  dateTimeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: SPACING.md,
  },
  dateTimeCol: {
    flex: 1,
  },
  dateTimeInputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: RADIUS.md,
    paddingHorizontal: 12,
    height: 46,
    gap: 8,
  },
  dateTimeInput: {
    flex: 1,
    fontSize: 13,
    color: COLORS.textDark,
    fontWeight: '600',
    paddingVertical: 0,
  },
  notesTextarea: {
    minHeight: 110,
    maxHeight: 190,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: RADIUS.md,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: COLORS.textDark,
    textAlignVertical: 'top',
  },
  dropdownTrigger: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: RADIUS.md,
    paddingHorizontal: 12,
    height: 46,
  },
  dropdownTriggerActive: {
    borderColor: COLORS.primary,
    backgroundColor: '#EFF6FF',
  },
  dropdownTriggerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
  },
  dropdownTriggerText: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.textDark,
    flex: 1,
  },
  dropdownMenu: {
    backgroundColor: COLORS.bgWhite,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: RADIUS.md,
    marginTop: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 4,
    overflow: 'hidden',
  },
  dropdownItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  dropdownItemActive: {
    backgroundColor: '#EFF6FF',
  },
  dropdownItemContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
  },
  dropdownItemName: {
    fontSize: 13,
    fontWeight: '700',
    color: COLORS.textDark,
  },
  dropdownItemNameActive: {
    color: COLORS.primary,
  },
  dropdownItemRole: {
    fontSize: 11,
    color: COLORS.textMuted,
    marginTop: 1,
  },
  formGroup: {
    marginBottom: SPACING.md,
  },
  modalSubmitBtn: {
    backgroundColor: COLORS.primary,
    height: 48,
    borderRadius: RADIUS.md,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: SPACING.md,
    shadowColor: COLORS.primary,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.2,
    shadowRadius: 5,
    elevation: 3,
  },
  modalSubmitText: {
    color: COLORS.bgWhite,
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: 0.3,
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
  assignChipsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 4,
  },
  assignChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: RADIUS.full,
    backgroundColor: COLORS.inputBg,
    borderWidth: 1,
    borderColor: COLORS.borderColor,
  },
  assignChipActive: {
    backgroundColor: '#EFF6FF',
    borderColor: COLORS.primary,
  },
  assignChipText: {
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.textDark,
  },
  assignChipTextActive: {
    color: COLORS.primary,
    fontWeight: '700',
  },
  chipAvatar: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: COLORS.textMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipAvatarActive: {
    backgroundColor: COLORS.primary,
  },
  chipAvatarText: {
    color: COLORS.bgWhite,
    fontSize: 10,
    fontWeight: '700',
  },
  chipAvatarTextActive: {
    color: COLORS.bgWhite,
  },
  listHeaderContainer: {
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  loadOlderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 6,
  },
  loadOlderText: {
    fontSize: 12,
    color: COLORS.primary,
    fontWeight: '600',
  },
  loadOlderBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: RADIUS.full,
    backgroundColor: '#EFF6FF',
    borderWidth: 1,
    borderColor: '#DBEAFE',
  },
  loadOlderBtnText: {
    fontSize: 12,
    color: COLORS.primary,
    fontWeight: '600',
  },
  beginningContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: SPACING.md,
    paddingVertical: 6,
  },
  beginningLine: {
    flex: 1,
    height: 1,
    backgroundColor: COLORS.borderColor,
  },
  beginningText: {
    fontSize: 11,
    color: COLORS.textMuted,
    fontWeight: '500',
  },
  flatListFlex: {
    flex: 1,
  },
  topSyncBanner: {
    backgroundColor: '#EFF6FF',
    borderBottomWidth: 1,
    borderBottomColor: '#DBEAFE',
    paddingVertical: 9,
    paddingHorizontal: SPACING.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  topSyncRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  topSyncText: {
    fontSize: 12,
    color: COLORS.primary,
    fontWeight: '600',
  },
  headerActionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headerCallIconBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255, 255, 255, 0.16)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  callBubbleCard: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    minWidth: 200,
  },
  callCardMain: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 4,
  },
  callIconContainer: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 10,
  },
  callIconBoxStaff: {
    backgroundColor: 'rgba(255, 255, 255, 0.22)',
  },
  callIconBoxCustomer: {
    backgroundColor: 'rgba(22, 50, 91, 0.1)',
  },
  callIconBoxMissed: {
    backgroundColor: 'rgba(239, 68, 68, 0.15)',
  },
  callDetailsCol: {
    flex: 1,
  },
  callTitleText: {
    fontSize: 14,
    fontWeight: '600',
  },
  missedCallText: {
    color: '#EF4444',
  },
  callSubtitleText: {
    fontSize: 11,
    marginTop: 1,
  },
});
