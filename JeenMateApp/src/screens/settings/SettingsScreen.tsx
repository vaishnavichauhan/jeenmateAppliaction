import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Image,
  Alert,
  ActivityIndicator,
  Modal,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuthStore } from '../../store/authStore';
import { useWhatsAppStore } from '../../store/whatsappStore';
import { COLORS, SPACING, RADIUS } from '../../constants/theme';
import { Icon } from '../../components/common/Icon';

export const SettingsScreen: React.FC = () => {
  const insets = useSafeAreaInsets();
  const { user, serverUrl, setServerUrl, testServerConnection, logout } = useAuthStore();
  const { isConnected, phone, name } = useWhatsAppStore();

  const [showIpModal, setShowIpModal] = useState(false);
  const [customIp, setCustomIp] = useState(serverUrl);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [isTesting, setIsTesting] = useState(false);

  const handleLogout = () => {
    Alert.alert(
      'Confirm Sign Out',
      'Are you sure you want to log out of your jeenMate staff session?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Log Out',
          style: 'destructive',
          onPress: async () => {
            await logout();
          },
        },
      ]
    );
  };

  const handleTestConnection = async () => {
    setIsTesting(true);
    setTestResult('Testing connection...');
    const res = await testServerConnection(customIp);
    setIsTesting(false);
    setTestResult(res.message);
  };

  const handleSaveIp = async () => {
    if (!customIp.trim()) {
      Alert.alert('Invalid Address', 'Server URL cannot be empty.');
      return;
    }
    await setServerUrl(customIp);
    setShowIpModal(false);
    Alert.alert('Saved', `Server URL updated to:\n${customIp}`);
  };

  return (
    <ScrollView contentContainerStyle={styles.container} showsVerticalScrollIndicator={false}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: Math.max(insets.top, 20) + 12 }]}>
        <View>
          <Text style={styles.headerTitle}>Settings</Text>
          <Text style={styles.headerSub}>Staff profile and portal configuration</Text>
        </View>

        {/* Prominent Header Logout Button as requested */}
        <TouchableOpacity
          style={styles.headerLogoutBtn}
          onPress={handleLogout}
          activeOpacity={0.8}
        >
          <Icon name="logout" size={16} color={COLORS.accentRed} />
          <Text style={styles.headerLogoutText}>Logout</Text>
        </TouchableOpacity>
      </View>

      {/* Staff User Information Card */}
      <View style={styles.card}>
        <Text style={styles.sectionHeading}>User Information</Text>

        <View style={styles.profileRow}>
          <View style={styles.avatarContainer}>
            {user?.avatar ? (
              <Image source={{ uri: user.avatar }} style={styles.avatar} />
            ) : (
              <View style={styles.avatarPlaceholder}>
                <Text style={styles.avatarInitial}>
                  {user?.name ? user.name[0].toUpperCase() : 'S'}
                </Text>
              </View>
            )}
          </View>

          <View style={styles.profileDetails}>
            <Text style={styles.userName}>{user?.name || 'Support Staff'}</Text>
            <Text style={styles.userEmail}>{user?.email || 'staff@support.com'}</Text>
            <View style={styles.roleBadge}>
              <Text style={styles.roleText}>{user?.role?.toUpperCase() || 'STAFF PORTAL'}</Text>
            </View>
          </View>
        </View>
      </View>

      {/* WhatsApp Link Quick Info */}
      <View style={styles.card}>
        <Text style={styles.sectionHeading}>WhatsApp Status</Text>
        <View style={styles.waStatusRow}>
          <View style={[styles.waDot, isConnected ? styles.waDotOnline : styles.waDotOffline]} />
          <View style={{ flex: 1 }}>
            <Text style={styles.waStatusText}>
              {isConnected ? 'WhatsApp Session Active' : 'Waiting for QR Session'}
            </Text>
            <Text style={styles.waPhoneText}>
              {isConnected ? `Linked Phone: ${phone || name || 'Active'}` : 'Not currently connected'}
            </Text>
          </View>
        </View>
      </View>

      {/* Dynamic Backend Server URL Selector */}
      <View style={styles.card}>
        <Text style={styles.sectionHeading}>Network & Backend Server</Text>
        <Text style={styles.cardDesc}>
          Configure the active server endpoint. Works across LAN WiFi and remote APK builds without
          needing to recompile.
        </Text>

        <View style={styles.serverBox}>
          <View style={{ flex: 1 }}>
            <Text style={styles.serverUrlLabel}>Active Backend URL</Text>
            <Text style={styles.serverUrlText} numberOfLines={1}>
              {serverUrl}
            </Text>
          </View>
          <TouchableOpacity
            style={styles.editIpBtn}
            onPress={() => {
              setCustomIp(serverUrl);
              setTestResult(null);
              setShowIpModal(true);
            }}
          >
            <Text style={styles.editIpBtnText}>Edit IP</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Prominent Full Logout Button */}
      <TouchableOpacity
        style={styles.fullLogoutButton}
        onPress={handleLogout}
        activeOpacity={0.85}
      >
        <Icon name="logout" size={18} color={COLORS.bgWhite} />
        <Text style={styles.fullLogoutButtonText}>Sign Out of Staff Account</Text>
      </TouchableOpacity>

      <Text style={styles.footerVersion}>jeenMate Mobile App v1.0.0 (Build 11.09.2026)</Text>

      {/* Server IP Edit Modal */}
      <Modal
        visible={showIpModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowIpModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Change Backend Server</Text>
            <Text style={styles.modalSub}>
              Enter your backend computer's LAN IP address (e.g. http://192.168.1.9:5001)
            </Text>

            <TextInput
              style={styles.modalInput}
              value={customIp}
              onChangeText={setCustomIp}
              placeholder="http://192.168.1.9:5001"
              placeholderTextColor={COLORS.textSubtle}
              autoCapitalize="none"
              autoCorrect={false}
            />

            {testResult ? (
              <Text
                style={[
                  styles.testStatusText,
                  testResult.includes('success') || testResult.includes('Connected')
                    ? { color: COLORS.whatsappGreen }
                    : { color: COLORS.accentRed },
                ]}
              >
                {testResult}
              </Text>
            ) : null}

            <View style={styles.modalBtnRow}>
              <TouchableOpacity
                style={styles.modalTestBtn}
                onPress={handleTestConnection}
                disabled={isTesting}
              >
                {isTesting ? (
                  <ActivityIndicator size="small" color={COLORS.primary} />
                ) : (
                  <Text style={styles.modalTestBtnText}>Test Connection</Text>
                )}
              </TouchableOpacity>

              <TouchableOpacity style={styles.modalSaveBtn} onPress={handleSaveIp}>
                <Text style={styles.modalSaveBtnText}>Save</Text>
              </TouchableOpacity>
            </View>

            <TouchableOpacity style={styles.modalCancelBtn} onPress={() => setShowIpModal(false)}>
              <Text style={styles.modalCancelBtnText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    padding: SPACING.lg,
    paddingBottom: SPACING.xxxl,
    backgroundColor: COLORS.bgLinen,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: SPACING.md,
    marginBottom: SPACING.lg,
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
  headerLogoutBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FEE2E2',
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: RADIUS.md,
    gap: 6,
    borderWidth: 1,
    borderColor: '#FECACA',
  },
  headerLogoutText: {
    fontSize: 12,
    fontWeight: '700',
    color: COLORS.accentRed,
  },
  card: {
    backgroundColor: COLORS.bgWhite,
    borderRadius: RADIUS.xl,
    padding: SPACING.lg,
    marginBottom: SPACING.md,
    borderWidth: 1,
    borderColor: COLORS.borderColor,
    shadowColor: COLORS.shadowColor,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 2,
  },
  sectionHeading: {
    fontSize: 13,
    fontWeight: '700',
    color: COLORS.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: SPACING.md,
  },
  profileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  avatarContainer: {
    width: 60,
    height: 60,
    borderRadius: 30,
    overflow: 'hidden',
    backgroundColor: COLORS.primary,
  },
  avatar: {
    width: '100%',
    height: '100%',
  },
  avatarPlaceholder: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.primaryNavy,
  },
  avatarInitial: {
    color: COLORS.bgWhite,
    fontSize: 22,
    fontWeight: '800',
  },
  profileDetails: {
    flex: 1,
  },
  userName: {
    fontSize: 17,
    fontWeight: '800',
    color: COLORS.textDark,
  },
  userEmail: {
    fontSize: 13,
    color: COLORS.textMuted,
    marginTop: 2,
  },
  roleBadge: {
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(26, 59, 113, 0.08)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: RADIUS.sm,
    marginTop: 6,
  },
  roleText: {
    fontSize: 10,
    fontWeight: '700',
    color: COLORS.primary,
  },
  waStatusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  waDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  waDotOnline: {
    backgroundColor: COLORS.whatsappGreen,
  },
  waDotOffline: {
    backgroundColor: '#EAB308',
  },
  waStatusText: {
    fontSize: 14,
    fontWeight: '700',
    color: COLORS.textDark,
  },
  waPhoneText: {
    fontSize: 12,
    color: COLORS.textMuted,
    marginTop: 2,
  },
  cardDesc: {
    fontSize: 12,
    color: COLORS.textMuted,
    lineHeight: 18,
    marginBottom: SPACING.md,
  },
  serverBox: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: COLORS.bgLinen,
    borderRadius: RADIUS.md,
    padding: SPACING.md,
    borderWidth: 1,
    borderColor: COLORS.borderColor,
    gap: 10,
  },
  serverUrlLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: COLORS.textMuted,
    textTransform: 'uppercase',
  },
  serverUrlText: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.primaryNavy,
    marginTop: 2,
  },
  editIpBtn: {
    backgroundColor: COLORS.bgWhite,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: RADIUS.sm,
    borderWidth: 1,
    borderColor: COLORS.borderColor,
  },
  editIpBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: COLORS.primary,
  },
  fullLogoutButton: {
    backgroundColor: COLORS.accentRed,
    height: 50,
    borderRadius: RADIUS.lg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: SPACING.lg,
    gap: 8,
    shadowColor: COLORS.accentRed,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 3,
  },
  fullLogoutButtonText: {
    color: COLORS.bgWhite,
    fontSize: 15,
    fontWeight: '700',
  },
  footerVersion: {
    textAlign: 'center',
    marginTop: SPACING.xl,
    fontSize: 11,
    color: COLORS.textSubtle,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(7, 15, 30, 0.65)',
    justifyContent: 'center',
    padding: SPACING.xl,
  },
  modalCard: {
    backgroundColor: COLORS.bgWhite,
    borderRadius: RADIUS.xl,
    padding: SPACING.xl,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: COLORS.textDark,
  },
  modalSub: {
    fontSize: 12,
    color: COLORS.textMuted,
    marginTop: 4,
    marginBottom: SPACING.md,
    lineHeight: 18,
  },
  modalInput: {
    height: 46,
    borderWidth: 1,
    borderColor: COLORS.borderColor,
    borderRadius: RADIUS.md,
    paddingHorizontal: 12,
    fontSize: 14,
    color: COLORS.textDark,
    backgroundColor: COLORS.inputBg,
    marginBottom: 8,
  },
  testStatusText: {
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 10,
  },
  modalBtnRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 4,
  },
  modalTestBtn: {
    flex: 1,
    height: 44,
    borderRadius: RADIUS.md,
    backgroundColor: COLORS.bgLinen,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: COLORS.borderColor,
  },
  modalTestBtnText: {
    color: COLORS.primary,
    fontSize: 12,
    fontWeight: '700',
  },
  modalSaveBtn: {
    flex: 1,
    height: 44,
    borderRadius: RADIUS.md,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalSaveBtnText: {
    color: COLORS.bgWhite,
    fontSize: 13,
    fontWeight: '700',
  },
  modalCancelBtn: {
    alignItems: 'center',
    paddingVertical: 12,
    marginTop: 4,
  },
  modalCancelBtnText: {
    color: COLORS.textMuted,
    fontSize: 12,
    fontWeight: '600',
  },
});
