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
  PermissionsAndroid,
} from 'react-native';
import { useRoute, useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { launchCamera, launchImageLibrary } from 'react-native-image-picker';
import DocumentPicker, { types as docTypes } from 'react-native-document-picker';
import { useChatStore, ChatMessage, SendMediaPayload, SendImagePayload, deduplicateMessages, resolveMediaUrl } from '../../store/chatStore';
import { useTaskStore, TeamMember } from '../../store/taskStore';
import { useAuthStore } from '../../store/authStore';
import { COLORS, SPACING, RADIUS } from '../../constants/theme';
import { Icon } from '../../components/common/Icon';
import apiClient from '../../services/api';

export const formatFileSize = (bytes?: number): string => {
  if (!bytes || bytes <= 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

export const formatDuration = (seconds?: number): string => {
  if (!seconds || seconds <= 0) return '';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
};

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

  const sorted = deduplicateMessages(rawMessages);
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
    fetchConversations,
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
  const [selectedMedia, setSelectedMedia] = useState<SendMediaPayload | null>(null);
  const selectedImage = selectedMedia;
  const setSelectedImage = setSelectedMedia;
  const [isKeyboardVisible, setKeyboardVisible] = useState(false);
  const flatListRef = useRef<FlatList>(null);
  const isInitialScrollDone = useRef(false);
  const isUserDragging = useRef(false);

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

  const [attachmentModalVisible, setAttachmentModalVisible] = useState(false);
  const [taskModalVisible, setTaskModalVisible] = useState(false);
  const [selectedMediaModal, setSelectedMediaModal] = useState<{
    visible: boolean;
    type: 'image' | 'video' | 'document';
    uri: string;
    caption?: string;
    filename?: string;
    filesize?: number;
    duration?: number;
    ext?: string;
  }>({
    visible: false,
    type: 'image',
    uri: '',
    caption: '',
  });
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
      const scrollDown = () => {
        flatListRef.current?.scrollToEnd({ animated: false });
      };
      scrollDown();
      const t1 = setTimeout(scrollDown, 50);
      const t2 = setTimeout(scrollDown, 150);
      const t3 = setTimeout(() => {
        scrollDown();
        isInitialScrollDone.current = true;
      }, 400);
      return () => {
        clearTimeout(t1);
        clearTimeout(t2);
        clearTimeout(t3);
      };
    }
  }, [isInitialLoading, activeConvId, groupedMessages.length]);
  
  useEffect(() => {
    return () => {
      fetchConversations().catch(() => {});
    };
  }, [fetchConversations]);

  const handleLoadOlder = async () => {
    if (isLoadingOlder || !conversationId || !hasMoreMessages) return;
    await fetchOlderMessages(conversationId);
  };

  const requestCameraPermission = async () => {
    if (Platform.OS !== 'android') return true;
    try {
      const granted = await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.CAMERA,
        {
          title: 'Camera Permission',
          message: 'JeenMate needs access to your camera to take and send photos.',
          buttonPositive: 'OK',
        }
      );
      return granted === PermissionsAndroid.RESULTS.GRANTED;
    } catch (err) {
      console.warn(err);
      return false;
    }
  };

  const requestGalleryPermission = async () => {
    if (Platform.OS !== 'android') return true;
    try {
      if (Platform.Version >= 33) {
        const granted = await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.READ_MEDIA_IMAGES
        );
        return granted === PermissionsAndroid.RESULTS.GRANTED;
      } else {
        const granted = await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.READ_EXTERNAL_STORAGE
        );
        return granted === PermissionsAndroid.RESULTS.GRANTED;
      }
    } catch (err) {
      console.warn(err);
      return false;
    }
  };

const getBase64FromUri = async (uri: string): Promise<string> => {
  try {
    const response = await fetch(uri);
    const blob = await response.blob();
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const resStr = (reader.result as string) || '';
        const b64 = resStr.includes(',') ? resStr.split(',')[1] : resStr;
        resolve(b64);
      };
      reader.onerror = () => resolve('');
      reader.readAsDataURL(blob);
    });
  } catch (_) {
    return '';
  }
};

  const handlePickCamera = async () => {
    setAttachmentModalVisible(false);
    const hasPermission = await requestCameraPermission();
    if (!hasPermission) {
      Alert.alert('Permission Required', 'Camera permission is needed to take a photo.');
      return;
    }

    try {
      const res = await launchCamera({
        mediaType: 'photo',
        quality: 0.8,
        maxWidth: 1280,
        maxHeight: 1280,
        includeBase64: true,
        saveToPhotos: false,
      });

      if (res.didCancel) return;
      if (res.errorCode) {
        Alert.alert('Camera Error', res.errorMessage || res.errorCode);
        return;
      }

      if (res.assets && res.assets.length > 0) {
        const asset = res.assets[0];
        if (asset.uri) {
          let b64 = asset.base64;
          if (!b64) {
            b64 = await getBase64FromUri(asset.uri);
          }
          setSelectedMedia({
            mediaType: 'image',
            uri: asset.uri,
            base64: b64,
            type: asset.type || 'image/jpeg',
            fileName: asset.fileName || `photo_${Date.now()}.jpg`,
            fileSize: asset.fileSize,
          });
        }
      }
    } catch (err: any) {
      console.warn('[Camera] Error:', err);
      Alert.alert('Error', err?.message || 'Failed to open camera');
    }
  };

  const handlePickGallery = async () => {
    setAttachmentModalVisible(false);
    await requestGalleryPermission();

    try {
      const res = await launchImageLibrary({
        mediaType: 'photo',
        selectionLimit: 1,
        quality: 0.8,
        maxWidth: 1280,
        maxHeight: 1280,
        includeBase64: true,
      });

      if (res.didCancel) return;
      if (res.errorCode) {
        Alert.alert('Gallery Error', res.errorMessage || res.errorCode);
        return;
      }

      if (res.assets && res.assets.length > 0) {
        const asset = res.assets[0];
        if (asset.uri) {
          let b64 = asset.base64;
          if (!b64) {
            b64 = await getBase64FromUri(asset.uri);
          }
          setSelectedMedia({
            mediaType: 'image',
            uri: asset.uri,
            base64: b64,
            type: asset.type || 'image/jpeg',
            fileName: asset.fileName || `image_${Date.now()}.jpg`,
            fileSize: asset.fileSize,
          });
        }
      }
    } catch (err: any) {
      console.warn('[Gallery] Error:', err);
      Alert.alert('Error', err?.message || 'Failed to open photo gallery');
    }
  };

  const handlePickVideo = async () => {
    setAttachmentModalVisible(false);
    await requestGalleryPermission();

    try {
      const res = await launchImageLibrary({
        mediaType: 'video',
        selectionLimit: 1,
      });

      if (res.didCancel) return;
      if (res.errorCode) {
        Alert.alert('Video Error', res.errorMessage || res.errorCode);
        return;
      }

      if (res.assets && res.assets.length > 0) {
        const asset = res.assets[0];
        if (asset.uri) {
          setSelectedMedia({
            mediaType: 'video',
            uri: asset.uri,
            type: asset.type || 'video/mp4',
            fileName: asset.fileName || `video_${Date.now()}.mp4`,
            fileSize: asset.fileSize,
            duration: asset.duration,
          });
        }
      }
    } catch (err: any) {
      console.warn('[Video] Error:', err);
      Alert.alert('Error', err?.message || 'Failed to open video picker');
    }
  };

  const handlePickDocument = async () => {
    setAttachmentModalVisible(false);
    try {
      const res = await DocumentPicker.pickSingle({
        type: [
          docTypes.pdf,
          docTypes.doc,
          docTypes.docx,
          docTypes.allFiles,
          'application/pdf',
          'application/msword',
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        ],
        copyTo: 'cachesDirectory',
      });

      if (res) {
        const fileUri = res.fileCopyUri || res.uri;
        setSelectedMedia({
          mediaType: 'document',
          uri: fileUri,
          type: res.type || 'application/pdf',
          fileName: res.name || `document_${Date.now()}`,
          fileSize: res.size || undefined,
        });
      }
    } catch (err: any) {
      if (DocumentPicker.isCancel(err)) {
        return;
      }
      console.warn('[Document] Error:', err);
      Alert.alert('Error', err?.message || 'Failed to pick document');
    }
  };

  const handleAttachmentMenu = () => {
    Keyboard.dismiss();
    setAttachmentModalVisible(true);
  };

  const handlePickImage = handleAttachmentMenu;

  const handleSend = async (textToSend?: string) => {
    const text = (textToSend || inputMessage).trim();
    if (!text && !selectedMedia) return;
    const mediaToSend = selectedMedia;
    setInputMessage('');
    setSelectedMedia(null);
    await sendMessage(conversationId, text, mediaToSend || undefined);
    flatListRef.current?.scrollToEnd({ animated: true });
    fetchConversations().catch(() => {});
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

  const handleOpenDirectMedia = async (rawUri: string | null, filename: string, isVideo: boolean) => {
    if (!rawUri) {
      Alert.alert(
        isVideo ? 'Video' : 'Document',
        `File: ${filename}\nMedia was received via WhatsApp.`
      );
      return;
    }

    const fullUrl = resolveMediaUrl(rawUri) || rawUri;

    try {
      await Linking.openURL(fullUrl);
    } catch (err: any) {
      console.warn('[OpenMedia Error]', err);
      Alert.alert(
        isVideo ? 'Play Video' : 'Open Document',
        `File: ${filename}\nCould not open with system player.`
      );
    }
  };

  const handleOpenMedia = handleOpenDirectMedia;

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

    let parsedMeta: any = item.metadata;
    if (typeof parsedMeta === 'string') {
      try {
        parsedMeta = JSON.parse(parsedMeta);
      } catch (_) {
        parsedMeta = null;
      }
    }
    const rawMediaUrl = parsedMeta?.mediaUrl || null;
    const metaMediaUrl = resolveMediaUrl(rawMediaUrl);
    const mimeType = String(parsedMeta?.mimetype || '').toLowerCase();
    const fileName = String(parsedMeta?.filename || '').toLowerCase();

    // Accurate media classification — prioritize Video and Document first to prevent solid box fallback
    const isVideo =
      item.message_type === 'video' ||
      Boolean(parsedMeta?.isVideo) ||
      mimeType.startsWith('video/') ||
      Boolean(fileName.match(/\.(mp4|mov|3gp|mkv|avi|webm)$/i)) ||
      (metaMediaUrl ? Boolean(metaMediaUrl.match(/\.(mp4|mov|3gp|mkv|avi|webm)($|\?)/i)) : false) ||
      rawText === '🎥 Video' ||
      rawText === 'Video';

    const isDocument =
      !isVideo &&
      (item.message_type === 'document' ||
        Boolean(parsedMeta?.isDocument) ||
        mimeType.includes('pdf') ||
        mimeType.includes('word') ||
        mimeType.includes('officedocument') ||
        mimeType.includes('msword') ||
        mimeType.includes('document') ||
        mimeType.includes('application/zip') ||
        mimeType.includes('application/octet-stream') ||
        Boolean(fileName.match(/\.(pdf|doc|docx|xls|xlsx|ppt|pptx|txt|zip|apk)$/i)) ||
        (metaMediaUrl ? Boolean(metaMediaUrl.match(/\.(pdf|doc|docx|xls|xlsx|ppt|pptx|txt|zip|apk)($|\?)/i)) : false) ||
        rawText === '📄 Document' ||
        rawText.startsWith('📄 ') ||
        rawText === 'Document');

    const isImage =
      !isVideo &&
      !isDocument &&
      (item.message_type === 'image' ||
        Boolean(parsedMeta?.isImage) ||
        mimeType.startsWith('image/') ||
        Boolean(fileName.match(/\.(jpg|jpeg|png|webp|gif)$/i)) ||
        rawText.startsWith('data:image') ||
        rawText.startsWith('/9j/') ||
        (metaMediaUrl ? Boolean(metaMediaUrl.match(/\.(jpg|jpeg|png|webp|gif)($|\?)/i)) : false) ||
        rawText === '📷 Photo' ||
        rawText === 'Photo' ||
        rawText === 'Images' ||
        rawText === 'Image');

    const imageUri = isImage ? (metaMediaUrl || (rawText.startsWith('data:image') ? rawText : (rawText.startsWith('/9j/') ? `data:image/jpeg;base64,${rawText}` : null))) : null;
    const mediaUri = metaMediaUrl || imageUri;
    const docFilename = parsedMeta?.filename || (isDocument && rawText && !['📄 Document', 'Document', '📷 Photo', 'Photo'].includes(rawText) ? contentText : (isVideo ? 'Video' : 'Document'));
    const docFileSize = parsedMeta?.fileSize;
    const docDuration = parsedMeta?.duration;
    const docExt = (docFilename.split('.').pop() || (isDocument ? 'DOC' : 'VID')).toUpperCase();

    const isNonCaptionPlaceholder = ['📷 Photo', 'Images', 'Image', '🖼️ Image', '🎥 Video', 'Video', '📄 Document', 'Document'].includes(rawText);
    const captionText = parsedMeta?.caption || (!rawText.startsWith('data:') && !rawText.startsWith('/9j/') && !isNonCaptionPlaceholder ? contentText : '');

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
            (isImage || isVideo || isDocument) && styles.bubbleImageContainer,
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
                onPress={() => handleOpenCreateTask(captionText || displayText, item.timestamp, isImage ? 'WhatsApp Image' : (isVideo ? 'WhatsApp Video' : (isDocument ? 'WhatsApp Document' : 'WhatsApp Chat')))}
                activeOpacity={0.7}
              >
                <Text style={styles.taskConvertBtnText}>📌 Create Task</Text>
              </TouchableOpacity>
            </View>
          ) : null}

          {isImage ? (
            <View style={styles.mediaContentBox}>
              {imageUri ? (
                <TouchableOpacity
                  activeOpacity={0.88}
                  onPress={() => setSelectedMediaModal({ visible: true, type: 'image', uri: imageUri, caption: captionText })}
                >
                  <Image
                    source={{ uri: imageUri }}
                    style={styles.chatImagePreview}
                    resizeMode="cover"
                  />
                </TouchableOpacity>
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
          ) : isVideo ? (
            <View style={styles.mediaContentBox}>
              <TouchableOpacity
                activeOpacity={0.85}
                style={styles.videoCardContainer}
                onPress={() => handleOpenDirectMedia(mediaUri, docFilename, true)}
              >
                <View style={styles.videoThumbnailBox}>
                  <View style={styles.videoPlayCircle}>
                    <Icon name="play" size={24} color="#FFFFFF" />
                  </View>
                  <View style={styles.videoMetaOverlay}>
                    <Text style={styles.videoFilenameText} numberOfLines={1}>
                      {docFilename || 'Video'}
                    </Text>
                  </View>
                  {docDuration ? (
                    <View style={styles.videoDurationBadge}>
                      <Text style={styles.videoDurationText}>{formatDuration(docDuration)}</Text>
                    </View>
                  ) : null}
                </View>
              </TouchableOpacity>
              {captionText ? (
                <Text style={[styles.bubbleText, styles.mediaCaptionText, isStaff ? styles.textWhite : styles.textDark]}>
                  {captionText}
                </Text>
              ) : null}
            </View>
          ) : isDocument ? (
            <View style={styles.docContentBox}>
              <TouchableOpacity
                activeOpacity={0.85}
                style={[styles.docCard, isStaff ? styles.docCardStaff : styles.docCardCustomer]}
                onPress={() => handleOpenDirectMedia(mediaUri, docFilename, false)}
              >
                <View style={[styles.docIconWrapper, docExt === 'PDF' ? styles.docIconPdf : styles.docIconWord]}>
                  <Icon name="document" size={22} color="#FFFFFF" strokeWidth={2} />
                </View>
                <View style={styles.docDetailsBox}>
                  <Text style={[styles.docTitle, isStaff ? styles.textWhite : styles.textDark]} numberOfLines={2}>
                    {docFilename}
                  </Text>
                  <Text style={[styles.docSub, isStaff ? styles.timeStaff : styles.timeCustomer]}>
                    {formatFileSize(docFileSize) ? `${formatFileSize(docFileSize)} • ` : ''}{docExt}
                  </Text>
                </View>
                
              </TouchableOpacity>
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
                  name={
                    item.status === 'sending' || item.status === 'pending'
                      ? 'clock-outline'
                      : item.status === 'failed'
                      ? 'alert-circle-outline'
                      : 'check-double'
                  }
                  size={14}
                  color={
                    item.status === 'failed'
                      ? '#FF5252'
                      : item.status === 'delivered'
                      ? COLORS.accentLime
                      : 'rgba(255,255,255,0.7)'
                  }
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
          <View style={styles.headerSubtitleRow}>
            <View style={styles.liveDot} />
            <Text style={styles.headerCustomerPhone} numberOfLines={1}>
              {activeConversation?.phone_number || 'Live WhatsApp'} 
            </Text>
          </View>
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
            }
          }}
          onLayout={() => {
            if (!isInitialScrollDone.current && groupedMessages.length > 0) {
              flatListRef.current?.scrollToEnd({ animated: false });
            }
          }}
          onScrollBeginDrag={() => {
            isUserDragging.current = true;
          }}
          onScrollEndDrag={() => {
            isUserDragging.current = false;
          }}
          onScroll={(event) => {
            const offsetY = event.nativeEvent.contentOffset.y;
            if (
              isUserDragging.current &&
              offsetY <= 10 &&
              hasMoreMessages &&
              !isLoadingOlder &&
              !isInitialLoading &&
              isInitialScrollDone.current
            ) {
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

      {/* Selected Media Preview */}
      {selectedMedia && (
        <View style={styles.selectedImagePreviewContainer}>
          <View style={styles.selectedImageThumbWrapper}>
            {selectedMedia.mediaType === 'image' && selectedMedia.uri ? (
              <Image source={{ uri: selectedMedia.uri }} style={styles.selectedImageThumb} resizeMode="cover" />
            ) : selectedMedia.mediaType === 'video' ? (
              <View style={[styles.selectedImageThumb, styles.selectedVideoThumb]}>
                <Icon name="video" size={20} color="#FFFFFF" />
              </View>
            ) : (
              <View style={[styles.selectedImageThumb, styles.selectedDocThumb]}>
                <Icon name="document" size={20} color="#FFFFFF" />
              </View>
            )}
            <TouchableOpacity
              style={styles.selectedImageRemoveBtn}
              onPress={() => setSelectedMedia(null)}
              activeOpacity={0.7}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Icon name="x" size={12} color={COLORS.bgWhite} strokeWidth={3} />
            </TouchableOpacity>
          </View>
          <View style={styles.selectedImageInfo}>
            <Text style={styles.selectedImageTitle} numberOfLines={1}>
              {selectedMedia.fileName || (selectedMedia.mediaType === 'video' ? 'Video selected' : (selectedMedia.mediaType === 'document' ? 'Document selected' : 'Photo selected'))}
            </Text>
            <Text style={styles.selectedImageSub}>
              {selectedMedia.fileSize ? `${formatFileSize(selectedMedia.fileSize)} • ` : ''}
              {selectedMedia.duration ? `${formatDuration(selectedMedia.duration)} • ` : ''}
              Ready to send
            </Text>
          </View>
          <TouchableOpacity
            onPress={() => setSelectedMedia(null)}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Text style={styles.selectedImageCancelText}>Remove</Text>
          </TouchableOpacity>
        </View>
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
        {/* Attachment Paperclip Button */}
        <TouchableOpacity
          style={styles.attachBtn}
          onPress={handleAttachmentMenu}
          activeOpacity={0.7}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Icon name="paperclip" size={20} color={COLORS.primaryNavy} strokeWidth={2.2} />
        </TouchableOpacity>

        <TextInput
          style={styles.textInput}
          placeholder={
            selectedMedia
              ? (selectedMedia.mediaType === 'video'
                ? 'Add a video caption...'
                : selectedMedia.mediaType === 'document'
                ? 'Add a message with document...'
                : 'Add a caption...')
              : 'Type Here...'
          }
          placeholderTextColor={COLORS.textSubtle}
          value={inputMessage}
          onChangeText={setInputMessage}
          multiline
          maxLength={1000}
        />
        <TouchableOpacity
          style={[
            styles.sendButton,
            ((!inputMessage.trim() && !selectedMedia) || isSending) && styles.sendButtonDisabled,
          ]}
          onPress={() => handleSend()}
          disabled={(!inputMessage.trim() && !selectedMedia) || isSending}
          activeOpacity={0.8}
        >
          {isSending ? (
            <ActivityIndicator size="small" color={COLORS.bgWhite} />
          ) : (
            <Icon name="send" size={18} color={COLORS.bgWhite} />
          )}
        </TouchableOpacity>
      </View>

      {/* WhatsApp-Style Attachment Bottom Sheet Modal */}
      <Modal
        visible={attachmentModalVisible}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setAttachmentModalVisible(false)}
      >
        <TouchableOpacity
          style={styles.attachmentModalOverlay}
          activeOpacity={1}
          onPress={() => setAttachmentModalVisible(false)}
        >
          <View style={styles.attachmentSheet}>
            <View style={styles.attachmentHandleBar} />

            {/* Header: Title on Left, Cross Close Icon (✕) on Right */}
            <View style={styles.attachmentHeaderRow}>
              <View style={styles.attachmentTitleContainer}>
                <Text style={styles.attachmentTitle}>Attach Files</Text>
                <Text style={styles.attachmentSubTitle}>Choose an option to share</Text>
              </View>
              <TouchableOpacity
                style={styles.attachmentCloseBtn}
                onPress={() => setAttachmentModalVisible(false)}
                activeOpacity={0.7}
                hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              >
                <Icon name="x" size={18} color={COLORS.textDark} strokeWidth={2.5} />
              </TouchableOpacity>
            </View>

            {/* 4-Option Grid */}
            <View style={styles.attachmentGrid}>
              {/* Document Option (PDF, Word) */}
              <TouchableOpacity
                style={styles.attachmentOption}
                activeOpacity={0.75}
                onPress={handlePickDocument}
              >
                <View style={[styles.attachmentIconCircle, { backgroundColor: '#7C3AED' }]}>
                  <Icon name="document" size={26} color="#FFFFFF" strokeWidth={2.2} />
                </View>
                <Text style={styles.attachmentLabel}>Document</Text>
                <Text style={styles.attachmentSubLabel}>PDF, Word</Text>
              </TouchableOpacity>

              {/* Camera Option */}
              <TouchableOpacity
                style={styles.attachmentOption}
                activeOpacity={0.75}
                onPress={handlePickCamera}
              >
                <View style={[styles.attachmentIconCircle, { backgroundColor: '#EC4899' }]}>
                  <Icon name="camera" size={26} color="#FFFFFF" strokeWidth={2.2} />
                </View>
                <Text style={styles.attachmentLabel}>Camera</Text>
                <Text style={styles.attachmentSubLabel}>Take photo</Text>
              </TouchableOpacity>

              {/* Gallery Option */}
              <TouchableOpacity
                style={styles.attachmentOption}
                activeOpacity={0.75}
                onPress={handlePickGallery}
              >
                <View style={[styles.attachmentIconCircle, { backgroundColor: '#3B82F6' }]}>
                  <Icon name="image" size={26} color="#FFFFFF" strokeWidth={2.2} />
                </View>
                <Text style={styles.attachmentLabel}>Gallery</Text>
                <Text style={styles.attachmentSubLabel}>Photos</Text>
              </TouchableOpacity>

              {/* Video Option */}
              <TouchableOpacity
                style={styles.attachmentOption}
                activeOpacity={0.75}
                onPress={handlePickVideo}
              >
                <View style={[styles.attachmentIconCircle, { backgroundColor: '#06B6D4' }]}>
                  <Icon name="video" size={26} color="#FFFFFF" strokeWidth={2.2} />
                </View>
                <Text style={styles.attachmentLabel}>Video</Text>
                <Text style={styles.attachmentSubLabel}>Record / Clip</Text>
              </TouchableOpacity>
            </View>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Fullscreen Media Preview Modal (Image / Video / PDF / Word) */}
      <Modal
        visible={selectedMediaModal.visible}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setSelectedMediaModal({ visible: false, type: 'image', uri: '', caption: '' })}
      >
        <View style={styles.fullscreenModalContainer}>
          <TouchableOpacity
            style={styles.fullscreenCloseBtn}
            onPress={() => setSelectedMediaModal({ visible: false, type: 'image', uri: '', caption: '' })}
            activeOpacity={0.8}
            hitSlop={{ top: 15, bottom: 15, left: 15, right: 15 }}
          >
            <Icon name="x" size={24} color="#FFFFFF" strokeWidth={2.5} />
          </TouchableOpacity>

          {selectedMediaModal.type === 'image' && selectedMediaModal.uri ? (
            <Image
              source={{ uri: resolveMediaUrl(selectedMediaModal.uri) || selectedMediaModal.uri }}
              style={styles.fullscreenImage}
              resizeMode="contain"
            />
          ) : selectedMediaModal.type === 'video' ? (
            <View style={styles.fullscreenVideoCard}>
              <View style={styles.fullscreenVideoIconCircle}>
                <Icon name="video" size={54} color="#FFFFFF" strokeWidth={2.2} />
              </View>
              <Text style={styles.fullscreenMediaTitle} numberOfLines={2}>
                {selectedMediaModal.filename || 'Video'}
              </Text>
              {selectedMediaModal.duration ? (
                <Text style={styles.fullscreenMediaSub}>
                  Duration: {formatDuration(selectedMediaModal.duration)}
                </Text>
              ) : null}
              {selectedMediaModal.uri ? (
                <TouchableOpacity
                  style={styles.fullscreenOpenBtn}
                  activeOpacity={0.85}
                  onPress={() => {
                    const resolved = resolveMediaUrl(selectedMediaModal.uri) || selectedMediaModal.uri;
                    Linking.openURL(resolved).catch(() => {});
                  }}
                >
                  <Icon name="play" size={20} color="#FFFFFF" strokeWidth={2.5} />
                  <Text style={styles.fullscreenOpenBtnText}>Play Video</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          ) : selectedMediaModal.type === 'document' ? (
            <View style={styles.fullscreenDocCard}>
              <View
                style={[
                  styles.fullscreenDocIconCircle,
                  selectedMediaModal.ext === 'PDF' ? { backgroundColor: '#E11D48' } : { backgroundColor: '#2563EB' },
                ]}
              >
                <Icon name="document" size={48} color="#FFFFFF" strokeWidth={2.2} />
                <Text style={styles.fullscreenDocExtText}>{selectedMediaModal.ext || 'DOC'}</Text>
              </View>
              <Text style={styles.fullscreenMediaTitle} numberOfLines={2}>
                {selectedMediaModal.filename || 'Document'}
              </Text>
              {selectedMediaModal.filesize ? (
                <Text style={styles.fullscreenMediaSub}>
                  Size: {formatFileSize(selectedMediaModal.filesize)}
                </Text>
              ) : null}
              {selectedMediaModal.uri ? (
                <TouchableOpacity
                  style={[
                    styles.fullscreenOpenBtn,
                    selectedMediaModal.ext === 'PDF' ? { backgroundColor: '#E11D48' } : { backgroundColor: '#2563EB' },
                  ]}
                  activeOpacity={0.85}
                  onPress={() => {
                    const resolved = resolveMediaUrl(selectedMediaModal.uri) || selectedMediaModal.uri;
                    Linking.openURL(resolved).catch(() => {});
                  }}
                >
                  <Icon name="external-link" size={20} color="#FFFFFF" strokeWidth={2.5} />
                  <Text style={styles.fullscreenOpenBtnText}>Open Document</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          ) : null}

          {selectedMediaModal.caption ? (
            <View style={styles.fullscreenCaptionContainer}>
              <Text style={styles.fullscreenCaptionText}>{selectedMediaModal.caption}</Text>
            </View>
          ) : null}
        </View>
      </Modal>

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
  headerSubtitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 2,
    gap: 5,
  },
  liveDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
    backgroundColor: '#22C55E',
  },
  headerCustomerPhone: {
    color: 'rgba(255,255,255,0.85)',
    fontSize: 12,
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
    width: 240,
    height: 190,
    borderRadius: RADIUS.md,
    backgroundColor: 'rgba(0,0,0,0.04)',
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
  videoCardContainer: {
    width: 230,
    height: 140,
    borderRadius: RADIUS.md,
    overflow: 'hidden',
    backgroundColor: '#0F172A',
  },
  videoThumbnailBox: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#1E293B',
    position: 'relative',
  },
  videoPlayCircle: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: 'rgba(0,0,0,0.65)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.85)',
  },
  videoDurationBadge: {
    position: 'absolute',
    bottom: 8,
    right: 8,
    backgroundColor: 'rgba(0,0,0,0.75)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  videoDurationText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '600',
  },
  videoMetaOverlay: {
    position: 'absolute',
    top: 8,
    left: 8,
    right: 8,
    backgroundColor: 'rgba(0,0,0,0.55)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
  },
  videoFilenameText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '600',
  },
  docContentBox: {
    minWidth: 220,
    maxWidth: 260,
    marginBottom: 4,
  },
  docCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 10,
    borderRadius: RADIUS.md,
    gap: 10,
  },
  docCardStaff: {
    backgroundColor: 'rgba(255,255,255,0.18)',
  },
  docCardCustomer: {
    backgroundColor: '#F1F5F9',
  },
  docIconWrapper: {
    width: 42,
    height: 46,
    borderRadius: RADIUS.sm,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
    overflow: 'hidden',
  },
  docIconPdf: {
    backgroundColor: '#E11D48',
  },
  docIconWord: {
    backgroundColor: '#2563EB',
  },
  docExtBadge: {
    position: 'absolute',
    bottom: 2,
    fontSize: 8,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  docDetailsBox: {
    flex: 1,
  },
  docTitle: {
    fontSize: 13,
    fontWeight: '600',
    lineHeight: 17,
  },
  docSub: {
    fontSize: 11,
    marginTop: 2,
  },
  docActionIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.06)',
  },
  selectedVideoThumb: {
    backgroundColor: '#1E293B',
    alignItems: 'center',
    justifyContent: 'center',
  },
  selectedDocThumb: {
    backgroundColor: '#E11D48',
    alignItems: 'center',
    justifyContent: 'center',
  },
  fullscreenModalContainer: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.95)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  fullscreenCloseBtn: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 54 : 32,
    right: 20,
    zIndex: 999,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.25)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  fullscreenImage: {
    width: '94%',
    height: '75%',
  },
  fullscreenCaptionContainer: {
    position: 'absolute',
    bottom: 40,
    left: 20,
    right: 20,
    backgroundColor: 'rgba(0,0,0,0.65)',
    padding: 12,
    borderRadius: RADIUS.md,
  },
  fullscreenCaptionText: {
    color: '#FFFFFF',
    fontSize: 14,
    textAlign: 'center',
  },
  fullscreenVideoCard: {
    width: '85%',
    backgroundColor: '#0F172A',
    borderRadius: RADIUS.xl,
    padding: 24,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.15)',
  },
  fullscreenVideoIconCircle: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: '#06B6D4',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
    shadowColor: '#06B6D4',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.4,
    shadowRadius: 10,
    elevation: 8,
  },
  fullscreenDocCard: {
    width: '85%',
    backgroundColor: '#0F172A',
    borderRadius: RADIUS.xl,
    padding: 24,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.15)',
  },
  fullscreenDocIconCircle: {
    width: 96,
    height: 96,
    borderRadius: 48,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
    position: 'relative',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.4,
    shadowRadius: 10,
    elevation: 8,
  },
  fullscreenDocExtText: {
    position: 'absolute',
    bottom: 8,
    fontSize: 10,
    fontWeight: '900',
    color: '#FFFFFF',
    letterSpacing: 0.5,
  },
  fullscreenMediaTitle: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: 6,
  },
  fullscreenMediaSub: {
    color: '#94A3B8',
    fontSize: 13,
    marginBottom: 20,
    textAlign: 'center',
  },
  fullscreenOpenBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#0284C7',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: RADIUS.lg,
    gap: 8,
    width: '100%',
  },
  fullscreenOpenBtnText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
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
  selectedImagePreviewContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F1F5F9',
    paddingHorizontal: SPACING.md,
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: COLORS.borderColor,
    gap: 12,
  },
  selectedImageThumbWrapper: {
    width: 48,
    height: 48,
    borderRadius: RADIUS.sm,
    overflow: 'hidden',
    position: 'relative',
    borderWidth: 1.5,
    borderColor: COLORS.primaryNavy,
  },
  selectedImageThumb: {
    width: '100%',
    height: '100%',
  },
  selectedImageRemoveBtn: {
    position: 'absolute',
    top: 2,
    right: 2,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    width: 16,
    height: 16,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  selectedImageInfo: {
    flex: 1,
  },
  selectedImageTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: COLORS.primaryNavy,
  },
  selectedImageSub: {
    fontSize: 11,
    color: COLORS.textSubtle,
    marginTop: 1,
  },
  selectedImageCancelText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#EF4444',
  },
  attachBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: 'rgba(26, 59, 113, 0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: SPACING.md,
    paddingTop: 8,
    backgroundColor: COLORS.bgWhite,
    borderTopWidth: 1,
    borderTopColor: COLORS.borderColor,
    gap: 8,
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
  attachmentModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
    justifyContent: 'flex-end',
  },
  attachmentSheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: Platform.OS === 'ios' ? 36 : 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 24,
  },
  attachmentHandleBar: {
    width: 38,
    height: 4,
    backgroundColor: '#E2E8F0',
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 12,
  },
  attachmentHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 20,
    paddingHorizontal: 4,
  },
  attachmentTitleContainer: {
    flex: 1,
  },
  attachmentTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: COLORS.primaryNavy,
    letterSpacing: -0.2,
  },
  attachmentSubTitle: {
    fontSize: 12,
    color: COLORS.textMuted,
    marginTop: 2,
  },
  attachmentCloseBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#F1F5F9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  attachmentGrid: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 6,
    marginBottom: 10,
  },
  attachmentOption: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 72,
  },
  attachmentIconCircle: {
    width: 58,
    height: 58,
    borderRadius: 29,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.18,
    shadowRadius: 6,
    elevation: 5,
  },
  attachmentLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.textDark,
    textAlign: 'center',
  },
  attachmentSubLabel: {
    fontSize: 10,
    fontWeight: '400',
    color: COLORS.textMuted,
    textAlign: 'center',
    marginTop: 2,
  },
});
