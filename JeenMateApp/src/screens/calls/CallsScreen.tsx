import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Linking,
  TextInput,
  Modal,
  Alert,
  Platform,
  ActivityIndicator,
  RefreshControl,
  KeyboardAvoidingView,
  Keyboard,
  Dimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { COLORS, SPACING, RADIUS } from '../../constants/theme';
import { Icon } from '../../components/common/Icon';
import { Header } from '../../components/common/Header';
import { useTaskStore, TeamMember, TaskEventType } from '../../store/taskStore';
import { useAuthStore } from '../../store/authStore';
import { useWhatsAppStore } from '../../store/whatsappStore';
import apiClient from '../../services/api';
import {
  fetchAndroidCallLogs,
} from '../../services/callLogService';

export interface CallLogItem {
  id: string;
  customerName: string;
  phoneNumber: string;
  callType: 'incoming' | 'outgoing' | 'missed';
  status?: 'unknown' | 'answered' | 'missed' | 'rejected';
  mediaType: 'voice' | 'video';
  timestamp: string;
  duration?: number | string | null;
  avatar?: string;
  isVideo?: boolean;
  isVideoCall?: boolean;
  rawCall?: any;
  rawTimestamp?: number;
}

/**
 * Robustly parses a timestamp string or number into a standard JavaScript Date.
 * Handles ISO strings ("2026-09-11 10:45:00"), Epoch milliseconds/seconds,
 * and relative string fallbacks ("Today, 10:45 AM").
 */
const parseCallDate = (rawTs: string | number | undefined | null): Date => {
  if (!rawTs) return new Date(0);
  if (typeof rawTs === 'number') {
    return rawTs > 1e11 ? new Date(rawTs) : new Date(rawTs * 1000);
  }

  let str = String(rawTs).trim();

  // If string contains only numbers (unix timestamp)
  if (/^\d+$/.test(str)) {
    const num = parseInt(str, 10);
    return str.length === 10 ? new Date(num * 1000) : new Date(num);
  }

  const now = new Date();

  // Robustly handle "Today..." string
  if (/^today/i.test(str) || str.toLowerCase().includes('today')) {
    const timeMatch = str.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm)?/i);
    if (timeMatch) {
      let h = parseInt(timeMatch[1], 10);
      const m = parseInt(timeMatch[2], 10);
      const s = timeMatch[3] ? parseInt(timeMatch[3], 10) : 0;
      const ampm = timeMatch[4] ? timeMatch[4].toLowerCase() : null;
      if (ampm === 'pm' && h < 12) h += 12;
      if (ampm === 'am' && h === 12) h = 0;
      return new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m, s);
    }
    return now;
  }

  // Robustly handle "Yesterday..." string
  if (/^yesterday/i.test(str) || str.toLowerCase().includes('yesterday')) {
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    const timeMatch = str.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm)?/i);
    if (timeMatch) {
      let h = parseInt(timeMatch[1], 10);
      const m = parseInt(timeMatch[2], 10);
      const s = timeMatch[3] ? parseInt(timeMatch[3], 10) : 0;
      const ampm = timeMatch[4] ? timeMatch[4].toLowerCase() : null;
      if (ampm === 'pm' && h < 12) h += 12;
      if (ampm === 'am' && h === 12) h = 0;
      return new Date(yesterday.getFullYear(), yesterday.getMonth(), yesterday.getDate(), h, m, s);
    }
    return yesterday;
  }

  // Pattern: "12 Aug, 04:30 PM" or "12 Aug 2026, 4:30 pm"
  const dmyMatch = str.match(/(\d{1,2})\s+([A-Za-z]{3,9})(?:\s*,?\s*(\d{4}))?(?:,?\s*(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm)?)?/i);
  if (dmyMatch) {
    const day = parseInt(dmyMatch[1], 10);
    const monthStr = dmyMatch[2];
    const year = dmyMatch[3] ? parseInt(dmyMatch[3], 10) : now.getFullYear();
    const months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
    const monthIdx = months.findIndex((m) => monthStr.toLowerCase().startsWith(m));
    if (monthIdx !== -1) {
      let h = dmyMatch[4] ? parseInt(dmyMatch[4], 10) : 0;
      const m = dmyMatch[5] ? parseInt(dmyMatch[5], 10) : 0;
      const ampm = dmyMatch[7] ? dmyMatch[7].toLowerCase() : null;
      if (ampm === 'pm' && h < 12) h += 12;
      if (ampm === 'am' && h === 12) h = 0;
      return new Date(year, monthIdx, day, h, m, 0);
    }
  }

  // If date string contains month name but no 4-digit year, inject current year
  if (!/\b(20\d{2})\b/.test(str)) {
    str = str.replace(/(\d{1,2}\s+[A-Za-z]+)/, `$1 ${now.getFullYear()}`);
  }

  // Handle SQL datetime ("YYYY-MM-DD HH:mm:ss") -> convert to ISO UTC ("YYYY-MM-DDTHH:mm:ss.000Z")
  let normalized = str;
  if (/^\d{4}-\d{2}-\d{2}\s\d{2}:\d{2}:\d{2}/.test(normalized)) {
    normalized = normalized.replace(' ', 'T') + '.000Z';
  } else if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(normalized)) {
    normalized = normalized + '.000Z';
  }

  const d = new Date(normalized);
  if (!isNaN(d.getTime()) && d.getTime() > 0) {
    if (d.getFullYear() < 2020) d.setFullYear(now.getFullYear());
    return d;
  }

  // Fallback: extract unix timestamp from string like "msg_call_1789109485"
  const matchMsgTs = str.match(/17\d{8,11}/);
  if (matchMsgTs) {
    const num = parseInt(matchMsgTs[0], 10);
    return matchMsgTs[0].length === 10 ? new Date(num * 1000) : new Date(num);
  }

  return new Date(0);
};

/**
 * Formats a clean date string for call cards (e.g. "Today", "Yesterday", "12 Aug 2026").
 */
const getCallCardDate = (item: CallLogItem): string => {
  const d = (item.rawTimestamp && item.rawTimestamp > 0)
    ? new Date(item.rawTimestamp)
    : parseCallDate(item.rawCall?.timestamp || item.timestamp);

  if (!isNaN(d.getTime()) && d.getTime() > 0) {
    const dayCategory = getDateCategory(d);
    if (dayCategory && dayCategory.toLowerCase() !== 'older calls') return dayCategory;
    const day = String(d.getDate()).padStart(2, '0');
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const month = monthNames[d.getMonth()];
    const year = d.getFullYear() < 2020 ? new Date().getFullYear() : d.getFullYear();
    return `${day} ${month} ${year}`;
  }

  const str = String(item.timestamp).toLowerCase();
  if (str.includes('today')) return 'Today';
  if (str.includes('yesterday')) return 'Yesterday';

  const match = String(item.timestamp).match(/(\d{1,2})\s+([A-Za-z]+)(?:\s*,?\s*(\d{4}))?/i);
  if (match) {
    const day = match[1].padStart(2, '0');
    const month = match[2].charAt(0).toUpperCase() + match[2].slice(1, 3).toLowerCase();
    const year = match[3] || new Date().getFullYear();
    return `${day} ${month} ${year}`;
  }
  return '';
};

/**
 * Formats a Date object to 12-hour time string ("6:42 pm", "10:45 am").
 */
const formatCallTime = (d: Date, rawFallback: string): string => {
  if (isNaN(d.getTime()) || d.getTime() === 0) {
    const match = String(rawFallback).match(/(\d{1,2}:\d{2}\s*(?:am|pm)?)/i);
    return match ? match[1].toLowerCase().replace(/(am|pm)/i, ' $1').replace(/\s+/g, ' ').trim() : (rawFallback || '');
  }
  let hours = d.getHours();
  const minutes = String(d.getMinutes()).padStart(2, '0');
  const ampm = hours >= 12 ? 'pm' : 'am';
  hours = hours % 12;
  hours = hours ? hours : 12;
  return `${hours}:${minutes} ${ampm}`;
};

/**
 * Returns date section title ("Today", "Yesterday", Day name e.g. "Tuesday", or "05 Sep 2026").
 */
const getDateCategory = (d: Date): string => {
  if (isNaN(d.getTime()) || d.getTime() === 0) return '';

  const now = new Date();
  if (
    d.getDate() === now.getDate() &&
    d.getMonth() === now.getMonth() &&
    d.getFullYear() === now.getFullYear()
  ) {
    return 'Today';
  }

  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (
    d.getDate() === yesterday.getDate() &&
    d.getMonth() === yesterday.getMonth() &&
    d.getFullYear() === yesterday.getFullYear()
  ) {
    return 'Yesterday';
  }

  const day = String(d.getDate()).padStart(2, '0');
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const month = monthNames[d.getMonth()];
  const year = d.getFullYear() < 2020 ? now.getFullYear() : d.getFullYear();
  return `${day} ${month} ${year}`;
};

const formatCallDuration = (dur?: number | string | null): string => {
  if (dur === null || dur === undefined || dur === '' || dur === '0s' || dur === '0') return '';
  const num = typeof dur === 'number' ? dur : parseInt(String(dur).replace(/[^0-9]/g, ''), 10);
  if (isNaN(num) || num <= 0) return '';
  if (num < 60) return `${num}s`;
  const m = Math.floor(num / 60);
  const s = num % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
};

/**
 * Formats dynamic call event description (e.g., "missed call at 13:sept, 6:42 pm (duration 29s)").
 */
const getEventDescription = (call: CallLogItem): string => {
  const d = (call.rawTimestamp && call.rawTimestamp > 0)
    ? new Date(call.rawTimestamp)
    : parseCallDate(call.rawCall?.timestamp || call.timestamp);
  const timeStr = formatCallTime(d, call.timestamp);
  const monthNames = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sept', 'oct', 'nov', 'dec'];
  let dateStr = '';
  if (!isNaN(d.getTime()) && d.getTime() > 0) {
    const day = d.getDate();
    const month = monthNames[d.getMonth()];
    dateStr = `${day}:${month}`;
  }
  const callTypeStr = call.callType === 'missed'
    ? 'missed call'
    : call.callType === 'incoming'
    ? 'incoming call'
    : 'outgoing call';

  const atPart = dateStr ? `at ${dateStr}, ${timeStr}` : (timeStr ? `at ${timeStr}` : '');
  const formattedDur = formatCallDuration(call.duration);
  const durationStr = call.callType !== 'missed' && formattedDur
    ? ` (duration ${formattedDur})`
    : '';

  return `${callTypeStr} ${atPart}${durationStr}`.trim();
};

/**
 * Formats the call date from call log for display in task info:
 * e.g., "13 sept ,2026"
 */
const getCallDateDisplay = (call: CallLogItem): string => {
  const d = (call.rawTimestamp && call.rawTimestamp > 0)
    ? new Date(call.rawTimestamp)
    : parseCallDate(call.rawCall?.timestamp || call.timestamp);
  if (!isNaN(d.getTime()) && d.getTime() > 0) {
    const day = d.getDate();
    const monthNames = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sept', 'oct', 'nov', 'dec'];
    const month = monthNames[d.getMonth()];
    const year = d.getFullYear() < 2020 ? new Date().getFullYear() : d.getFullYear();
    return `${day} ${month} ,${year}`;
  }

  // Regex fallback: extract day, month, and year if available
  const match = String(call.timestamp).match(/(\d{1,2})\s+([A-Za-z]+)(?:\s*,?\s*(\d{4}))?/i);
  if (match) {
    const day = match[1];
    const month = match[2].toLowerCase();
    const year = match[3] || new Date().getFullYear();
    return `${day} ${month} ,${year}`;
  }
  return call.timestamp || 'N/A';
};

/**
 * Formats the call time from call log for display in task info:
 * e.g., "6:42 pm"
 */
const getCallTimeDisplay = (call: CallLogItem): string => {
  const d = (call.rawTimestamp && call.rawTimestamp > 0)
    ? new Date(call.rawTimestamp)
    : parseCallDate(call.rawCall?.timestamp || call.timestamp);
  if (!isNaN(d.getTime()) && d.getTime() > 0) {
    return formatCallTime(d, call.timestamp);
  }

  // Regex fallback: extract time
  const match = String(call.timestamp).match(/(\d{1,2}:\d{2}\s*(?:am|pm)?)/i);
  if (match) {
    return match[1].toLowerCase().replace(/(am|pm)/i, ' $1').replace(/\s+/g, ' ').trim();
  }
  return call.timestamp || 'N/A';
};

interface CallSection {
  title: string;
  data: CallLogItem[];
}

export const CallsScreen: React.FC = () => {
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();
  const { addTask, teamMembers, fetchTeamMembers } = useTaskStore();
  const { user } = useAuthStore();

  const [activeTab, setActiveTab] = useState<'whatsapp' | 'phone'>('whatsapp');
  const [searchQuery, setSearchQuery] = useState('');

  // Call Logs state
  const { isConnected: isStoreConnected, fetchStatus: fetchWhatsAppStatus } = useWhatsAppStore();
  const [isWaConnectedApi, setIsWaConnectedApi] = useState<boolean | null>(null);
  const isWhatsAppConnected = isWaConnectedApi !== null ? isWaConnectedApi : isStoreConnected;

  const [realPhoneCalls, setRealPhoneCalls] = useState<CallLogItem[]>([]);
  const [liveWhatsAppCalls, setLiveWhatsAppCalls] = useState<CallLogItem[]>([]);
  const [isSyncingCalls, setIsSyncingCalls] = useState<boolean>(false);
  const [isFetchingWACalls, setIsFetchingWACalls] = useState<boolean>(false);

  // CRM Task Modal
  const [taskModalVisible, setTaskModalVisible] = useState(false);
  const [selectedCall, setSelectedCall] = useState<CallLogItem | null>(null);
  const [staffNote, setStaffNote] = useState('');

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
  const [dueDate, setDueDate] = useState(getTodayDateStr());
  const [assignedUser, setAssignedUser] = useState<TeamMember | null>(null);
  const [assignDropdownOpen, setAssignDropdownOpen] = useState(false);
  const [isSubmittingTask, setIsSubmittingTask] = useState(false);
  const modalScrollRef = useRef<any>(null);
  const [keyboardHeight, setKeyboardHeight] = useState(0);

  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';

    const showSub = Keyboard.addListener(showEvent, (e) => {
      setKeyboardHeight(e.endCoordinates.height);
    });
    const hideSub = Keyboard.addListener(hideEvent, () => {
      setKeyboardHeight(0);
    });

    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  const screenHeight = Dimensions.get('window').height;
  const modalScrollMaxHeight = keyboardHeight > 0
    ? Math.max(220, screenHeight - keyboardHeight - 160)
    : Math.min(540, screenHeight * 0.72);

  const assignableMembers: TeamMember[] = (teamMembers || []).filter((m) => {
    // Exclude currently logged-in user from assignment options
    if (user) {
      if (user.id && String(m.id) === String(user.id)) return false;
      if (user.email && m.email && m.email.toLowerCase() === user.email.toLowerCase()) return false;
      if (user.name && m.name && m.name.toLowerCase().trim() === user.name.toLowerCase().trim()) return false;
    }
    return true;
  });

  const loadWhatsAppCalls = async () => {
    setIsFetchingWACalls(true);
    try {
      const res = await apiClient.get('/api/whatsapp/call-logs');
      if (res.data && res.data.success) {
        if (res.data.isConnected !== undefined) {
          setIsWaConnectedApi(!!res.data.isConnected);
        }
        if (!res.data.isConnected) {
          setLiveWhatsAppCalls([]);
          return;
        }

        if (Array.isArray(res.data.data)) {
          const formatted: CallLogItem[] = res.data.data.map((item: any) => {
          const rawCall = item.rawCall || {
            id: item.id || item.callId,
            from: item.phoneNumber,
            timestamp: item.timestamp,
            isGroup: false,
            isVideo: item.isVideo === true,
            isVideoCall: item.isVideoCall === true,
            isGroupCall: false,
            canHandleLocally: true,
          };

          const isVideo = !!(
            rawCall?.isVideo === true ||
            rawCall?.isVideoCall === true ||
            (rawCall?._data && (rawCall._data.isVideo === true || rawCall._data.isVideoCall === true)) ||
            item.isVideo === true ||
            item.isVideoCall === true ||
            String(item.mediaType || item.media_type || '').toLowerCase() === 'video' ||
            String(rawCall?.offerType || '').toLowerCase() === 'video' ||
            String(rawCall?.subtype || rawCall?._data?.subtype || '').toLowerCase().includes('video')
          );

          const mediaType: 'voice' | 'video' = isVideo ? 'video' : 'voice';

          console.log("RAW WHATSAPP CALL:", rawCall);
          console.log("IS VIDEO:", rawCall?.isVideo);
          console.log("IS VIDEO CALL:", rawCall?.isVideoCall);
          console.log("NORMALIZED MEDIA TYPE:", mediaType);

          const parsedInitial = parseCallDate(rawCall?.timestamp || item.timestamp);
          const rawTimestamp = item.rawTimestamp || (parsedInitial.getTime() > 0 ? parsedInitial.getTime() : undefined);

          return {
            id: `wa_call_${item.id || item.callId}`,
            customerName: item.customerName || item.phoneNumber || 'Customer',
            phoneNumber: item.phoneNumber || '',
            callType: (item.callType || 'incoming').toLowerCase() as 'incoming' | 'outgoing' | 'missed',
            status: item.status || (item.callType === 'missed' ? 'missed' : 'unknown'),
            mediaType: mediaType,
            timestamp: item.timestamp,
            duration: item.duration !== null && item.duration !== undefined ? item.duration : undefined,
            isVideo: isVideo,
            isVideoCall: isVideo,
            rawCall: rawCall,
            rawTimestamp: rawTimestamp,
          };
        });

        const uniqueFormatted: CallLogItem[] = [];
        formatted.forEach((item) => {
          const itemPhone = item.phoneNumber.replace(/[^0-9]/g, '');
          const itemTime = (item.rawTimestamp && item.rawTimestamp > 0)
            ? item.rawTimestamp
            : parseCallDate(item.timestamp).getTime();
          const itemBaseId = String(item.id).replace(/^(wa_call_|msg_call_\d+_)/, '');

          const isDup = uniqueFormatted.some((u) => {
            const uPhone = u.phoneNumber.replace(/[^0-9]/g, '');
            const uTime = (u.rawTimestamp && u.rawTimestamp > 0)
              ? u.rawTimestamp
              : parseCallDate(u.timestamp).getTime();
            const uBaseId = String(u.id).replace(/^(wa_call_|msg_call_\d+_)/, '');

            const sameBaseId = !!(itemBaseId && uBaseId && (itemBaseId === uBaseId || itemBaseId.includes(uBaseId) || uBaseId.includes(itemBaseId)));
            const exactSameEvent = !!(itemPhone && uPhone && itemPhone === uPhone && item.callType === u.callType && itemTime === uTime);
            return sameBaseId || exactSameEvent;
          });

          if (!isDup) {
            uniqueFormatted.push(item);
          }
        });

        setLiveWhatsAppCalls(uniqueFormatted);
      }
    }
  } catch (e) {
      console.log('[CallsScreen] Error loading WhatsApp calls from API');
    } finally {
      setIsFetchingWACalls(false);
    }
  };

  const loadRealAndroidCalls = async () => {
    if (Platform.OS !== 'android') return;
    setIsSyncingCalls(true);
    try {
      const logs = await fetchAndroidCallLogs(60);
      if (logs && logs.length > 0) {
        setRealPhoneCalls(logs);
      }
    } catch (e) {
      console.warn('Call logs fetch warning:', e);
    } finally {
      setIsSyncingCalls(false);
    }
  };

  useEffect(() => {
    fetchTeamMembers();
    fetchWhatsAppStatus();
    loadWhatsAppCalls();
    if (Platform.OS === 'android') {
      loadRealAndroidCalls();
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      fetchTeamMembers();
      fetchWhatsAppStatus();
      loadWhatsAppCalls();
      if (Platform.OS === 'android') {
        loadRealAndroidCalls();
      }
    }, [])
  );

  const handleOpenTaskModal = (call: CallLogItem) => {
    fetchTeamMembers();
    setAssignedUser(null);
    setAssignDropdownOpen(false);
    setDueDate(getTodayDateStr());
    setTaskTime(getCurrentTimeStr());
    setSelectedCall(call);
    setStaffNote('');
    setTaskModalVisible(true);
  };

  const handleSaveTask = async () => {
    if (!selectedCall || isSubmittingTask) return;
    try {
      setIsSubmittingTask(true);
      const combinedDue = taskTime?.trim() ? `${dueDate.trim()} ${taskTime.trim()}` : dueDate.trim();

      const eventType: TaskEventType = activeTab === 'whatsapp' ? 'WhatsappCall' : 'PhoneCall';
      await addTask({
        customerId: selectedCall.id,
        customerName: selectedCall.customerName,
        customerPhone: selectedCall.phoneNumber,
        originalMessage: `Call Log [${selectedCall.mediaType.toUpperCase()}]: ${getEventDescription(selectedCall)}`,
        staffNote: staffNote,
        dueDate: combinedDue,
        assignedToUserId: assignedUser ? assignedUser.id : null,
        eventType,
      });
      setAssignedUser(null);
      setAssignDropdownOpen(false);
      setTaskModalVisible(false);
      Alert.alert('Task Created Successfully')
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'Failed to create task');
    } finally {
      setIsSubmittingTask(false);
    }
  };

  const filterCalls = (calls: CallLogItem[]): CallLogItem[] => {
    if (!searchQuery.trim()) return calls;
    const q = searchQuery.toLowerCase();
    return calls.filter(
      (c) =>
        c.customerName.toLowerCase().includes(q) ||
        c.phoneNumber.includes(q) ||
        c.timestamp.toLowerCase().includes(q)
    );
  };

  /**
   * Sort calls strictly chronologically (newest at top, oldest at bottom)
   * and group into date sections ("Today", "Yesterday", "DD MMM YYYY").
   */
  const getSortedAndGroupedSections = (rawList: CallLogItem[]): { sections: CallSection[]; newestId?: string } => {
    const filtered = filterCalls(rawList);

    // 1. Sort strictly descending by exact timestamp
    const sorted = [...filtered].sort((a, b) => {
      const timeA = (a.rawTimestamp && a.rawTimestamp > 0)
        ? a.rawTimestamp
        : parseCallDate(a.rawCall?.timestamp || a.timestamp).getTime();
      const timeB = (b.rawTimestamp && b.rawTimestamp > 0)
        ? b.rawTimestamp
        : parseCallDate(b.rawCall?.timestamp || b.timestamp).getTime();
      return timeB - timeA;
    });

    const newestId = sorted.length > 0 ? sorted[0].id : undefined;

    // 2. Group into sections maintaining descending date order
    const sectionMap = new Map<string, CallLogItem[]>();

    sorted.forEach((call) => {
      const callDate = (call.rawTimestamp && call.rawTimestamp > 0)
        ? new Date(call.rawTimestamp)
        : parseCallDate(call.rawCall?.timestamp || call.timestamp);
      const category = getDateCategory(callDate);
      if (!sectionMap.has(category)) {
        sectionMap.set(category, []);
      }
      sectionMap.get(category)!.push(call);
    });

    const sections: CallSection[] = [];
    sectionMap.forEach((data, title) => {
      sections.push({ title, data });
    });

    return { sections, newestId };
  };

  const waGrouped = getSortedAndGroupedSections(liveWhatsAppCalls);
  const phoneGrouped = getSortedAndGroupedSections(realPhoneCalls);

  console.log("waGrouped",waGrouped);
  
  const renderCallCardItem = (item: CallLogItem, isWhatsApp: boolean, isNewest: boolean) => {
    const isMissed = item.callType === 'missed';
    const isIncoming = item.callType === 'incoming';
    const isOutgoing = item.callType === 'outgoing';

    const parsedDate = (item.rawTimestamp && item.rawTimestamp > 0)
      ? new Date(item.rawTimestamp)
      : parseCallDate(item.rawCall?.timestamp || item.timestamp);
    const displayTime = formatCallTime(parsedDate, item.timestamp);
    const cardDate = getCallCardDate(item);
    const displayDayTime = cardDate && displayTime
      ? `${cardDate}, ${displayTime}`
      : (cardDate || displayTime || item.timestamp);

    const initials = item.customerName
      ? item.customerName
          .split(' ')
          .map((n) => n[0])
          .slice(0, 2)
          .join('')
          .toUpperCase()
      : 'C';

    return (
      <View
        key={item.id}
        style={styles.callItemCard}
      >
        {/* Top Info Row: User info on left, + Task on right */}
        <View style={styles.itemHeaderRow}>
          {/* Avatar & Customer */}
          <View style={styles.itemUserCol}>
            <View
              style={[
                styles.itemAvatar,
                isWhatsApp ? styles.avatarGreenBg : styles.avatarBlueBg,
              ]}
            >
              <Text style={styles.avatarInitialsText}>
                {initials}
              </Text>
              <View
                style={[
                  styles.statusDotBadge,
                  isMissed ? styles.dotRed : isIncoming ? styles.dotGreen : styles.dotBlue,
                ]}
              >
                <Icon
                  name={item.mediaType === 'video' ? 'video' : 'phone'}
                  size={9}
                  color={COLORS.bgWhite}
                />
              </View>
            </View>

            <View style={styles.userTextContainer}>
              <View style={styles.nameRow}>
                <Text style={styles.itemCustomerName} numberOfLines={1}>
                  {item.customerName}
                </Text>
              </View>
              <View style={styles.phoneMetaRow}>
                <Text style={styles.itemPhoneText}>{item.phoneNumber}</Text>
                {!isMissed && formatCallDuration(item.duration) ? (
                  <View style={styles.durationBadge}>
                    <Icon name="clock" size={10} color={COLORS.textMuted} />
                    <Text style={styles.durationText}>{formatCallDuration(item.duration)}</Text>
                  </View>
                ) : null}
              </View>
            </View>
          </View>

          {/* Top Right: + Task Button */}
          <TouchableOpacity
            style={styles.taskBtnPill}
            onPress={() => handleOpenTaskModal(item)}
            activeOpacity={0.75}
          >
            <Text style={styles.taskBtnText}>📌 + Task</Text>
          </TouchableOpacity>
        </View>

        {/* Bottom Meta: Direction Status on left, Day and Time on right */}
        <View style={styles.itemFooterRow}>
          {/* Status Badge with Visual Indicators */}
          <View style={styles.statusPillGroup}>
            <View
              style={[
                styles.statusPill,
                isMissed
                  ? styles.pillMissed
                  : isIncoming
                  ? styles.pillIncoming
                  : styles.pillOutgoing,
              ]}
            >
              <Text
                style={[
                  styles.statusPillText,
                  isMissed
                    ? styles.pillTextMissed
                    : isIncoming
                    ? styles.pillTextIncoming
                    : styles.pillTextOutgoing,
                ]}
              >
                {isMissed
                  ? (item.mediaType === 'video' ? '↙ Missed video call' : '↙ Missed voice call')
                  : isIncoming
                  ? (item.mediaType === 'video' ? '↓ Incoming video call' : '↓ Incoming voice call')
                  : (item.mediaType === 'video' ? '↑ Outgoing video call' : '↑ Outgoing voice call')}
              </Text>
            </View>
          </View>

          {/* Bottom Right: Day and Time */}
          <Text style={styles.bottomTimeText}>
            {displayDayTime}
          </Text>
        </View>
      </View>
    );
  };

  return (
    <View style={styles.container}>
      {/* Reusable Top Header */}
      <Header
        title="Calls"
        onBack={() => navigation.navigate('Home')}
      >
        {/* Underline Filter Tabs */}
        <View style={styles.tabSegmentContainer}>
          <TouchableOpacity
            style={styles.tabSegment}
            onPress={() => setActiveTab('whatsapp')}
            activeOpacity={0.7}
          >
            <Icon
              name="phone"
              size={15}
              color={activeTab === 'whatsapp' ? COLORS.whatsappGreen : COLORS.textMuted}
            />
            <Text
              style={[
                styles.tabSegmentText,
                activeTab === 'whatsapp' && styles.tabSegmentTextActiveWA,
              ]}
            >
              WhatsApp Calls
            </Text>
            {activeTab === 'whatsapp' && (
              <View style={[styles.tabActiveIndicator, styles.tabIndicatorWA]} />
            )}
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.tabSegment}
            onPress={() => setActiveTab('phone')}
            activeOpacity={0.7}
          >
            <Icon
              name="phone"
              size={15}
              color={activeTab === 'phone' ? COLORS.primaryNavy : COLORS.textMuted}
            />
            <Text
              style={[
                styles.tabSegmentText,
                activeTab === 'phone' && styles.tabSegmentTextActivePhone,
              ]}
            >
              Phone Calls
            </Text>
            {activeTab === 'phone' && (
              <View style={[styles.tabActiveIndicator, styles.tabIndicatorPhone]} />
            )}
          </TouchableOpacity>
        </View>

        {/* Search Bar */}
        <View style={styles.searchWrapper}>
          <Icon name="search" size={16} color={COLORS.textMuted} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search by contact name, phone, date..."
            placeholderTextColor={COLORS.textSubtle}
            value={searchQuery}
            onChangeText={setSearchQuery}
          />
        </View>
      </Header>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          activeTab === 'phone' && Platform.OS === 'android' ? (
            <RefreshControl
              refreshing={isSyncingCalls}
              onRefresh={loadRealAndroidCalls}
              colors={[COLORS.primary]}
            />
          ) : activeTab === 'whatsapp' ? (
            <RefreshControl
              refreshing={isFetchingWACalls}
              onRefresh={loadWhatsAppCalls}
              colors={[COLORS.primary]}
            />
          ) : undefined
        }
      >
        {/* WHATSAPP CALLS LIST */}
        {activeTab === 'whatsapp' && (
          !isWhatsAppConnected ? (
            <View style={styles.disconnectedContainer}>
              <View style={styles.disconnectedIconCircle}>
                <Icon name="link" size={38} color={COLORS.primaryNavy} strokeWidth={2.2} />
              </View>
              <Text style={styles.disconnectedTitle}>Device Not Linked</Text>
              <Text style={styles.disconnectedSub}>
                Please link your WhatsApp account to view your WhatsApp call logs and history.
              </Text>

              <TouchableOpacity
                style={styles.linkDeviceButton}
                onPress={() => navigation.navigate('Link')}
                activeOpacity={0.85}
              >
                <Icon name="link" size={18} color={COLORS.bgWhite} strokeWidth={2.5} />
                <Text style={styles.linkDeviceButtonText}>Please Link Your Device</Text>
              </TouchableOpacity>
            </View>
          ) : isFetchingWACalls && liveWhatsAppCalls.length === 0 ? (
            <View style={styles.emptyBox}>
              <ActivityIndicator size="small" color={COLORS.primary} />
              <Text style={styles.emptyText}>Loading WhatsApp calls...</Text>
            </View>
          ) : waGrouped.sections.length === 0 ? (
            <View style={styles.emptyBox}>
              <Text style={styles.emptyTitleText}>No Data</Text>
              <Text style={styles.emptyText}>No WhatsApp call history recorded</Text>
            </View>
          ) : (
            waGrouped.sections.map((section) => (
              <View key={`wa_sec_${section.title || 'all'}`} style={styles.sectionContainer}>
                {section.data.map((item) =>
                  renderCallCardItem(item, true, item.id === waGrouped.newestId)
                )}
              </View>
            ))
          )
        )}

        {/* CELLULAR PHONE CALLS LIST */}
        {activeTab === 'phone' && (
          <>
            {Platform.OS === 'android' && (
              <View style={styles.syncBannerCard}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.syncBannerTitle}>Android Device Call Logs</Text>
                 
                </View>
                <TouchableOpacity
                  style={styles.syncBannerBtn}
                  onPress={loadRealAndroidCalls}
                  disabled={isSyncingCalls}
                  activeOpacity={0.8}
                >
                  {isSyncingCalls ? (
                    <ActivityIndicator size="small" color={COLORS.bgWhite} />
                  ) : (
                    <Text style={styles.syncBannerBtnText}>
                      {realPhoneCalls.length > 0 ? 'Sync Logs' : 'Grant Permission'}
                    </Text>
                  )}
                </TouchableOpacity>
              </View>
            )}

            {phoneGrouped.sections.length === 0 ? (
              <View style={styles.emptyBox}>
                <Text style={styles.emptyTitleText}>No Data</Text>
                <Text style={styles.emptyText}>No phone call history found</Text>
              </View>
            ) : (
              phoneGrouped.sections.map((section) => (
                <View key={`phone_sec_${section.title || 'all'}`} style={styles.sectionContainer}>
                  {section.data.map((item) =>
                    renderCallCardItem(item, false, item.id === phoneGrouped.newestId)
                  )}
                </View>
              ))
            )}
          </>
        )}
      </ScrollView>

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
            Platform.OS === 'android' && keyboardHeight > 0
              ? { paddingBottom: keyboardHeight }
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

            {selectedCall && (
              <ScrollView
                ref={modalScrollRef}
                style={{ maxHeight: modalScrollMaxHeight }}
                contentContainerStyle={{
                  paddingBottom: keyboardHeight > 0 ? 120 : 36,
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
                        {selectedCall.customerName || 'Customer'}
                      </Text>
                    </View>

                    {/* Phone Number */}
                    <View style={styles.infoDetailRow}>
                      <Text style={styles.infoDetailLabel}>Phone Number :</Text>
                      <Text style={styles.infoDetailValue}>
                        {selectedCall.phoneNumber || 'N/A'}
                      </Text>
                    </View>

                    {/* Call Date from Call List */}
                    <View style={styles.infoDetailRow}>
                      <Text style={styles.infoDetailLabel}>Date :</Text>
                      <Text style={styles.infoDetailValue}>
                        {getCallDateDisplay(selectedCall)}
                      </Text>
                    </View>

                    {/* Call Time from Call List */}
                    <View style={styles.infoDetailRow}>
                      <Text style={styles.infoDetailLabel}>Time :</Text>
                      <Text style={styles.infoDetailValue}>
                        {getCallTimeDisplay(selectedCall)}
                      </Text>
                    </View>

                    {/* Event Type */}
                    <View style={styles.infoDetailRow}>
                      <Text style={styles.infoDetailLabel}>Event Type :</Text>
                      <Text style={styles.infoDetailValue}>
                        {activeTab === 'whatsapp' ? 'WhatsappCall':'PhoneCall'}
                      </Text>
                    </View>

                    {/* Event Description */}
                    <View style={[styles.infoDetailRow, { borderBottomWidth: 0, paddingBottom: 0 }]}>
                      <Text style={styles.infoDetailLabel}>Event description :</Text>
                      <Text style={styles.infoDetailDescValue}>
                        {getEventDescription(selectedCall)}
                      </Text>
                    </View>
                  </View>
                </View>

                {/* Date & Time Row (placed above Our Notes) */}
                <View style={styles.dateTimeRow}>
                  <View style={styles.dateTimeCol}>
                    <Text style={styles.fieldHeading}>Create Task Date :</Text>
                    <View style={styles.dateTimeInputContainer}>
                      <Icon name="calendar" size={14} color={COLORS.primary} />
                      <TextInput
                        style={styles.dateTimeInput}
                        value={dueDate}
                        onChangeText={setDueDate}
                        placeholder="DD/MM/YYYY"
                        placeholderTextColor={COLORS.textSubtle}
                        onFocus={() => {
                          setTimeout(() => {
                            modalScrollRef.current?.scrollTo({ y: 160, animated: true });
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
                            modalScrollRef.current?.scrollTo({ y: 160, animated: true });
                          }, 180);
                        }}
                      />
                    </View>
                  </View>
                </View>

                {/* Our Notes: min 5 line max 10 lines */}
                <View style={styles.formGroup}>
                  <Text style={styles.fieldHeading}>Our Notes:</Text>
                  <TextInput
                    style={styles.notesTextarea}
                    value={staffNote}
                    onChangeText={setStaffNote}
                    placeholder="Write your Notes here (5 to 10 lines).."
                    placeholderTextColor={COLORS.textSubtle}
                    multiline={true}
                    numberOfLines={6}
                    textAlignVertical="top"
                    onFocus={() => {
                      setTimeout(() => {
                        modalScrollRef.current?.scrollToEnd({ animated: true });
                      }, 180);
                    }}
                  />
                </View>

                {/* asign task to : dropdown (default Unassigned, user1,user 2,admin) */}
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
                      {/* <View style={styles.dropdownTriggerAvatar}>
                        <Text style={styles.dropdownTriggerAvatarText}>
                          {assignedUser ? (assignedUser.name || 'U').charAt(0).toUpperCase() : '—'}
                        </Text>
                      </View> */}
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
                          {/* <View
                            style={[
                              styles.itemInitialCircle,
                              !assignedUser && styles.itemInitialCircleActive,
                            ]}
                          >
                            <Text
                              style={[
                                styles.itemInitialText,
                                !assignedUser && styles.itemInitialTextActive,
                              ]}
                            >
                              —
                            </Text>
                          </View> */}
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
                      {assignableMembers.length === 0 ? (
                        <View style={{ padding: 14, alignItems: 'center' }}>
                          <Text style={{ fontSize: 13, color: COLORS.textMuted }}>
                            No other users found
                          </Text>
                        </View>
                      ) : (
                        assignableMembers.map((member) => {
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
                                {/* <View
                                  style={[
                                    styles.itemInitialCircle,
                                    isSelected && styles.itemInitialCircleActive,
                                  ]}
                                >
                                  <Text
                                    style={[
                                      styles.itemInitialText,
                                      isSelected && styles.itemInitialTextActive,
                                    ]}
                                  >
                                    {(member.name || 'U').charAt(0).toUpperCase()}
                                  </Text>
                                </View> */}
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
            )}
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.bgLinen,
  },
  searchWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.inputBg,
    borderRadius: RADIUS.md,
    paddingHorizontal: 12,
    height: 38,
    borderWidth: 1,
    borderColor: COLORS.borderColor,
  },
  searchInput: {
    flex: 1,
    fontSize: 13,
    color: COLORS.textDark,
    marginLeft: 8,
    paddingVertical: 0,
  },
  tabSegmentContainer: {
    flexDirection: 'row',
    borderBottomWidth: 1.5,
    borderBottomColor: '#F1F5F9',
    marginBottom: 12,
  },
  tabSegment: {
    flex: 1,
    flexDirection: 'row',
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    position: 'relative',
  },
  tabActiveIndicator: {
    position: 'absolute',
    bottom: -1.5,
    left: 8,
    right: 8,
    height: 3,
    borderRadius: 2,
  },
  tabIndicatorWA: {
    backgroundColor: COLORS.whatsappGreen,
  },
  tabIndicatorPhone: {
    backgroundColor: COLORS.primaryNavy,
  },
  tabSegmentText: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.textMuted,
  },
  tabSegmentTextActiveWA: {
    color: COLORS.whatsappGreen,
    fontWeight: '800',
  },
  tabSegmentTextActivePhone: {
    color: COLORS.primaryNavy,
    fontWeight: '800',
  },
  scrollContent: {
    padding: SPACING.md,
    gap: SPACING.lg,
    paddingBottom: SPACING.xxxl,
  },
  sectionContainer: {
    gap: 10,
    marginBottom: 6,
  },
  callItemCard: {
    backgroundColor: COLORS.bgWhite,
    borderRadius: RADIUS.lg,
    padding: 12,
    borderWidth: 1,
    borderColor: COLORS.borderColor,
    shadowColor: COLORS.shadowColor,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 2,
    elevation: 1,
  },
  itemHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  itemUserCol: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
 
  itemAvatar: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  avatarGreenBg: {
    backgroundColor: '#DCFCE7',
  },
  avatarBlueBg: {
    backgroundColor: '#DBEAFE',
  },
  avatarRedBg: {
    backgroundColor: '#FEE2E2',
  },
  avatarInitialsText: {
    fontSize: 14,
    fontWeight: '800',
    color: COLORS.primaryNavy,
  },
  initialsRed: {
    color: '#B91C1C',
  },
  initialsGreen: {
    color: '#15803D',
  },
  initialsBlue: {
    color: '#1E40AF',
  },
  statusDotBadge: {
    position: 'absolute',
    bottom: -2,
    right: -2,
    width: 16,
    height: 16,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: COLORS.bgWhite,
  },
  dotGreen: {
    backgroundColor: COLORS.whatsappGreen,
  },
  dotBlue: {
    backgroundColor: '#2563EB',
  },
  dotRed: {
    backgroundColor: COLORS.accentRed,
  },
  userTextContainer: {
    flex: 1,
  },
  itemCustomerName: {
    fontSize: 15,
    fontWeight: '700',
    color: COLORS.textDark,
  },
  phoneMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 2,
    flexWrap: 'wrap',
  },
  itemPhoneText: {
    fontSize: 12,
    color: COLORS.textMuted,
  },
  timeCol: {
    alignItems: 'flex-end',
    gap: 4,
  },
  itemTimeText: {
    fontSize: 12,
    fontWeight: '700',
    color: COLORS.textDark,
  },
  videoBadge: {
    backgroundColor: 'rgba(26, 59, 113, 0.08)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: RADIUS.sm,
  },
  videoBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: COLORS.primary,
  },
  voiceBadge: {
    backgroundColor: 'rgba(37, 211, 102, 0.1)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: RADIUS.sm,
  },
  voiceBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#16A34A',
  },
  itemFooterRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: COLORS.inputBg,
  },
  statusPillGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  statusPill: {
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: RADIUS.full,
  },
  pillIncoming: {
    backgroundColor: '#DCFCE7',
  },
  pillOutgoing: {
    backgroundColor: '#E0F2FE',
  },
  pillMissed: {
    backgroundColor: '#FEE2E2',
  },
  statusPillText: {
    fontSize: 11,
    fontWeight: '700',
  },
  pillTextIncoming: {
    color: '#15803D',
  },
  pillTextOutgoing: {
    color: '#0369A1',
  },
  pillTextMissed: {
    color: '#B91C1C',
  },
  durationBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: COLORS.inputBg,
    paddingHorizontal: 7,
    paddingVertical: 2.5,
    borderRadius: RADIUS.sm,
  },
  durationText: {
    fontSize: 11,
    color: COLORS.textMuted,
    fontWeight: '600',
  },
  bottomTimeText: {
    fontSize: 11,
    fontWeight: '600',
    color: COLORS.textMuted,
    textAlign: 'right',
  },
  actionButtonsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  taskBtnPill: {
    backgroundColor: 'rgba(26, 59, 113, 0.08)',
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: RADIUS.full,
    borderWidth: 1,
    borderColor: COLORS.borderColor,
  },
  taskBtnText: {
    fontSize: 11,
    fontWeight: '700',
    color: COLORS.primary,
  },
  emptyBox: {
    paddingVertical: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyTitleText: {
    fontSize: 16,
    fontWeight: '800',
    color: COLORS.primaryNavy,
    marginBottom: 4,
  },
  emptyText: {
    fontSize: 12,
    color: COLORS.textMuted,
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
    maxHeight: '94%',
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
  fieldHeading: {
    fontSize: 13,
    fontWeight: '700',
    color: COLORS.primaryNavy,
    marginBottom: 6,
  },
  fieldLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: COLORS.textDark,
    marginBottom: 4,
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
  syncBannerCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#EFF6FF',
    borderRadius: RADIUS.lg,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#BFDBFE',
    gap: 10,
  },
  syncBannerTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: '#1E40AF',
  },
  syncBannerSub: {
    fontSize: 11,
    color: '#3B82F6',
    marginTop: 2,
  },
  syncBannerBtn: {
    backgroundColor: '#2563EB',
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: RADIUS.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  syncBannerBtnText: {
    color: COLORS.bgWhite,
    fontSize: 12,
    fontWeight: '700',
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
  dropdownTriggerAvatar: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: COLORS.primaryNavy,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dropdownTriggerAvatarText: {
    color: COLORS.bgWhite,
    fontSize: 12,
    fontWeight: '700',
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
  itemInitialCircle: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#E2E8F0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  itemInitialCircleActive: {
    backgroundColor: COLORS.primary,
  },
  itemInitialText: {
    fontSize: 12,
    fontWeight: '700',
    color: COLORS.textDark,
  },
  itemInitialTextActive: {
    color: COLORS.bgWhite,
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
  disconnectedContainer: {
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: SPACING.xl,
    paddingVertical: 50,
    backgroundColor: COLORS.bgWhite,
    marginHorizontal: SPACING.md,
    marginVertical: SPACING.lg,
    borderRadius: RADIUS.xl,
    borderWidth: 1,
    borderColor: COLORS.borderColor,
    shadowColor: COLORS.shadowColor,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.04,
    shadowRadius: 10,
    elevation: 2,
  },
  disconnectedIconCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: 'rgba(26, 59, 113, 0.07)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: SPACING.lg,
    borderWidth: 1.5,
    borderColor: 'rgba(26, 59, 113, 0.12)',
  },
  disconnectedTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: COLORS.primaryNavy,
    marginBottom: SPACING.xs,
    textAlign: 'center',
  },
  disconnectedSub: {
    fontSize: 14,
    color: COLORS.textMuted,
    textAlign: 'center',
    lineHeight: 21,
    marginBottom: SPACING.xl,
    maxWidth: 290,
  },
  linkDeviceButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    backgroundColor: COLORS.primaryNavy,
    paddingVertical: 14,
    paddingHorizontal: 26,
    borderRadius: RADIUS.lg,
    shadowColor: COLORS.primaryNavy,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 3,
  },
  linkDeviceButtonText: {
    color: COLORS.bgWhite,
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
});
