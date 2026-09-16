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
  Modal,
  Alert,
  ActivityIndicator,
  KeyboardAvoidingView,
  Keyboard,
  Dimensions,
  Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { useTaskStore, CRMTask, TeamMember } from '../../store/taskStore';
import { useAuthStore } from '../../store/authStore';
import { COLORS, SPACING, RADIUS } from '../../constants/theme';
import { Icon } from '../../components/common/Icon';

export const HomeScreen: React.FC = () => {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<any>();
  const { user } = useAuthStore();
  const isAdmin = user?.role === 'admin';
  const {
    tasks,
    counts,
    filter,
    setFilter,
    fetchTasks,
    toggleTaskStatus,
    deleteTask,
    addTask,
    assignTask,
    teamMembers,
    fetchTeamMembers,
    clearCompletedTasks,
    isRefreshing,
  } = useTaskStore();

  const [search, setSearch] = useState('');
  const [showAddModal, setShowAddModal] = useState(false);

  // Assign task modal state
  const [showAssignModal, setShowAssignModal] = useState(false);
  const [selectedTaskForAssign, setSelectedTaskForAssign] = useState<CRMTask | null>(null);
  const [assignSearch, setAssignSearch] = useState('');
  const [isAssigning, setIsAssigning] = useState(false);

  // New task form state
  const [newCustomerName, setNewCustomerName] = useState('');
  const [newCustomerPhone, setNewCustomerPhone] = useState('');
  const [newStaffNote, setNewStaffNote] = useState('');
  const [newDueDate, setNewDueDate] = useState(
    new Date(Date.now() + 24 * 3600 * 1000).toISOString().split('T')[0]
  );
  const [newAssignedUser, setNewAssignedUser] = useState<TeamMember | null>(null);
  const [newTaskTime, setNewTaskTime] = useState('');
  const [newAssignDropdownOpen, setNewAssignDropdownOpen] = useState(false);
  const [isCreatingTask, setIsCreatingTask] = useState(false);
  const addModalScrollRef = useRef<any>(null);
  const [addKeyboardHeight, setAddKeyboardHeight] = useState(0);

  // Helper: today's date as DD/MM/YYYY
  const getTodayDateStr = () => {
    const now = new Date();
    const dd = String(now.getDate()).padStart(2, '0');
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const yyyy = now.getFullYear();
    return `${dd}/${mm}/${yyyy}`;
  };

  // Helper: current time as h:mmam/pm
  const getCurrentTimeStr = () => {
    const now = new Date();
    const minutes = String(now.getMinutes()).padStart(2, '0');
    let hours = now.getHours();
    const ampm = hours >= 12 ? 'pm' : 'am';
    hours = hours % 12;
    hours = hours ? hours : 12;
    return `${hours}:${minutes}${ampm}`;
  };

  // Helper: parse call event info from original_message
  const parseCallEventInfo = (originalMessage?: string) => {
    if (!originalMessage || !originalMessage.trim()) return null;
    const msg = originalMessage.trim();
    if (!msg.startsWith('Call Log')) return null;

    const isVideo = msg.includes('[VIDEO]');
    let eventType = isVideo ? 'Video Call' : 'Phone Call';
    let eventIcon: 'video' | 'phone' = isVideo ? 'video' : 'phone';
    let eventColor = '#2563EB';

    const lower = msg.toLowerCase();
    if (lower.includes('missed call')) {
      eventType = isVideo ? 'Missed Video Call' : 'Missed Call';
      eventColor = '#DC2626';
    } else if (lower.includes('incoming call')) {
      eventType = isVideo ? 'Incoming Video Call' : 'Incoming Call';
      eventColor = '#059669';
    } else if (lower.includes('outgoing call')) {
      eventType = isVideo ? 'Outgoing Video Call' : 'Outgoing Call';
      eventColor = '#2563EB';
    }

    const timeMatch = msg.match(/at\s+(?:[0-9]{1,2}:[a-zA-Z]+,\s*)?([0-9]{1,2}:[0-9]{2}\s*(?:am|pm)?)/i);
    const callTime = timeMatch ? timeMatch[1] : null;

    const dateMatch = msg.match(/at\s+([0-9]{1,2}:[a-zA-Z]+)/i);
    const callDate = dateMatch ? dateMatch[1].replace(':', ' ') : null;

    const durationMatch = msg.match(/\(duration\s+([^)]+)\)/i);
    const duration = durationMatch ? durationMatch[1] : null;

    return {
      eventType,
      eventIcon,
      eventColor,
      callTime,
      callDate,
      duration,
    };
  };

  // Helper: separate date and time from due_date string (e.g. "16/09/2026 3:55pm")
  const parseDueDateAndTime = (dueStr?: string) => {
    if (!dueStr) return { date: null, time: null };
    const trimmed = dueStr.trim();
    const match = trimmed.match(/^(\d{1,2}[/-]\d{1,2}[/-]\d{2,4}|\d{4}-\d{2}-\d{2})\s*(.*)$/);
    if (match) {
      return {
        date: match[1],
        time: match[2]?.trim() || null,
      };
    }
    return { date: trimmed, time: null };
  };

  // Keyboard listener for add task modal
  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const showSub = Keyboard.addListener(showEvent, (e) => setAddKeyboardHeight(e.endCoordinates.height));
    const hideSub = Keyboard.addListener(hideEvent, () => setAddKeyboardHeight(0));
    return () => { showSub.remove(); hideSub.remove(); };
  }, []);

  const addScreenHeight = Dimensions.get('window').height;
  const addModalScrollMaxHeight = addKeyboardHeight > 0
    ? Math.max(220, addScreenHeight - addKeyboardHeight - 160)
    : Math.min(540, addScreenHeight * 0.72);

  useEffect(() => {
    fetchTasks();
  }, [fetchTasks]);

  useFocusEffect(
    useCallback(() => {
      fetchTasks();
    }, [fetchTasks])
  );

  const availableAssignMembers = teamMembers.filter((m) => {
    // Exclude own user from assign selection (e.g. if Tanmay logged in, don't show Tanmay)
    if (user) {
      if (user.id && String(m.id) === String(user.id)) return false;
      if (user.email && m.email && m.email.toLowerCase() === user.email.toLowerCase()) return false;
      if (user.name && m.name && m.name.toLowerCase().trim() === user.name.toLowerCase().trim()) return false;
    }
    return true;
  });

  const filteredTasks = tasks.filter((task) => {
    let matchesFilter = true;

    // Check if this task was assigned out by the current user to someone else
    const isAssignedOut = Boolean(
      task.assigned_to_name &&
      user?.id &&
      (String(task.assigned_by_id || task.created_by_id) === String(user.id)) &&
      (String(task.user_id) !== String(user.id) || String(task.assigned_to_id) !== String(user.id))
    );

    // Check if this task was assigned to current user by someone else (e.g. Admin assigned to Tanmay)
    const isAssignedToMe = Boolean(
      task.assigned_to_name &&
      user?.id &&
      String(task.user_id) === String(user.id) &&
      (
        (task.assigned_by_id && String(task.assigned_by_id) !== String(user.id)) ||
        (task.created_by_id && String(task.created_by_id) !== String(user.id)) ||
        (task.assigned_by_name && user.name && task.assigned_by_name.toLowerCase().trim() !== user.name.toLowerCase().trim()) ||
        (task.created_by_name && user.name && task.created_by_name.toLowerCase().trim() !== user.name.toLowerCase().trim())
      )
    );

    if (filter === 'pending') {
      matchesFilter = task.status === 'pending';
    } else if (filter === 'assigned') {
      // Both incoming assigned tasks (AssignBy: Admin) and outgoing assigned tasks (Assigned : Tanmay) show in Assign list!
      matchesFilter = (isAssignedOut || isAssignedToMe) && task.status !== 'completed';
    } else if (filter === 'completed') {
      matchesFilter = task.status === 'completed';
    } else {
      matchesFilter = true;
    }

    const matchesSearch =
      !search.trim() ||
      task.customer_name.toLowerCase().includes(search.toLowerCase()) ||
      task.customer_phone.includes(search) ||
      task.staff_note.toLowerCase().includes(search.toLowerCase()) ||
      task.original_message.toLowerCase().includes(search.toLowerCase());

    return matchesFilter && matchesSearch;
  });

  const handleDeleteTask = (task: CRMTask) => {
    Alert.alert(
      'Delete Task',
      `Are you sure you want to delete the task for "${task.customer_name}"?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => deleteTask(task.id),
        },
      ]
    );
  };

  const handleOpenCreateTask = () => {
    fetchTeamMembers();
    setNewAssignedUser(null);
    setNewAssignDropdownOpen(false);
    setNewDueDate(getTodayDateStr());
    setNewTaskTime(getCurrentTimeStr());
    setNewCustomerName('');
    setNewCustomerPhone('');
    setNewStaffNote('');
    setShowAddModal(true);
  };

  const handleCreateTask = async () => {
    if (isCreatingTask) return;
    try {
      setIsCreatingTask(true);
      const combinedDue = newTaskTime?.trim() ? `${newDueDate.trim()} ${newTaskTime.trim()}` : newDueDate.trim();

      await addTask({
        customerName: user?.name || 'Manual Task',
        customerPhone: 'N/A',
        staffNote: newStaffNote.trim(),
        dueDate: combinedDue,
        assignedToUserId: newAssignedUser ? newAssignedUser.id : null,
      });

      setNewCustomerName('');
      setNewCustomerPhone('');
      setNewStaffNote('');
      setNewAssignedUser(null);
      setNewAssignDropdownOpen(false);
      setShowAddModal(false);
      Alert.alert('Task Created', 'New task has been created successfully.');
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'Failed to create task');
    } finally {
      setIsCreatingTask(false);
    }
  };

  const handleOpenAssignModal = (task: CRMTask) => {
    setSelectedTaskForAssign(task);
    setAssignSearch('');
    fetchTeamMembers();
    setShowAssignModal(true);
  };

  const handleSelectMemberToAssign = async (member: TeamMember) => {
    if (!selectedTaskForAssign) return;
    try {
      setIsAssigning(true);
      await assignTask(selectedTaskForAssign.id, member.id);
      Alert.alert(
        'Task Assigned',
        `Task for "${selectedTaskForAssign.customer_name}" has been assigned to ${member.name}.`
      );
      setShowAssignModal(false);
      setSelectedTaskForAssign(null);
    } catch (error: any) {
      Alert.alert('Error', error.message || 'Failed to assign task');
    } finally {
      setIsAssigning(false);
    }
  };

  const filteredTeamMembers = availableAssignMembers.filter((m) => {
    const q = assignSearch.trim().toLowerCase();
    if (!q) return true;
    return (
      m.name.toLowerCase().includes(q) ||
      m.email.toLowerCase().includes(q) ||
      m.role.toLowerCase().includes(q)
    );
  });

  const renderTaskItem = ({ item }: { item: CRMTask }) => {
    const isDone = item.status === 'completed';
    const assignerId = item.assigned_by_id || item.created_by_id;
    const assignerRawName = item.assigned_by_name || item.created_by_name;
    const isAssignedByOther = Boolean(
      item.assigned_to_name && (
        (assignerId && user?.id && String(assignerId) !== String(user.id)) ||
        (assignerRawName && user?.name && assignerRawName.toLowerCase().trim() !== user.name.toLowerCase().trim())
      )
    );

    const formatAssignerName = (rawName?: string) => {
      if (!rawName) return 'Admin';
      if (rawName.toLowerCase() === 'support admin') return 'Admin';
      return rawName;
    };

    const assignerDisplay = formatAssignerName(assignerRawName);
    const eventInfo = parseCallEventInfo(item.original_message);
    const { date: dueDatePart, time: dueTimePart } = parseDueDateAndTime(item.due_date);
    const displayDate = dueDatePart || eventInfo?.callDate || null;
    const displayTime = dueTimePart || eventInfo?.callTime || null;

    return (
      <View style={[styles.taskCard, isDone && styles.taskCardCompleted]}>
        {/* Top Accent Strip */}
        <View style={[styles.taskAccentStrip, isDone ? styles.taskAccentDone : styles.taskAccentPending]} />

        <View style={styles.taskCardInner}>
          {/* Row 1: Checkbox + Name + Status + Delete */}
          <View style={styles.taskCardHeader}>
            <TouchableOpacity
              style={[styles.checkbox, isDone && styles.checkboxCompleted]}
              onPress={() => toggleTaskStatus(item.id)}
              activeOpacity={0.7}
            >
              {isDone ? <Icon name="check" size={14} color={COLORS.bgWhite} strokeWidth={3} /> : null}
            </TouchableOpacity>

            <View style={styles.customerInfo}>
              <Text style={[styles.customerName, isDone && styles.textCompleted]} numberOfLines={1}>
                {item.customer_name}
              </Text>
              {item.customer_phone && item.customer_phone !== 'N/A' ? (
                <Text style={styles.customerPhone} numberOfLines={1}>{item.customer_phone}</Text>
              ) : null}
            </View>

            <View style={[styles.statusBadge, isDone ? styles.badgeDone : styles.badgePending]}>
              <View style={[styles.statusDot, isDone ? styles.statusDotDone : styles.statusDotPending]} />
              <Text style={[styles.statusBadgeText, isDone ? styles.textDone : styles.textPending]}>
                {isDone ? 'Done' : 'Pending'}
              </Text>
            </View>

            <TouchableOpacity
              style={styles.deleteIconButton}
              onPress={() => handleDeleteTask(item)}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Icon name="trash" size={16} color="#94A3B8" />
            </TouchableOpacity>
          </View>

          {/* Row 2: Event Details (Event Type, Date, Time) - Only show event type if available */}
          {(eventInfo || displayDate || displayTime) ? (
            <View style={styles.eventDetailsRow}>
              {/* Event Type (Only show if available, not shown for self-added tasks) */}
              {eventInfo?.eventType ? (
                <View style={[styles.eventTypeBadge, { backgroundColor: eventInfo.eventColor + '12', borderColor: eventInfo.eventColor + '30' }]}>
                  <Icon name={eventInfo.eventIcon} size={11} color={eventInfo.eventColor} />
                  <Text style={[styles.eventTypeText, { color: eventInfo.eventColor }]}>
                    {eventInfo.eventType}
                  </Text>
                </View>
              ) : null}

              {/* Date */}
              {displayDate ? (
                <View style={styles.eventMetaBadge}>
                  <Icon name="calendar" size={11} color="#64748B" />
                  <Text style={styles.eventMetaText}>{displayDate}</Text>
                </View>
              ) : null}

              {/* Time */}
              {displayTime ? (
                <View style={styles.eventMetaBadge}>
                  <Icon name="clock" size={11} color="#64748B" />
                  <Text style={styles.eventMetaText}>{displayTime}</Text>
                </View>
              ) : null}

              {/* Call Duration if available */}
              {eventInfo?.duration ? (
                <View style={styles.durationBadge}>
                  <Text style={styles.durationBadgeText}>{eventInfo.duration}</Text>
                </View>
              ) : null}
            </View>
          ) : null}

          {/* Staff Note */}
          {item.staff_note ? (
            <View style={styles.noteBox}>
              <View style={styles.noteIconRow}>
                <Icon name="edit" size={12} color={COLORS.primary} />
                <Text style={styles.noteLabel}>Note</Text>
              </View>
              <Text style={styles.noteText} numberOfLines={3}>{item.staff_note}</Text>
            </View>
          ) : null}

          {/* Original Message (Only show if real user message, not raw Call Log text) */}
          {item.original_message && !item.original_message.startsWith('Call Log') ? (
            <View style={styles.quoteBox}>
              <Text style={styles.quoteText} numberOfLines={2}>
                "{item.original_message}"
              </Text>
            </View>
          ) : null}

          {/* Footer: Assign info */}
          <View style={styles.taskFooter}>
            <View style={styles.footerLeft}>
              {isAssignedByOther ? (
                <View style={styles.assignedByPill}>
                  <Text style={styles.assignedByPillText}>by {assignerDisplay}</Text>
                </View>
              ) : null}
            </View>

            {item.assigned_to_name ? (
              <View style={styles.assignedRightPill}>
                <Icon name="user" size={11} color={COLORS.primary} />
                <Text style={styles.assignedRightLabel}>
                  Assigned:<Text style={styles.assignedRightName}>{item.assigned_to_name}</Text>
                </Text>
              </View>
            ) : (
              <TouchableOpacity
                style={styles.assignButton}
                onPress={() => handleOpenAssignModal(item)}
                activeOpacity={0.7}
              >
                <Icon name="user-plus" size={12} color={COLORS.primary} />
                <Text style={styles.assignButtonText}>Assign</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      </View>
    );
  };

  return (
    <View style={styles.container}>
      {/* Header Bar */}
      <View style={[styles.header, { paddingTop: Math.max(insets.top, 20) + 12 }]}>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>JeenMate</Text>
          <Text style={styles.headerGreeting}>
            👋 Hello, <Text style={styles.headerUserName}>{user?.name || 'User'}</Text>
          </Text>
        </View>
        {/* User Avatar */}
        <View style={styles.userAvatarCircle}>
          <Text style={styles.userAvatarText}>
            {(user?.name || 'U').charAt(0).toUpperCase()}
          </Text>
        </View>
      </View>

      {/* Admin – Create User Section */}
      {isAdmin && (
        <View style={styles.adminSection}>
          <View style={styles.adminSectionLeft}>
            <View style={styles.adminIconBox}>
              <Icon name="users" size={18} color={COLORS.primary} />
            </View>
            <View>
              <Text style={styles.adminSectionTitle}>Team Management</Text>
              <Text style={styles.adminSectionSub}>Add new staff members</Text>
            </View>
          </View>
          <TouchableOpacity
            style={styles.createUserBtn}
            onPress={() => navigation.navigate('CreateUser')}
            activeOpacity={0.8}
          >
            <Icon name="user-plus" size={14} color={COLORS.bgWhite} strokeWidth={2.5} />
            <Text style={styles.createUserBtnText}>Create User</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Summary Metrics Chips (Pending, Assign, Completed, Total) */}
      <View style={styles.metricsContainer}>
        <TouchableOpacity
          style={[styles.metricCard, filter === 'pending' && styles.metricCardActive]}
          onPress={() => setFilter('pending')}
        >
          <Text style={[styles.metricNumber, { color: COLORS.primary }]}>{counts.pending}</Text>
          <Text style={styles.metricLabel}>Pending</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.metricCard, filter === 'assigned' && styles.metricCardActive]}
          onPress={() => setFilter('assigned')}
        >
          <Text style={[styles.metricNumber, { color: '#8B5CF6' }]}>{counts.assigned || 0}</Text>
          <Text style={styles.metricLabel}>Assign</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.metricCard, filter === 'completed' && styles.metricCardActive]}
          onPress={() => setFilter('completed')}
        >
          <Text style={[styles.metricNumber, { color: COLORS.whatsappGreen }]}>{counts.completed}</Text>
          <Text style={styles.metricLabel}>Completed</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.metricCard, filter === 'all' && styles.metricCardActive]}
          onPress={() => setFilter('all')}
        >
          <Text style={styles.metricNumber}>{counts.total}</Text>
          <Text style={styles.metricLabel}>Total</Text>
        </TouchableOpacity>
      </View>

      {/* Search & Action Bar */}
      <View style={styles.searchBarContainer}>
        <View style={styles.searchInputWrapper}>
          <Icon name="search" size={16} color={COLORS.textMuted} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search tasks..."
            placeholderTextColor={COLORS.textSubtle}
            value={search}
            onChangeText={setSearch}
          />
        </View>

        {counts.completed > 0 ? (
          <TouchableOpacity
            style={styles.clearCompletedBtn}
            onPress={() => {
              Alert.alert(
                'Clear Completed',
                'Remove all completed tasks from the list?',
                [
                  { text: 'Cancel', style: 'cancel' },
                  { text: 'Clear', style: 'destructive', onPress: clearCompletedTasks },
                ]
              );
            }}
          >
            <Text style={styles.clearCompletedText}>Clear All</Text>
          </TouchableOpacity>
        ) : null}

        <TouchableOpacity
          style={styles.actionAddButton}
          onPress={handleOpenCreateTask}
          activeOpacity={0.8}
        >
          <Icon name="plus" size={15} color={COLORS.bgWhite} strokeWidth={2.5} />
          <Text style={styles.actionAddButtonText}>Add Task</Text>
        </TouchableOpacity>
      </View>

      {/* Tasks List */}
      <FlatList
        data={filteredTasks}
        keyExtractor={(item) => item.id}
        renderItem={renderTaskItem}
        contentContainerStyle={styles.listContent}
        refreshControl={
          <RefreshControl refreshing={isRefreshing} onRefresh={fetchTasks} colors={[COLORS.primary]} />
        }
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Icon name="check-double" size={44} color={COLORS.borderColor} />
            <Text style={styles.emptyTitle}>No Data</Text>
            <Text style={styles.emptySub}>
              {search
                ? 'No tasks matched your search query.'
                : 'No tasks available.'}
            </Text>
          </View>
        }
      />

      {/* Add Task Modal */}
      <Modal
        visible={showAddModal}
        transparent
        animationType="slide"
        onRequestClose={() => {
          Keyboard.dismiss();
          setShowAddModal(false);
        }}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={[
            styles.modalOverlay,
            Platform.OS === 'android' && addKeyboardHeight > 0
              ? { paddingBottom: addKeyboardHeight }
              : null,
          ]}
        >
          <TouchableOpacity
            style={StyleSheet.absoluteFill}
            activeOpacity={1}
            onPress={() => {
              Keyboard.dismiss();
              if (newAssignDropdownOpen) setNewAssignDropdownOpen(false);
            }}
          />
          <View style={[styles.modalCard, { maxHeight: '94%' }]}>
            {/* Header */}
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Create New Task 📌</Text>
              <TouchableOpacity
                onPress={() => {
                  Keyboard.dismiss();
                  setShowAddModal(false);
                }}
                hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              >
                <Text style={styles.modalCloseText}>✕</Text>
              </TouchableOpacity>
            </View>

            <ScrollView
              ref={addModalScrollRef}
              style={{ maxHeight: addModalScrollMaxHeight }}
              contentContainerStyle={{
                paddingBottom: addKeyboardHeight > 0 ? 120 : 36,
                flexGrow: 1,
              }}
              showsVerticalScrollIndicator={true}
              keyboardShouldPersistTaps="handled"
              nestedScrollEnabled={true}
            >
              {/* Date & Time Row */}
              <View style={styles.dateTimeRow}>
                <View style={styles.dateTimeCol}>
                  <Text style={styles.fieldHeading}>Date :</Text>
                  <View style={styles.dateTimeInputContainer}>
                    <Icon name="calendar" size={14} color={COLORS.primary} />
                    <TextInput
                      style={styles.dateTimeInput}
                      value={newDueDate}
                      onChangeText={setNewDueDate}
                      placeholder="DD/MM/YYYY"
                      placeholderTextColor={COLORS.textSubtle}
                      onFocus={() => {
                        setTimeout(() => {
                          addModalScrollRef.current?.scrollTo({ y: 160, animated: true });
                        }, 180);
                      }}
                    />
                  </View>
                </View>

                <View style={styles.dateTimeCol}>
                  <Text style={styles.fieldHeading}>Time :</Text>
                  <View style={styles.dateTimeInputContainer}>
                    <Icon name="clock" size={14} color={COLORS.primary} />
                    <TextInput
                      style={styles.dateTimeInput}
                      value={newTaskTime}
                      onChangeText={setNewTaskTime}
                      placeholder="2:37pm"
                      placeholderTextColor={COLORS.textSubtle}
                      onFocus={() => {
                        setTimeout(() => {
                          addModalScrollRef.current?.scrollTo({ y: 160, animated: true });
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
                  value={newStaffNote}
                  onChangeText={setNewStaffNote}
                  placeholder="Write your Notes here (5 to 10 lines).."
                  placeholderTextColor={COLORS.textSubtle}
                  multiline={true}
                  numberOfLines={6}
                  textAlignVertical="top"
                  onFocus={() => {
                    setTimeout(() => {
                      addModalScrollRef.current?.scrollToEnd({ animated: true });
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
                    newAssignDropdownOpen && styles.dropdownTriggerActive,
                  ]}
                  onPress={() => {
                    Keyboard.dismiss();
                    fetchTeamMembers();
                    setNewAssignDropdownOpen(!newAssignDropdownOpen);
                  }}
                  activeOpacity={0.8}
                >
                  <View style={styles.dropdownTriggerLeft}>
                    <Text style={styles.dropdownTriggerText} numberOfLines={1}>
                      {newAssignedUser ? newAssignedUser.name : 'Unassigned'}
                    </Text>
                  </View>
                  <Icon
                    name={newAssignDropdownOpen ? 'chevron-up' : 'chevron-down'}
                    size={18}
                    color={COLORS.textDark}
                  />
                </TouchableOpacity>

                {newAssignDropdownOpen && (
                  <View style={styles.dropdownMenu}>
                    {/* Unassigned Option */}
                    <TouchableOpacity
                      style={[
                        styles.dropdownItem,
                        !newAssignedUser && styles.dropdownItemActive,
                      ]}
                      onPress={() => {
                        setNewAssignedUser(null);
                        setNewAssignDropdownOpen(false);
                      }}
                      activeOpacity={0.7}
                    >
                      <View style={styles.dropdownItemContent}>
                        <View>
                          <Text
                            style={[
                              styles.dropdownItemName,
                              !newAssignedUser && styles.dropdownItemNameActive,
                            ]}
                          >
                            Unassigned
                          </Text>
                          <Text style={styles.dropdownItemRole}>Default</Text>
                        </View>
                      </View>
                      {!newAssignedUser ? (
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
                        const isSelected = newAssignedUser?.id === member.id;
                        return (
                          <TouchableOpacity
                            key={member.id}
                            style={[
                              styles.dropdownItem,
                              isSelected && styles.dropdownItemActive,
                            ]}
                            onPress={() => {
                              setNewAssignedUser(member);
                              setNewAssignDropdownOpen(false);
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
                style={[styles.modalSubmitBtn, isCreatingTask && { opacity: 0.7 }]}
                onPress={handleCreateTask}
                disabled={isCreatingTask}
                activeOpacity={0.85}
              >
                {isCreatingTask ? (
                  <ActivityIndicator size="small" color={COLORS.bgWhite} />
                ) : (
                  <Text style={styles.modalSubmitText}>Submit</Text>
                )}
              </TouchableOpacity>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Assign Task Modal */}
      <Modal
        visible={showAssignModal}
        animationType="slide"
        transparent={true}
        onRequestClose={() => {
          if (!isAssigning) setShowAssignModal(false);
        }}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalCard, styles.assignModalCard]}>
            <View style={styles.modalHeader}>
              <View style={{ flex: 1 }}>
                <Text style={styles.modalTitle}>Assign Task</Text>
                {selectedTaskForAssign ? (
                  <Text style={styles.assignModalSub} numberOfLines={1}>
                    For: {selectedTaskForAssign.customer_name} ({selectedTaskForAssign.customer_phone})
                  </Text>
                ) : null}
              </View>
              <TouchableOpacity
                onPress={() => setShowAssignModal(false)}
                disabled={isAssigning}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
                <Text style={styles.modalCloseText}>✕</Text>
              </TouchableOpacity>
            </View>

            {/* Search Team Members Bar */}
            <View style={styles.assignSearchWrapper}>
              <Icon name="search" size={16} color={COLORS.textMuted} />
              <TextInput
                style={styles.assignSearchInput}
                placeholder="Search staff by name or email..."
                placeholderTextColor={COLORS.textSubtle}
                value={assignSearch}
                onChangeText={setAssignSearch}
                autoCapitalize="none"
              />
            </View>

            {isAssigning ? (
              <View style={styles.assignLoadingContainer}>
                <ActivityIndicator size="large" color={COLORS.primary} />
                <Text style={styles.assignLoadingText}>Assigning task...</Text>
              </View>
            ) : (
              <FlatList
                data={filteredTeamMembers}
                keyExtractor={(member) => String(member.id)}
                style={styles.membersList}
                keyboardShouldPersistTaps="handled"
                renderItem={({ item: member }) => {
                  const isCurrent =
                    selectedTaskForAssign &&
                    (selectedTaskForAssign.user_id === member.id ||
                      selectedTaskForAssign.assigned_to_name === member.name);

                  return (
                    <TouchableOpacity
                      style={[styles.memberRow, isCurrent && styles.memberRowSelected]}
                      onPress={() => handleSelectMemberToAssign(member)}
                      activeOpacity={0.7}
                    >
                      <View style={styles.memberAvatar}>
                        <Text style={styles.memberAvatarText}>
                          {(member.name || 'U').charAt(0).toUpperCase()}
                        </Text>
                      </View>

                      <View style={styles.memberDetails}>
                        <View style={styles.memberNameRow}>
                          <Text style={styles.memberName}>{member.name}</Text>
                          <View
                            style={[
                              styles.memberRoleBadge,
                              member.role === 'admin'
                                ? styles.roleBadgeAdmin
                                : styles.roleBadgeUser,
                            ]}
                          >
                            <Text
                              style={[
                                styles.memberRoleText,
                                member.role === 'admin'
                                  ? styles.roleTextAdmin
                                  : styles.roleTextUser,
                              ]}
                            >
                              {member.role.toUpperCase()}
                            </Text>
                          </View>
                        </View>
                        <Text style={styles.memberEmail}>{member.email}</Text>
                      </View>

                      {isCurrent ? (
                        <View style={styles.currentBadge}>
                          <Text style={styles.currentBadgeText}>Assigned</Text>
                        </View>
                      ) : (
                        <View style={styles.assignActionBtn}>
                          <Text style={styles.assignActionBtnText}>Assign</Text>
                        </View>
                      )}
                    </TouchableOpacity>
                  );
                }}
                ListEmptyComponent={
                  <View style={styles.emptyMembersContainer}>
                    <Icon name="users" size={32} color={COLORS.textSubtle} />
                    <Text style={styles.emptyMembersText}>No staff members found</Text>
                  </View>
                }
              />
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
    paddingTop: SPACING.xl,
    paddingBottom: SPACING.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
    borderBottomColor: COLORS.borderColor,
  },
  headerTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: COLORS.primaryNavy,
  },
  headerGreeting: {
    fontSize: 12,
    color: COLORS.textMuted,
    marginTop: 2,
  },
  headerUserName: {
    fontSize: 12,
    fontWeight: '700',
    color: COLORS.primary,
  },
  userAvatarCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: COLORS.primary,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 3,
  },
  userAvatarText: {
    color: COLORS.bgWhite,
    fontSize: 16,
    fontWeight: '800',
  },

  headerRoleBadge: {
    fontSize: 11,
    fontWeight: '600',
    color: COLORS.primary,
    marginTop: 2,
    opacity: 0.8,
  },
  createUserBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.primary,
    paddingHorizontal: 13,
    paddingVertical: 8,
    borderRadius: RADIUS.md,
    gap: 6,
    shadowColor: COLORS.primary,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 3,
  },
  createUserBtnText: {
    color: COLORS.bgWhite,
    fontWeight: '700',
    fontSize: 12,
  },
  adminSection: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: COLORS.bgWhite,
    marginHorizontal: SPACING.lg,
    marginTop: SPACING.md,
    padding: SPACING.md,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    borderColor: 'rgba(26, 59, 113, 0.12)',
    shadowColor: COLORS.primary,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 6,
    elevation: 2,
  },
  adminSectionLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  adminIconBox: {
    width: 38,
    height: 38,
    borderRadius: RADIUS.md,
    backgroundColor: 'rgba(26, 59, 113, 0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  adminSectionTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: COLORS.primaryNavy,
  },
  adminSectionSub: {
    fontSize: 11,
    color: COLORS.textMuted,
    marginTop: 1,
  },

  headerSub: {
    fontSize: 12,
    color: COLORS.textMuted,
    marginTop: 2,
  },
  addButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.primary,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: RADIUS.md,
    gap: 6,
  },
  addButtonText: {
    color: COLORS.bgWhite,
    fontWeight: '700',
    fontSize: 13,
  },
  metricsContainer: {
    flexDirection: 'row',
    paddingHorizontal: SPACING.md,
    paddingTop: SPACING.md,
    gap: 6,
  },
  metricCard: {
    flex: 1,
    backgroundColor: COLORS.bgWhite,
    borderRadius: RADIUS.md,
    paddingVertical: 10,
    paddingHorizontal: 4,
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: COLORS.borderColor,
  },
  metricCardActive: {
    borderColor: COLORS.primary,
    backgroundColor: 'rgba(26, 59, 113, 0.05)',
  },
  metricNumber: {
    fontSize: 17,
    fontWeight: '800',
    color: COLORS.textDark,
  },
  metricLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: COLORS.textMuted,
    marginTop: 2,
  },
  searchBarContainer: {
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.md,
    flexDirection: 'row',
    gap: 10,
    alignItems: 'center',
  },
  searchInputWrapper: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.bgWhite,
    borderRadius: RADIUS.md,
    paddingHorizontal: 12,
    height: 42,
    borderWidth: 1,
    borderColor: COLORS.borderColor,
    gap: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 13,
    color: COLORS.textDark,
  },
  clearCompletedBtn: {
    paddingHorizontal: 10,
    paddingVertical: 9,
    borderRadius: RADIUS.md,
    backgroundColor: '#FEE2E2',
    justifyContent: 'center',
  },
  clearCompletedText: {
    fontSize: 11,
    fontWeight: '700',
    color: COLORS.accentRed,
  },
  actionAddButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.primary,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: RADIUS.md,
    gap: 5,
    shadowColor: COLORS.primary,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 2,
  },
  actionAddButtonText: {
    color: COLORS.bgWhite,
    fontWeight: '700',
    fontSize: 12,
  },
  listContent: {
    paddingHorizontal: SPACING.lg,
    paddingBottom: SPACING.xxxl,
  },
  taskCard: {
    backgroundColor: COLORS.bgWhite,
    borderRadius: RADIUS.lg,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: '#E8ECF1',
    shadowColor: '#1A3B71',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.06,
    shadowRadius: 12,
    elevation: 3,
    overflow: 'hidden',
  },
  taskCardCompleted: {
    opacity: 0.7,
    borderColor: '#D1FAE5',
  },
  taskAccentStrip: {
    height: 3,
    width: '100%',
  },
  taskAccentPending: {
    backgroundColor: COLORS.primary,
  },
  taskAccentDone: {
    backgroundColor: '#10B981',
  },
  taskCardInner: {
    padding: 14,
  },
  taskCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 7,
    borderWidth: 2,
    borderColor: '#CBD5E1',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F8FAFC',
  },
  checkboxCompleted: {
    backgroundColor: '#10B981',
    borderColor: '#10B981',
  },
  customerInfo: {
    flex: 1,
  },
  customerName: {
    fontSize: 15,
    fontWeight: '700',
    color: COLORS.primaryNavy,
    letterSpacing: 0.1,
  },
  textCompleted: {
    textDecorationLine: 'line-through',
    color: '#94A3B8',
  },
  customerPhone: {
    fontSize: 12,
    color: COLORS.textMuted,
    marginTop: 2,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: RADIUS.full,
    gap: 5,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  statusDotPending: {
    backgroundColor: COLORS.primary,
  },
  statusDotDone: {
    backgroundColor: '#10B981',
  },
  badgePending: {
    backgroundColor: '#EFF6FF',
    borderWidth: 1,
    borderColor: '#DBEAFE',
  },
  badgeDone: {
    backgroundColor: '#ECFDF5',
    borderWidth: 1,
    borderColor: '#D1FAE5',
  },
  statusBadgeText: {
    fontSize: 11,
    fontWeight: '700',
  },
  textPending: {
    color: COLORS.primary,
  },
  textDone: {
    color: '#059669',
  },
  deleteIconButton: {
    padding: 6,
    borderRadius: 8,
    backgroundColor: '#F8FAFC',
  },
  eventDetailsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexWrap: 'wrap',
    marginTop: 8,
  },
  eventTypeBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: RADIUS.full,
    borderWidth: 1,
  },
  eventTypeText: {
    fontSize: 11,
    fontWeight: '700',
  },
  eventMetaBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#F8FAFC',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: RADIUS.full,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  eventMetaText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#475569',
  },
  durationBadge: {
    backgroundColor: '#F1F5F9',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: RADIUS.sm,
  },
  durationBadgeText: {
    fontSize: 10,
    fontWeight: '600',
    color: '#64748B',
  },
  quoteBox: {
    backgroundColor: '#FFFBEB',
    borderRadius: RADIUS.md,
    padding: 10,
    marginTop: 10,
    borderLeftWidth: 3,
    borderLeftColor: '#F59E0B',
  },
  quoteText: {
    fontSize: 12,
    color: '#92400E',
    fontStyle: 'italic',
    lineHeight: 18,
  },
  noteBox: {
    backgroundColor: '#F0F9FF',
    borderRadius: RADIUS.md,
    padding: 10,
    marginTop: 10,
    borderWidth: 1,
    borderColor: '#DBEAFE',
  },
  noteIconRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginBottom: 4,
  },
  noteLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: COLORS.primary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  noteText: {
    fontSize: 13,
    color: '#334155',
    lineHeight: 19,
  },
  taskFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    marginTop: 12,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
  },
  footerLeft: {
    flex: 1,
    gap: 6,
  },
  dueDateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  dueDateText: {
    fontSize: 11,
    fontWeight: '600',
    color: COLORS.textMuted,
  },
  assignInfoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexWrap: 'wrap',
  },
  assignedToPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#EFF6FF',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: RADIUS.full,
    borderWidth: 1,
    borderColor: '#DBEAFE',
  },
  assignedToPillText: {
    fontSize: 10,
    fontWeight: '700',
    color: COLORS.primary,
  },
  assignedByPill: {
    backgroundColor: '#F1F5F9',
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: RADIUS.full,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  assignedByPillText: {
    fontSize: 10,
    fontWeight: '600',
    color: '#64748B',
  },
  assignedRightPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: '#EFF6FF',
    borderWidth: 1,
    borderColor: '#BFDBFE',
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: RADIUS.full,
  },
  assignedRightLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: COLORS.primary,
  },
  assignedRightName: {
    fontSize: 11,
    fontWeight: '800',
    color: COLORS.primaryNavy,
  },
  unassignedPill: {
    backgroundColor: '#F8FAFC',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: RADIUS.full,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  unassignedPillText: {
    fontSize: 10,
    fontWeight: '600',
    color: '#94A3B8',
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
  },
  emptyTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: COLORS.textDark,
    marginTop: 14,
  },
  emptySub: {
    fontSize: 13,
    color: COLORS.textMuted,
    textAlign: 'center',
    marginTop: 6,
    paddingHorizontal: 40,
    lineHeight: 18,
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
    marginBottom: 6,
  },
  formInput: {
    height: 44,
    backgroundColor: COLORS.inputBg,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.borderColor,
    paddingHorizontal: 12,
    fontSize: 14,
    color: COLORS.textDark,
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
  assignedInfoRow: {
    marginTop: 6,
    paddingTop: 6,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
  },
  assignedInfoText: {
    fontSize: 11,
    color: COLORS.textMuted,
  },
  assignedInfoBold: {
    fontWeight: '700',
    color: COLORS.textDark,
  },
  assignButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#EFF6FF',
    borderWidth: 1,
    borderColor: '#BFDBFE',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: RADIUS.sm,
  },
  assignButtonText: {
    fontSize: 11,
    fontWeight: '700',
    color: COLORS.primary,
  },
  assignModalCard: {
    maxHeight: '80%',
    paddingBottom: SPACING.xl,
  },
  assignModalSub: {
    fontSize: 12,
    color: COLORS.textMuted,
    marginTop: 2,
  },
  assignSearchWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.inputBg,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.borderColor,
    paddingHorizontal: 12,
    height: 42,
    marginBottom: 14,
    gap: 8,
  },
  assignSearchInput: {
    flex: 1,
    fontSize: 13,
    color: COLORS.textDark,
    paddingVertical: 0,
  },
  assignLoadingContainer: {
    paddingVertical: 40,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  assignLoadingText: {
    fontSize: 13,
    color: COLORS.textMuted,
  },
  membersList: {
    maxHeight: 320,
  },
  memberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: RADIUS.md,
    marginBottom: 6,
    backgroundColor: COLORS.bgLinen,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  memberRowSelected: {
    backgroundColor: '#EFF6FF',
    borderColor: '#BFDBFE',
  },
  memberAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  memberAvatarText: {
    color: COLORS.bgWhite,
    fontSize: 14,
    fontWeight: '700',
  },
  memberDetails: {
    flex: 1,
  },
  memberNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  memberName: {
    fontSize: 14,
    fontWeight: '700',
    color: COLORS.textDark,
  },
  memberRoleBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  roleBadgeAdmin: {
    backgroundColor: '#FEF3C7',
  },
  roleBadgeUser: {
    backgroundColor: '#E0E7FF',
  },
  memberRoleText: {
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  roleTextAdmin: {
    color: '#D97706',
  },
  roleTextUser: {
    color: '#4F46E5',
  },
  memberEmail: {
    fontSize: 12,
    color: COLORS.textMuted,
    marginTop: 2,
  },
  currentBadge: {
    backgroundColor: '#DCFCE7',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: RADIUS.sm,
  },
  currentBadgeText: {
    color: '#15803D',
    fontSize: 11,
    fontWeight: '700',
  },
  assignActionBtn: {
    backgroundColor: COLORS.primary,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: RADIUS.sm,
  },
  assignActionBtnText: {
    color: COLORS.bgWhite,
    fontSize: 12,
    fontWeight: '700',
  },
  emptyMembersContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 32,
    gap: 8,
  },
  emptyMembersText: {
    fontSize: 13,
    color: COLORS.textMuted,
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

