import React, { useEffect, useState, useCallback } from 'react';
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
} from 'react-native';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useChatStore, Conversation } from '../../store/chatStore';
import { useWhatsAppStore } from '../../store/whatsappStore';
import { useTaskStore, TeamMember } from '../../store/taskStore';
import { useAuthStore } from '../../store/authStore';
import { COLORS, SPACING, RADIUS } from '../../constants/theme';
import { Icon } from '../../components/common/Icon';

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
  } = useChatStore();

  const { isConnected, fetchStatus: fetchWhatsAppStatus } = useWhatsAppStore();

  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    fetchWhatsAppStatus();
    fetchConversations();
    setupSocketListeners();
  }, [fetchWhatsAppStatus, fetchConversations, setupSocketListeners]);

  useFocusEffect(
    useCallback(() => {
      fetchWhatsAppStatus();
      fetchConversations();
    }, [fetchWhatsAppStatus, fetchConversations])
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await Promise.all([fetchWhatsAppStatus(), fetchConversations()]);
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
    setActiveConversation(conv);
    navigation.navigate('ChatDetail', { conversationId: conv.id, customerName: conv.customer_name });
  };

  const filteredConversations = conversations.filter((c) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      c.customer_name.toLowerCase().includes(q) ||
      c.phone_number.includes(q) ||
      (c.last_message && c.last_message.toLowerCase().includes(q))
    );
  });

  const formatTimestamp = (dateStr?: string) => {
    if (!dateStr) return '';
    const normalized = dateStr.includes('T') || dateStr.endsWith('Z')
      ? (dateStr.endsWith('Z') ? dateStr : `${dateStr}Z`)
      : `${dateStr.replace(' ', 'T')}Z`;
    const date = new Date(normalized);
    if (isNaN(date.getTime())) return '';

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

  const getCleanMessagePreview = (msg?: string) => {
    if (!msg) return 'No messages yet';
    if (msg.startsWith('/9j/') || (msg.length > 100 && /^[A-Za-z0-9+/=]+$/.test(msg.slice(0, 40)))) {
      return '📷 Photo';
    }
    if (msg === '[call_log]') return '📞 Call';
    if (msg === '[gp2]') return 'Group update';
    if (msg === '[e2e_notification]') return 'End-to-end encrypted';
    if (msg === '[notification_template]') return 'Notification';
    return msg;
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

  const handleOpenTaskModalForConv = (conv: Conversation) => {
    fetchTeamMembers();
    setAssignedUser(null);
    setDueDate(getTodayDateStr());
    setTaskTime(getCurrentTimeStr());
    setSelectedConv(conv);
    setStaffNote(`Follow up on chat with ${conv.customer_name}`);
    setTaskModalVisible(true);
  };

  const handleSaveTask = async () => {
    if (!selectedConv) return;
    const combinedDue = taskTime?.trim() ? `${dueDate.trim()} ${taskTime.trim()}` : dueDate.trim();
    await addTask({
      customerId: selectedConv.id,
      customerName: selectedConv.customer_name,
      customerPhone: selectedConv.phone_number,
      originalMessage: selectedConv.last_message || 'WhatsApp Chat',
      staffNote: staffNote,
      dueDate: combinedDue,
      assignedToUserId: assignedUser ? assignedUser.id : null,
    });
    setAssignedUser(null);
    setTaskModalVisible(false);
    Alert.alert('Task Created 📌', `CRM task added for ${selectedConv.customer_name}.`);
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
              {item.is_pinned ? (
                <View style={{ marginLeft: 6 }}>
                  <Icon name="pin" size={12} color={COLORS.primaryNavy} />
                </View>
              ) : null}
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
      {/* Top Header */}
      <View style={[styles.header, { paddingTop: Math.max(insets.top, 20) + 12 }]}>
        <View style={styles.headerLeft}>
          <TouchableOpacity
            style={styles.backButton}
            onPress={() => navigation.navigate('Home')}
            activeOpacity={0.7}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          >
            <Icon name="arrow-left" size={20} color={COLORS.primaryNavy} strokeWidth={2.5} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>WhatsApp Chats</Text>
        </View>

        <TouchableOpacity
          style={styles.syncIconButton}
          onPress={handleSyncChats}
          disabled={isSyncing}
          activeOpacity={0.7}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          {isSyncing ? (
            <ActivityIndicator size="small" color={COLORS.primary} />
          ) : (
            <Icon name="refresh" size={18} color={COLORS.primaryNavy} strokeWidth={2.2} />
          )}
        </TouchableOpacity>
      </View>

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
      ) : (
        <>
          {/* Search Bar */}
          <View style={styles.searchContainer}>
            <View style={styles.searchWrapper}>
              <Icon name="search" size={16} color={COLORS.textMuted} />
              <TextInput
                style={styles.searchInput}
                placeholder="Search by customer name, phone, message..."
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
          </View>

          {/* Conversation List */}
          <FlatList
            data={filteredConversations}
            keyExtractor={(item) => item.id}
            renderItem={renderItem}
            contentContainerStyle={styles.listContent}
            refreshControl={
              <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[COLORS.primary]} />
            }
            ItemSeparatorComponent={() => <View style={styles.separator} />}
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

      {/* Convert Chat to Task Modal */}
      <Modal
        visible={taskModalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setTaskModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Convert Chat to Task 📌</Text>
              <TouchableOpacity onPress={() => setTaskModalVisible(false)}>
                <Text style={styles.modalCloseText}>✕</Text>
              </TouchableOpacity>
            </View>

            {selectedConv && (
              <ScrollView style={{ maxHeight: 460 }} showsVerticalScrollIndicator={false}>
                <View style={styles.formGroup}>
                  <Text style={styles.formLabel}>Customer</Text>
                  <Text style={styles.readOnlyCustomer}>
                    {selectedConv.customer_name} ({selectedConv.phone_number})
                  </Text>
                </View>

                <View style={styles.formGroup}>
                  <Text style={styles.formLabel}>Last Message</Text>
                  <View style={styles.quoteBoxModal}>
                    <Text style={styles.quoteBoxText}>"{selectedConv.last_message || 'WhatsApp Chat'}"</Text>
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
    backgroundColor: COLORS.bgWhite,
  },
  header: {
    paddingHorizontal: SPACING.lg,
    paddingTop: Platform.OS === 'ios' ? 12 : SPACING.sm,
    paddingBottom: SPACING.md,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: COLORS.borderColor,
    backgroundColor: COLORS.bgWhite,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: RADIUS.md,
    backgroundColor: COLORS.bgWhite,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: COLORS.borderColor,
    shadowColor: COLORS.shadowColor,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  headerTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: COLORS.primaryNavy,
    letterSpacing: -0.4,
  },
  syncIconButton: {
    width: 40,
    height: 40,
    borderRadius: RADIUS.md,
    backgroundColor: COLORS.bgWhite,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: COLORS.borderColor,
    shadowColor: COLORS.shadowColor,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  searchContainer: {
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.sm,
    backgroundColor: COLORS.bgWhite,
  },
  searchWrapper: {
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
