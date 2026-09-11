import React, { useState, useEffect, useCallback } from 'react';
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
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { COLORS, SPACING, RADIUS } from '../../constants/theme';
import { Icon } from '../../components/common/Icon';
import { useTaskStore, TeamMember } from '../../store/taskStore';
import { useAuthStore } from '../../store/authStore';
import apiClient from '../../services/api';
import {
  fetchAndroidCallLogs,
} from '../../services/callLogService';

export interface CallLogItem {
  id: string;
  customerName: string;
  phoneNumber: string;
  callType: 'incoming' | 'outgoing' | 'missed';
  mediaType: 'voice' | 'video';
  timestamp: string;
  duration?: string;
  avatar?: string;
}

/**
 * Robustly parses a timestamp string or number into a standard JavaScript Date.
 * Handles ISO strings ("2026-09-11 10:45:00"), Epoch milliseconds/seconds,
 * and relative string fallbacks ("Today, 10:45 AM").
 */
const parseCallDate = (rawTs: string | number): Date => {
  if (!rawTs) return new Date(0);
  if (typeof rawTs === 'number') {
    return rawTs > 1e11 ? new Date(rawTs) : new Date(rawTs * 1000);
  }

  const str = String(rawTs).trim();

  // If string contains only numbers (unix timestamp)
  if (/^\d+$/.test(str)) {
    const num = parseInt(str, 10);
    return str.length === 10 ? new Date(num * 1000) : new Date(num);
  }

  // Handle SQL datetime ("YYYY-MM-DD HH:mm:ss") -> convert to ISO UTC ("YYYY-MM-DDTHH:mm:ss.000Z")
  let normalized = str;
  if (/^\d{4}-\d{2}-\d{2}\s\d{2}:\d{2}:\d{2}/.test(normalized)) {
    normalized = normalized.replace(' ', 'T') + '.000Z';
  } else if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(normalized)) {
    normalized = normalized + '.000Z';
  }

  const d = new Date(normalized);
  if (!isNaN(d.getTime()) && d.getTime() > 0) return d;

  // Fallback: extract unix timestamp from string like "msg_call_1789109485"
  const matchMsgTs = str.match(/17\d{8,11}/);
  if (matchMsgTs) {
    const num = parseInt(matchMsgTs[0], 10);
    return matchMsgTs[0].length === 10 ? new Date(num * 1000) : new Date(num);
  }

  // Relative string fallbacks ("Today, 10:45 AM", "Yesterday, 8:20 PM")
  const now = new Date();
  if (normalized.toLowerCase().includes('today')) {
    const timePart = normalized.split(',')[1] || normalized.replace(/today/i, '');
    const parsedTime = new Date(`${now.toDateString()} ${timePart.trim()}`);
    if (!isNaN(parsedTime.getTime())) return parsedTime;
  } else if (normalized.toLowerCase().includes('yesterday')) {
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    const timePart = normalized.split(',')[1] || normalized.replace(/yesterday/i, '');
    const parsedTime = new Date(`${yesterday.toDateString()} ${timePart.trim()}`);
    if (!isNaN(parsedTime.getTime())) return parsedTime;
  }

  return new Date(0);
};

/**
 * Formats a Date object to 12-hour time string ("10:45 AM", "03:30 PM").
 */
const formatCallTime = (d: Date, rawFallback: string): string => {
  if (isNaN(d.getTime()) || d.getTime() === 0) return rawFallback || '';
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true });
};

/**
 * Returns date section title ("Today", "Yesterday", Day name e.g. "Tuesday", or "05 Sep 2026").
 */
const getDateCategory = (d: Date): string => {
  if (isNaN(d.getTime()) || d.getTime() === 0) return 'Older Calls';

  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const target = new Date(d.getFullYear(), d.getMonth(), d.getDate());

  const diffTime = today.getTime() - target.getTime();
  const diffDays = Math.round(diffTime / (1000 * 3600 * 24));

  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';

  if (diffDays > 1 && diffDays < 7) {
    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    return dayNames[d.getDay()];
  }

  const day = String(d.getDate()).padStart(2, '0');
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const month = monthNames[d.getMonth()];
  const year = d.getFullYear();
  return `${day} ${month} ${year}`;
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
    return `${hours}:${minutes} ${ampm}`;
  };

  const [taskTime, setTaskTime] = useState(getCurrentTimeStr());
  const [dueDate, setDueDate] = useState(getTodayDateStr());
  const [assignedUser, setAssignedUser] = useState<TeamMember | null>(null);

  const availableAssignMembers = teamMembers.filter((m) => {
    if (user) {
      if (user.id && String(m.id) === String(user.id)) return false;
      if (user.email && m.email && m.email.toLowerCase() === user.email.toLowerCase()) return false;
    }
    return true;
  });

  const loadWhatsAppCalls = async () => {
    setIsFetchingWACalls(true);
    try {
      const res = await apiClient.get('/api/whatsapp/call-logs');
      if (res.data && res.data.success && Array.isArray(res.data.data)) {
        const formatted: CallLogItem[] = res.data.data.map((item: any) => ({
          id: `wa_call_${item.id || item.callId}`,
          customerName: item.customerName || item.phoneNumber || 'Customer',
          phoneNumber: item.phoneNumber || '',
          callType: (item.callType || 'incoming').toLowerCase(),
          mediaType: item.mediaType || 'voice',
          timestamp: item.timestamp,
          duration: item.duration || undefined,
        }));
        setLiveWhatsAppCalls(formatted);
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
    loadWhatsAppCalls();
    if (Platform.OS === 'android') {
      loadRealAndroidCalls();
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadWhatsAppCalls();
      if (Platform.OS === 'android') {
        loadRealAndroidCalls();
      }
    }, [])
  );

  const handleOpenTaskModal = (call: CallLogItem) => {
    fetchTeamMembers();
    setAssignedUser(null);
    setDueDate(getTodayDateStr());
    setTaskTime(getCurrentTimeStr());
    setSelectedCall(call);
    const parsedDate = parseCallDate(call.timestamp);
    const timeStr = formatCallTime(parsedDate, call.timestamp);
    setStaffNote(`Follow up call with ${call.customerName} (${call.phoneNumber})`);
    setTaskModalVisible(true);
  };

  const handleSaveTask = async () => {
    if (!selectedCall) return;
    const parsedDate = parseCallDate(selectedCall.timestamp);
    const timeStr = formatCallTime(parsedDate, selectedCall.timestamp);
    const combinedDue = taskTime?.trim() ? `${dueDate.trim()} ${taskTime.trim()}` : dueDate.trim();

    await addTask({
      customerId: selectedCall.id,
      customerName: selectedCall.customerName,
      customerPhone: selectedCall.phoneNumber,
      originalMessage: `Call Log [${selectedCall.mediaType.toUpperCase()}]: ${selectedCall.callType} call at ${timeStr}${selectedCall.duration ? ` (Duration: ${selectedCall.duration})` : ''}`,
      staffNote: staffNote,
      dueDate: combinedDue,
      assignedToUserId: assignedUser ? assignedUser.id : null,
    });
    setAssignedUser(null);
    setTaskModalVisible(false);
    Alert.alert('Task Created 📌', `CRM Task scheduled for ${selectedCall.customerName}.`);
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
      const timeA = parseCallDate(a.timestamp).getTime();
      const timeB = parseCallDate(b.timestamp).getTime();
      return timeB - timeA;
    });

    const newestId = sorted.length > 0 ? sorted[0].id : undefined;

    // 2. Group into sections maintaining descending date order
    const sectionMap = new Map<string, CallLogItem[]>();

    sorted.forEach((call) => {
      const callDate = parseCallDate(call.timestamp);
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

  const renderCallCardItem = (item: CallLogItem, isWhatsApp: boolean, isNewest: boolean) => {
    const isMissed = item.callType === 'missed';
    const isIncoming = item.callType === 'incoming';
    const isOutgoing = item.callType === 'outgoing';

    const parsedDate = parseCallDate(item.timestamp);
    const displayTime = formatCallTime(parsedDate, item.timestamp);

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
        style={[
          styles.callItemCard,
          isNewest && styles.newestCallCardHighlight,
        ]}
      >
        {/* Top Info Row */}
        <View style={styles.itemHeaderRow}>
          {/* Avatar & Customer */}
          <View style={styles.itemUserCol}>
            <View
              style={[
                styles.itemAvatar,
                isWhatsApp ? styles.avatarGreenBg : styles.avatarBlueBg,
                isMissed && styles.avatarRedBg,
              ]}
            >
              <Text
                style={[
                  styles.avatarInitialsText,
                  isMissed && { color: COLORS.accentRed },
                ]}
              >
                {initials}
              </Text>
              <View
                style={[
                  styles.statusDotBadge,
                  isMissed ? styles.dotRed : isIncoming ? styles.dotGreen : styles.dotBlue,
                ]}
              >
                <Icon
                  name={isWhatsApp ? 'call' : 'phone'}
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
                {isNewest && (
                  <View style={styles.latestBadgePill}>
                    <Text style={styles.latestBadgeText}>LATEST</Text>
                  </View>
                )}
              </View>
              <Text style={styles.itemPhoneText}>{item.phoneNumber}</Text>
            </View>
          </View>

          {/* Time & Media Type */}
          <View style={styles.timeCol}>
            <Text style={styles.itemTimeText}>{displayTime || item.timestamp}</Text>
            {isWhatsApp && item.mediaType === 'video' ? (
              <View style={styles.videoBadge}>
                <Text style={styles.videoBadgeText}>🎥 Video</Text>
              </View>
            ) : null}
          </View>
        </View>

        {/* Bottom Meta & Action Bar */}
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
                  ? '↙ Missed call'
                  : isIncoming
                  ? '↓ Incoming call'
                  : '↑ Outgoing call'}
              </Text>
            </View>

            {/* Duration Display (Only if available in fetched data) */}
            {item.duration && item.duration.trim() !== '' ? (
              <View style={styles.durationBadge}>
                <Text style={styles.durationText}>Duration: {item.duration}</Text>
              </View>
            ) : null}
          </View>

          {/* Action Buttons */}
          <View style={styles.actionButtonsRow}>
            <TouchableOpacity
              style={styles.taskBtnPill}
              onPress={() => handleOpenTaskModal(item)}
              activeOpacity={0.75}
            >
              <Text style={styles.taskBtnText}>📌 + Task</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    );
  };

  return (
    <View style={styles.container}>
      {/* Top Header */}
      <View style={[styles.header, { paddingTop: Math.max(insets.top, 20) + 12 }]}>
        <View style={styles.headerTopRow}>
          <TouchableOpacity
            style={styles.backButton}
            onPress={() => navigation.navigate('Home')}
            activeOpacity={0.7}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          >
            <Icon name="arrow-left" size={20} color={COLORS.primaryNavy} strokeWidth={2.5} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Calls</Text>
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

        {/* Segmented Filter Switch */}
        <View style={styles.tabSegmentContainer}>
          <TouchableOpacity
            style={[
              styles.tabSegment,
              activeTab === 'whatsapp' && styles.tabSegmentActiveWA,
            ]}
            onPress={() => setActiveTab('whatsapp')}
          >
            <Text
              style={[
                styles.tabSegmentText,
                activeTab === 'whatsapp' && styles.tabSegmentTextActiveWA,
              ]}
            >
              WhatsApp Calls 🟢 ({liveWhatsAppCalls.length})
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.tabSegment,
              activeTab === 'phone' && styles.tabSegmentActivePhone,
            ]}
            onPress={() => setActiveTab('phone')}
          >
            <Text
              style={[
                styles.tabSegmentText,
                activeTab === 'phone' && styles.tabSegmentTextActivePhone,
              ]}
            >
              Phone Calls 📞 ({realPhoneCalls.length})
            </Text>
          </TouchableOpacity>
        </View>
      </View>

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
          waGrouped.sections.length === 0 ? (
            <View style={styles.emptyBox}>
              <Text style={styles.emptyTitleText}>No Data</Text>
              <Text style={styles.emptyText}>No WhatsApp call history recorded</Text>
            </View>
          ) : (
            waGrouped.sections.map((section) => (
              <View key={`wa_sec_${section.title}`} style={styles.sectionContainer}>
                <View style={styles.sectionHeaderRow}>
                  <Text style={styles.sectionHeaderText}>{section.title}</Text>
                  <View style={styles.sectionHeaderDivider} />
                </View>
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
                  <Text style={styles.syncBannerSub}>
                    {realPhoneCalls.length > 0
                      ? `Synced ${realPhoneCalls.length} real call logs directly from device`
                      : 'Tap button to sync real call history from your Android phone'}
                  </Text>
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
                <View key={`phone_sec_${section.title}`} style={styles.sectionContainer}>
                  <View style={styles.sectionHeaderRow}>
                    <Text style={styles.sectionHeaderText}>{section.title}</Text>
                    <View style={styles.sectionHeaderDivider} />
                  </View>
                  {section.data.map((item) =>
                    renderCallCardItem(item, false, item.id === phoneGrouped.newestId)
                  )}
                </View>
              ))
            )}
          </>
        )}
      </ScrollView>

      {/* Convert Call to CRM Task Modal */}
      <Modal
        visible={taskModalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setTaskModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Convert Call to Task 📌</Text>
              <TouchableOpacity onPress={() => setTaskModalVisible(false)}>
                <Text style={styles.modalCloseText}>✕</Text>
              </TouchableOpacity>
            </View>

            {selectedCall && (
              <ScrollView style={{ maxHeight: 460 }} showsVerticalScrollIndicator={false}>
                <View style={styles.formGroup}>
                  <Text style={styles.formLabel}>Customer</Text>
                  <Text style={styles.readOnlyCustomer}>
                    {selectedCall.customerName} ({selectedCall.phoneNumber})
                  </Text>
                </View>

                <View style={styles.formGroup}>
                  <Text style={styles.formLabel}>Call Event</Text>
                  <View style={styles.quoteBoxModal}>
                    <Text style={styles.quoteBoxText}>
                      {selectedCall.callType.toUpperCase()} Call at{' '}
                      {formatCallTime(parseCallDate(selectedCall.timestamp), selectedCall.timestamp)}
                      {selectedCall.duration ? ` (Duration: ${selectedCall.duration})` : ''}
                    </Text>
                  </View>
                </View>

                <View style={styles.formGroup}>
                  <Text style={styles.formLabel}>Notes</Text>
                  <TextInput
                    style={[styles.formInput, { height: 75, textAlignVertical: 'top' }]}
                    value={staffNote}
                    onChangeText={setStaffNote}
                    multiline
                  />
                </View>

                <View style={styles.formGroup}>
                  <Text style={styles.formLabel}>Due Date</Text>
                  <TextInput
                    style={styles.formInput}
                    value={dueDate}
                    onChangeText={setDueDate}
                    placeholder="DD/MM/YYYY"
                    placeholderTextColor={COLORS.textSubtle}
                  />
                </View>

                <View style={styles.formGroup}>
                  <Text style={styles.formLabel}>Time</Text>
                  <TextInput
                    style={styles.formInput}
                    value={taskTime}
                    onChangeText={setTaskTime}
                    placeholder="6:48 pm"
                    placeholderTextColor={COLORS.textSubtle}
                  />
                </View>

                {/* Assign Task To */}
                <View style={styles.formGroup}>
                  <Text style={styles.formLabel}>Assign Task To</Text>
                  <View style={styles.assignChipsContainer}>
                    <TouchableOpacity
                      style={[styles.assignChip, !assignedUser && styles.assignChipActive]}
                      onPress={() => setAssignedUser(null)}
                      activeOpacity={0.7}
                    >
                      <Text style={[styles.assignChipText, !assignedUser && styles.assignChipTextActive]}>
                        Unassigned
                      </Text>
                      {!assignedUser ? (
                        <Icon name="check" size={12} color={COLORS.primary} strokeWidth={3} />
                      ) : null}
                    </TouchableOpacity>

                    {availableAssignMembers.map((member) => {
                      const isSelected = assignedUser?.id === member.id;
                      return (
                        <TouchableOpacity
                          key={member.id}
                          style={[styles.assignChip, isSelected && styles.assignChipActive]}
                          onPress={() => setAssignedUser(member)}
                          activeOpacity={0.7}
                        >
                          <View style={[styles.chipAvatar, isSelected && styles.chipAvatarActive]}>
                            <Text style={[styles.chipAvatarText, isSelected && styles.chipAvatarTextActive]}>
                              {(member.name || 'U').charAt(0).toUpperCase()}
                            </Text>
                          </View>
                          <Text style={[styles.assignChipText, isSelected && styles.assignChipTextActive]}>
                            {member.name}
                          </Text>
                          {isSelected ? (
                            <Icon name="check" size={12} color={COLORS.primary} strokeWidth={3} />
                          ) : null}
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </View>

                <TouchableOpacity style={styles.modalSubmitBtn} onPress={handleSaveTask}>
                  <Text style={styles.modalSubmitText}>Save</Text>
                </TouchableOpacity>
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.bgLinen,
  },
  header: {
    backgroundColor: COLORS.bgWhite,
    paddingHorizontal: SPACING.lg,
    paddingBottom: SPACING.md,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.borderColor,
  },
  headerTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
    gap: 10,
  },
  backButton: {
    paddingVertical: 4,
    paddingRight: 4,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: COLORS.primaryNavy,
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
    marginBottom: 12,
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
    backgroundColor: COLORS.inputBg,
    borderRadius: RADIUS.md,
    padding: 3,
    gap: 4,
  },
  tabSegment: {
    flex: 1,
    paddingVertical: 7,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: RADIUS.sm,
  },
  tabSegmentActiveWA: {
    backgroundColor: '#DCFCE7',
    borderWidth: 1,
    borderColor: '#86EFAC',
  },
  tabSegmentActivePhone: {
    backgroundColor: '#DBEAFE',
    borderWidth: 1,
    borderColor: '#93C5FD',
  },
  tabSegmentText: {
    fontSize: 11,
    fontWeight: '600',
    color: COLORS.textMuted,
  },
  tabSegmentTextActiveWA: {
    color: '#15803D',
    fontWeight: '800',
  },
  tabSegmentTextActivePhone: {
    color: '#1E40AF',
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
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 6,
    marginBottom: 2,
    gap: 10,
  },
  sectionHeaderText: {
    fontSize: 13,
    fontWeight: '800',
    color: COLORS.primaryNavy,
    letterSpacing: 0.3,
  },
  sectionHeaderDivider: {
    flex: 1,
    height: 1,
    backgroundColor: COLORS.borderColor,
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
  newestCallCardHighlight: {
    borderColor: '#86EFAC',
    borderWidth: 1.5,
    backgroundColor: '#FAFDFB',
  },
  itemHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
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
  latestBadgePill: {
    backgroundColor: '#DCFCE7',
    paddingHorizontal: 6,
    paddingVertical: 1.5,
    borderRadius: 4,
    borderWidth: 0.5,
    borderColor: '#86EFAC',
  },
  latestBadgeText: {
    fontSize: 9,
    fontWeight: '900',
    color: '#15803D',
    letterSpacing: 0.5,
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
    backgroundColor: COLORS.primaryNavy,
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
  itemPhoneText: {
    fontSize: 12,
    color: COLORS.textMuted,
    marginTop: 2,
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
    backgroundColor: COLORS.inputBg,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: RADIUS.sm,
  },
  durationText: {
    fontSize: 11,
    color: COLORS.textMuted,
    fontWeight: '600',
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
});
