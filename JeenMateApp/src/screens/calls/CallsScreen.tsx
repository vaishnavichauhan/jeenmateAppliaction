import React, { useState } from 'react';
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
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { COLORS, SPACING, RADIUS } from '../../constants/theme';
import { Icon } from '../../components/common/Icon';
import { useTaskStore } from '../../store/taskStore';

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

const SAMPLE_WHATSAPP_CALLS: CallLogItem[] = [
  {
    id: 'wa_call_1',
    customerName: 'Raj Patel ( Jeenweb )',
    phoneNumber: '+918799350736',
    callType: 'incoming',
    mediaType: 'voice',
    timestamp: 'Today, 5:10 PM',
    duration: '3m 45s',
  },
  {
    id: 'wa_call_2',
    customerName: 'Vaishnavi Shah',
    phoneNumber: '+919316539751',
    callType: 'outgoing',
    mediaType: 'video',
    timestamp: 'Today, 4:25 PM',
    duration: '5m 12s',
  },
  {
    id: 'wa_call_3',
    customerName: 'Shubham Software',
    phoneNumber: '+918849139833',
    callType: 'missed',
    mediaType: 'voice',
    timestamp: 'Today, 2:15 PM',
  },
  {
    id: 'wa_call_4',
    customerName: 'Orsang Camp Admin',
    phoneNumber: '+919879611490',
    callType: 'outgoing',
    mediaType: 'voice',
    timestamp: 'Yesterday, 6:40 PM',
    duration: '8m 20s',
  },
  {
    id: 'wa_call_5',
    customerName: 'Jeen Web Office',
    phoneNumber: '+919510972299',
    callType: 'incoming',
    mediaType: 'voice',
    timestamp: 'Yesterday, 11:30 AM',
    duration: '2m 10s',
  },
];

const SAMPLE_PHONE_CALLS: CallLogItem[] = [
  {
    id: 'ph_call_1',
    customerName: 'Raj Patel ( Jeenweb )',
    phoneNumber: '+918799350736',
    callType: 'outgoing',
    mediaType: 'voice',
    timestamp: 'Today, 4:50 PM',
    duration: '1m 30s',
  },
  {
    id: 'ph_call_2',
    customerName: 'Snehal Mam',
    phoneNumber: '+919112013911',
    callType: 'incoming',
    mediaType: 'voice',
    timestamp: 'Today, 3:10 PM',
    duration: '4m 05s',
  },
  {
    id: 'ph_call_3',
    customerName: 'Marketing Jeenweb',
    phoneNumber: '+918799092907',
    callType: 'missed',
    mediaType: 'voice',
    timestamp: 'Today, 1:05 PM',
  },
  {
    id: 'ph_call_4',
    customerName: 'Shah Tatvam',
    phoneNumber: '+919824466017',
    callType: 'outgoing',
    mediaType: 'voice',
    timestamp: 'Yesterday, 5:15 PM',
    duration: '6m 50s',
  },
  {
    id: 'ph_call_5',
    customerName: 'Aditya Jeenweb',
    phoneNumber: '+919512605989',
    callType: 'incoming',
    mediaType: 'voice',
    timestamp: 'Yesterday, 10:15 AM',
    duration: '1m 45s',
  },
];

export const CallsScreen: React.FC = () => {
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();
  const { addTask } = useTaskStore();

  const [activeTab, setActiveTab] = useState<'whatsapp' | 'phone'>('whatsapp');
  const [searchQuery, setSearchQuery] = useState('');

  // CRM Task Modal
  const [taskModalVisible, setTaskModalVisible] = useState(false);
  const [selectedCall, setSelectedCall] = useState<CallLogItem | null>(null);
  const [staffNote, setStaffNote] = useState('');
  const [taskTime, setTaskTime] = useState('10:00 AM');
  const [dueDate, setDueDate] = useState(
    new Date(Date.now() + 24 * 3600 * 1000).toISOString().split('T')[0]
  );

  const handleOpenWhatsAppCall = (phoneNumber: string) => {
    const cleanPhone = phoneNumber.replace(/[^0-9]/g, '');
    const waUrl = `https://wa.me/${cleanPhone}`;
    Linking.canOpenURL(waUrl).then((supported) => {
      if (supported) {
        Linking.openURL(waUrl);
      } else {
        Linking.openURL(`tel:${phoneNumber}`);
      }
    });
  };

  const handleOpenCellularCall = (phoneNumber: string) => {
    Linking.openURL(`tel:${phoneNumber}`);
  };

  const handleOpenTaskModal = (call: CallLogItem) => {
    setSelectedCall(call);
    setStaffNote(`Follow up call with ${call.customerName} (${call.phoneNumber})`);
    setTaskModalVisible(true);
  };

  const handleSaveTask = async () => {
    if (!selectedCall) return;
    await addTask({
      customerId: selectedCall.id,
      customerName: selectedCall.customerName,
      customerPhone: selectedCall.phoneNumber,
      originalMessage: `Call Log [${selectedCall.mediaType.toUpperCase()}]: ${selectedCall.callType} call at ${selectedCall.timestamp}${selectedCall.duration ? ` (${selectedCall.duration})` : ''}`,
      staffNote: staffNote,
      dueDate: dueDate,
    });
    setTaskModalVisible(false);
    Alert.alert('Task Created 📌', `CRM Task scheduled for ${selectedCall.customerName}.`);
  };

  const filterCalls = (calls: CallLogItem[]) => {
    if (!searchQuery.trim()) return calls;
    const q = searchQuery.toLowerCase();
    return calls.filter(
      (c) =>
        c.customerName.toLowerCase().includes(q) ||
        c.phoneNumber.includes(q) ||
        c.timestamp.toLowerCase().includes(q)
    );
  };

  const filteredWhatsApp = filterCalls(SAMPLE_WHATSAPP_CALLS);
  const filteredPhone = filterCalls(SAMPLE_PHONE_CALLS);

  const renderCallCardItem = (item: CallLogItem, isWhatsApp: boolean) => {
    const isMissed = item.callType === 'missed';
    const isIncoming = item.callType === 'incoming';

    const initials = item.customerName
      ? item.customerName
          .split(' ')
          .map((n) => n[0])
          .slice(0, 2)
          .join('')
          .toUpperCase()
      : 'C';

    return (
      <View key={item.id} style={styles.callItemCard}>
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
              <Text style={styles.itemCustomerName} numberOfLines={1}>
                {item.customerName}
              </Text>
              <Text style={styles.itemPhoneText}>{item.phoneNumber}</Text>
            </View>
          </View>

          {/* Time & Media Type */}
          <View style={styles.timeCol}>
            <Text style={styles.itemTimeText}>{item.timestamp}</Text>
            {isWhatsApp && item.mediaType === 'video' ? (
              <View style={styles.videoBadge}>
                <Text style={styles.videoBadgeText}>🎥 Video</Text>
              </View>
            ) : null}
          </View>
        </View>

        {/* Bottom Meta & Action Bar */}
        <View style={styles.itemFooterRow}>
          {/* Status Badge */}
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
                ? '✕ Missed Call'
                : isIncoming
                ? '↙ Incoming'
                : '↗ Outgoing'}
              {item.duration ? ` • ${item.duration}` : ''}
            </Text>
          </View>

          {/* Action Buttons */}
          <View style={styles.actionButtonsRow}>
            {/* Task Action Button */}
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
            placeholder="Search by customer name, phone, time..."
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
              WhatsApp Calls 🟢 ({SAMPLE_WHATSAPP_CALLS.length})
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
              Phone Calls 📞 ({SAMPLE_PHONE_CALLS.length})
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* WHATSAPP CALLS LIST */}
        {activeTab === 'whatsapp' && (
          filteredWhatsApp.length === 0 ? (
            <View style={styles.emptyBox}>
              <Text style={styles.emptyText}>No WhatsApp calls found.</Text>
            </View>
          ) : (
            filteredWhatsApp.map((item) => renderCallCardItem(item, true))
          )
        )}

        {/* CELLULAR PHONE CALLS LIST */}
        {activeTab === 'phone' && (
          filteredPhone.length === 0 ? (
            <View style={styles.emptyBox}>
              <Text style={styles.emptyText}>No Cellular phone calls found.</Text>
            </View>
          ) : (
            filteredPhone.map((item) => renderCallCardItem(item, false))
          )
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
              <>
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
                      {selectedCall.callType.toUpperCase()} Call at {selectedCall.timestamp}
                      {selectedCall.duration ? ` (${selectedCall.duration})` : ''}
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
                    placeholder="YYYY-MM-DD"
                    placeholderTextColor={COLORS.textSubtle}
                  />
                </View>

                <View style={styles.formGroup}>
                  <Text style={styles.formLabel}>Time</Text>
                  <TextInput
                    style={styles.formInput}
                    value={taskTime}
                    onChangeText={setTaskTime}
                    placeholder="10:00 AM"
                    placeholderTextColor={COLORS.textSubtle}
                  />
                </View>

                <TouchableOpacity style={styles.modalSubmitBtn} onPress={handleSaveTask}>
                  <Text style={styles.modalSubmitText}>Save</Text>
                </TouchableOpacity>
              </>
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
  tabSegmentActive: {
    backgroundColor: COLORS.bgWhite,
    shadowColor: COLORS.shadowColor,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 1,
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
  tabSegmentTextActive: {
    color: COLORS.primaryNavy,
    fontWeight: '800',
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
    gap: SPACING.xl,
    paddingBottom: SPACING.xxxl,
  },
  mainCard: {
    borderRadius: RADIUS.xl,
    borderWidth: 1.5,
    backgroundColor: COLORS.bgWhite,
    overflow: 'hidden',
    shadowColor: COLORS.shadowColor,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.08,
    shadowRadius: 6,
    elevation: 3,
  },
  cardWhatsApp: {
    borderColor: '#86EFAC',
  },
  cardPhone: {
    borderColor: '#93C5FD',
  },
  cardHeaderBarWA: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: SPACING.lg,
    paddingVertical: 14,
    backgroundColor: '#F0FDF4',
    borderBottomWidth: 1,
    borderBottomColor: '#DCFCE7',
  },
  cardHeaderBarPhone: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: SPACING.lg,
    paddingVertical: 14,
    backgroundColor: '#F0F9FF',
    borderBottomWidth: 1,
    borderBottomColor: '#DBEAFE',
  },
  cardHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  headerIconCircleWA: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#DCFCE7',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerIconCirclePhone: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#DBEAFE',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardMainTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: COLORS.primaryNavy,
  },
  cardSubTitle: {
    fontSize: 11,
    color: COLORS.textMuted,
    marginTop: 1,
  },
  badgeGreenPill: {
    backgroundColor: '#DCFCE7',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: RADIUS.full,
    borderWidth: 1,
    borderColor: '#86EFAC',
  },
  badgeGreenPillText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#15803D',
  },
  badgeNavyPill: {
    backgroundColor: '#DBEAFE',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: RADIUS.full,
    borderWidth: 1,
    borderColor: '#93C5FD',
  },
  badgeNavyPillText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#1E40AF',
  },
  cardItemsBody: {
    padding: SPACING.md,
    gap: SPACING.md,
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
    alignItems: 'flex-start',
    marginBottom: 10,
  },
  itemUserCol: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
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
    fontSize: 11,
    fontWeight: '600',
    color: COLORS.textMuted,
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
  statusPill: {
    paddingHorizontal: 8,
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
  actionButtonsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  callBtnPill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: RADIUS.full,
    gap: 4,
  },
  callBtnWA: {
    backgroundColor: COLORS.whatsappGreen,
  },
  callBtnPhone: {
    backgroundColor: COLORS.primaryNavy,
  },
  callBtnText: {
    fontSize: 11,
    fontWeight: '700',
    color: COLORS.bgWhite,
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
    paddingVertical: 30,
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 13,
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
});
