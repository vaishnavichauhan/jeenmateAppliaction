import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  RefreshControl,
  TextInput,
  Modal,
  Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTaskStore, CRMTask } from '../../store/taskStore';
import { COLORS, SPACING, RADIUS } from '../../constants/theme';
import { Icon } from '../../components/common/Icon';

export const HomeScreen: React.FC = () => {
  const insets = useSafeAreaInsets();
  const {
    tasks,
    counts,
    filter,
    setFilter,
    fetchTasks,
    toggleTaskStatus,
    deleteTask,
    addTask,
    clearCompletedTasks,
    isRefreshing,
  } = useTaskStore();

  const [search, setSearch] = useState('');
  const [showAddModal, setShowAddModal] = useState(false);

  // New task form state
  const [newCustomerName, setNewCustomerName] = useState('');
  const [newCustomerPhone, setNewCustomerPhone] = useState('');
  const [newStaffNote, setNewStaffNote] = useState('');
  const [newDueDate, setNewDueDate] = useState(
    new Date(Date.now() + 24 * 3600 * 1000).toISOString().split('T')[0]
  );

  useEffect(() => {
    fetchTasks();
  }, [fetchTasks]);

  const filteredTasks = tasks.filter((task) => {
    const matchesFilter =
      filter === 'all' ||
      (filter === 'pending' && task.status === 'pending') ||
      (filter === 'completed' && task.status === 'completed');

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
    });

    setNewCustomerName('');
    setNewCustomerPhone('');
    setNewStaffNote('');
    setShowAddModal(false);
  };

  const renderTaskItem = ({ item }: { item: CRMTask }) => {
    const isDone = item.status === 'completed';

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
            <Text style={[styles.customerName, isDone && styles.textCompleted]}>
              {item.customer_name}
            </Text>
            <Text style={styles.customerPhone}>{item.customer_phone}</Text>
          </View>

          <View style={[styles.statusBadge, isDone ? styles.badgeDone : styles.badgePending]}>
            <Text style={[styles.statusBadgeText, isDone ? styles.textDone : styles.textPending]}>
              {isDone ? 'Completed' : 'Pending'}
            </Text>
          </View>

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

        <View style={styles.taskFooter}>
          <View style={styles.dueDateRow}>
            <Icon name="calendar" size={14} color={COLORS.textMuted} />
            <Text style={styles.dueDateText}>Due: {item.due_date || 'No due date'}</Text>
          </View>
        </View>
      </View>
    );
  };

  return (
    <View style={styles.container}>
      {/* Header Bar */}
      <View style={[styles.header, { paddingTop: Math.max(insets.top, 20) + 12 }]}>
        <Text style={styles.headerTitle}>JeenMate</Text>
      </View>

      {/* Summary Metrics Chips */}
      <View style={styles.metricsContainer}>
        <TouchableOpacity
          style={[styles.metricCard, filter === 'all' && styles.metricCardActive]}
          onPress={() => setFilter('all')}
        >
          <Text style={styles.metricNumber}>{counts.total}</Text>
          <Text style={styles.metricLabel}>Total Tasks</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.metricCard, filter === 'pending' && styles.metricCardActive]}
          onPress={() => setFilter('pending')}
        >
          <Text style={[styles.metricNumber, { color: COLORS.primary }]}>{counts.pending}</Text>
          <Text style={styles.metricLabel}>Pending</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.metricCard, filter === 'completed' && styles.metricCardActive]}
          onPress={() => setFilter('completed')}
        >
          <Text style={[styles.metricNumber, { color: COLORS.whatsappGreen }]}>{counts.completed}</Text>
          <Text style={styles.metricLabel}>Completed</Text>
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
          onPress={() => setShowAddModal(true)}
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

            <TouchableOpacity style={styles.modalSubmitBtn} onPress={handleCreateTask}>
              <Text style={styles.modalSubmitText}>Save Task</Text>
            </TouchableOpacity>
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
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.md,
    gap: 10,
  },
  metricCard: {
    flex: 1,
    backgroundColor: COLORS.bgWhite,
    borderRadius: RADIUS.lg,
    paddingVertical: 12,
    paddingHorizontal: 10,
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: COLORS.borderColor,
  },
  metricCardActive: {
    borderColor: COLORS.primary,
    backgroundColor: 'rgba(26, 59, 113, 0.04)',
  },
  metricNumber: {
    fontSize: 20,
    fontWeight: '800',
    color: COLORS.textDark,
  },
  metricLabel: {
    fontSize: 11,
    fontWeight: '600',
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
    gap: 10,
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
});
