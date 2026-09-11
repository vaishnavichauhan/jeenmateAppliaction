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
  Modal,
  Alert,
  ActivityIndicator,
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
      matchesFilter = task.status === 'pending' && !isAssignedOut;
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
    setShowAddModal(true);
  };

  const handleCreateTask = async () => {
    if (!newCustomerName.trim() || !newCustomerPhone.trim()) {
      Alert.alert('Missing Info', 'Please enter both customer name and phone number.');
      return;
    }

    await addTask({
      customerName: newCustomerName.trim(),
      customerPhone: newCustomerPhone.trim(),
      staffNote: newStaffNote.trim(),
      dueDate: newDueDate.trim(),
      assignedToUserId: newAssignedUser ? newAssignedUser.id : null,
    });

    setNewCustomerName('');
    setNewCustomerPhone('');
    setNewStaffNote('');
    setNewAssignedUser(null);
    setShowAddModal(false);
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

    return (
      <View style={[styles.taskCard, isDone && styles.taskCardCompleted]}>
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
            <Text style={styles.customerPhone} numberOfLines={1}>{item.customer_phone}</Text>
          </View>

          <View style={[styles.statusBadge, isDone ? styles.badgeDone : styles.badgePending]}>
            <Text style={[styles.statusBadgeText, isDone ? styles.textDone : styles.textPending]}>
              {isDone ? 'Completed' : 'Pending'}
            </Text>
          </View>

          {!item.assigned_to_name && !isAssignedByOther ? (
            <TouchableOpacity
              style={styles.assignButton}
              onPress={() => handleOpenAssignModal(item)}
              activeOpacity={0.7}
            >
              <Icon name="user-plus" size={12} color={COLORS.primary} />
              <Text style={styles.assignButtonText}>Assign</Text>
            </TouchableOpacity>
          ) : null}

          <TouchableOpacity
            style={styles.deleteIconButton}
            onPress={() => handleDeleteTask(item)}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Icon name="trash" size={18} color={COLORS.accentRed} />
          </TouchableOpacity>
        </View>

        {item.original_message ? (
          <View style={styles.quoteBox}>
            <Text style={styles.quoteLabel}>Original Customer Message:</Text>
            <Text style={styles.quoteText} numberOfLines={2}>
              "{item.original_message}"
            </Text>
          </View>
        ) : null}

        {item.staff_note ? (
          <View style={styles.noteBox}>
            <Text style={styles.noteLabel}>Staff Action Note:</Text>
            <Text style={styles.noteText}>{item.staff_note}</Text>
          </View>
        ) : null}

        {item.created_by_name || item.assigned_to_name ? (
          <View style={styles.assignedInfoRow}>
            <Text style={styles.assignedInfoText}>
              {item.created_by_name ? (
                <>Created by <Text style={styles.assignedInfoBold}>{item.created_by_name}</Text></>
              ) : null}
              {item.created_by_name && item.assigned_to_name ? ' • ' : ''}
              {item.assigned_to_name ? (
                <>Assigned to <Text style={[styles.assignedInfoBold, { color: COLORS.primary }]}>{item.assigned_to_name}</Text></>
              ) : null}
            </Text>
          </View>
        ) : null}

        <View style={styles.taskFooter}>
          <View style={styles.dueDateRow}>
            <Icon name="calendar" size={13} color={COLORS.textMuted} />
            <Text style={styles.dueDateText}>Due: {item.due_date || 'No due date'}</Text>
          </View>

          {isAssignedByOther ? (
            <View style={styles.assignByDisabledBadge}>
              <Icon name="user" size={12} color="#64748B" />
              <Text style={styles.assignByDisabledText}>
                Assigned By: "{assignerDisplay}"
              </Text>
            </View>
          ) : item.assigned_to_name ? (
            <View style={styles.assignedToDisabledBadge}>
              <Icon name="user" size={12} color={COLORS.primary} />
              <Text style={styles.assignedToDisabledText}>
                Assigned to: "{item.assigned_to_name}"
              </Text>
            </View>
          ) : null}
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
            <Text style={styles.clearCompletedText}>Clear Done</Text>
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
        onRequestClose={() => setShowAddModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Create New Task</Text>
              <TouchableOpacity onPress={() => setShowAddModal(false)}>
                <Text style={styles.modalCloseText}>✕</Text>
              </TouchableOpacity>
            </View>

            <ScrollView
              style={{ maxHeight: 420 }}
              contentContainerStyle={{ paddingBottom: 10 }}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
            >
              <View style={styles.formGroup}>
                <Text style={styles.formLabel}>Customer Name *</Text>
                <TextInput
                  style={styles.formInput}
                  placeholder="e.g. Ramesh Kumar"
                  placeholderTextColor={COLORS.textSubtle}
                  value={newCustomerName}
                  onChangeText={setNewCustomerName}
                />
              </View>

              <View style={styles.formGroup}>
                <Text style={styles.formLabel}>Customer WhatsApp Phone *</Text>
                <TextInput
                  style={styles.formInput}
                  placeholder="e.g. +91 98765 43210"
                  placeholderTextColor={COLORS.textSubtle}
                  keyboardType="phone-pad"
                  value={newCustomerPhone}
                  onChangeText={setNewCustomerPhone}
                />
              </View>

              <View style={styles.formGroup}>
                <Text style={styles.formLabel}>Staff Follow-up Note</Text>
                <TextInput
                  style={[styles.formInput, { height: 72, textAlignVertical: 'top' }]}
                  placeholder="e.g. Call customer at 3 PM to confirm invoice"
                  placeholderTextColor={COLORS.textSubtle}
                  multiline
                  value={newStaffNote}
                  onChangeText={setNewStaffNote}
                />
              </View>

              <View style={styles.formGroup}>
                <Text style={styles.formLabel}>Due Date (YYYY-MM-DD)</Text>
                <TextInput
                  style={styles.formInput}
                  placeholder="YYYY-MM-DD"
                  placeholderTextColor={COLORS.textSubtle}
                  value={newDueDate}
                  onChangeText={setNewDueDate}
                />
              </View>

              {/* Assign To Field */}
              <View style={styles.formGroup}>
                <Text style={styles.formLabel}>Assign Task To</Text>
                <View style={styles.assignChipsContainer}>
                  <TouchableOpacity
                    style={[styles.assignChip, !newAssignedUser && styles.assignChipActive]}
                    onPress={() => setNewAssignedUser(null)}
                    activeOpacity={0.7}
                  >
                    <Text style={[styles.assignChipText, !newAssignedUser && styles.assignChipTextActive]}>
                      Unassigned
                    </Text>
                    {!newAssignedUser ? (
                      <Icon name="check" size={12} color={COLORS.primary} strokeWidth={3} />
                    ) : null}
                  </TouchableOpacity>

                  {availableAssignMembers.map((member) => {
                    const isSelected = newAssignedUser?.id === member.id;
                    return (
                      <TouchableOpacity
                        key={member.id}
                        style={[styles.assignChip, isSelected && styles.assignChipActive]}
                        onPress={() => setNewAssignedUser(member)}
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
            </ScrollView>

            <TouchableOpacity style={styles.modalSubmitBtn} onPress={handleCreateTask}>
              <Text style={styles.modalSubmitText}>Save Task</Text>
            </TouchableOpacity>
          </View>
        </View>
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
    padding: SPACING.md,
    marginBottom: SPACING.md,
    borderWidth: 1,
    borderColor: COLORS.borderColor,
    shadowColor: COLORS.shadowColor,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 2,
  },
  taskCardCompleted: {
    opacity: 0.75,
    backgroundColor: '#FAF9F6',
  },
  taskCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: COLORS.primaryNavy,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxCompleted: {
    backgroundColor: COLORS.whatsappGreen,
    borderColor: COLORS.whatsappGreen,
  },
  customerInfo: {
    flex: 1,
  },
  customerName: {
    fontSize: 15,
    fontWeight: '700',
    color: COLORS.textDark,
  },
  textCompleted: {
    textDecorationLine: 'line-through',
    color: COLORS.textMuted,
  },
  customerPhone: {
    fontSize: 12,
    color: COLORS.textMuted,
    marginTop: 1,
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: RADIUS.full,
  },
  badgePending: {
    backgroundColor: 'rgba(26, 59, 113, 0.1)',
  },
  badgeDone: {
    backgroundColor: 'rgba(0, 168, 132, 0.12)',
  },
  statusBadgeText: {
    fontSize: 11,
    fontWeight: '700',
  },
  textPending: {
    color: COLORS.primary,
  },
  textDone: {
    color: COLORS.whatsappGreen,
  },
  deleteIconButton: {
    padding: 6,
  },
  quoteBox: {
    backgroundColor: COLORS.bgLinen,
    borderRadius: RADIUS.sm,
    padding: 10,
    marginTop: 10,
    borderLeftWidth: 3,
    borderLeftColor: COLORS.primary,
  },
  quoteLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: COLORS.textMuted,
    textTransform: 'uppercase',
    marginBottom: 2,
  },
  quoteText: {
    fontSize: 12,
    color: COLORS.textDark,
    fontStyle: 'italic',
  },
  noteBox: {
    backgroundColor: '#F8FAFC',
    borderRadius: RADIUS.sm,
    padding: 10,
    marginTop: 8,
    borderWidth: 1,
    borderColor: COLORS.borderColor,
  },
  noteLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: COLORS.primaryNavy,
    marginBottom: 2,
  },
  noteText: {
    fontSize: 13,
    color: COLORS.textDark,
  },
  taskFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 10,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: COLORS.borderColor,
  },
  dueDateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  dueDateText: {
    fontSize: 11,
    fontWeight: '600',
    color: COLORS.textMuted,
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
    marginTop: SPACING.sm,
  },
  modalSubmitText: {
    color: COLORS.bgWhite,
    fontSize: 15,
    fontWeight: '700',
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
  assignByDisabledBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: '#F1F5F9',
    borderWidth: 1,
    borderColor: '#CBD5E1',
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: RADIUS.sm,
  },
  assignByDisabledText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#475569',
  },
  assignedToDisabledBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: '#EFF6FF',
    borderWidth: 1,
    borderColor: '#BFDBFE',
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: RADIUS.sm,
  },
  assignedToDisabledText: {
    fontSize: 11,
    fontWeight: '700',
    color: COLORS.primary,
  },
});
