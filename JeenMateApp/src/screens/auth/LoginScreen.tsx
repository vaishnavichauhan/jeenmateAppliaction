import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Modal,
  Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuthStore } from '../../store/authStore';
import { COLORS, SPACING, RADIUS } from '../../constants/theme';
import { Icon } from '../../components/common/Icon';
import { JeenMateLogo } from '../../components/common/JeenMateLogo';

export const LoginScreen: React.FC = () => {
  const insets = useSafeAreaInsets();
  const { login, serverUrl, setServerUrl, testServerConnection, isLoading, isLoginSuccess, loginError } = useAuthStore();

  const [email, setEmail] = useState('admin@support.com');
  const [password, setPassword] = useState('Admin@12345');
  const [showPassword, setShowPassword] = useState(false);
  const [focusedField, setFocusedField] = useState<'email' | 'password' | null>(null);

  // Server settings modal state
  const [showServerModal, setShowServerModal] = useState(false);
  const [customUrl, setCustomUrl] = useState(serverUrl);
  const [testStatus, setTestStatus] = useState<string | null>(null);
  const [isTesting, setIsTesting] = useState(false);

  const isBusy = isLoading || isLoginSuccess;

  const handleLogin = async () => {
    if (!email.trim() || !password) {
      Alert.alert('Required Fields', 'Please enter both your email address and password.');
      return;
    }
    await login(email, password);
  };

  const handleTestConnection = async () => {
    setIsTesting(true);
    setTestStatus('Testing connection...');
    const result = await testServerConnection(customUrl);
    setIsTesting(false);
    setTestStatus(result.message);
  };

  const handleSaveServerUrl = async () => {
    if (!customUrl.trim()) {
      Alert.alert('Invalid URL', 'Server URL cannot be empty.');
      return;
    }
    await setServerUrl(customUrl);
    setShowServerModal(false);
    Alert.alert('Saved', `Server URL updated to:\n${customUrl}`);
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 40 : 0}
    >
      <ScrollView
        contentContainerStyle={[
          styles.scrollContent,
          { paddingTop: Math.max(insets.top, 20) + 16 },
        ]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* Brand Header */}
        <View style={styles.brandContainer}>
          <View style={styles.logoWrapper}>
            <JeenMateLogo size={76} />
          </View>
          <Text style={styles.brandTitle}>jeenMate</Text>
          <Text style={styles.brandSubtitle}>
            Connect Smarter. Work Better.
          </Text>
        </View>

        {/* Login Card */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Sign In</Text>

          {/* Success Message */}
          {isLoginSuccess ? (
            <View style={styles.successBox}>
              <Icon name="check" size={16} color="#059669" strokeWidth={2.5} />
              <Text style={styles.successText}>Sign In Successful!</Text>
            </View>
          ) : null}

          {/* Error Message */}
          {loginError ? (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>{loginError}</Text>
            </View>
          ) : null}

          {/* Email Field */}
          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>Email Id</Text>
            <View
              style={[
                styles.inputWrapper,
                focusedField === 'email' && styles.inputWrapperFocused,
                isBusy && styles.inputWrapperDisabled,
              ]}
            >
              <View style={styles.inputIcon}>
                <Icon
                  name="mail"
                  size={18}
                  color={focusedField === 'email' ? COLORS.peacockDark : (isBusy ? COLORS.textMuted : COLORS.textMuted)}
                />
              </View>
              <TextInput
                style={[styles.input, isBusy && styles.inputDisabled]}
                placeholder="admin@support.com"
                placeholderTextColor={COLORS.textSubtle}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                value={email}
                onChangeText={setEmail}
                onFocus={() => setFocusedField('email')}
                onBlur={() => setFocusedField(null)}
                editable={!isBusy}
              />
            </View>
          </View>

          {/* Password Field with Eye Toggle */}
          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>Password</Text>
            <View
              style={[
                styles.inputWrapper,
                focusedField === 'password' && styles.inputWrapperFocused,
                isBusy && styles.inputWrapperDisabled,
              ]}
            >
              <View style={styles.inputIcon}>
                <Icon
                  name="lock"
                  size={18}
                  color={focusedField === 'password' ? COLORS.peacockDark : (isBusy ? COLORS.textMuted : COLORS.textMuted)}
                />
              </View>
              <TextInput
                style={[styles.input, { paddingRight: 48 }, isBusy && styles.inputDisabled]}
                placeholder="Enter password"
                placeholderTextColor={COLORS.textSubtle}
                secureTextEntry={!showPassword}
                autoCapitalize="none"
                value={password}
                onChangeText={setPassword}
                onFocus={() => setFocusedField('password')}
                onBlur={() => setFocusedField(null)}
                editable={!isBusy}
              />
              <TouchableOpacity
                style={styles.eyeButton}
                onPress={() => setShowPassword(!showPassword)}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                disabled={isBusy}
              >
                <Icon
                  name={showPassword ? 'eye' : 'eye-off'}
                  size={20}
                  color={COLORS.textMuted}
                />
              </TouchableOpacity>
            </View>
          </View>

          {/* Sign In Button */}
          <TouchableOpacity
            style={[
              styles.submitButton,
              isLoading && styles.submitButtonDisabled,
              isLoginSuccess && styles.submitButtonSuccess,
            ]}
            onPress={handleLogin}
            disabled={isBusy}
            activeOpacity={0.85}
          >
            {isLoginSuccess ? (
              <View style={styles.loadingButtonRow}>
                <Icon name="check" size={20} color={COLORS.bgWhite} strokeWidth={2.5} />
                <Text style={styles.submitButtonText}>Sign In Successful!</Text>
              </View>
            ) : isLoading ? (
              <View style={styles.loadingButtonRow}>
                <ActivityIndicator color={COLORS.bgWhite} size="small" />
                <Text style={styles.submitButtonText}>Signing In...</Text>
              </View>
            ) : (
              <Text style={styles.submitButtonText}>Sign In</Text>
            )}
          </TouchableOpacity>
        </View>

        {/* Server IP / URL Configuration Selector */}
        {/* <View style={styles.serverConfigContainer}>
          <View style={styles.serverInfoRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.serverConfigLabel}>Backend Server</Text>
              <Text style={styles.serverConfigUrl} numberOfLines={1}>
                {serverUrl}
              </Text>
            </View>
            <TouchableOpacity
              style={styles.serverChangeBtn}
              onPress={() => {
                setCustomUrl(serverUrl);
                setTestStatus(null);
                setShowServerModal(true);
              }}
            >
              <Text style={styles.serverChangeText}>Change IP</Text>
            </TouchableOpacity>
          </View>
        </View> */}
      </ScrollView>

      {/* Server URL Change Modal */}
      <Modal
        visible={showServerModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowServerModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalBox}>
            <Text style={styles.modalTitle}>Backend Server Settings</Text>
            <Text style={styles.modalSub}>
              Enter your backend server host IP (e.g. your computer LAN IP like http://192.168.1.9:5001)
            </Text>

            <TextInput
              style={styles.modalInput}
              value={customUrl}
              onChangeText={setCustomUrl}
              placeholder="http://192.168.1.9:5001"
              placeholderTextColor={COLORS.textSubtle}
              autoCapitalize="none"
              autoCorrect={false}
            />

            {testStatus ? (
              <Text
                style={[
                  styles.testStatusText,
                  testStatus.includes('success') || testStatus.includes('Connected')
                    ? { color: COLORS.whatsappGreen }
                    : { color: COLORS.accentRed },
                ]}
              >
                {testStatus}
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

              <TouchableOpacity
                style={styles.modalSaveBtn}
                onPress={handleSaveServerUrl}
              >
                <Text style={styles.modalSaveBtnText}>Save</Text>
              </TouchableOpacity>
            </View>

            <TouchableOpacity
              style={styles.modalCancelBtn}
              onPress={() => setShowServerModal(false)}
            >
              <Text style={styles.modalCancelBtnText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.bgLinen,
  },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: SPACING.xl,
    paddingBottom: SPACING.xl,
    justifyContent: 'flex-start',
  },
  brandContainer: {
    alignItems: 'center',
    marginTop: SPACING.xl,
    marginBottom: SPACING.lg,
  },
  logoWrapper: {
    marginBottom: SPACING.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgePill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(26, 59, 113, 0.08)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: RADIUS.full,
    marginBottom: SPACING.sm,
    gap: 6,
  },
  onlineDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: COLORS.whatsappGreen,
  },
  badgeText: {
    fontSize: 12,
    fontWeight: '700',
    color: COLORS.primary,
    letterSpacing: 0.3,
  },
  brandTitle: {
    fontSize: 34,
    fontWeight: '800',
    color: COLORS.primaryNavy,
    letterSpacing: -0.5,
  },
  brandSubtitle: {
    fontSize: 14,
    color: COLORS.textMuted,
    marginTop: 4,
    textAlign: 'center',
  },
  card: {
    backgroundColor: COLORS.bgWhite,
    borderRadius: RADIUS.xl,
    padding: SPACING.xl,
  },
  cardTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: COLORS.textDark,
    marginBottom: SPACING.lg,
  },
  successBox: {
    backgroundColor: COLORS.greenLight,
    padding: 12,
    borderRadius: RADIUS.md,
    marginBottom: SPACING.md,
    borderLeftWidth: 4,
    borderLeftColor: COLORS.greenDark,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  successText: {
    color: COLORS.greenDark,
    fontSize: 13,
    fontWeight: '600',
  },
  errorBox: {
    backgroundColor: '#FEE2E2',
    padding: 12,
    borderRadius: RADIUS.md,
    marginBottom: SPACING.md,
    borderLeftWidth: 4,
    borderLeftColor: COLORS.accentRed,
  },
  errorText: {
    color: COLORS.accentRed,
    fontSize: 13,
    fontWeight: '500',
  },
  inputGroup: {
    marginBottom: SPACING.md,
  },
  inputLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.textDark,
    marginBottom: 6,
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.inputBg,
    borderRadius: RADIUS.md,
    borderWidth: 1.5,
    borderColor: '#8AAEB2',
    position: 'relative',
  },
  inputWrapperFocused: {
    borderColor: COLORS.peacockDark,
    borderWidth: 1.5,
    backgroundColor: '#FFFFFF',
  },
  inputWrapperDisabled: {
    backgroundColor: COLORS.inputDisabledBg,
    borderColor: COLORS.inputBorder,
    opacity: 0.8,
  },
  inputIcon: {
    paddingHorizontal: 12,
  },
  input: {
    flex: 1,
    height: 48,
    fontSize: 15,
    color: COLORS.textDark,
  },
  inputDisabled: {
    color: COLORS.textPlaceholder,
  },
  eyeButton: {
    position: 'absolute',
    right: 14,
    padding: 4,
  },
  submitButton: {
    backgroundColor: COLORS.primary,
    height: 50,
    borderRadius: RADIUS.md,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: SPACING.sm,
    shadowColor: COLORS.shadow,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 4,
  },
  submitButtonDisabled: {
    opacity: 0.7,
  },
  submitButtonSuccess: {
    backgroundColor: COLORS.greenDark,
    shadowColor: COLORS.shadow,
  },
  loadingButtonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  submitButtonText: {
    color: COLORS.bgWhite,
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  demoFillBtn: {
    alignItems: 'center',
    marginTop: SPACING.md,
    paddingVertical: 6,
  },
  demoFillText: {
    fontSize: 12,
    color: COLORS.primary,
    fontWeight: '600',
  },
  serverConfigContainer: {
    marginTop: SPACING.lg,
    backgroundColor: COLORS.bgWhite,
    borderRadius: RADIUS.lg,
    padding: SPACING.md,
    borderWidth: 1,
    borderColor: COLORS.borderColor,
  },
  serverInfoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  serverConfigLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: COLORS.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  serverConfigUrl: {
    fontSize: 13,
    color: COLORS.textDark,
    fontWeight: '600',
    marginTop: 2,
  },
  serverChangeBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: COLORS.bgLinen,
    borderRadius: RADIUS.sm,
    borderWidth: 1,
    borderColor: COLORS.borderColor,
  },
  serverChangeText: {
    fontSize: 12,
    fontWeight: '700',
    color: COLORS.primary,
  },
  footerNote: {
    textAlign: 'center',
    marginTop: SPACING.xl,
    fontSize: 12,
    color: COLORS.textSubtle,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(7, 15, 30, 0.65)',
    justifyContent: 'center',
    padding: SPACING.xl,
  },
  modalBox: {
    backgroundColor: COLORS.bgWhite,
    borderRadius: RADIUS.xl,
    padding: SPACING.xl,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.textDark,
  },
  modalSub: {
    fontSize: 13,
    color: COLORS.textMuted,
    marginTop: 6,
    marginBottom: SPACING.md,
    lineHeight: 18,
  },
  modalInput: {
    height: 48,
    borderWidth: 1,
    borderColor: COLORS.borderColor,
    borderRadius: RADIUS.md,
    paddingHorizontal: 12,
    fontSize: 14,
    color: COLORS.textDark,
    backgroundColor: COLORS.inputBg,
    marginBottom: 10,
  },
  testStatusText: {
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 12,
  },
  modalBtnRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 6,
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
    fontSize: 13,
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
    marginTop: 6,
  },
  modalCancelBtnText: {
    color: COLORS.textMuted,
    fontSize: 13,
    fontWeight: '600',
  },
});
