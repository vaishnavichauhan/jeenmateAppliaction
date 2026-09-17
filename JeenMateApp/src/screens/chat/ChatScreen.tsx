import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
  View,
  Text,
  FlatList,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  RefreshControl,
  TextInput,
  Image,
  ActivityIndicator,
  Alert,
  Platform,
  Modal,
  KeyboardAvoidingView,
  Keyboard,
  Dimensions,
} from 'react-native';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useChatStore, Conversation, sortConversations } from '../../store/chatStore';
import { useWhatsAppStore } from '../../store/whatsappStore';
import { useTaskStore, TeamMember } from '../../store/taskStore';
import { useAuthStore } from '../../store/authStore';
import { COLORS, SPACING, RADIUS } from '../../constants/theme';
import { Icon } from '../../components/common/Icon';
import { Header } from '../../components/common/Header';

export const ChatScreen: React.FC = () => {
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();
  const {
    conversations,
    searchQuery,
    setSearchQuery,
    fetchConversations,
    setActiveConversation,
    whatsappStatus,
    syncWhatsAppChats,
    setupSocketListeners,
    isLoading,
    isSyncing,
    clearMessages,
  } = useChatStore();

  const { isConnected, fetchStatus: fetchWhatsAppStatus } = useWhatsAppStore();

  const [refreshing, setRefreshing] = useState(false);
  const [visibleCount, setVisibleCount] = useState(50);
  const [isInitialLoad, setIsInitialLoad] = useState(true);

  useEffect(() => {
    setVisibleCount(50);
  }, [searchQuery]);

  useEffect(() => {
    let isMounted = true;
    const init = async () => {
      setIsInitialLoad(true);
      await Promise.all([fetchWhatsAppStatus(), fetchConversations()]);
      if (isMounted) {
        setIsInitialLoad(false);
      }
      setupSocketListeners();
    };
    init();
    return () => {
      isMounted = false;
    };
  }, [fetchWhatsAppStatus, fetchConversations, setupSocketListeners]);

  useFocusEffect(
    useCallback(() => {
      let isMounted = true;
      Promise.all([fetchWhatsAppStatus(), fetchConversations()]).finally(() => {
        if (isMounted) {
          setIsInitialLoad(false);
        }
      });
      return () => {
        isMounted = false;
      };
    }, [fetchWhatsAppStatus, fetchConversations])
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await Promise.all([fetchWhatsAppStatus(), fetchConversations()]);
    setVisibleCount(50);
    setRefreshing(false);
  };

  const handleSyncChats = async () => {
    if (!isConnected) {
      Alert.alert('Device Not Linked', 'Please link your WhatsApp device first.', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Link Device', onPress: () => navigation.navigate('Link') },
      ]);
      return;
    }
    const res = await syncWhatsAppChats();
    Alert.alert(res.success ? 'Sync Completed' : 'Sync Info', res.message);
  };

  const handleOpenConversation = (conv: Conversation) => {
    clearMessages();
    setActiveConversation(conv);
    navigation.navigate('ChatDetail', { conversationId: conv.id, customerName: conv.customer_name });
  };

  const sortedConversations = sortConversations(conversations);
  const filteredConversations = sortedConversations.filter((c) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      c.customer_name.toLowerCase().includes(q) ||
      c.phone_number.includes(q) ||
      (c.last_message && c.last_message.toLowerCase().includes(q))
    );
  });

  const parseSafeDate = (dateStr?: string) => {
    if (!dateStr) return null;
    const str = String(dateStr).trim();
    if (!str || str === '2000-01-01 00:00:00' || str.startsWith('1970') || str.startsWith('2000-01-01')) return null;
    const normalized = str.includes('T') || str.endsWith('Z')
      ? (str.endsWith('Z') ? str : `${str}Z`)
      : `${str.replace(' ', 'T')}Z`;
    let d = new Date(normalized);
    if (!isNaN(d.getTime())) return d;
    d = new Date(str);
    return isNaN(d.getTime()) ? null : d;
  };

  const formatTimestamp = (dateStr?: string) => {
    const date = parseSafeDate(dateStr);
    if (!date) return '';

    const now = new Date();
    const isToday =
      date.getDate() === now.getDate() &&
      date.getMonth() === now.getMonth() &&
      date.getFullYear() === now.getFullYear();

    if (isToday) {
      return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true });
    }

    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    const isYesterday =
      date.getDate() === yesterday.getDate() &&
      date.getMonth() === yesterday.getMonth() &&
      date.getFullYear() === yesterday.getFullYear();

    if (isYesterday) {
      return 'Yesterday';
    }

    return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
  };

  const getConvDateDisplay = (dateStr?: string) => {
    const d = parseSafeDate(dateStr);
    if (!d) return getTodayDateStr();
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const year = d.getFullYear();
    return `${day}/${month}/${year}`;
  };

  const getConvTimeDisplay = (dateStr?: string) => {
    const d = parseSafeDate(dateStr);
    if (!d) return getCurrentTimeStr();
    return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true });
  };

  const getCleanMessagePreview = (msg?: string) => {
    if (!msg || !String(msg).trim()) return 'No messages yet';
    const raw = String(msg).trim();
    if (raw === '[revoked]') return '🚫 You deleted this message';
    if (raw.startsWith('/9j/') || (raw.length > 100 && /^[A-Za-z0-9+/=]+$/.test(raw.slice(0, 40)))) {
      return '📷 Photo';
    }
    const lower = raw.toLowerCase();
    if (lower.includes('video') && (lower.includes('call') || raw.includes('📹'))) {
      return lower.includes('missed') ? 'Missed video call' : 'Video call';
    }
    if (lower.includes('voice') || lower.includes('call') || raw === '[call_log]' || raw.includes('📞')) {
      return lower.includes('missed') ? 'Missed voice call' : 'Voice call';
    }
    if (raw === 'Images' || raw === 'Image' || raw === '🖼️ Image') return '📷 Photo';
    if (raw === 'Video' || raw === '🎥 Video') return '🎥 Video';
    if (raw === 'Voice message' || raw === '🎤 Voice Message' || raw === '🎤 Voice message') return '🎤 Voice message';
    if (raw === 'Document' || raw === '📄 Document') return '📄 Document';
    if (raw === 'Sticker' || raw === '🎭 Sticker') return '🏷️ Sticker';
    if (raw === 'Location' || raw === '📍 Location') return '📍 Location';
    if (raw === '[gp2]') return 'Group update';
    if (raw === '[e2e_notification]') return 'End-to-end encrypted';
    if (raw === '[notification_template]') return 'Notification';
    return raw;
  };

  // CRM Task Modal
  const { addTask, teamMembers, fetchTeamMembers } = useTaskStore();
  const { user } = useAuthStore();
  const [taskModalVisible, setTaskModalVisible] = useState(false);
  const [selectedConv, setSelectedConv] = useState<Conversation | null>(null);
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

  const availableAssignMembers = teamMembers.filter((m) => {
    if (user) {
      if (user.id && String(m.id) === String(user.id)) return false;
      if (user.email && m.email && m.email.toLowerCase() === user.email.toLowerCase()) return false;
    }
    return true;
  });

  const handleOpenTaskModalForConv = (conv: Conversation) => {
    fetchTeamMembers();
    setAssignedUser(null);
    setAssignDropdownOpen(false);
    setDueDate(getTodayDateStr());
    setTaskTime(getCurrentTimeStr());
    setSelectedConv(conv);
    setStaffNote('');
    setTaskModalVisible(true);
  };

  const handleSaveTask = async () => {
    if (!selectedConv || isSubmittingTask) return;
    setIsSubmittingTask(true);
    try {
      const combinedDue = taskTime?.trim() ? `${dueDate.trim()} ${taskTime.trim()}` : dueDate.trim();
      await addTask({
        customerId: selectedConv.id,
        customerName: selectedConv.customer_name,
        customerPhone: selectedConv.phone_number,
        originalMessage: selectedConv.last_message || 'WhatsApp Chat',
        staffNote: staffNote,
        dueDate: combinedDue,
        assignedToUserId: assignedUser ? assignedUser.id : null,
        eventType: 'WhatsappChat',
      });
      setAssignedUser(null);
      setTaskModalVisible(false);
      Alert.alert('Task Created 📌', `CRM task added for ${selectedConv.customer_name}.`);
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'Failed to create task');
    } finally {
      setIsSubmittingTask(false);
    }
  };

  const renderItem = ({ item }: { item: Conversation }) => {
    const initials = item.customer_name
      ? item.customer_name
          .split(' ')
          .map((n) => n[0])
          .slice(0, 2)
          .join('')
          .toUpperCase()
      : 'C';

    return (
      <TouchableOpacity
        style={styles.chatRow}
        onPress={() => handleOpenConversation(item)}
        activeOpacity={0.7}
      >
        {/* Avatar */}
        <View style={styles.avatarBox}>
          {item.avatar ? (
            <Image source={{ uri: item.avatar }} style={styles.avatarImage} />
          ) : (
            <View style={styles.avatarFallback}>
              <Text style={styles.avatarInitials}>{initials}</Text>
            </View>
          )}
        </View>

        {/* Info */}
        <View style={styles.chatInfo}>
          <View style={styles.chatInfoTop}>
            <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1, marginRight: SPACING.sm }}>
              <Text style={styles.customerName} numberOfLines={1}>
                {item.customer_name}
              </Text>
            </View>

            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Text style={styles.chatTime}>{formatTimestamp(item.last_message_at)}</Text>
              <TouchableOpacity
                style={styles.rightPinBtn}
                onPress={() => handleOpenTaskModalForConv(item)}
                activeOpacity={0.7}
              >
                <Text style={styles.rightPinBtnText}>📌</Text>
              </TouchableOpacity>
            </View>
          </View>

          <View style={styles.chatInfoBottom}>
            <Text style={styles.lastMessage} numberOfLines={1}>
              {getCleanMessagePreview(item.last_message)}
            </Text>

            {item.unread_count > 0 ? (
              <View style={styles.unreadBadge}>
                <Text style={styles.unreadText}>{item.unread_count}</Text>
              </View>
            ) : null}
          </View>
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <View style={styles.container}>
      {/* Reusable Top Header */}
      <Header
        title="WhatsApp Chats"
        onBack={() => {
          if (navigation.canGoBack()) {
            navigation.goBack();
          } else {
            navigation.navigate('ChatSelect');
          }
        }}
      />

      {/* If WhatsApp is disconnected, don't show chat list; show "Please link your device" */}
      {!isConnected ? (
        <View style={styles.disconnectedContainer}>
          <View style={styles.disconnectedIconCircle}>
            <Icon name="link" size={38} color={COLORS.primaryNavy} strokeWidth={2.2} />
          </View>
          <Text style={styles.disconnectedTitle}>Device Not Linked</Text>
          <Text style={styles.disconnectedSub}>
            Please link your WhatsApp account to view your chat list and live customer conversations.
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
      ) : isInitialLoad ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={COLORS.primary} />
          <Text style={styles.loadingText}>Loading conversations...</Text>
        </View>
      ) : (
        <>
          {/* Search Bar & Sync Action */}
          <View style={styles.searchContainer}>
            <View style={styles.searchWrapper}>
              <Icon name="search" size={16} color={COLORS.textMuted} />
              <TextInput
                style={styles.searchInput}
                placeholder="Search by customer name, phone..."
                placeholderTextColor={COLORS.textSubtle}
                value={searchQuery}
                onChangeText={setSearchQuery}
              />
              {searchQuery ? (
                <TouchableOpacity onPress={() => setSearchQuery('')}>
                  <Text style={styles.clearSearch}>✕</Text>
                </TouchableOpacity>
              ) : null}
            </View>

            <TouchableOpacity
              style={styles.syncIconButton}
              onPress={handleSyncChats}
              disabled={isSyncing}
              activeOpacity={0.7}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              {isSyncing ? (
                <ActivityIndicator size="small" color={COLORS.primary} />
              ) : (
                <Icon name="refresh" size={18} color={COLORS.primaryNavy} strokeWidth={2.2} />
              )}
            </TouchableOpacity>
          </View>

          {/* Conversation List */}
          <FlatList
            data={filteredConversations.slice(0, visibleCount)}
            keyExtractor={(item) => item.id}
            renderItem={renderItem}
            contentContainerStyle={styles.listContent}
            refreshControl={
              <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[COLORS.primary]} />
            }
            ItemSeparatorComponent={() => <View style={styles.separator} />}
            onEndReached={() => {
              if (visibleCount < filteredConversations.length) {
                setVisibleCount((prev) => prev + 10);
              }
            }}
            onEndReachedThreshold={0.5}
            ListFooterComponent={
              visibleCount < filteredConversations.length ? (
                <View style={styles.listFooterLoader}>
                  <ActivityIndicator size="small" color={COLORS.primary} />
                </View>
              ) : undefined
            }
            ListEmptyComponent={
              <View style={styles.emptyBox}>
                <Icon name="chat" size={44} color={COLORS.borderColor} />
                <Text style={styles.emptyTitle}>No Data</Text>
                <Text style={styles.emptySub}>
                  {searchQuery
                    ? 'No customer conversations matched your search.'
                    : 'No conversations available.'}
                </Text>
              </View>
            }
          />
        </>
      )}

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

            {selectedConv && (
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
                        {selectedConv.customer_name || 'Customer'}
                      </Text>
                    </View>

                    {/* Phone Number */}
                    <View style={styles.infoDetailRow}>
                      <Text style={styles.infoDetailLabel}>Phone Number :</Text>
                      <Text style={styles.infoDetailValue}>
                        {selectedConv.phone_number || 'N/A'}
                      </Text>
                    </View>

                    {/* Date */}
                    <View style={styles.infoDetailRow}>
                      <Text style={styles.infoDetailLabel}>Date :</Text>
                      <Text style={styles.infoDetailValue}>
                        {getConvDateDisplay(selectedConv.last_message_at)}
                      </Text>
                    </View>

                    {/* Time */}
                    <View style={styles.infoDetailRow}>
                      <Text style={styles.infoDetailLabel}>Time :</Text>
                      <Text style={styles.infoDetailValue}>
                        {getConvTimeDisplay(selectedConv.last_message_at)}
                      </Text>
                    </View>

                    {/* Event Type */}
                    <View style={styles.infoDetailRow}>
                      <Text style={styles.infoDetailLabel}>Event Type :</Text>
                      <Text style={styles.infoDetailValue}>WhatsappChat</Text>
                    </View>

                    {/* Event Description */}
                    <View style={[styles.infoDetailRow, { borderBottomWidth: 0, paddingBottom: 0 }]}>
                      <Text style={styles.infoDetailLabel}>Event description :</Text>
                      <Text style={styles.infoDetailDescValue} numberOfLines={2}>
                        {getCleanMessagePreview(selectedConv.last_message) || 'WhatsApp Chat'}
                      </Text>
                    </View>
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

                {/* Our Notes */}
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
    backgroundColor: COLORS.bgWhite,
  },
  syncIconButton: {
    width: 40,
    height: 40,
    borderRadius: RADIUS.md,
    backgroundColor: COLORS.inputBg,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: COLORS.borderColor,
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.sm,
    backgroundColor: COLORS.bgWhite,
    gap: 8,
  },
  searchWrapper: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.inputBg,
    borderRadius: RADIUS.md,
    paddingHorizontal: 12,
    height: 40,
    borderWidth: 1,
    borderColor: COLORS.borderColor,
    gap: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 13,
    color: COLORS.textDark,
  },
  clearSearch: {
    fontSize: 14,
    color: COLORS.textMuted,
    padding: 4,
  },
  listContent: {
    flexGrow: 1,
  },
  chatRow: {
    flexDirection: 'row',
    paddingHorizontal: SPACING.lg,
    paddingVertical: 14,
    alignItems: 'center',
    backgroundColor: COLORS.bgWhite,
  },
  avatarBox: {
    width: 48,
    height: 48,
    borderRadius: 24,
    overflow: 'hidden',
    backgroundColor: COLORS.bgLinen,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 14,
  },
  avatarImage: {
    width: '100%',
    height: '100%',
  },
  avatarFallback: {
    width: '100%',
    height: '100%',
    backgroundColor: COLORS.primaryNavy,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitials: {
    color: COLORS.bgWhite,
    fontSize: 16,
    fontWeight: '700',
  },
  chatInfo: {
    flex: 1,
  },
  chatInfoTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  customerName: {
    fontSize: 15,
    fontWeight: '700',
    color: COLORS.textDark,
    flex: 1,
    marginRight: 8,
  },
  chatTime: {
    fontSize: 11,
    color: COLORS.textMuted,
    fontWeight: '500',
  },
  chatInfoBottom: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  lastMessage: {
    fontSize: 13,
    color: COLORS.textMuted,
    flex: 1,
    marginRight: 10,
  },
  unreadBadge: {
    backgroundColor: COLORS.whatsappGreen,
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  unreadText: {
    color: COLORS.bgWhite,
    fontSize: 11,
    fontWeight: '800',
  },
  separator: {
    height: 1,
    backgroundColor: COLORS.borderColor,
    marginLeft: 76,
  },
  emptyBox: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 80,
    paddingHorizontal: 40,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.textDark,
    marginTop: 14,
  },
  emptySub: {
    fontSize: 13,
    color: COLORS.textMuted,
    textAlign: 'center',
    marginTop: 6,
    lineHeight: 18,
  },
  disconnectedContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: SPACING.xl,
    backgroundColor: COLORS.bgWhite,
  },
  disconnectedIconCircle: {
    width: 84,
    height: 84,
    borderRadius: 42,
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
    paddingVertical: 15,
    paddingHorizontal: 28,
    borderRadius: RADIUS.lg,
    shadowColor: COLORS.primaryNavy,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 4,
  },
  linkDeviceButtonText: {
    fontSize: 15,
    fontWeight: '700',
    color: COLORS.bgWhite,
    letterSpacing: 0.3,
  },
  rightPinBtn: {
    backgroundColor: 'rgba(26, 59, 113, 0.08)',
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: RADIUS.sm,
    borderWidth: 1,
    borderColor: COLORS.borderColor,
  },
  rightPinBtnText: {
    fontSize: 11,
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
  fieldHeading: {
    fontSize: 13,
    fontWeight: '700',
    color: COLORS.textDark,
    marginBottom: 6,
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
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 60,
  },
  loadingText: {
    marginTop: 12,
    fontSize: 14,
    color: COLORS.textMuted,
    fontWeight: '500',
  },
  listFooterLoader: {
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
