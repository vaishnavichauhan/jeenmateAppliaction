import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Image,
  ActivityIndicator,
  Alert,
  Modal,
  Platform,
  Share,
  Clipboard,
} from 'react-native';
import { useNavigation, useFocusEffect, useIsFocused } from '@react-navigation/native';
import { useWhatsAppStore, WhatsAppAccount } from '../../store/whatsappStore';
import { useAuthStore } from '../../store/authStore';
import { COLORS, SPACING, RADIUS } from '../../constants/theme';
import { Icon } from '../../components/common/Icon';
import { Header } from '../../components/common/Header';
import apiClient from '../../services/api';

const QR_TIMEOUT_SECONDS = 75;

export const LinkScreen: React.FC = () => {
  const navigation = useNavigation<any>();
  const isFocused = useIsFocused();
  const user = useAuthStore((s) => s.user);
  const isAdmin = user?.role === 'admin';

  const {
    accounts,
    selectedAccountId,
    qrCodes,
    fetchAccounts,
    createAccount,
    deleteAccount,
    disconnectAccount,
    fetchAccountQr,
    restartAccount,
    setupSocketListeners,
    hasLoadedAccounts,
    isFetchingAccounts,
  } = useWhatsAppStore();

  // Reloading state per account ID
  const [reloadingAccountId, setReloadingAccountId] = useState<number | null>(null);

  // Expanded/Collapsed state for connected account details
  const [expandedAccountIds, setExpandedAccountIds] = useState<Record<number, boolean>>({});

  const toggleExpand = (accountId: number) => {
    setExpandedAccountIds((prev) => ({
      ...prev,
      [accountId]: !prev[accountId],
    }));
  };

  // QR Scan Modal State
  const [showScanModal, setShowScanModal] = useState(false);
  const [scanModalType, setScanModalType] = useState<'PERSONAL' | 'TEAM'>('PERSONAL');
  const [pendingAccountId, setPendingAccountId] = useState<number | null>(null);
  const [isGeneratingQr, setIsGeneratingQr] = useState(false);
  const [isQrReady, setIsQrReady] = useState(false);
  const [isQrExpired, setIsQrExpired] = useState(false);
  const [qrCountdown, setQrCountdown] = useState(QR_TIMEOUT_SECONDS);
  const [qrLinkCopied, setQrLinkCopied] = useState(false);

  // Refs for timers & disconnect detection
  const pollTimerRef = useRef<any>(null);
  const countdownTimerRef = useRef<any>(null);
  const prevAccountsRef = useRef<Record<number, boolean>>({});
  const isInitialAccountsMount = useRef(true);
  const alertedDisconnectAccountsRef = useRef<Set<number>>(new Set());

  // Team Access Modal
  const [showAccessModal, setShowAccessModal] = useState(false);
  const [accessAccount, setAccessAccount] = useState<WhatsAppAccount | null>(null);
  const [allUsers, setAllUsers] = useState<Array<{ id: number; name: string; email: string; role: string }>>([]);
  const [selectedUserIds, setSelectedUserIds] = useState<number[]>([]);
  const [isSavingAccess, setIsSavingAccess] = useState(false);

  // Clear all modal timers
  const clearAllTimers = () => {
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
    if (countdownTimerRef.current) {
      clearInterval(countdownTimerRef.current);
      countdownTimerRef.current = null;
    }
  };

  // Build shareable QR viewer URL (opens a browser-friendly HTML page with the QR code)
  const getQrLink = () => {
    const { serverUrl, token } = useAuthStore.getState();
    if (!pendingAccountId || !token) return null;
    return `${serverUrl}/api/whatsapp/accounts/${pendingAccountId}/qr-viewer?token=${token}`;
  };

  const handleShareQrLink = async () => {
    const link = getQrLink();
    if (!link) return;
    try {
      await Share.share({
        message: `Scan this link to view the WhatsApp QR code:\n${link}`,
        url: link,
        title: 'WhatsApp QR Code Link',
      });
    } catch (err: any) {
      Alert.alert('Share failed', err?.message || 'Could not share link.');
    }
  };

  const handleCopyQrLink = () => {
    const link = getQrLink();
    if (!link) return;
    Clipboard.setString(link);
    setQrLinkCopied(true);
    setTimeout(() => setQrLinkCopied(false), 2000);
  };

  // On Focus: load accounts and setup live socket listeners
  useFocusEffect(
    useCallback(() => {
      fetchAccounts();
      setupSocketListeners();
      return () => {
        clearAllTimers();
      };
    }, [])
  );

  // Only show connected accounts on the main screen list and count
  const personalAccounts = React.useMemo(() => accounts.filter(
    (a) => a.account_type === 'PERSONAL' && (a.status === 'online' || a.is_connected)
  ), [accounts]);
  const teamAccounts = React.useMemo(() => accounts.filter(
    (a) => a.account_type === 'TEAM' && (a.status === 'online' || a.is_connected)
  ), [accounts]);

  // Detect remote disconnect transitions and stop QR polling if scanning that account
  useEffect(() => {
    if (isInitialAccountsMount.current) {
      if (accounts.length > 0) {
        const initPrev: Record<number, boolean> = {};
        accounts.forEach((acc) => {
          initPrev[acc.id] = !!(acc.is_connected || acc.status === 'online');
        });
        prevAccountsRef.current = initPrev;
        isInitialAccountsMount.current = false;
      }
      return;
    }

    const prev = prevAccountsRef.current;
    accounts.forEach((acc) => {
      const wasConnected = prev[acc.id] === true;
      const isNowConnected = !!(acc.is_connected || acc.status === 'online');

      // Actual transition from connected -> disconnected
      if (wasConnected && !isNowConnected && !alertedDisconnectAccountsRef.current.has(acc.id)) {
        alertedDisconnectAccountsRef.current.add(acc.id);
        if (isFocused) {
          Alert.alert('Disconnected', 'This account disconnected.');
        }
        if (showScanModal && pendingAccountId === acc.id) {
          clearAllTimers();
          setIsQrReady(false);
          setIsQrExpired(false);
          setIsGeneratingQr(false);
          setQrCountdown(QR_TIMEOUT_SECONDS);
        }
      }

      if (isNowConnected) {
        alertedDisconnectAccountsRef.current.delete(acc.id);
      }
    });

    const newPrev: Record<number, boolean> = {};
    accounts.forEach((acc) => {
      newPrev[acc.id] = !!(acc.is_connected || acc.status === 'online');
    });
    prevAccountsRef.current = newPrev;
  }, [accounts, isFocused, showScanModal, pendingAccountId]);

  // Open Scan Modal
  const openScanModal = (type: 'PERSONAL' | 'TEAM', existingAccountId?: number) => {
    clearAllTimers();
    setScanModalType(type);
    setPendingAccountId(existingAccountId || null);
    setIsGeneratingQr(false);
    setIsQrReady(false);
    setIsQrExpired(false);
    setQrCountdown(QR_TIMEOUT_SECONDS);
    setShowScanModal(true);
  };

  // Start QR polling & expiration countdown for an account
  const startQrSession = (accountId: number) => {
    clearAllTimers();
    setIsQrExpired(false);
    setQrCountdown(QR_TIMEOUT_SECONDS);

    // 1. Countdown timer
    countdownTimerRef.current = setInterval(() => {
      setQrCountdown((prev) => {
        if (prev <= 1) {
          clearAllTimers();
          setIsQrExpired(true);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    // 2. Polling timer
    pollTimerRef.current = setInterval(async () => {
      if (!pollTimerRef.current) return;
      const res = await fetchAccountQr(accountId);
      if (!pollTimerRef.current) return;
      if (res.status === 'online') {
        clearAllTimers();
        await fetchAccounts();
      }
    }, 3000);
  };

  // Handle "Generate QR Code" button press inside modal
  const handleGenerateQrInModal = async () => {
    clearAllTimers();
    setIsGeneratingQr(true);
    setIsQrExpired(false);
    setQrCountdown(QR_TIMEOUT_SECONDS);

    try {
      if (pendingAccountId) {
        // Existing account: restart & fetch QR
        await restartAccount(pendingAccountId);
        await fetchAccountQr(pendingAccountId);
        setIsQrReady(true);
        startQrSession(pendingAccountId);
      } else {
        // Create new account automatically without asking for account name or type
        const defaultName = scanModalType === 'PERSONAL'
          ? (user?.name ? `${user.name} Personal` : 'Personal WhatsApp')
          : 'Team WhatsApp';

        const res = await createAccount(defaultName, scanModalType);
        if (res.success && res.data) {
          const newId = res.data.id;
          setPendingAccountId(newId);
          await restartAccount(newId);
          await fetchAccountQr(newId);
          setIsQrReady(true);
          startQrSession(newId);
        } else {
          Alert.alert('Error', res.message || 'Failed to create QR session');
        }
      }
    } finally {
      setIsGeneratingQr(false);
    }
  };

  // Handle Close / Cancel in Scan Modal (stops all background processes)
  const handleCloseScanModal = async () => {
    clearAllTimers();
    const accId = pendingAccountId;

    setShowScanModal(false);
    setPendingAccountId(null);
    setIsGeneratingQr(false);
    setIsQrReady(false);
    setIsQrExpired(false);

    if (accId) {
      try {
        const pending = accounts.find((a) => a.id === accId);
        // If the pending account was not connected yet, delete it from DB to stop backend Puppeteer
        if (pending && !pending.is_connected && pending.status !== 'online' && !pending.phone_number) {
          await deleteAccount(accId);
        }
      } catch (err) {
        console.log('Error cleaning up unlinked QR session:', err);
      }
    }
  };

  // Auto-detect when pending account gets successfully scanned & connected -> Auto-close modal!
  useEffect(() => {
    if (showScanModal && pendingAccountId) {
      const acc = accounts.find((a) => a.id === pendingAccountId);
      if (acc && (acc.status === 'online' || acc.is_connected)) {
        clearAllTimers();
        setShowScanModal(false);
        setPendingAccountId(null);
        setIsGeneratingQr(false);
        setIsQrReady(false);
        setIsQrExpired(false);
        Alert.alert('Success', 'WhatsApp account connected successfully!');
      }
    }
  }, [accounts, showScanModal, pendingAccountId]);

  // Handle Reload QR from button
  const handleReloadQr = async (account: WhatsAppAccount) => {
    setReloadingAccountId(account.id);
    await restartAccount(account.id);
    await fetchAccountQr(account.id);
    setReloadingAccountId(null);
  };

  // Handle Disconnect
  const handleDisconnect = (account: WhatsAppAccount) => {
    Alert.alert(
      'Disconnect WhatsApp',
      `Are you sure you want to disconnect your Account`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Disconnect',
          style: 'destructive',
          onPress: async () => {
            const res = await disconnectAccount(account.id);
            if (!res.success) {
              Alert.alert('Error', res.message);
            }
          },
        },
      ]
    );
  };

  // Handle Delete Account
  const handleDelete = (account: WhatsAppAccount) => {
    Alert.alert(
      'Delete Account',
      `Are you sure you want to permanently delete ${account.account_name}? All associated data and team permissions will be removed.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            const res = await deleteAccount(account.id);
            if (!res.success) Alert.alert('Error', res.message);
          },
        },
      ]
    );
  };

  // Handle Open Manage Access Modal (Team accounts only)
  const handleOpenAccessModal = async (account: WhatsAppAccount) => {
    setAccessAccount(account);
    setShowAccessModal(true);
    try {
      const [usersRes, membersRes] = await Promise.all([
        apiClient.get('/api/auth/users'),
        apiClient.get(`/api/whatsapp/accounts/${account.id}/members`),
      ]);

      if (usersRes.data?.data) {
        setAllUsers(usersRes.data.data);
      }
      if (membersRes.data?.data) {
        const memberIds = membersRes.data.data.map((m: any) => m.user_id);
        setSelectedUserIds(memberIds);
      }
    } catch (err: any) {
      console.log('Error fetching access data:', err);
    }
  };

  const toggleUserAccess = (userId: number) => {
    if (selectedUserIds.includes(userId)) {
      setSelectedUserIds(selectedUserIds.filter((id) => id !== userId));
    } else {
      setSelectedUserIds([...selectedUserIds, userId]);
    }
  };

  const handleSaveAccess = async () => {
    if (!accessAccount) return;
    setIsSavingAccess(true);
    try {
      const res = await apiClient.post(`/api/whatsapp/accounts/${accessAccount.id}/members`, {
        user_ids: selectedUserIds,
      });
      if (res.data?.success) {
        Alert.alert('Success', 'Team access permissions updated successfully');
        setShowAccessModal(false);
        await fetchAccounts();
      } else {
        Alert.alert('Error', res.data?.message || 'Failed to update access');
      }
    } catch (err: any) {
      Alert.alert('Error', err.response?.data?.message || 'Failed to update access');
    } finally {
      setIsSavingAccess(false);
    }
  };

  // Render Account Card on Main Link Screen
  const renderAccountCard = (account: WhatsAppAccount) => {
    const isConnected = account.status === 'online' || account.is_connected;
    const isGlobalActive = selectedAccountId === account.id;
    const isTeam = account.account_type === 'TEAM';
    const isExpanded = !!expandedAccountIds[account.id];

    const displayName = account.whatsapp_name || (isTeam ? account.account_name : (user?.name || 'Personal WhatsApp'));
    const displayNumber = account.phone_number ? `+${account.phone_number.replace('+', '')}` : 'Connected (Online)';

    // Team Assigned Members formatting
    const assignedMembersList: string[] = isTeam
      ? (account.members && account.members.length > 0
          ? (account.members.map((m) => m.name).filter(Boolean) as string[])
          : [account.creator_name || 'Support Admin'])
      : [];
    const uniqueAssigned = Array.from(new Set(assignedMembersList));

    return (
      <View key={account.id} style={styles.card}>
        {isConnected ? (
          /* ======================================================== */
          /* CONNECTED STATE (COLLAPSIBLE)                            */
          /* ======================================================== */
          <View>
            {/* COLLAPSIBLE SUMMARY HEADER */}
            <TouchableOpacity
              style={styles.summaryHeaderRow}
              onPress={() => toggleExpand(account.id)}
              activeOpacity={0.7}
            >
              <View style={styles.summaryLeftGroup}>
                <View style={styles.whatsappIconCircle}>
                  <Icon name="whatsapp" size={20} color={COLORS.whatsappGreen} />
                </View>
                <View style={styles.summaryInfoCol}>
                  <View style={styles.nameBadgeRow}>
                    <Text style={styles.connectedNameText} numberOfLines={1}>
                      {displayName}
                    </Text>
                    {/* {isGlobalActive && (
                      <View style={styles.miniActiveBadge}>
                        <Icon name="check" size={10} color="#059669" strokeWidth={3} />
                        <Text style={styles.miniActiveBadgeText}>Active</Text>
                      </View>
                    )} */}
                  </View>
                  <Text style={styles.connectedNumberText} numberOfLines={1}>
                    {displayNumber}
                  </Text>
                  {isTeam && (
                    <View style={styles.teamAssignedSummaryRow}>
                      <Text style={styles.teamAssignedSummaryLabel}>Assigned Teams:</Text>
                      <Text style={styles.teamAssignedSummaryValue}>
                        {uniqueAssigned.map((name) => `"${name}"`).join(', ')}
                      </Text>
                    </View>
                  )}
                </View>
              </View>

              <View style={styles.summaryRightGroup}>
                <View style={styles.collapseArrowCircle}>
                  <Icon
                    name={isExpanded ? 'chevron-up' : 'chevron-down'}
                    size={16}
                    color={COLORS.primary}
                    strokeWidth={2.5}
                  />
                </View>
              </View>
            </TouchableOpacity>

            {/* EXPANDABLE DETAILS */}
            {isExpanded && (
              <View style={styles.expandedDetailsContainer}>
                <View style={styles.detailDividerTop} />

                <View style={styles.sessionDetailsBox}>
                  <View style={styles.detailRow}>
                    <Text style={styles.detailLabel}>WhatsApp Name</Text>
                    <Text style={[styles.detailValue, { color: COLORS.primaryNavy, fontWeight: '800' }]}>
                      {displayName}
                    </Text>
                  </View>
                  <View style={styles.detailDivider} />

                  <View style={styles.detailRow}>
                    <Text style={styles.detailLabel}>Account Type</Text>
                    <View style={[styles.badgePill, isTeam ? styles.teamBadgePill : styles.personalBadgePill]}>
                      <Text style={[styles.badgePillText, isTeam ? styles.teamBadgeText : styles.personalBadgeText]}>
                        {account.account_type}
                      </Text>
                    </View>
                  </View>
                  <View style={styles.detailDivider} />

                  <View style={styles.detailRow}>
                    <Text style={styles.detailLabel}>Connected Status</Text>
                    <Text style={[styles.detailValue, { color: COLORS.whatsappGreen, fontWeight: '700' }]}>
                      Connected (Online)
                    </Text>
                  </View>
                  <View style={styles.detailDivider} />

                  <View style={styles.detailRow}>
                    <Text style={styles.detailLabel}>Phone Number</Text>
                    <Text style={styles.detailValue}>
                      {account.phone_number ? `+${account.phone_number.replace('+', '')}` : 'Active'}
                    </Text>
                  </View>
                  <View style={styles.detailDivider} />

                  <View style={styles.detailRow}>
                    <Text style={styles.detailLabel}>Status</Text>
                    <Text style={[styles.detailValue, { color: COLORS.whatsappGreen }]}>Online (2-way synced)</Text>
                  </View>

                  {isTeam && (
                    <>
                      <View style={styles.detailDivider} />
                      <View style={styles.detailRow}>
                        <Text style={styles.detailLabel}>Assigned Teams</Text>
                        <View style={styles.teamAccessRow}>
                          {isAdmin && (
                            <TouchableOpacity
                              style={styles.manageAccessMiniBtn}
                              onPress={() => handleOpenAccessModal(account)}
                            >
                              <Text style={styles.manageAccessMiniText}>Manage</Text>
                            </TouchableOpacity>
                          )}
                        </View>
                      </View>
                    </>
                  )}
                </View>

                {/* Disconnect Button */}
                <TouchableOpacity
                  style={styles.resetButton}
                  onPress={() => handleDisconnect(account)}
                  activeOpacity={0.8}
                >
                  <Icon name="logout" size={16} color={COLORS.accentRed} />
                  <Text style={styles.resetButtonText}>Disconnect</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        ) : (
          /* ======================================================== */
          /* DISCONNECTED STATE (CLEAN TITLE & DISCONNECTED BADGE)    */
          /* ======================================================== */
          <TouchableOpacity
            style={styles.disconnectedCardContent}
            onPress={() => openScanModal(account.account_type, account.id)}
            onLongPress={() => (!isTeam || isAdmin) && handleDelete(account)}
            activeOpacity={0.7}
          >
            <View style={styles.cardHeaderRow}>
              <View style={styles.cardHeaderLeft}>
                <View style={[styles.statusDot, styles.dotDisconnected]} />
                <Text style={styles.cardAccountTitle} numberOfLines={1}>
                  {account.account_name}
                </Text>
              </View>
              <View style={[styles.statusBadge, styles.statusBadgeOffline]}>
                <Text style={[styles.statusBadgeText, styles.statusTextOffline]}>
                  Disconnected
                </Text>
              </View>
            </View>
          </TouchableOpacity>
        )}
      </View>
    );
  };

  const currentQr = pendingAccountId ? qrCodes[pendingAccountId] : null;

  if (!hasLoadedAccounts && accounts.length === 0) {
    return (
      <View style={styles.screenWrapper}>
        <Header
          title="WhatsApp Session"
          onBack={() => navigation.navigate('Home')}
        />
        <View style={styles.centerLoadingContainer}>
          <ActivityIndicator size="large" color={COLORS.primary} />
          <Text style={styles.loadingText}>Loading WhatsApp sessions...</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.screenWrapper}>
      <Header
        title="WhatsApp Session"
        onBack={() => navigation.navigate('Home')}
      />

      <ScrollView contentContainerStyle={styles.container} showsVerticalScrollIndicator={false}>
        {/* ======================================================== */}
        {/* 1. PERSONAL WHATSAPP SECTION                             */}
        {/* ======================================================== */}
        <View style={styles.sectionContainer}>
          <View style={styles.sectionHeaderRow}>
            <View style={styles.sectionTitleGroup}>
              <View style={[styles.sectionIconCircle, { backgroundColor: '#EFF6FF' }]}>
                <Icon name="user" size={16} color={COLORS.primary} strokeWidth={2.5} />
              </View>
              <Text style={styles.sectionTitle}>Personal WhatsApp</Text>
              <View style={styles.countBadge}>
                <Text style={styles.countBadgeText}>{personalAccounts.length}</Text>
              </View>
            </View>

            <TouchableOpacity
              style={styles.sectionAddBtn}
              onPress={() => openScanModal('PERSONAL')}
              activeOpacity={0.8}
            >
              <Icon name="plus" size={13} color={COLORS.primary} strokeWidth={2.8} />
              <Text style={styles.sectionAddBtnText}>Add Personal</Text>
            </TouchableOpacity>
          </View>

          {personalAccounts.length > 0 ? (
            personalAccounts.map((acc) => renderAccountCard(acc))
          ) : isFetchingAccounts && accounts.length === 0 ? (
            <View style={styles.loadingSectionCard}>
              <ActivityIndicator size="small" color={COLORS.primary} />
              <Text style={styles.loadingSectionText}>Loading Personal WhatsApp...</Text>
            </View>
          ) : (
            <View style={styles.emptyCard}>
              <View style={styles.emptyIconCircle}>
                <Icon name="user" size={24} color={COLORS.textSubtle} />
              </View>
              <Text style={styles.emptyHeaderTitle}>No data</Text>
              <Text style={styles.emptyHeaderDesc}>
                No Personal WhatsApp account connected.
              </Text>
            </View>
          )}
        </View>

        {/* ======================================================== */}
        {/* 2. TEAM WHATSAPP SECTION                                 */}
        {/* ======================================================== */}
        <View style={[styles.sectionContainer, { marginTop: SPACING.lg }]}>
          <View style={styles.sectionHeaderRow}>
            <View style={styles.sectionTitleGroup}>
              <View style={[styles.sectionIconCircle, { backgroundColor: '#EEF2FF' }]}>
                <Icon name="users" size={16} color="#4F46E5" strokeWidth={2.5} />
              </View>
              <Text style={styles.sectionTitle}>Team WhatsApp</Text>
              <View style={[styles.countBadge, { backgroundColor: '#EEF2FF' }]}>
                <Text style={[styles.countBadgeText, { color: '#4F46E5' }]}>{teamAccounts.length}</Text>
              </View>
            </View>

            {isAdmin && (
              <TouchableOpacity
                style={[styles.sectionAddBtn, styles.sectionAddBtnTeam]}
                onPress={() => openScanModal('TEAM')}
                activeOpacity={0.8}
              >
                <Icon name="plus" size={13} color="#4F46E5" strokeWidth={2.8} />
                <Text style={[styles.sectionAddBtnText, { color: '#4F46E5' }]}>Add Team</Text>
              </TouchableOpacity>
            )}
          </View>

          {teamAccounts.length > 0 ? (
            teamAccounts.map((acc) => renderAccountCard(acc))
          ) : isFetchingAccounts && accounts.length === 0 ? (
            <View style={styles.loadingSectionCard}>
              <ActivityIndicator size="small" color="#4F46E5" />
              <Text style={[styles.loadingSectionText, { color: '#4F46E5' }]}>Loading Team WhatsApp...</Text>
            </View>
          ) : (
            <View style={styles.emptyCard}>
              <View style={[styles.emptyIconCircle, { backgroundColor: '#EEF2FF' }]}>
                <Icon name="users" size={24} color="#818CF8" />
              </View>
              <Text style={styles.emptyHeaderTitle}>No data</Text>
              <Text style={styles.emptyHeaderDesc}>
                {isAdmin
                  ? 'No Team WhatsApp accounts configured.'
                  : 'No Team WhatsApp accounts assigned to your profile.'}
              </Text>
            </View>
          )}
        </View>

        <View style={{ height: 40 }} />
      </ScrollView>

      {/* ======================================================== */}
      {/* MODAL: SCAN TO LINK WHATSAPP                             */}
      {/* ======================================================== */}
      <Modal visible={showScanModal} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.scanModalContent}>
            {/* Modal Header */}
            <View style={styles.modalHeader}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <View style={[styles.modalIconWrap, scanModalType === 'TEAM' && { backgroundColor: '#EEF2FF' }]}>
                  <Icon
                    name={scanModalType === 'TEAM' ? 'users' : 'user'}
                    size={16}
                    color={scanModalType === 'TEAM' ? '#4F46E5' : COLORS.primary}
                    strokeWidth={2.5}
                  />
                </View>
                <Text style={styles.modalTitle}>
                  Link {scanModalType === 'PERSONAL' ? 'Personal' : 'Team'} WhatsApp
                </Text>
              </View>
              <TouchableOpacity onPress={handleCloseScanModal}>
                <Icon name="x" size={22} color={COLORS.textMuted} />
              </TouchableOpacity>
            </View>

            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingVertical: 8, alignItems: 'center' }}>
              {!isQrReady ? (
                /* INITIAL STEP: CLICK TO GENERATE QR */
                <View style={styles.generatePromptBox}>
                  <View style={styles.generateIconCircle}>
                    <Icon name="link" size={32} color={COLORS.primary} strokeWidth={2.2} />
                  </View>
                  <Text style={styles.generateTitle}>Scan to Link WhatsApp</Text>
                  <Text style={styles.generateDesc}>
                    Tap the button below to generate a new QR code session and link your WhatsApp number.
                  </Text>

                  <TouchableOpacity
                    style={styles.generateBtn}
                    onPress={handleGenerateQrInModal}
                    disabled={isGeneratingQr}
                    activeOpacity={0.85}
                  >
                    {isGeneratingQr ? (
                      <ActivityIndicator size="small" color={COLORS.bgWhite} />
                    ) : (
                      <>
                        <Icon name="refresh" size={16} color={COLORS.bgWhite} strokeWidth={2.5} />
                        <Text style={styles.generateBtnText}>Generate QR Code</Text>
                      </>
                    )}
                  </TouchableOpacity>
                </View>
              ) : isQrExpired ? (
                /* TIMEOUT / EXPIRED STEP: TAP TO RE-GENERATE */
                <View style={styles.expiredPromptBox}>
                  <View style={styles.expiredIconCircle}>
                    <Icon name="clock" size={34} color="#D97706" strokeWidth={2.2} />
                  </View>
                  <Text style={styles.expiredTitle}>QR Code Expired</Text>
                  <Text style={styles.expiredDesc}>
                    The QR code timed out or scan was not completed. Tap below to generate a fresh QR code.
                  </Text>

                  <TouchableOpacity
                    style={styles.generateBtn}
                    onPress={handleGenerateQrInModal}
                    disabled={isGeneratingQr}
                    activeOpacity={0.85}
                  >
                    {isGeneratingQr ? (
                      <ActivityIndicator size="small" color={COLORS.bgWhite} />
                    ) : (
                      <>
                        <Icon name="refresh" size={16} color={COLORS.bgWhite} strokeWidth={2.5} />
                        <Text style={styles.generateBtnText}>Generate New QR Code</Text>
                      </>
                    )}
                  </TouchableOpacity>
                </View>
              ) : (
                /* QR READY STEP: DISPLAY QR CODE TO SCAN */
                <View style={styles.qrReadyBox}>
                  <Text style={styles.qrInstructionsSub}>
                    Point your WhatsApp camera at the code below to connect.
                  </Text>

                  <View style={styles.qrImageFrame}>
                    {isGeneratingQr || !currentQr ? (
                      <View style={styles.qrLoadingBox}>
                        <ActivityIndicator size="large" color={COLORS.primary} />
                        <Text style={styles.qrLoadingText}>
                          Generating live QR session... Please wait
                        </Text>
                      </View>
                    ) : (
                      <Image
                        source={{ uri: currentQr }}
                        style={styles.qrImage}
                        resizeMode="contain"
                      />
                    )}
                  </View>

                  {/* Countdown Notice */}
                  <View style={styles.countdownBadge}>
                    <Icon name="clock" size={12} color="#D97706" />
                    <Text style={styles.countdownText}>
                      Code expires in {qrCountdown}s
                    </Text>
                  </View>

                  {/* Share & Copy Link Row */}
                  <View style={styles.qrLinkActionRow}>
                    <TouchableOpacity
                      style={styles.qrLinkBtn}
                      onPress={handleShareQrLink}
                      activeOpacity={0.8}
                    >
                      <Icon name="share" size={15} color={COLORS.primary} strokeWidth={2.2} />
                      <Text style={styles.qrLinkBtnText}>Share QR Link</Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={[styles.qrLinkBtn, qrLinkCopied && styles.qrLinkBtnCopied]}
                      onPress={handleCopyQrLink}
                      activeOpacity={0.8}
                    >
                      <Icon
                        name={qrLinkCopied ? 'check' : 'copy'}
                        size={15}
                        color={qrLinkCopied ? '#059669' : COLORS.primary}
                        strokeWidth={2.2}
                      />
                      <Text style={[styles.qrLinkBtnText, qrLinkCopied && styles.qrLinkBtnTextCopied]}>
                        {qrLinkCopied ? 'Copied!' : 'Copy Link'}
                      </Text>
                    </TouchableOpacity>
                  </View>

                  <TouchableOpacity
                    style={styles.regenerateButton}
                    onPress={handleGenerateQrInModal}
                    disabled={isGeneratingQr}
                    activeOpacity={0.8}
                  >
                    <Icon name="refresh" size={14} color={COLORS.primaryNavy} />
                    <Text style={styles.regenerateButtonText}>Reload QR Code</Text>
                  </TouchableOpacity>

                  {/* Step-by-Step Guide */}
                  <View style={styles.guideBox}>
                    <Text style={styles.guideTitle}>How to scan:</Text>
                    <Text style={styles.guideStep}>1. Open WhatsApp on your phone</Text>
                    <Text style={styles.guideStep}>
                      2. Tap Menu ({Platform.OS === 'ios' ? 'Settings' : '⋮'}) &gt; Linked Devices
                    </Text>
                    <Text style={styles.guideStep}>3. Tap Link a Device</Text>
                    <Text style={styles.guideStep}>4. Point your camera at this QR code</Text>
                  </View>
                </View>
              )}
            </ScrollView>

            {/* Modal Bottom Close */}
            <TouchableOpacity
              style={styles.modalCancelBtnFull}
              onPress={handleCloseScanModal}
              activeOpacity={0.8}
            >
              <Text style={styles.modalCancelText}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* ======================================================== */}
      {/* MODAL: MANAGE TEAM ACCESS                                */}
      {/* ======================================================== */}
      <Modal visible={showAccessModal} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <View style={styles.modalTitleRow}>
                <View style={[styles.modalIconWrap, { backgroundColor: '#EEF2FF' }]}>
                  <Icon name="users" size={16} color="#4F46E5" />
                </View>
                <Text style={styles.modalTitle}>Team Access</Text>
              </View>
              <TouchableOpacity onPress={() => setShowAccessModal(false)}>
                <Icon name="x" size={22} color={COLORS.textMuted} />
              </TouchableOpacity>
            </View>

            <Text style={styles.modalSubtitle}>
              Select team members who can view chats and send messages via{' '}
              <Text style={{ fontWeight: '700', color: COLORS.textDark }}>
                {accessAccount?.account_name}
              </Text>
            </Text>

            <ScrollView style={styles.userListScroll} showsVerticalScrollIndicator={false}>
              {allUsers.map((u) => {
                const isChecked = selectedUserIds.includes(u.id);
                return (
                  <TouchableOpacity
                    key={u.id}
                    style={[styles.userRow, isChecked && styles.userRowChecked]}
                    onPress={() => toggleUserAccess(u.id)}
                    activeOpacity={0.7}
                  >
                    <View style={styles.userRowInfo}>
                      <Text style={styles.userNameText}>{u.name}</Text>
                      <Text style={styles.userEmailText}>{u.email} • {u.role}</Text>
                    </View>
                    <View style={[styles.checkbox, isChecked && styles.checkboxChecked]}>
                      {isChecked && <Icon name="check" size={12} color={COLORS.bgWhite} strokeWidth={3} />}
                    </View>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>

            <View style={styles.modalBtnRow}>
              <TouchableOpacity
                style={styles.modalCancelBtn}
                onPress={() => setShowAccessModal(false)}
              >
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.modalSubmitBtn, { backgroundColor: '#4F46E5' }]}
                onPress={handleSaveAccess}
                disabled={isSavingAccess}
              >
                {isSavingAccess ? (
                  <ActivityIndicator size="small" color={COLORS.bgWhite} />
                ) : (
                  <Text style={styles.modalSubmitText}>Save Access</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  screenWrapper: {
    flex: 1,
    backgroundColor: COLORS.bg,
  },
  container: {
    padding: SPACING.lg,
    paddingBottom: 40,
  },

  // SECTION STYLES
  sectionContainer: {
    marginBottom: SPACING.md,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: SPACING.sm,
    paddingHorizontal: 2,
  },
  sectionTitleGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  sectionIconCircle: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: COLORS.primaryNavy,
  },
  countBadge: {
    backgroundColor: '#EFF6FF',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
  },
  countBadgeText: {
    fontSize: 12,
    fontWeight: '700',
    color: COLORS.primary,
  },
  sectionAddBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#EFF6FF',
    borderWidth: 1,
    borderColor: '#BFDBFE',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: RADIUS.md,
    minHeight: 30,
  },
  sectionAddBtnTeam: {
    backgroundColor: '#EEF2FF',
    borderColor: '#C7D2FE',
  },
  sectionAddBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: COLORS.primary,
  },

  // CARD STYLES
  card: {
    backgroundColor: COLORS.bgWhite,
    borderRadius: RADIUS.xl,
    padding: SPACING.md,
    marginBottom: SPACING.md,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 3,
  },

  // CONNECTED COLLAPSIBLE SUMMARY HEADER
  summaryHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 4,
  },
  summaryLeftGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
  },
  whatsappIconCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#ECFDF5',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#A7F3D0',
  },
  summaryInfoCol: {
    flex: 1,
  },
  nameBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  connectedNameText: {
    fontSize: 15,
    fontWeight: '800',
    color: COLORS.primaryNavy,
    maxWidth: '70%',
  },
  miniActiveBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: '#ECFDF5',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#A7F3D0',
  },
  miniActiveBadgeText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#059669',
  },
  connectedNumberText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#64748B',
    marginTop: 2,
  },
  teamAssignedSummaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    marginTop: 4,
    gap: 4,
  },
  teamAssignedSummaryLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#4F46E5',
  },
  teamAssignedSummaryValue: {
    fontSize: 11,
    fontWeight: '800',
    color: COLORS.primaryNavy,
  },
  summaryRightGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginLeft: 8,
  },
  collapseArrowCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#F1F5F9',
    alignItems: 'center',
    justifyContent: 'center',
  },

  // EXPANDED DETAILS
  expandedDetailsContainer: {
    marginTop: SPACING.sm,
  },
  detailDividerTop: {
    height: 1,
    backgroundColor: '#F1F5F9',
    marginBottom: SPACING.md,
  },
  sessionDetailsBox: {
    width: '100%',
    backgroundColor: '#F8FAFC',
    borderRadius: RADIUS.lg,
    padding: SPACING.md,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginBottom: SPACING.md,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 4,
  },
  detailDivider: {
    height: 1,
    backgroundColor: '#E2E8F0',
    marginVertical: 6,
  },
  detailLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.textMuted,
  },
  detailValue: {
    fontSize: 12,
    fontWeight: '700',
    color: COLORS.textDark,
  },
  badgePill: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },
  personalBadgePill: {
    backgroundColor: '#EFF6FF',
  },
  teamBadgePill: {
    backgroundColor: '#EEF2FF',
  },
  badgePillText: {
    fontSize: 11,
    fontWeight: '700',
  },
  personalBadgeText: {
    color: COLORS.primary,
  },
  teamBadgeText: {
    color: '#4F46E5',
  },
  teamAccessRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  manageAccessMiniBtn: {
    backgroundColor: '#EEF2FF',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: '#C7D2FE',
  },
  manageAccessMiniText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#4F46E5',
  },
  resetButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: '#FEF2F2',
    borderWidth: 1,
    borderColor: '#FECACA',
    borderRadius: RADIUS.md,
    paddingVertical: 11,
    width: '100%',
  },
  resetButtonText: {
    fontSize: 13,
    fontWeight: '700',
    color: COLORS.accentRed,
  },

  // DISCONNECTED CARD CONTENT (ON MAIN SCREEN)
  disconnectedCardContent: {
    padding: SPACING.xs,
  },
  cardHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
    paddingVertical: 2,
  },
  cardHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
  },
  cardAccountTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: COLORS.textDark,
    flex: 1,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  dotDisconnected: {
    backgroundColor: '#94A3B8',
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: RADIUS.sm,
  },
  statusBadgeOffline: {
    backgroundColor: '#F1F5F9',
  },
  statusBadgeText: {
    fontSize: 11,
    fontWeight: '700',
  },
  statusTextOffline: {
    color: '#64748B',
  },
  disconnectedSubText: {
    fontSize: 12,
    color: COLORS.textMuted,
    lineHeight: 17,
    marginBottom: SPACING.md,
  },
  disconnectedBtnRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  reconnectBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: '#EFF6FF',
    borderWidth: 1,
    borderColor: '#BFDBFE',
    borderRadius: RADIUS.md,
    paddingVertical: 9,
  },
  reconnectBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: COLORS.primary,
  },
  deleteMiniBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    backgroundColor: '#FEF2F2',
    borderWidth: 1,
    borderColor: '#FECACA',
    borderRadius: RADIUS.md,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  deleteMiniBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: COLORS.accentRed,
  },

  // LOADING STATES
  centerLoadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: SPACING.xl,
    gap: 12,
  },
  loadingText: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.textMuted,
  },
  loadingSectionCard: {
    backgroundColor: COLORS.bgWhite,
    borderRadius: RADIUS.xl,
    padding: SPACING.xl,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginBottom: SPACING.md,
    flexDirection: 'row',
    gap: 10,
  },
  loadingSectionText: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.textMuted,
  },

  // EMPTY CARD
  emptyCard: {
    backgroundColor: COLORS.bgWhite,
    borderRadius: RADIUS.xl,
    padding: SPACING.lg,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginBottom: SPACING.md,
  },
  emptyIconCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#F1F5F9',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: SPACING.xs,
  },
  emptyHeaderTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: COLORS.textDark,
    textAlign: 'center',
  },
  emptyHeaderDesc: {
    fontSize: 12,
    color: COLORS.textMuted,
    textAlign: 'center',
    marginTop: 2,
    lineHeight: 16,
    paddingHorizontal: 8,
  },
  emptyAddBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: COLORS.primary,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: RADIUS.md,
    marginTop: SPACING.md,
    minHeight: 38,
  },
  emptyAddBtnText: {
    color: COLORS.bgWhite,
    fontSize: 12,
    fontWeight: '700',
  },

  // SCAN TO LINK MODAL
  scanModalContent: {
    width: '100%',
    maxHeight: '88%',
    backgroundColor: COLORS.bgWhite,
    borderTopLeftRadius: RADIUS.xl,
    borderTopRightRadius: RADIUS.xl,
    padding: SPACING.lg,
    paddingBottom: Platform.OS === 'android' ? 44 : 34,
  },
  generatePromptBox: {
    alignItems: 'center',
    paddingVertical: SPACING.lg,
    width: '100%',
  },
  generateIconCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#EFF6FF',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: SPACING.md,
  },
  generateTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: COLORS.primaryNavy,
    textAlign: 'center',
    marginBottom: 6,
  },
  generateDesc: {
    fontSize: 13,
    color: COLORS.textMuted,
    textAlign: 'center',
    lineHeight: 19,
    marginBottom: SPACING.xl,
    paddingHorizontal: 16,
  },
  generateBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: COLORS.primary,
    paddingVertical: 14,
    paddingHorizontal: 28,
    borderRadius: RADIUS.lg,
    width: '100%',
    maxWidth: 280,
    shadowColor: COLORS.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 4,
  },
  generateBtnText: {
    fontSize: 14,
    fontWeight: '800',
    color: COLORS.bgWhite,
  },

  // EXPIRED BOX
  expiredPromptBox: {
    alignItems: 'center',
    paddingVertical: SPACING.lg,
    width: '100%',
  },
  expiredIconCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#FEF3C7',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: SPACING.md,
  },
  expiredTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: '#92400E',
    textAlign: 'center',
    marginBottom: 6,
  },
  expiredDesc: {
    fontSize: 13,
    color: '#B45309',
    textAlign: 'center',
    lineHeight: 19,
    marginBottom: SPACING.xl,
    paddingHorizontal: 16,
  },

  qrReadyBox: {
    alignItems: 'center',
    width: '100%',
  },
  qrInstructionsSub: {
    fontSize: 13,
    color: COLORS.textMuted,
    textAlign: 'center',
    lineHeight: 18,
    marginBottom: SPACING.md,
  },
  qrImageFrame: {
    width: 220,
    height: 220,
    backgroundColor: '#FFFFFF',
    borderRadius: RADIUS.lg,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: '#E2E8F0',
    marginBottom: SPACING.sm,
  },
  qrImage: {
    width: 200,
    height: 200,
  },
  qrLoadingBox: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: SPACING.md,
  },
  qrLoadingText: {
    fontSize: 12,
    color: COLORS.textMuted,
    textAlign: 'center',
    marginTop: 10,
    lineHeight: 16,
  },
  countdownBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: '#FFFBEB',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#FDE68A',
  },
  countdownText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#B45309',
  },
  qrLinkActionRow: {
    flexDirection: 'row',
    gap: 10,
    width: '100%',
    marginBottom: 10,
  },
  qrLinkBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: '#EFF6FF',
    borderWidth: 1,
    borderColor: '#BFDBFE',
    borderRadius: RADIUS.md,
    paddingVertical: 10,
  },
  qrLinkBtnCopied: {
    backgroundColor: '#ECFDF5',
    borderColor: '#6EE7B7',
  },
  qrLinkBtnText: {
    fontSize: 13,
    fontWeight: '700',
    color: COLORS.primary,
  },
  qrLinkBtnTextCopied: {
    color: '#059669',
  },
  regenerateButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: RADIUS.md,
    paddingVertical: 10,
    paddingHorizontal: 16,
    width: '100%',
    marginBottom: 10,
  },
  regenerateButtonText: {
    fontSize: 13,
    fontWeight: '700',
    color: COLORS.primaryNavy,
  },
  guideBox: {
    width: '100%',
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: RADIUS.md,
    padding: 12,
    marginTop: 4,
    marginBottom: 10,
  },
  guideTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: COLORS.textDark,
    marginBottom: 6,
  },
  guideStep: {
    fontSize: 11,
    color: COLORS.textMuted,
    lineHeight: 17,
  },

  modalCancelBtnFull: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 13,
    backgroundColor: '#F1F5F9',
    borderRadius: RADIUS.md,
    marginTop: 10,
    marginBottom: Platform.OS === 'android' ? 12 : 0,
    width: '100%',
  },

  // GENERIC MODAL STYLES (TEAM ACCESS)
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.55)',
    justifyContent: 'flex-end',
  },
  modalCard: {
    width: '100%',
    maxHeight: '88%',
    backgroundColor: COLORS.bgWhite,
    borderTopLeftRadius: RADIUS.xl,
    borderTopRightRadius: RADIUS.xl,
    padding: SPACING.lg,
    paddingBottom: Platform.OS === 'android' ? 44 : 34,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: SPACING.xs,
  },
  modalTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  modalIconWrap: {
    width: 32,
    height: 32,
    borderRadius: RADIUS.sm,
    backgroundColor: '#EFF6FF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.textDark,
  },
  modalSubtitle: {
    fontSize: 12,
    color: COLORS.textMuted,
    lineHeight: 18,
    marginTop: 4,
    marginBottom: SPACING.md,
  },
  modalBtnRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: SPACING.md,
    marginBottom: Platform.OS === 'android' ? 10 : 0,
  },
  modalCancelBtn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    backgroundColor: '#F1F5F9',
    borderRadius: RADIUS.md,
  },
  modalCancelText: {
    fontSize: 13,
    fontWeight: '700',
    color: COLORS.textMuted,
  },
  modalSubmitBtn: {
    flex: 1.3,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    backgroundColor: COLORS.primary,
    borderRadius: RADIUS.md,
  },
  modalSubmitText: {
    fontSize: 13,
    fontWeight: '700',
    color: COLORS.bgWhite,
  },

  // USER ACCESS LIST
  userListScroll: {
    maxHeight: 260,
    marginVertical: 6,
  },
  userRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: RADIUS.md,
    padding: 10,
    marginBottom: 6,
  },
  userRowChecked: {
    backgroundColor: '#EEF2FF',
    borderColor: '#C7D2FE',
  },
  userRowInfo: {
    flex: 1,
  },
  userNameText: {
    fontSize: 13,
    fontWeight: '700',
    color: COLORS.textDark,
  },
  userEmailText: {
    fontSize: 11,
    color: COLORS.textMuted,
    marginTop: 2,
  },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 5,
    borderWidth: 1.5,
    borderColor: '#94A3B8',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.bgWhite,
  },
  checkboxChecked: {
    backgroundColor: '#4F46E5',
    borderColor: '#4F46E5',
  },
});
