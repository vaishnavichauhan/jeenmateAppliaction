import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Modal,
  Platform,
} from 'react-native';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { useWhatsAppStore, WhatsAppAccount } from '../../store/whatsappStore';
import { useChatStore } from '../../store/chatStore';
import { Header } from '../../components/common/Header';
import { Icon } from '../../components/common/Icon';
import { COLORS, SPACING, RADIUS } from '../../constants/theme';

export const ChatSelectScreen: React.FC = () => {
  const navigation = useNavigation<any>();
  const {
    accounts,
    selectedAccountId,
    selectedAccount,
    fetchAccounts,
    selectAccount,
  } = useWhatsAppStore();


  useFocusEffect(
    React.useCallback(() => {
      fetchAccounts();
    }, [fetchAccounts])
  );

  const personalAccounts = React.useMemo(() => accounts.filter((a) => a.account_type === 'PERSONAL'), [accounts]);
  const teamAccounts = React.useMemo(() => accounts.filter((a) => a.account_type === 'TEAM'), [accounts]);

  const onlinePersonalAccounts = React.useMemo(() => personalAccounts.filter((a) => a.status === 'online' || a.is_connected), [personalAccounts]);
  const onlineTeamAccounts = React.useMemo(() => teamAccounts.filter((a) => a.status === 'online' || a.is_connected), [teamAccounts]);

  // Handle clicking Personal WhatsApp
  const handlePersonalPress = () => {
    if (personalAccounts.length === 0 || onlinePersonalAccounts.length === 0) {
      navigation.navigate('Link');
    } else {
      const currentSelected = (selectedAccount && selectedAccount.account_type === 'PERSONAL' && (selectedAccount.status === 'online' || selectedAccount.is_connected))
        ? selectedAccount
        : onlinePersonalAccounts[0];
      selectAccount(currentSelected);
      navigation.navigate('WhatsAppChat');
    }
  };

  // Handle clicking Team WhatsApp
  const handleTeamPress = () => {
    if (teamAccounts.length === 0 || onlineTeamAccounts.length === 0) {
      navigation.navigate('Link');
    } else {
      const currentSelected = (selectedAccount && selectedAccount.account_type === 'TEAM' && (selectedAccount.status === 'online' || selectedAccount.is_connected))
        ? selectedAccount
        : onlineTeamAccounts[0];
      selectAccount(currentSelected);
      navigation.navigate('WhatsAppChat');
    }
  };

  const activePersonalOnline = onlinePersonalAccounts.length;
  const activeTeamOnline = onlineTeamAccounts.length;

  return (
    <View style={styles.container}>
      <Header
        title="Chats"
        onBack={() => navigation.navigate('Home')}
      />

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* ======================================================== */}
        {/* 1. WHATSAPP PERSONAL CHAT CARD                           */}
        {/* ======================================================== */}
        <TouchableOpacity
          style={styles.chatCard}
          onPress={handlePersonalPress}
          activeOpacity={0.82}
        >
          <View style={[styles.iconContainer, styles.personalIconBg]}>
            <Icon name="user" size={26} color={COLORS.bgWhite} strokeWidth={2.2} />
          </View>

          <View style={styles.cardDetails}>
            <View style={styles.titleRow}>
              <Text style={styles.cardTitle}>1. WhatsApp Personal Chat</Text>
            </View>
            <Text style={styles.cardSubtitle}>
              {personalAccounts.length === 0
                ? 'No Personal WhatsApp linked. Tap to link your number.'
                : personalAccounts.length === 1
                ? `${personalAccounts[0].whatsapp_name || personalAccounts[0].account_name} (${personalAccounts[0].phone_number ? '+' + personalAccounts[0].phone_number.replace('+', '') : 'Linked'})`
                : `${personalAccounts.length} Personal WhatsApp accounts (${activePersonalOnline} Online)`}
            </Text>

            <View style={styles.badgeRow}>
              <View
                style={[
                  styles.statusIndicator,
                  { backgroundColor: activePersonalOnline > 0 ? COLORS.whatsappGreen : '#94A3B8' },
                ]}
              />
              <Text style={[styles.statusText, { color: activePersonalOnline > 0 ? '#16A34A' : '#64748B' }]}>
                {personalAccounts.length === 0
                  ? 'Tap to Link Device'
                  : activePersonalOnline > 0
                  ? `${activePersonalOnline} Active Session${activePersonalOnline > 1 ? 's' : ''}`
                  : 'Disconnected'}
              </Text>
            </View>
          </View>

          <View style={styles.arrowBox}>
            <Icon name="chevron-right" size={20} color={COLORS.textSubtle} strokeWidth={2.2} />
          </View>
        </TouchableOpacity>

        {/* ======================================================== */}
        {/* 2. WHATSAPP TEAM CHAT CARD                               */}
        {/* ======================================================== */}
        <TouchableOpacity
          style={styles.chatCard}
          onPress={handleTeamPress}
          activeOpacity={0.82}
        >
          <View style={[styles.iconContainer, styles.teamIconBg]}>
            <Icon name="users" size={24} color={COLORS.bgWhite} strokeWidth={2.2} />
          </View>

          <View style={styles.cardDetails}>
            <View style={styles.titleRow}>
              <Text style={styles.cardTitle}>2. WhatsApp Team Chat</Text>
            </View>
            <Text style={styles.cardSubtitle}>
              {teamAccounts.length === 0
                ? 'No Team WhatsApp linked. Tap to manage team numbers.'
                : teamAccounts.length === 1
                ? `${teamAccounts[0].whatsapp_name || teamAccounts[0].account_name} (${teamAccounts[0].phone_number ? '+' + teamAccounts[0].phone_number.replace('+', '') : 'Shared Desk'})`
                : `${teamAccounts.length} Team WhatsApp accounts (${activeTeamOnline} Online)`}
            </Text>

            <View style={styles.badgeRow}>
              <View
                style={[
                  styles.statusIndicator,
                  { backgroundColor: activeTeamOnline > 0 ? '#4F46E5' : '#94A3B8' },
                ]}
              />
              <Text style={[styles.statusText, { color: activeTeamOnline > 0 ? '#4F46E5' : '#64748B' }]}>
                {teamAccounts.length === 0
                  ? 'No Team Account'
                  : activeTeamOnline > 0
                  ? `${activeTeamOnline} Team Session${activeTeamOnline > 1 ? 's' : ''} Online`
                  : 'Disconnected'}
              </Text>
            </View>
          </View>

          <View style={styles.arrowBox}>
            <Icon name="chevron-right" size={20} color={COLORS.textSubtle} strokeWidth={2.2} />
          </View>
        </TouchableOpacity>

        {/* ======================================================== */}
        {/* 3. JEENMATE CHAT CARD                                    */}
        {/* ======================================================== */}
        <TouchableOpacity
          style={styles.chatCard}
          onPress={() => navigation.navigate('JeenmateChat')}
          activeOpacity={0.82}
        >
          <View style={[styles.iconContainer, styles.jeenmateIconBg]}>
            <Icon name="chat" size={24} color={COLORS.bgWhite} strokeWidth={2.2} />
          </View>

          <View style={styles.cardDetails}>
            <View style={styles.titleRow}>
              <Text style={styles.cardTitle}>3. Jeenmate Chat</Text>
            </View>

            <Text style={styles.cardSubtitle}>
              Internal team messaging, private chats & staff collaboration.
            </Text>

            <View style={styles.badgeRow}>
              <View style={[styles.statusIndicator, { backgroundColor: '#8B5CF6' }]} />
              <Text style={[styles.statusText, { color: '#8B5CF6' }]}>
                Internal Team Messaging
              </Text>
            </View>
          </View>

          <View style={styles.arrowBox}>
            <Icon name="chevron-right" size={20} color={COLORS.textSubtle} strokeWidth={2.2} />
          </View>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.bg,
  },
  scrollContent: {
    padding: SPACING.lg,
    paddingTop: SPACING.xl,
  },
  chatCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.bgWhite,
    borderRadius: RADIUS.xl,
    padding: SPACING.lg,
    marginBottom: SPACING.md,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
  },
  iconContainer: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: SPACING.md,
  },
  personalIconBg: {
    backgroundColor: COLORS.whatsappGreen,
  },
  teamIconBg: {
    backgroundColor: '#4F46E5',
  },
  jeenmateIconBg: {
    backgroundColor: '#8B5CF6',
  },
  cardDetails: {
    flex: 1,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: COLORS.textDark,
  },
  cardSubtitle: {
    fontSize: 12,
    color: COLORS.textSubtle,
    lineHeight: 17,
    marginBottom: 8,
  },
  badgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  statusIndicator: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 6,
  },
  statusText: {
    fontSize: 11,
    fontWeight: '700',
  },
  arrowBox: {
    marginLeft: SPACING.sm,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.6)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: COLORS.bgWhite,
    borderTopLeftRadius: RADIUS.xl,
    borderTopRightRadius: RADIUS.xl,
    padding: SPACING.lg,
    paddingBottom: Platform.OS === 'android' ? 44 : 34,
    maxHeight: '88%',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  modalTitle: { fontSize: 17, fontWeight: '800', color: COLORS.textDark },
  modalSubtitle: { fontSize: 13, color: COLORS.textSubtle, marginTop: 4, marginBottom: 16, lineHeight: 18 },
  accountOption: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: RADIUS.md,
    backgroundColor: '#F8FAFC',
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  accountOptionSelected: {
    borderColor: COLORS.whatsappGreen,
    backgroundColor: '#ECFDF5',
  },
  accountOptionSelectedTeam: {
    borderColor: '#4F46E5',
    backgroundColor: '#EEF2FF',
  },
  accIconBox: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', marginRight: 10 },
  accInfo: { flex: 1 },
  accNameText: { fontSize: 14, fontWeight: '700', color: COLORS.textDark },
  accPhoneText: { fontSize: 12, color: COLORS.textSubtle, marginTop: 2 },
  accStatusPill: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 999 },
  accOnline: { backgroundColor: '#DCFCE7' },
  accOnlineTeam: { backgroundColor: '#EEF2FF' },
  accOffline: { backgroundColor: '#F1F5F9' },
  accStatusText: { fontSize: 11, fontWeight: '700' },
  textOnline: { color: '#16A34A' },
  textOnlineTeam: { color: '#4F46E5' },
  textOffline: { color: '#64748B' },
  manageAccountsBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 12,
    marginTop: 12,
    marginBottom: Platform.OS === 'android' ? 12 : 0,
    borderRadius: RADIUS.md,
    backgroundColor: '#F1F5F9',
  },
  manageAccountsText: { fontSize: 13, fontWeight: '700', color: COLORS.primary },
});
