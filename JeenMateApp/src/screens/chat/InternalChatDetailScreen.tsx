import React, { useEffect, useState, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Modal,
  ScrollView,
  Alert,
  Keyboard,
  Dimensions,
  Image,
  PermissionsAndroid,
  Linking,
} from 'react-native';
import { useRoute, useNavigation } from '@react-navigation/native';
import { launchImageLibrary, launchCamera } from 'react-native-image-picker';
import DocumentPicker, { types as docTypes } from 'react-native-document-picker';
import { useInternalChatStore, InternalChatMessage, SelectedMedia, SelectedImage } from '../../store/internalChatStore';
import { useAuthStore } from '../../store/authStore';
import { useTaskStore, TeamMember } from '../../store/taskStore';
import { Header } from '../../components/common/Header';
import { Icon } from '../../components/common/Icon';
import { COLORS, SPACING, RADIUS } from '../../constants/theme';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

export type InternalChatListItem =
  | { type: 'date_header'; id: string; dateLabel: string }
  | (InternalChatMessage & { type?: 'message' });

export const parseInternalMessageDate = (dateStr?: string | null): Date | null => {
  if (!dateStr) return null;
  const str = String(dateStr).trim();

  // If already ends with Z or has timezone offset like +05:30 or -04:00, parse as ISO
  if (str.endsWith('Z') || /[+-]\d{2}(:\d{2})?$/.test(str)) {
    const d = new Date(str);
    return isNaN(d.getTime()) ? null : d;
  }

  // Format: "YYYY-MM-DD HH:mm:ss" or "YYYY-MM-DDTHH:mm:ss" (MySQL local timestamp)
  const match = str.match(/^(\d{4})-(\d{2})-(\d{2})[T\s](\d{2}):(\d{2})(?::(\d{2}))?/);
  if (match) {
    const year = parseInt(match[1], 10);
    const month = parseInt(match[2], 10) - 1;
    const day = parseInt(match[3], 10);
    const hours = parseInt(match[4], 10);
    const minutes = parseInt(match[5], 10);
    const seconds = match[6] ? parseInt(match[6], 10) : 0;
    return new Date(year, month, day, hours, minutes, seconds);
  }

  const d = new Date(str);
  return isNaN(d.getTime()) ? null : d;
};

export const getDateHeaderLabel = (date: Date): string => {
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

export const groupMessagesByDate = (rawMessages: InternalChatMessage[]): InternalChatListItem[] => {
  if (!rawMessages || rawMessages.length === 0) return [];

  // Sort chronologically (oldest first, newest at the bottom)
  const sorted = [...rawMessages].sort((a, b) => {
    const timeA = parseInternalMessageDate(a.created_at)?.getTime() || 0;
    const timeB = parseInternalMessageDate(b.created_at)?.getTime() || 0;
    return timeA - timeB;
  });

  const listItems: InternalChatListItem[] = [];
  let lastDateKey = '';

  for (const msg of sorted) {
    const dateObj = parseInternalMessageDate(msg.created_at);
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

export const InternalChatDetailScreen: React.FC = () => {
  const route = useRoute<any>();
  const navigation = useNavigation<any>();
  const { user, serverUrl } = useAuthStore();

  const { colleagueId, colleagueName, colleagueRole } = route.params || {};

  const {
    messages,
    isLoadingMessages,
    isSending,
    isColleagueTyping,
    sendMessage,
    sendTypingIndicator,
    clearActiveChat,
  } = useInternalChatStore();

  const [inputText, setInputText] = useState('');
  const [selectedImages, setSelectedImages] = useState<SelectedMedia[]>([]);
  const [attachmentModalVisible, setAttachmentModalVisible] = useState(false);
  const flatListRef = useRef<FlatList<any>>(null);
  const typingTimeoutRef = useRef<any>(null);

  // Full screen Image Viewer Modal State
  const [imageViewerVisible, setImageViewerVisible] = useState(false);
  const [viewerImages, setViewerImages] = useState<string[]>([]);
  const [activeImageIndex, setActiveImageIndex] = useState(0);

  // CRM Task Modal State
  const { addTask, teamMembers, fetchTeamMembers } = useTaskStore();
  const [taskModalVisible, setTaskModalVisible] = useState(false);

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

  const [taskDueDate, setTaskDueDate] = useState(getTodayDateStr());
  const [taskTime, setTaskTime] = useState(getCurrentTimeStr());
  const [taskMessageDate, setTaskMessageDate] = useState(getTodayDateStr());
  const [taskMessageTime, setTaskMessageTime] = useState(getCurrentTimeStr());
  const [taskStaffNote, setTaskStaffNote] = useState('');
  const [taskOriginalMessage, setTaskOriginalMessage] = useState('');
  const [assignedUser, setAssignedUser] = useState<TeamMember | null>(null);
  const [assignDropdownOpen, setAssignDropdownOpen] = useState(false);
  const [isSubmittingTask, setIsSubmittingTask] = useState(false);
  const modalScrollRef = useRef<any>(null);
  const [taskKeyboardHeight, setTaskKeyboardHeight] = useState(0);

  const insets = useSafeAreaInsets();
  const [isKeyboardVisible, setKeyboardVisible] = useState(false);

  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';

    const showSub = Keyboard.addListener(showEvent, (e) => {
      setKeyboardVisible(true);
      setTaskKeyboardHeight(e.endCoordinates.height);
      setTimeout(() => {
        flatListRef.current?.scrollToEnd({ animated: true });
      }, 100);
    });
    const hideSub = Keyboard.addListener(hideEvent, () => {
      setKeyboardVisible(false);
      setTaskKeyboardHeight(0);
    });

    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  const modalScrollMaxHeight =
    taskKeyboardHeight > 0
      ? Dimensions.get('window').height - taskKeyboardHeight - 160
      : Dimensions.get('window').height * 0.72;

  const availableAssignMembers = teamMembers.filter((m) => {
    if (user) {
      if (user.id && String(m.id) === String(user.id)) return false;
      if (user.email && m.email && m.email.toLowerCase() === user.email.toLowerCase()) return false;
      if (user.name && m.name && m.name.toLowerCase().trim() === user.name.toLowerCase().trim()) return false;
    }
    return true;
  });

  const handleOpenTaskModal = (pinnedMsgText?: string, pinnedCreatedAt?: string) => {
    fetchTeamMembers();
    setAssignedUser(null);
    setAssignDropdownOpen(false);

    let msgDate = getTodayDateStr();
    let msgTime = getCurrentTimeStr();

    if (pinnedCreatedAt) {
      const d = parseInternalMessageDate(pinnedCreatedAt);
      if (d) {
        const dd = String(d.getDate()).padStart(2, '0');
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const yyyy = d.getFullYear();
        msgDate = `${dd}/${mm}/${yyyy}`;
        msgTime = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true });
      }
    }

    setTaskMessageDate(msgDate);
    setTaskMessageTime(msgTime);
    setTaskDueDate(getTodayDateStr());
    setTaskTime(getCurrentTimeStr());
    setTaskOriginalMessage(pinnedMsgText || '');
    setTaskStaffNote('');
    setTaskModalVisible(true);
  };

  const handleSaveTask = async () => {
    if (!colleagueName) {
      Alert.alert('Error', 'Colleague name is missing.');
      return;
    }

    try {
      setIsSubmittingTask(true);

      const parsedDue = taskDueDate.trim() || getTodayDateStr();
      const parsedTime = taskTime.trim() || getCurrentTimeStr();
      const finalDueDate = `${parsedDue} ${parsedTime}`;

      await addTask({
        customerName: colleagueName,
        customerPhone: 'Internal Team',
        originalMessage: taskOriginalMessage || 'Internal Chat task',
        staffNote: taskStaffNote.trim(),
        dueDate: finalDueDate,
        eventType: 'JeenmateChat',
        assignedToUserId: assignedUser ? assignedUser.id : undefined,
      });

      setAssignedUser(null);
      setTaskModalVisible(false);
      Alert.alert('Success', 'Task created successfully and added to Home page.');
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'Failed to create task');
    } finally {
      setIsSubmittingTask(false);
    }
  };

  useEffect(() => {
    return () => {
      clearActiveChat();
    };
  }, []);

  const groupedMessages = React.useMemo(() => groupMessagesByDate(messages), [messages]);

  // Scroll to bottom whenever messages update
  useEffect(() => {
    if (groupedMessages.length > 0) {
      setTimeout(() => {
        flatListRef.current?.scrollToEnd({ animated: true });
      }, 100);
    }
  }, [groupedMessages.length]);

  const handleTextChange = (text: string) => {
    setInputText(text);

    if (colleagueId) {
      sendTypingIndicator(colleagueId, true);

      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
      }
      typingTimeoutRef.current = setTimeout(() => {
        sendTypingIndicator(colleagueId, false);
      }, 2000);
    }
  };

  // Android Permission Helpers
  const requestCameraPermission = async () => {
    if (Platform.OS !== 'android') return true;
    try {
      const granted = await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.CAMERA,
        {
          title: 'Camera Permission',
          message: 'JeenMate needs access to your camera to take photos.',
          buttonNegative: 'Cancel',
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
      const sdkVersion =
        typeof Platform.Version === 'number'
          ? Platform.Version
          : parseInt(String(Platform.Version), 10);
      if (sdkVersion >= 33) {
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

  const handlePickCamera = async () => {
    setAttachmentModalVisible(false);
    const currentImages = selectedImages.filter((m) => m.mediaType === 'image');
    if (currentImages.length >= 5) {
      Alert.alert('Limit Reached', 'You can select a maximum of 5 photos per message.');
      return;
    }

    const hasPermission = await requestCameraPermission();
    if (!hasPermission) {
      Alert.alert('Permission Required', 'Camera permission is needed to take a photo.');
      return;
    }

    try {
      const res = await launchCamera({
        mediaType: 'photo',
        quality: 0.8,
        saveToPhotos: false,
      });

      if (res.didCancel) return;
      if (res.errorCode) {
        Alert.alert('Camera Error', res.errorMessage || res.errorCode);
        return;
      }

      if (res.assets && res.assets.length > 0) {
        const newImgs: SelectedMedia[] = res.assets.map((a) => ({
          uri: a.uri!,
          fileName: a.fileName || `photo_${Date.now()}.jpg`,
          type: a.type || 'image/jpeg',
          fileSize: a.fileSize,
          mediaType: 'image',
        }));
        setSelectedImages([...currentImages, ...newImgs].slice(0, 5));
      }
    } catch (err: any) {
      console.warn('[Camera] Error:', err);
      Alert.alert('Error', err?.message || 'Failed to open camera');
    }
  };

  const handlePickGallery = async () => {
    setAttachmentModalVisible(false);
    const currentImages = selectedImages.filter((m) => m.mediaType === 'image');
    if (currentImages.length >= 5) {
      Alert.alert('Limit Reached', 'You can select a maximum of 5 photos per message.');
      return;
    }

    await requestGalleryPermission();

    try {
      const remaining = 5 - currentImages.length;
      const res = await launchImageLibrary({
        mediaType: 'photo',
        selectionLimit: remaining,
        quality: 0.8,
      });

      if (res.didCancel) return;
      if (res.errorCode) {
        Alert.alert('Gallery Error', res.errorMessage || res.errorCode);
        return;
      }

      if (res.assets && res.assets.length > 0) {
        const newImgs: SelectedMedia[] = res.assets.map((a) => ({
          uri: a.uri!,
          fileName: a.fileName || `image_${Date.now()}.jpg`,
          type: a.type || 'image/jpeg',
          fileSize: a.fileSize,
          mediaType: 'image',
        }));
        setSelectedImages([...currentImages, ...newImgs].slice(0, 5));
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
        const a = res.assets[0];
        const newVideo: SelectedMedia = {
          uri: a.uri!,
          fileName: a.fileName || `video_${Date.now()}.mp4`,
          type: a.type || 'video/mp4',
          fileSize: a.fileSize,
          duration: a.duration,
          mediaType: 'video',
        };
        // Strictly single selection for video
        setSelectedImages([newVideo]);
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
        const newDoc: SelectedMedia = {
          uri: fileUri,
          fileName: res.name || `doc_${Date.now()}.pdf`,
          type: res.type || 'application/pdf',
          fileSize: res.size || undefined,
          mediaType: 'document',
        };
        // Strictly single selection for document
        setSelectedImages([newDoc]);
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

  const handlePickImages = handleAttachmentMenu;

  const handleSend = async () => {
    const trimmed = inputText.trim();
    const hasImages = selectedImages.length > 0;

    if ((!trimmed && !hasImages) || !colleagueId || isSending) return;

    const imagesToSend = [...selectedImages];
    const textToSend = trimmed;

    setInputText('');
    setSelectedImages([]);

    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
    }
    sendTypingIndicator(colleagueId, false);

    const success = await sendMessage(colleagueId, textToSend, imagesToSend);
    if (!success) {
      Alert.alert('Send Failed', 'Could not send message or image. Please check your connection.');
      setInputText(textToSend);
      setSelectedImages(imagesToSend);
    }
  };

  const formatMessageTime = (dateStr?: string) => {
    if (!dateStr) return '';
    const d = parseInternalMessageDate(dateStr);
    if (!d) return '';
    return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true });
  };

  // Helper to format full image URL
  const getFullImageUrl = (path: string) => {
    if (!path) return '';
    if (path.startsWith('http://') || path.startsWith('https://') || path.startsWith('file://')) {
      return path;
    }
    const defaultHost = Platform.OS === 'android' ? 'http://192.168.1.3:5001' : 'http://localhost:5001';
    const cleanServer = (serverUrl || defaultHost).replace(/\/+$/, '');
    const cleanPath = path.startsWith('/') ? path : `/${path}`;
    return `${cleanServer}${cleanPath}`;
  };

  const handleOpenImageViewer = (urls: string[], index: number) => {
    const fullUrls = urls.map(getFullImageUrl);
    setViewerImages(fullUrls);
    setActiveImageIndex(index);
    setImageViewerVisible(true);
  };

  // Render 1 to 5 image gallery inside chat bubble
  const renderImageGrid = (mediaUrls: string[], isMe: boolean) => {
    if (!mediaUrls || mediaUrls.length === 0) return null;

    const count = mediaUrls.length;

    // 1 Image
    if (count === 1) {
      const fullUrl = getFullImageUrl(mediaUrls[0]);
      return (
        <TouchableOpacity
          style={styles.singleImageWrapper}
          activeOpacity={0.9}
          onPress={() => handleOpenImageViewer(mediaUrls, 0)}
        >
          <Image
            source={{ uri: fullUrl }}
            style={styles.singleImage}
            resizeMode="cover"
            onError={(e) => console.warn('[ChatImage] Single image load error:', fullUrl, e.nativeEvent?.error)}
          />
        </TouchableOpacity>
      );
    }

    // 2 Images (Side by side)
    if (count === 2) {
      return (
        <View style={styles.imageGridRow}>
          {mediaUrls.map((url, idx) => (
            <TouchableOpacity
              key={idx}
              style={styles.twoImageItem}
              activeOpacity={0.9}
              onPress={() => handleOpenImageViewer(mediaUrls, idx)}
            >
              <Image
                source={{ uri: getFullImageUrl(url) }}
                style={styles.gridImage}
                resizeMode="cover"
                onError={(e) => console.warn('[ChatImage] Load error (2-grid):', getFullImageUrl(url), e.nativeEvent?.error)}
              />
            </TouchableOpacity>
          ))}
        </View>
      );
    }

    // 3 Images (1 large top, 2 small bottom)
    if (count === 3) {
      return (
        <View style={styles.threeImageContainer}>
          <TouchableOpacity
            style={styles.threeImageTop}
            activeOpacity={0.9}
            onPress={() => handleOpenImageViewer(mediaUrls, 0)}
          >
            <Image
              source={{ uri: getFullImageUrl(mediaUrls[0]) }}
              style={styles.gridImage}
              resizeMode="cover"
              onError={(e) => console.warn('[ChatImage] Load error (3-top):', getFullImageUrl(mediaUrls[0]), e.nativeEvent?.error)}
            />
          </TouchableOpacity>
          <View style={styles.imageGridRow}>
            {mediaUrls.slice(1).map((url, idx) => (
              <TouchableOpacity
                key={idx + 1}
                style={styles.twoImageItem}
                activeOpacity={0.9}
                onPress={() => handleOpenImageViewer(mediaUrls, idx + 1)}
              >
                <Image
                  source={{ uri: getFullImageUrl(url) }}
                  style={styles.gridImage}
                  resizeMode="cover"
                  onError={(e) => console.warn('[ChatImage] Load error (3-bottom):', getFullImageUrl(url), e.nativeEvent?.error)}
                />
              </TouchableOpacity>
            ))}
          </View>
        </View>
      );
    }

    // 4 Images (2x2 Grid)
    if (count === 4) {
      return (
        <View style={styles.fourImageContainer}>
          <View style={styles.imageGridRow}>
            <TouchableOpacity
              style={styles.twoImageItem}
              activeOpacity={0.9}
              onPress={() => handleOpenImageViewer(mediaUrls, 0)}
            >
              <Image
                source={{ uri: getFullImageUrl(mediaUrls[0]) }}
                style={styles.gridImage}
                resizeMode="cover"
                onError={(e) => console.warn('[ChatImage] Load error (4-img-0):', getFullImageUrl(mediaUrls[0]), e.nativeEvent?.error)}
              />
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.twoImageItem}
              activeOpacity={0.9}
              onPress={() => handleOpenImageViewer(mediaUrls, 1)}
            >
              <Image
                source={{ uri: getFullImageUrl(mediaUrls[1]) }}
                style={styles.gridImage}
                resizeMode="cover"
                onError={(e) => console.warn('[ChatImage] Load error (4-img-1):', getFullImageUrl(mediaUrls[1]), e.nativeEvent?.error)}
              />
            </TouchableOpacity>
          </View>
          <View style={[styles.imageGridRow, { marginTop: 4 }]}>
            <TouchableOpacity
              style={styles.twoImageItem}
              activeOpacity={0.9}
              onPress={() => handleOpenImageViewer(mediaUrls, 2)}
            >
              <Image
                source={{ uri: getFullImageUrl(mediaUrls[2]) }}
                style={styles.gridImage}
                resizeMode="cover"
                onError={(e) => console.warn('[ChatImage] Load error (4-img-2):', getFullImageUrl(mediaUrls[2]), e.nativeEvent?.error)}
              />
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.twoImageItem}
              activeOpacity={0.9}
              onPress={() => handleOpenImageViewer(mediaUrls, 3)}
            >
              <Image
                source={{ uri: getFullImageUrl(mediaUrls[3]) }}
                style={styles.gridImage}
                resizeMode="cover"
                onError={(e) => console.warn('[ChatImage] Load error (4-img-3):', getFullImageUrl(mediaUrls[3]), e.nativeEvent?.error)}
              />
            </TouchableOpacity>
          </View>
        </View>
      );
    }

    // 5 Images (2 on top row, 3 on bottom row)
    return (
      <View style={styles.fiveImageContainer}>
        <View style={styles.imageGridRow}>
          <TouchableOpacity
            style={styles.twoImageItem}
            activeOpacity={0.9}
            onPress={() => handleOpenImageViewer(mediaUrls, 0)}
          >
            <Image
              source={{ uri: getFullImageUrl(mediaUrls[0]) }}
              style={styles.gridImage}
              resizeMode="cover"
              onError={(e) => console.warn('[ChatImage] Load error (5-img-0):', getFullImageUrl(mediaUrls[0]), e.nativeEvent?.error)}
            />
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.twoImageItem}
            activeOpacity={0.9}
            onPress={() => handleOpenImageViewer(mediaUrls, 1)}
          >
            <Image
              source={{ uri: getFullImageUrl(mediaUrls[1]) }}
              style={styles.gridImage}
              resizeMode="cover"
              onError={(e) => console.warn('[ChatImage] Load error (5-img-1):', getFullImageUrl(mediaUrls[1]), e.nativeEvent?.error)}
            />
          </TouchableOpacity>
        </View>
        <View style={[styles.imageGridRow, { marginTop: 4 }]}>
          {mediaUrls.slice(2, 5).map((url, idx) => (
            <TouchableOpacity
              key={idx + 2}
              style={styles.threeImageItem}
              activeOpacity={0.9}
              onPress={() => handleOpenImageViewer(mediaUrls, idx + 2)}
            >
              <Image
                source={{ uri: getFullImageUrl(url) }}
                style={styles.gridImage}
                resizeMode="cover"
                onError={(e) => console.warn(`[ChatImage] Load error (5-img-${idx + 2}):`, getFullImageUrl(url), e.nativeEvent?.error)}
              />
            </TouchableOpacity>
          ))}
        </View>
      </View>
    );
  };

  const renderMessageBubble = ({ item }: { item: InternalChatMessage }) => {
    const isMe = String(item.sender_id) === String(user?.id);

    // Robust parsing of media_urls (supports Array, JSON string, or single string)
    let mediaUrls: string[] = [];
    const rawMedia = (item as any).media_urls;
    if (Array.isArray(rawMedia)) {
      mediaUrls = rawMedia;
    } else if (typeof rawMedia === 'string' && rawMedia.trim().length > 0) {
      let raw = rawMedia.trim();
      try {
        let parsed = JSON.parse(raw);
        if (typeof parsed === 'string') {
          parsed = JSON.parse(parsed);
        }
        if (Array.isArray(parsed)) {
          mediaUrls = parsed;
        } else if (parsed) {
          mediaUrls = [String(parsed)];
        }
      } catch (e) {
        mediaUrls = [raw];
      }
    }

    const hasMedia = mediaUrls.length > 0;
    const hasText = item.message_text && item.message_text.trim().length > 0;

    const isVideoMsg =
      item.message_type === 'video' ||
      mediaUrls.some((u) => Boolean(u.match(/\.(mp4|mov|3gp|mkv)($|\?)/i)));

    const isDocMsg =
      item.message_type === 'document' ||
      mediaUrls.some((u) => Boolean(u.match(/\.(pdf|doc|docx)($|\?)/i)));

    return (
      <View
        style={[
          styles.bubbleWrapper,
          isMe ? styles.bubbleWrapperRight : styles.bubbleWrapperLeft,
        ]}
      >
        <View
          style={[
            styles.messageBubble,
            isMe ? styles.messageBubbleMe : styles.messageBubbleOther,
            hasMedia && styles.bubbleWithMedia,
          ]}
        >
          {/* Media Section */}
          {hasMedia && (
            <View style={styles.bubbleMediaContainer}>
              {isVideoMsg ? (
                mediaUrls.map((url, idx) => {
                  const fullUrl = getFullImageUrl(url);
                  const filename = url.split('/').pop() || 'Video';
                  return (
                    <TouchableOpacity
                      key={idx}
                      style={styles.internalVideoCard}
                      activeOpacity={0.85}
                      onPress={() => {
                        if (fullUrl) {
                          Linking.openURL(fullUrl).catch(() =>
                            Alert.alert('Video', 'Cannot open video URL directly.')
                          );
                        }
                      }}
                    >
                      <View style={styles.internalVideoPlayCircle}>
                        <Icon name="play" size={22} color="#FFFFFF" strokeWidth={2.5} />
                      </View>
                      <View style={styles.internalVideoDetails}>
                        <Text
                          style={[
                            styles.internalVideoTitle,
                            isMe ? styles.textWhite : styles.textDark,
                          ]}
                          numberOfLines={1}
                        >
                          {filename}
                        </Text>
                        <Text
                          style={[
                            styles.internalVideoSub,
                            isMe ? styles.timeMe : styles.timeOther,
                          ]}
                        >
                          Video • Tap to play
                        </Text>
                      </View>
                    </TouchableOpacity>
                  );
                })
              ) : isDocMsg ? (
                mediaUrls.map((url, idx) => {
                  const fullUrl = getFullImageUrl(url);
                  const filename = url.split('/').pop() || 'Document';
                  const ext = (filename.split('.').pop() || 'DOC').toUpperCase();
                  const isPdf = ext === 'PDF';
                  return (
                    <TouchableOpacity
                      key={idx}
                      style={[
                        styles.internalDocCard,
                        isMe ? styles.internalDocCardMe : styles.internalDocCardOther,
                      ]}
                      activeOpacity={0.85}
                      onPress={() => {
                        if (fullUrl) {
                          Linking.openURL(fullUrl).catch(() =>
                            Alert.alert('Document', `File: ${filename}`)
                          );
                        }
                      }}
                    >
                      <View
                        style={[
                          styles.internalDocIconWrapper,
                          isPdf ? styles.internalDocIconPdf : styles.internalDocIconWord,
                        ]}
                      >
                        <Icon name="document" size={18} color="#FFFFFF" strokeWidth={2.2} />
                        <Text style={styles.internalDocExtBadge}>{ext}</Text>
                      </View>
                      <View style={styles.internalDocDetails}>
                        <Text
                          style={[
                            styles.internalDocTitle,
                            isMe ? styles.textWhite : styles.textDark,
                          ]}
                          numberOfLines={1}
                        >
                          {filename}
                        </Text>
                        <Text
                          style={[
                            styles.internalDocSub,
                            isMe ? styles.timeMe : styles.timeOther,
                          ]}
                        >
                          {ext} • Tap to view
                        </Text>
                      </View>
                      <View style={styles.internalDocDownloadIcon}>
                        <Icon
                          name="download"
                          size={15}
                          color={isMe ? '#FFFFFF' : COLORS.primaryNavy}
                          strokeWidth={2}
                        />
                      </View>
                    </TouchableOpacity>
                  );
                })
              ) : (
                renderImageGrid(mediaUrls, isMe)
              )}
            </View>
          )}

          {/* Caption / Text */}
          {hasText && (
            <Text
              style={[
                styles.messageText,
                isMe ? styles.messageTextMe : styles.messageTextOther,
                hasMedia && { marginTop: 6, marginHorizontal: 4 },
              ]}
            >
              {item.message_text}
            </Text>
          )}

          {/* Metadata: Time, Pin, Read Status */}
          <View style={[styles.bubbleMeta, hasMedia && !hasText && styles.bubbleMetaOverlay]}>
            {/* Quick 📌 Pin to Task on message */}
            <TouchableOpacity
              style={styles.bubblePinBtn}
              onPress={() =>
                handleOpenTaskModal(
                  item.message_text ? item.message_text : (hasMedia ? 'Image' : ''),
                  item.created_at
                )
              }
              activeOpacity={0.7}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Text style={styles.bubblePinText}>📌</Text>
            </TouchableOpacity>

            <Text
              style={[
                styles.messageTimeText,
                isMe ? styles.messageTimeMe : styles.messageTimeOther,
              ]}
            >
              {formatMessageTime(item.created_at)}
            </Text>
            {isMe && (
              <View style={styles.readStatusCheck}>
                <Icon
                  name="check-double"
                  size={12}
                  color={item.is_read ? '#67E8F9' : 'rgba(255, 255, 255, 0.7)'}
                  strokeWidth={2.5}
                />
              </View>
            )}
          </View>
        </View>
      </View>
    );
  };

  const isAdmin = colleagueRole?.toLowerCase() === 'admin';

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 0}
    >
      {/* Header */}
      <Header
        title={colleagueName || 'name'}
        subtitle={isAdmin ? 'Admin' : 'User'}
        onBack={() => navigation.goBack()}
      />

      {isLoadingMessages && messages.length === 0 ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={COLORS.primary} />
          <Text style={styles.loadingText}>Loading conversation...</Text>
        </View>
      ) : (
        <FlatList
          ref={flatListRef}
          data={groupedMessages}
          keyExtractor={(item) => (item.type === 'date_header' ? item.id : String(item.id))}
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
            return renderMessageBubble({ item: item as InternalChatMessage });
          }}
          style={styles.flatListFlex}
          contentContainerStyle={styles.messagesContent}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: false })}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <View style={styles.emptyIconCircle}>
                <Icon name="chat" size={32} color={COLORS.primary} strokeWidth={2} />
              </View>
              <Text style={styles.emptyTitle}>Start a Conversation</Text>
              <Text style={styles.emptySubtitle}>
                Say hello to {colleagueName || 'your colleague'}! Messages are encrypted & internal to your team.
              </Text>
            </View>
          }
        />
      )}

      {/* Typing indicator */}
      {isColleagueTyping && (
        <View style={styles.typingContainer}>
          <Text style={styles.typingText}>{colleagueName} is typing...</Text>
        </View>
      )}

      {/* Attached Media Preview Tray */}
      {selectedImages.length > 0 && (
        <View style={styles.imagePreviewTray}>
          <View style={styles.previewHeaderRow}>
            <View style={styles.previewHeaderLeft}>
              <Icon name="paperclip" size={14} color={COLORS.primary} />
              <Text style={styles.previewTitle}>
                {selectedImages[0]?.mediaType === 'video'
                  ? 'Attached Video (1)'
                  : selectedImages[0]?.mediaType === 'document'
                  ? 'Attached Document (1)'
                  : `Attached Photos (${selectedImages.length}/5)`}
              </Text>
            </View>
            <TouchableOpacity
              onPress={() => setSelectedImages([])}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Text style={styles.previewClearAll}>Clear All</Text>
            </TouchableOpacity>
          </View>

          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.previewScrollContent}
          >
            {selectedImages.map((media, idx) => {
              const isVid = media.mediaType === 'video';
              const isDoc = media.mediaType === 'document';
              return (
                <View key={`${media.uri}-${idx}`} style={styles.previewThumbWrapper}>
                  {isVid ? (
                    <View style={styles.previewVideoBox}>
                      <Icon name="video" size={20} color="#FFFFFF" strokeWidth={2.2} />
                      <Text style={styles.previewMediaLabel} numberOfLines={1}>
                        Video
                      </Text>
                    </View>
                  ) : isDoc ? (
                    <View style={styles.previewDocBox}>
                      <Icon name="document" size={20} color="#FFFFFF" strokeWidth={2.2} />
                      <Text style={styles.previewMediaLabel} numberOfLines={1}>
                        {(media.fileName?.split('.').pop() || 'DOC').toUpperCase()}
                      </Text>
                    </View>
                  ) : (
                    <Image source={{ uri: media.uri }} style={styles.previewThumb} resizeMode="cover" />
                  )}
                  <TouchableOpacity
                    style={styles.previewRemoveBtn}
                    onPress={() => setSelectedImages((prev) => prev.filter((_, i) => i !== idx))}
                    activeOpacity={0.7}
                    hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                  >
                    <Icon name="x" size={10} color={COLORS.bgWhite} strokeWidth={3} />
                  </TouchableOpacity>
                  <View style={styles.previewBadge}>
                    <Text style={styles.previewBadgeText}>{idx + 1}</Text>
                  </View>
                </View>
              );
            })}

            {/* Show Add button only for photos (images) up to max 5 */}
            {!selectedImages.some((m) => m.mediaType === 'video' || m.mediaType === 'document') &&
              selectedImages.length < 5 && (
                <TouchableOpacity
                  style={styles.addMoreImagesBtn}
                  onPress={handleAttachmentMenu}
                  activeOpacity={0.7}
                >
                  <Icon name="plus" size={18} color={COLORS.primary} strokeWidth={2.5} />
                  <Text style={styles.addMoreText}>Add</Text>
                </TouchableOpacity>
              )}
          </ScrollView>
        </View>
      )}

      {/* Bottom Input Bar */}
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
        {/* Attachment Button */}
        <TouchableOpacity
          style={styles.attachBtn}
          onPress={handleAttachmentMenu}
          activeOpacity={0.7}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Icon name="paperclip" size={20} color={COLORS.primary} strokeWidth={2.2} />
        </TouchableOpacity>

        {/* Text Input */}
        <TextInput
          style={styles.textInput}
          placeholder={selectedImages.length > 0 ? 'Add a caption...' : 'Type Here..'}
          placeholderTextColor={COLORS.textSubtle}
          value={inputText}
          onChangeText={handleTextChange}
          multiline
          maxLength={1000}
        />

        {/* Send Button */}
        <TouchableOpacity
          style={[
            styles.sendBtn,
            (!inputText.trim() && selectedImages.length === 0) || isSending
              ? styles.sendBtnDisabled
              : styles.sendBtnActive,
          ]}
          onPress={handleSend}
          disabled={(!inputText.trim() && selectedImages.length === 0) || isSending}
          activeOpacity={0.8}
        >
          {isSending ? (
            <ActivityIndicator size="small" color={COLORS.bgWhite} />
          ) : (
            <Icon name="send" size={17} color={COLORS.bgWhite} strokeWidth={2.5} />
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
                <Text style={styles.attachmentSubTitle}>Share documents, photos or videos</Text>
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
                <Text style={styles.attachmentSubLabel}>PDF, Word (1)</Text>
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
                <Text style={styles.attachmentSubLabel}>Photos (max 5)</Text>
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
                <Text style={styles.attachmentSubLabel}>Video (1)</Text>
              </TouchableOpacity>
            </View>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Fullscreen Image Lightbox Viewer Modal */}
      <Modal
        visible={imageViewerVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setImageViewerVisible(false)}
      >
        <View style={styles.lightboxContainer}>
          {/* Header with counter and close button */}
          <View style={[styles.lightboxHeader, { paddingTop: Math.max(insets.top, 20) }]}>
            <Text style={styles.lightboxCounter}>
              {viewerImages.length > 0 ? `${activeImageIndex + 1} / ${viewerImages.length}` : ''}
            </Text>
            <TouchableOpacity
              style={styles.lightboxCloseBtn}
              onPress={() => setImageViewerVisible(false)}
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            >
              <Icon name="x" size={20} color={COLORS.bgWhite} strokeWidth={2.5} />
            </TouchableOpacity>
          </View>

          {/* Main Image */}
          {viewerImages.length > 0 && (
            <View style={styles.lightboxBody}>
              <Image
                source={{ uri: viewerImages[activeImageIndex] }}
                style={styles.lightboxImage}
                resizeMode="contain"
              />
            </View>
          )}

          {/* Navigation Controls if Multiple Images */}
          {viewerImages.length > 1 && (
            <View style={[styles.lightboxFooter, { paddingBottom: Math.max(insets.bottom, 20) }]}>
              <TouchableOpacity
                style={[
                  styles.lightboxNavBtn,
                  activeImageIndex === 0 && styles.lightboxNavBtnDisabled,
                ]}
                disabled={activeImageIndex === 0}
                onPress={() => setActiveImageIndex((prev) => Math.max(0, prev - 1))}
              >
                <Icon name="chevron-left" size={22} color={COLORS.bgWhite} strokeWidth={2.5} />
                <Text style={styles.lightboxNavText}>Prev</Text>
              </TouchableOpacity>

              {/* Thumbnails row */}
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: 8 }}>
                {viewerImages.map((uri, idx) => (
                  <TouchableOpacity
                    key={idx}
                    onPress={() => setActiveImageIndex(idx)}
                    style={[
                      styles.lightboxMiniThumb,
                      activeImageIndex === idx && styles.lightboxMiniThumbActive,
                    ]}
                  >
                    <Image source={{ uri }} style={styles.lightboxMiniImg} />
                  </TouchableOpacity>
                ))}
              </ScrollView>

              <TouchableOpacity
                style={[
                  styles.lightboxNavBtn,
                  activeImageIndex === viewerImages.length - 1 && styles.lightboxNavBtnDisabled,
                ]}
                disabled={activeImageIndex === viewerImages.length - 1}
                onPress={() => setActiveImageIndex((prev) => Math.min(viewerImages.length - 1, prev + 1))}
              >
                <Text style={styles.lightboxNavText}>Next</Text>
                <Icon name="chevron-right" size={22} color={COLORS.bgWhite} strokeWidth={2.5} />
              </TouchableOpacity>
            </View>
          )}
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
            {/* Header: Title "Create Task" & Close Button */}
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
              ref={modalScrollRef}
              style={{ maxHeight: modalScrollMaxHeight }}
              contentContainerStyle={{
                paddingBottom: taskKeyboardHeight > 0 ? 120 : 36,
                flexGrow: 1,
              }}
              showsVerticalScrollIndicator={true}
              keyboardShouldPersistTaps="handled"
              nestedScrollEnabled={true}
            >
              {/* Task Info Section */}
              <View style={styles.infoCard}>
                <View style={styles.infoHeader}>
                  <Icon name="chat" size={16} color={COLORS.primary} />
                  <Text style={styles.infoSectionTitle}>Task Info</Text>
                </View>
                <View style={styles.infoDetailsBox}>
                  {/* Name */}
                  <View style={styles.infoDetailRow}>
                    <Text style={styles.infoDetailLabel}>Name :</Text>
                    <Text style={styles.infoDetailValue} numberOfLines={1}>
                      {colleagueName || 'Colleague'}
                    </Text>
                  </View>

                  {/* Date */}
                  <View style={styles.infoDetailRow}>
                    <Text style={styles.infoDetailLabel}>Date :</Text>
                    <Text style={styles.infoDetailValue}>
                      {taskMessageDate || getTodayDateStr()}
                    </Text>
                  </View>

                  {/* Time */}
                  <View style={styles.infoDetailRow}>
                    <Text style={styles.infoDetailLabel}>Time :</Text>
                    <Text style={styles.infoDetailValue}>
                      {taskMessageTime || getCurrentTimeStr()}
                    </Text>
                  </View>

                  {/* Event Type: Jeenmate Chat */}
                  <View style={styles.infoDetailRow}>
                    <Text style={styles.infoDetailLabel}>Event Type :</Text>
                    <Text style={styles.infoDetailValue}>JeenmateChat</Text>
                  </View>

                  {/* Message */}
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
                          modalScrollRef.current?.scrollTo({ y: 140, animated: true });
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
                          modalScrollRef.current?.scrollTo({ y: 140, animated: true });
                        }, 180);
                      }}
                    />
                  </View>
                </View>
              </View>

              {/* Our Notes */}
              <View style={styles.formGroup}>
                <Text style={styles.fieldHeading}>Our Notes :</Text>
                <TextInput
                  style={styles.notesTextarea}
                  value={taskStaffNote}
                  onChangeText={setTaskStaffNote}
                  placeholder="Add notes for this task..."
                  placeholderTextColor={COLORS.textSubtle}
                  multiline
                  numberOfLines={3}
                  textAlignVertical="top"
                  onFocus={() => {
                    setTimeout(() => {
                      modalScrollRef.current?.scrollTo({ y: 220, animated: true });
                    }, 180);
                  }}
                />
              </View>

              {/* Assign Task to (Dropdown) */}
              <View style={styles.formGroup}>
                <Text style={styles.fieldHeading}>Assign Task to :</Text>
                <TouchableOpacity
                  style={[styles.dropdownTrigger, assignDropdownOpen && styles.dropdownTriggerActive]}
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
                    size={16}
                    color={COLORS.textMuted}
                  />
                </TouchableOpacity>

                {assignDropdownOpen && (
                  <View style={styles.dropdownMenu}>
                    {/* Unassign / Default Option */}
                    <TouchableOpacity
                      style={[styles.dropdownItem, !assignedUser && styles.dropdownItemActive]}
                      onPress={() => {
                        setAssignedUser(null);
                        setAssignDropdownOpen(false);
                      }}
                      activeOpacity={0.7}
                    >
                      <View style={styles.dropdownItemContent}>
                        <View>
                          <Text style={[styles.dropdownItemName, !assignedUser && styles.dropdownItemNameActive]}>
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
                  <Text style={styles.modalSubmitBtnText}>Submit</Text>
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
  flatListFlex: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  loadingText: {
    fontSize: 13,
    color: COLORS.textMuted,
  },
  messagesContent: {
    paddingHorizontal: SPACING.md,
    paddingTop: SPACING.sm,
    paddingBottom: SPACING.md,
    flexGrow: 1,
  },
  bubbleWrapper: {
    marginVertical: 3,
    maxWidth: '85%',
  },
  bubbleWrapperLeft: {
    alignSelf: 'flex-start',
  },
  bubbleWrapperRight: {
    alignSelf: 'flex-end',
  },
  messageBubble: {
    borderRadius: RADIUS.lg,
    paddingHorizontal: 12,
    paddingVertical: 8,
    maxWidth: '100%',
    shadowColor: COLORS.shadowColor,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 2,
    elevation: 1,
  },
  bubbleWithMedia: {
    paddingHorizontal: 6,
    paddingTop: 6,
    paddingBottom: 6,
  },
  messageBubbleMe: {
    backgroundColor: COLORS.primaryNavy,
    borderBottomRightRadius: 2,
  },
  messageBubbleOther: {
    backgroundColor: COLORS.bgWhite,
    borderBottomLeftRadius: 2,
    borderWidth: 1,
    borderColor: COLORS.borderColor,
  },
  messageText: {
    fontSize: 14,
    lineHeight: 20,
  },
  messageTextMe: {
    color: COLORS.bgWhite,
  },
  messageTextOther: {
    color: COLORS.textDark,
  },

  // Image Grid Styles in Message Bubble
  bubbleMediaContainer: {
    borderRadius: RADIUS.md,
    overflow: 'hidden',
  },
  singleImageWrapper: {
    width: 236,
    height: 180,
    borderRadius: RADIUS.md,
    overflow: 'hidden',
    backgroundColor: '#E2E8F0',
  },
  singleImage: {
    width: '100%',
    height: '100%',
  },
  imageGridRow: {
    flexDirection: 'row',
    gap: 4,
    width: 236,
  },
  twoImageItem: {
    flex: 1,
    height: 116,
    borderRadius: RADIUS.sm,
    overflow: 'hidden',
    backgroundColor: '#E2E8F0',
  },
  threeImageContainer: {
    width: 236,
    gap: 4,
  },
  threeImageTop: {
    width: 236,
    height: 120,
    borderRadius: RADIUS.sm,
    overflow: 'hidden',
    backgroundColor: '#E2E8F0',
  },
  fourImageContainer: {
    width: 236,
  },
  fiveImageContainer: {
    width: 236,
  },
  threeImageItem: {
    flex: 1,
    height: 76,
    borderRadius: RADIUS.sm,
    overflow: 'hidden',
    backgroundColor: '#E2E8F0',
  },
  gridImage: {
    width: '100%',
    height: '100%',
  },

  bubbleMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    marginTop: 4,
    gap: 4,
  },
  bubbleMetaOverlay: {
    marginTop: 2,
    paddingHorizontal: 4,
  },
  bubblePinBtn: {
    marginRight: 4,
    paddingHorizontal: 2,
  },
  bubblePinText: {
    fontSize: 11,
  },
  messageTimeText: {
    fontSize: 10,
  },
  messageTimeMe: {
    color: 'rgba(255, 255, 255, 0.7)',
  },
  messageTimeOther: {
    color: COLORS.textSubtle,
  },
  readStatusCheck: {
    marginLeft: 2,
  },
  typingContainer: {
    paddingHorizontal: SPACING.lg,
    paddingVertical: 4,
  },
  typingText: {
    fontSize: 12,
    fontStyle: 'italic',
    color: COLORS.primary,
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: SPACING.xxl,
    paddingTop: 80,
  },
  emptyIconCircle: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: 'rgba(26, 59, 113, 0.08)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: SPACING.md,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: COLORS.primaryNavy,
    marginBottom: 4,
  },
  emptySubtitle: {
    fontSize: 12.5,
    color: COLORS.textMuted,
    textAlign: 'center',
    lineHeight: 18,
  },

  // Image Preview Tray Styles
  imagePreviewTray: {
    backgroundColor: COLORS.bgWhite,
    borderTopWidth: 1,
    borderTopColor: COLORS.borderColor,
    paddingTop: 8,
    paddingBottom: 6,
    paddingHorizontal: SPACING.md,
  },
  previewHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  previewHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  previewTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: COLORS.primary,
  },
  previewClearAll: {
    fontSize: 11.5,
    fontWeight: '600',
    color: '#EF4444',
  },
  previewScrollContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingBottom: 4,
  },
  previewThumbWrapper: {
    width: 62,
    height: 62,
    borderRadius: RADIUS.md,
    overflow: 'hidden',
    position: 'relative',
    borderWidth: 1.5,
    borderColor: COLORS.primary,
  },
  previewThumb: {
    width: '100%',
    height: '100%',
  },
  previewRemoveBtn: {
    position: 'absolute',
    top: 2,
    right: 2,
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
    width: 18,
    height: 18,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  previewBadge: {
    position: 'absolute',
    bottom: 2,
    left: 2,
    backgroundColor: COLORS.primaryNavy,
    width: 16,
    height: 16,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  previewBadgeText: {
    fontSize: 9,
    fontWeight: '800',
    color: COLORS.bgWhite,
  },
  addMoreImagesBtn: {
    width: 62,
    height: 62,
    borderRadius: RADIUS.md,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(26, 59, 113, 0.04)',
    gap: 2,
  },
  addMoreText: {
    fontSize: 10,
    fontWeight: '700',
    color: COLORS.primary,
  },

  // Input Container
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
  attachBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: 'rgba(26, 59, 113, 0.08)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 1,
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
  sendBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 1,
  },
  sendBtnActive: {
    backgroundColor: COLORS.primaryNavy,
  },
  sendBtnDisabled: {
    backgroundColor: COLORS.borderColor,
  },

  // Lightbox Modal
  lightboxContainer: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.95)',
    justifyContent: 'space-between',
  },
  lightboxHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SPACING.lg,
    paddingBottom: SPACING.md,
  },
  lightboxCounter: {
    color: COLORS.bgWhite,
    fontSize: 15,
    fontWeight: '700',
  },
  lightboxCloseBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  lightboxBody: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  lightboxImage: {
    width: SCREEN_WIDTH - 16,
    height: SCREEN_HEIGHT * 0.65,
  },
  lightboxFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SPACING.md,
    paddingTop: SPACING.sm,
  },
  lightboxNavBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: RADIUS.md,
    gap: 4,
  },
  lightboxNavBtnDisabled: {
    opacity: 0.3,
  },
  lightboxNavText: {
    color: COLORS.bgWhite,
    fontSize: 12,
    fontWeight: '700',
  },
  lightboxMiniThumb: {
    width: 44,
    height: 44,
    borderRadius: RADIUS.sm,
    overflow: 'hidden',
    borderWidth: 1.5,
    borderColor: 'transparent',
    marginHorizontal: 3,
  },
  lightboxMiniThumbActive: {
    borderColor: '#38BDF8',
  },
  lightboxMiniImg: {
    width: '100%',
    height: '100%',
  },

  // Task Modal Styles
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(7, 15, 30, 0.65)',
    justifyContent: 'flex-end',
  },
  modalCard: {
    backgroundColor: COLORS.bgWhite,
    borderTopLeftRadius: RADIUS.xl,
    borderTopRightRadius: RADIUS.xl,
    paddingHorizontal: SPACING.xl,
    paddingTop: SPACING.lg,
    paddingBottom: Platform.OS === 'ios' ? 36 : 24,
    maxHeight: '92%',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingBottom: SPACING.sm,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.borderColor,
    marginBottom: SPACING.md,
  },
  modalTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: COLORS.primaryNavy,
  },
  modalCloseText: {
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.textMuted,
    padding: 4,
  },
  infoCard: {
    backgroundColor: COLORS.bgLinen,
    borderRadius: RADIUS.lg,
    padding: SPACING.md,
    borderWidth: 1,
    borderColor: COLORS.borderColor,
    marginBottom: SPACING.md,
  },
  infoHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  infoSectionTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: COLORS.primaryNavy,
  },
  infoDetailsBox: {
    backgroundColor: COLORS.bgWhite,
    borderRadius: RADIUS.md,
    padding: SPACING.sm + 4,
    borderWidth: 1,
    borderColor: COLORS.borderColor,
  },
  infoDetailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 5,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(230, 228, 220, 0.5)',
  },
  infoDetailLabel: {
    fontSize: 12.5,
    fontWeight: '600',
    color: COLORS.textMuted,
    width: 90,
  },
  infoDetailValue: {
    fontSize: 13,
    fontWeight: '700',
    color: COLORS.primaryNavy,
    flex: 1,
    textAlign: 'right',
  },
  infoDetailDescValue: {
    fontSize: 13,
    fontWeight: '600',
    color: '#D97706',
    flex: 1,
    textAlign: 'right',
    fontStyle: 'italic',
  },
  originalMessageBox: {
    backgroundColor: 'rgba(26, 59, 113, 0.05)',
    borderRadius: RADIUS.md,
    padding: SPACING.sm + 2,
    borderLeftWidth: 3,
    borderLeftColor: COLORS.primary,
    marginBottom: SPACING.md,
  },
  originalMessageLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: COLORS.primary,
    marginBottom: 2,
  },
  originalMessageText: {
    fontSize: 12,
    color: COLORS.textDark,
    lineHeight: 16,
  },
  dateTimeRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: SPACING.md,
  },
  dateTimeCol: {
    flex: 1,
  },
  fieldHeading: {
    fontSize: 12.5,
    fontWeight: '700',
    color: COLORS.textDark,
    marginBottom: 6,
  },
  dateTimeInputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.inputBg,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.borderColor,
    paddingHorizontal: 10,
    height: 40,
    gap: 8,
  },
  dateTimeInput: {
    flex: 1,
    fontSize: 13,
    color: COLORS.textDark,
    paddingVertical: 0,
  },
  formGroup: {
    marginBottom: SPACING.md,
  },
  notesTextarea: {
    backgroundColor: COLORS.inputBg,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.borderColor,
    padding: 10,
    height: 90,
    fontSize: 13,
    color: COLORS.textDark,
  },
  dropdownTrigger: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: COLORS.inputBg,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.borderColor,
    paddingHorizontal: 12,
    height: 42,
  },
  dropdownTriggerActive: {
    borderColor: COLORS.primary,
  },
  dropdownTriggerLeft: {
    flex: 1,
  },
  dropdownTriggerText: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.textDark,
  },
  dropdownMenu: {
    marginTop: 4,
    backgroundColor: COLORS.bgWhite,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.borderColor,
    elevation: 3,
    shadowColor: COLORS.shadowColor,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    maxHeight: 180,
    overflow: 'hidden',
  },
  dropdownItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(230, 228, 220, 0.5)',
  },
  dropdownItemActive: {
    backgroundColor: 'rgba(26, 59, 113, 0.06)',
  },
  dropdownItemContent: {
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
    fontSize: 10.5,
    color: COLORS.textMuted,
    marginTop: 1,
  },
  modalSubmitBtn: {
    backgroundColor: COLORS.primaryNavy,
    borderRadius: RADIUS.md,
    paddingVertical: 13,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: SPACING.xs,
    elevation: 2,
    shadowColor: COLORS.shadowColor,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
  },
  modalSubmitBtnText: {
    color: COLORS.bgWhite,
    fontSize: 14,
    fontWeight: '800',
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
  internalVideoCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1E293B',
    borderRadius: RADIUS.md,
    padding: 10,
    width: 220,
    marginBottom: 4,
  },
  internalVideoPlayCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  internalVideoDetails: {
    flex: 1,
  },
  internalVideoTitle: {
    fontSize: 13,
    fontWeight: '600',
  },
  internalVideoSub: {
    fontSize: 10,
    marginTop: 2,
  },
  internalDocCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 10,
    borderRadius: RADIUS.md,
    width: 230,
    marginBottom: 4,
  },
  internalDocCardMe: {
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
  },
  internalDocCardOther: {
    backgroundColor: 'rgba(26, 59, 113, 0.08)',
  },
  internalDocIconWrapper: {
    width: 38,
    height: 38,
    borderRadius: RADIUS.sm,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
    position: 'relative',
  },
  internalDocIconPdf: {
    backgroundColor: '#E11D48',
  },
  internalDocIconWord: {
    backgroundColor: '#2563EB',
  },
  internalDocExtBadge: {
    position: 'absolute',
    bottom: 2,
    fontSize: 7.5,
    fontWeight: '800',
    color: '#FFFFFF',
    textTransform: 'uppercase',
  },
  internalDocDetails: {
    flex: 1,
  },
  internalDocTitle: {
    fontSize: 13,
    fontWeight: '600',
  },
  internalDocSub: {
    fontSize: 10,
    marginTop: 2,
  },
  internalDocDownloadIcon: {
    marginLeft: 6,
    padding: 4,
  },
  previewVideoBox: {
    width: 60,
    height: 60,
    borderRadius: RADIUS.sm,
    backgroundColor: '#06B6D4',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 4,
  },
  previewDocBox: {
    width: 60,
    height: 60,
    borderRadius: RADIUS.sm,
    backgroundColor: '#7C3AED',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 4,
  },
  previewMediaLabel: {
    color: '#FFFFFF',
    fontSize: 9,
    fontWeight: '700',
    marginTop: 2,
    textAlign: 'center',
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
  textWhite: {
    color: '#FFFFFF',
  },
  textDark: {
    color: COLORS.textDark,
  },
  timeMe: {
    color: 'rgba(255, 255, 255, 0.7)',
  },
  timeOther: {
    color: COLORS.textMuted,
  },
});
