import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Image,
  ActivityIndicator,
  Share,
  Alert,
  Platform,
  Modal,
  TextInput,
  Clipboard,
} from 'react-native';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { useWhatsAppStore } from '../../store/whatsappStore';
import { COLORS, SPACING, RADIUS } from '../../constants/theme';
import { Icon } from '../../components/common/Icon';
import { Header } from '../../components/common/Header';

export const LinkScreen: React.FC = () => {
  const navigation = useNavigation<any>();
  const {
    isConnected,
    status,
    phone,
    name,
    qrDataUrl,
    fetchStatus,
    fetchQr,
    regenerateQr,
    resetSession,
    getQrPageUrl,
    isLoading,
    isCheckingStatus,
    hasCheckedStatus,
    setupSocketListeners,
    isResetting,
  } = useWhatsAppStore();

  const qrPageUrl = getQrPageUrl();

  // Check WhatsApp status and listen for live socket events and auto-refresh when scanning QR code
  useFocusEffect(
    useCallback(() => {
      fetchStatus();
      setupSocketListeners();

      // If disconnected, poll status every 2.5s so scanning QR code immediately auto-refreshes to Connected
      let pollTimer: any = null;
      if (!isConnected) {
        pollTimer = setInterval(() => {
          if (!useWhatsAppStore.getState().isConnected) {
            fetchStatus();
          } else {
            clearInterval(pollTimer);
          }
        }, 2500);
      }

      return () => {
        if (pollTimer) clearInterval(pollTimer);
      };
    }, [fetchStatus, setupSocketListeners, isConnected])
  );

  const [showUrlModal, setShowUrlModal] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleShareLink = async () => {
    try {
      await Share.share({
        title: 'jeenMate WhatsApp QR Web Link',
        message: `Open this link on your PC browser to scan and link WhatsApp:\n${qrPageUrl}`,
        url: qrPageUrl,
      });
    } catch (e: any) {
      Alert.alert('Share Failed', e.message);
    }
  };

  const handleCopyLink = () => {
    setShowUrlModal(true);
    setCopied(false);
  };

  const copyToClipboard = () => {
    try {
      Clipboard.setString(qrPageUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch (e) {
      console.log('Clipboard error', e);
    }
  };

  const handleResetSession = () => {
    Alert.alert(
      'Reset WhatsApp Session',
      'Are you sure you want to disconnect and reset the WhatsApp Web session? You will need to scan a new QR code to reconnect.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reset Session',
          style: 'destructive',
          onPress: async () => {
            const result = await resetSession();
            Alert.alert('Session Reset', result.message);
          },
        },
      ]
    );
  };

  return (
    <View style={styles.screenWrapper}>
      <Header
        title="WhatsApp Session"
        onBack={() => navigation.navigate('Home')}
      />
      <ScrollView contentContainerStyle={styles.container} showsVerticalScrollIndicator={false}>
        {/* Main Connection Card */}
        <View style={styles.card}>
          {isCheckingStatus && !hasCheckedStatus ? (
            <View style={styles.statusLoadingContainer}>
              <ActivityIndicator size="large" color={COLORS.primary} />
              <Text style={styles.statusLoadingTitle}>Checking WhatsApp Session</Text>
              <Text style={styles.statusLoadingSub}>
                Connecting to WhatsApp service, please wait...
              </Text>
            </View>
          ) : isConnected ? (
            <View style={styles.connectedContainer}>
              <View style={styles.successIconBox}>
                <Icon name="check-double" size={32} color={COLORS.whatsappGreen} strokeWidth={2.5} />
              </View>
              <Text style={styles.connectedTitle}>Session Active & Ready</Text>
              <View style={styles.sessionDetailsBox}>
                <View style={styles.detailRow}>
                  <Text style={styles.detailLabel}>Connected Name</Text>
                  <Text style={styles.detailValue}>{name || 'Staff Assistant'}</Text>
                </View>
                <View style={styles.detailDivider} />
                <View style={styles.detailRow}>
                  <Text style={styles.detailLabel}>Connected Status</Text>
                  <Text style={[styles.detailValue, { color: COLORS.whatsappGreen, fontWeight: '700' }]}>
                    {isConnected ? 'Connected' : 'Offline'}
                  </Text>
                </View>
                <View style={styles.detailDivider} />
                <View style={styles.detailRow}>
                  <Text style={styles.detailLabel}>Phone Number</Text>
                  <Text style={styles.detailValue}>{phone || 'Active'}</Text>
                </View>
                <View style={styles.detailDivider} />
                <View style={styles.detailRow}>
                  <Text style={styles.detailLabel}>Socket Status</Text>
                  <Text style={[styles.detailValue, { color: COLORS.whatsappGreen }]}>Online (2-way)</Text>
                </View>
              </View>
            </View>
          ) : (
            <View style={styles.qrContainer}>
              <Text style={styles.qrInstructionsTitle}>Scan to Link WhatsApp</Text>
              <Text style={styles.qrInstructionsSub}>
                Point your WhatsApp camera at the code below, or open the link on PC.
              </Text>

              <View style={styles.qrImageFrame}>
                {isLoading ? (
                  <View style={styles.qrLoadingBox}>
                    <ActivityIndicator size="large" color={COLORS.primary} />
                    <Text style={styles.qrLoadingText}>
                      Generating QR code... Please wait
                    </Text>
                  </View>
                ) : qrDataUrl ? (
                  <Image
                    source={{ uri: qrDataUrl }}
                    style={styles.qrImage}
                    resizeMode="contain"
                  />
                ) : (
                  <View style={styles.qrEmptyBox}>
                    <Icon name="qr-code" size={46} color={COLORS.textMuted} strokeWidth={1.5} />
                    <Text style={styles.qrEmptyTitle}>No QR Code Active</Text>
                    <Text style={styles.qrEmptySub}>
                      Tap "Generate QR Code" below to generate a new WhatsApp QR code.
                    </Text>
                  </View>
                )}
              </View>

              {/* Direct Regenerate / Generate QR button */}
              <TouchableOpacity
                style={styles.regenerateButton}
                onPress={() => regenerateQr()}
                disabled={isLoading}
                activeOpacity={0.8}
              >
                {isLoading ? (
                  <ActivityIndicator size="small" color={COLORS.primaryNavy} />
                ) : (
                  <>
                    <Icon name="refresh" size={16} color={COLORS.primaryNavy} strokeWidth={2.2} />
                    <Text style={styles.regenerateButtonText}>
                      {qrDataUrl ? 'Regenerate QR Code' : 'Generate QR Code'}
                    </Text>
                  </>
                )}
              </TouchableOpacity>

              {/* Note regarding QR Code expiration */}
              <View style={styles.expiryNoteBox}>
                <View style={styles.expiryNoteHeader}>
                  <Icon name="clock" size={13} color="#B45309" strokeWidth={2.2} />
                  <Text style={styles.expiryNoteTitle}>Important Note:</Text>
                </View>
                <Text style={styles.expiryNoteText}>
                  The QR code expires in 1 minute. If you do not scan it before expiry, please press <Text style={{ fontWeight: '700' }}>"Regenerate QR Code"</Text> to generate a new one.
                </Text>
              </View>
            </View>
          )}

          {/* QR Page Link & Sharing (only when not checking and not connected) */}
          {(!isCheckingStatus || hasCheckedStatus) && !isConnected && (
            <View style={styles.linkShareSection}>
              <View style={styles.actionButtonsRow}>
                <TouchableOpacity
                  style={styles.actionBtnOutline}
                  onPress={handleCopyLink}
                  activeOpacity={0.8}
                >
                  <Icon name="copy" size={16} color={COLORS.primary} />
                  <Text style={styles.actionBtnOutlineText}>Show Full URL</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.actionBtnPrimary}
                  onPress={handleShareLink}
                  activeOpacity={0.8}
                >
                  <Icon name="share" size={16} color={COLORS.bgWhite} />
                  <Text style={styles.actionBtnPrimaryText}>Share</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}

          {/* Instructions list (only when not checking and not connected) */}
          {(!isCheckingStatus || hasCheckedStatus) && !isConnected && (
            <View style={styles.guideBox}>
              <Text style={styles.guideTitle}>How to connect:</Text>
              <Text style={styles.guideStep}>1. Open WhatsApp on your device</Text>
              <Text style={styles.guideStep}>2. Tap Settings &gt; Linked Devices &gt; Link a Device</Text>
              <Text style={styles.guideStep}>3. Scan the QR code shown above or open the shared link on PC</Text>
            </View>
          )}

          {/* Reset Session Button */}
          {(!isCheckingStatus || hasCheckedStatus) && (
            <TouchableOpacity
              style={styles.resetButton}
              onPress={handleResetSession}
              disabled={isResetting}
              activeOpacity={0.8}
            >
              {isResetting ? (
                <ActivityIndicator size="small" color={COLORS.accentRed} />
              ) : (
                <>
                  <Icon name="refresh" size={16} color={COLORS.accentRed} />
                  <Text style={styles.resetButtonText}>Disconnect & Reset Session</Text>
                </>
              )}
            </TouchableOpacity>
          )}
        </View>
      </ScrollView>

      {/* Show Full URL & Copy Modal */}
      <Modal
        visible={showUrlModal}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setShowUrlModal(false)}
      >
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setShowUrlModal(false)}
        >
          <TouchableOpacity
            style={styles.modalCard}
            activeOpacity={1}
            onPress={(e) => e.stopPropagation()}
          >
            <View style={styles.modalHeader}>
              <View style={styles.modalTitleRow}>
                <View style={styles.modalIconWrap}>
                  <Icon name="link" size={17} color={COLORS.primaryNavy} />
                </View>
                <Text style={styles.modalTitle}>QR Web Scanner URL</Text>
              </View>
              <TouchableOpacity
                onPress={() => setShowUrlModal(false)}
                style={styles.modalCloseBtn}
                hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              >
                <Text style={styles.modalCloseText}>✕</Text>
              </TouchableOpacity>
            </View>

            <Text style={styles.modalSubtitle}>
              Open this URL in a browser on your PC to scan and link WhatsApp Web:
            </Text>

            <View style={styles.modalUrlInputWrapper}>
              <TextInput
                value={qrPageUrl}
                editable={false}
                multiline={true}
                selectTextOnFocus={true}
                style={styles.modalUrlInput}
              />
            </View>

            {copied && (
              <View style={styles.copiedBadge}>
                <Icon name="check" size={13} color="#16A34A" />
                <Text style={styles.copiedBadgeText}>Copied to clipboard!</Text>
              </View>
            )}

            <View style={styles.modalBtnRow}>
              <TouchableOpacity
                style={[styles.modalActionBtn, styles.modalCopyBtn, copied && styles.modalCopyBtnActive]}
                onPress={copyToClipboard}
                activeOpacity={0.8}
              >
                <Icon name={copied ? 'check' : 'copy'} size={15} color={copied ? '#FFFFFF' : COLORS.primaryNavy} />
                <Text style={[styles.modalCopyBtnText, copied && { color: '#FFFFFF' }]}>
                  {copied ? 'Copied!' : 'Copy URL'}
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.modalActionBtn, styles.modalShareBtn]}
                onPress={handleShareLink}
                activeOpacity={0.8}
              >
                <Icon name="share" size={15} color="#FFFFFF" />
                <Text style={styles.modalShareBtnText}>Share Link</Text>
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  screenWrapper: {
    flex: 1,
    backgroundColor: COLORS.bgWhite,
  },
  container: {
    paddingTop: 0,
    paddingBottom: SPACING.xxxl,
    backgroundColor: COLORS.bgWhite,
  },
  connectedName: {
    fontSize: 22,
    fontWeight: '800',
    color: COLORS.primaryNavy,
    marginBottom: 8,
    letterSpacing: -0.3,
    textAlign: 'center',
  },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.bgWhite,
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: RADIUS.full,
    gap: 8,
    borderWidth: 1,
    borderColor: COLORS.borderColor,
    marginBottom: 10,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  dotConnected: {
    backgroundColor: COLORS.whatsappGreen,
  },
  dotWaiting: {
    backgroundColor: '#EAB308',
  },
  dotOffline: {
    backgroundColor: COLORS.accentRed,
  },
  statusText: {
    fontSize: 12,
    fontWeight: '700',
    color: COLORS.textDark,
  },
  title: {
    fontSize: 22,
    fontWeight: '800',
    color: COLORS.primaryNavy,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 13,
    color: COLORS.textMuted,
    textAlign: 'center',
    marginTop: 4,
    paddingHorizontal: 20,
    lineHeight: 18,
  },
  card: {
    backgroundColor: COLORS.bgWhite,
    width: '100%',
    borderRadius: 0,
    paddingVertical: SPACING.xl,
    paddingHorizontal: SPACING.lg,
    borderTopWidth: 0,
    borderBottomWidth: 0,
    borderLeftWidth: 0,
    borderRightWidth: 0,
    borderColor: COLORS.borderColor,
    shadowColor: COLORS.shadowColor,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.05,
    shadowRadius: 10,
    elevation: 2,
  },
  statusLoadingContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
  },
  statusLoadingTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: COLORS.primaryNavy,
    marginTop: 16,
  },
  statusLoadingSub: {
    fontSize: 13,
    color: COLORS.textMuted,
    marginTop: 6,
    textAlign: 'center',
  },
  connectedContainer: {
    alignItems: 'center',
    paddingVertical: SPACING.md,
  },
  successIconBox: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: COLORS.whatsappLight,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: SPACING.md,
  },
  connectedTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: COLORS.textDark,
  },
  connectedDesc: {
    fontSize: 13,
    color: COLORS.textMuted,
    textAlign: 'center',
    marginTop: 6,
    paddingHorizontal: 10,
    lineHeight: 18,
  },
  sessionDetailsBox: {
    width: '100%',
    backgroundColor: COLORS.bgLinen,
    borderRadius: RADIUS.lg,
    padding: SPACING.md,
    marginTop: SPACING.lg,
    borderWidth: 1,
    borderColor: COLORS.borderColor,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 4,
  },
  detailLabel: {
    fontSize: 12,
    color: COLORS.textMuted,
    fontWeight: '600',
  },
  detailValue: {
    fontSize: 13,
    fontWeight: '700',
    color: COLORS.textDark,
  },
  detailDivider: {
    height: 1,
    backgroundColor: COLORS.borderColor,
    marginVertical: 6,
  },
  qrContainer: {
    alignItems: 'center',
  },
  qrInstructionsTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.textDark,
  },
  qrInstructionsSub: {
    fontSize: 12,
    color: COLORS.textMuted,
    textAlign: 'center',
    marginTop: 4,
    marginBottom: SPACING.md,
  },
  qrImageFrame: {
    width: 240,
    height: 240,
    borderRadius: RADIUS.lg,
    borderWidth: 2,
    borderColor: COLORS.borderColor,
    backgroundColor: '#FAFAFA',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  qrImage: {
    width: '100%',
    height: '100%',
  },
  qrLoadingBox: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: SPACING.lg,
  },
  qrLoadingText: {
    fontSize: 12,
    color: COLORS.textMuted,
    marginTop: 10,
    textAlign: 'center',
  },
  qrEmptyBox: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: SPACING.md,
  },
  qrEmptyTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: COLORS.textDark,
    marginTop: 8,
  },
  qrEmptySub: {
    fontSize: 11,
    color: COLORS.textMuted,
    textAlign: 'center',
    marginTop: 4,
    lineHeight: 16,
    paddingHorizontal: 10,
  },
  regenerateButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#EEF2FF',
    borderWidth: 1,
    borderColor: '#C7D2FE',
    borderRadius: RADIUS.md,
    paddingVertical: 10,
    paddingHorizontal: 18,
    marginTop: 14,
    width: 240,
  },
  regenerateButtonText: {
    fontSize: 13,
    fontWeight: '700',
    color: COLORS.primaryNavy,
  },
  expiryNoteBox: {
    backgroundColor: '#FFFBEB',
    borderWidth: 1,
    borderColor: '#FDE68A',
    borderRadius: RADIUS.md,
    padding: 10,
    marginTop: 14,
    width: 260,
  },
  expiryNoteHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginBottom: 4,
  },
  expiryNoteTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: '#92400E',
  },
  expiryNoteText: {
    fontSize: 11,
    color: '#78350F',
    lineHeight: 16,
  },
  linkShareSection: {
    marginTop: SPACING.xl,
    paddingTop: SPACING.lg,
    borderTopWidth: 1,
    borderTopColor: COLORS.borderColor,
  },
  linkShareLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: COLORS.textDark,
    marginBottom: 6,
  },
  urlBox: {
    backgroundColor: COLORS.bgLinen,
    borderRadius: RADIUS.md,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: COLORS.borderColor,
    marginBottom: 10,
  },
  urlText: {
    fontSize: 12,
    color: COLORS.primaryNavy,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  actionButtonsRow: {
    flexDirection: 'row',
    gap: 10,
  },
  actionBtnOutline: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    height: 42,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.primary,
    gap: 6,
  },
  actionBtnOutlineText: {
    color: COLORS.primary,
    fontSize: 12,
    fontWeight: '700',
  },
  actionBtnPrimary: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    height: 42,
    borderRadius: RADIUS.md,
    backgroundColor: COLORS.primary,
    gap: 6,
  },
  actionBtnPrimaryText: {
    color: COLORS.bgWhite,
    fontSize: 12,
    fontWeight: '700',
  },
  guideBox: {
    backgroundColor: '#F8FAFC',
    borderRadius: RADIUS.md,
    padding: SPACING.md,
    marginTop: SPACING.lg,
    borderWidth: 1,
    borderColor: COLORS.borderColor,
  },
  guideTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: COLORS.textDark,
    marginBottom: 4,
  },
  guideStep: {
    fontSize: 12,
    color: COLORS.textMuted,
    lineHeight: 18,
  },
  resetButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FEE2E2',
    height: 44,
    borderRadius: RADIUS.md,
    marginTop: SPACING.lg,
    gap: 8,
  },
  resetButtonText: {
    color: COLORS.accentRed,
    fontSize: 13,
    fontWeight: '700',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.55)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: SPACING.lg,
  },
  modalCard: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: COLORS.bgWhite,
    borderRadius: RADIUS.xl,
    padding: SPACING.lg,
    borderWidth: 1,
    borderColor: COLORS.borderColor,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.15,
    shadowRadius: 16,
    elevation: 8,
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
    backgroundColor: '#EEF2FF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.textDark,
  },
  modalCloseBtn: {
    padding: 4,
  },
  modalCloseText: {
    fontSize: 18,
    fontWeight: '600',
    color: COLORS.textMuted,
  },
  modalSubtitle: {
    fontSize: 12,
    color: COLORS.textMuted,
    lineHeight: 18,
    marginTop: 6,
    marginBottom: SPACING.md,
  },
  modalUrlInputWrapper: {
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: RADIUS.md,
    padding: SPACING.sm + 2,
    maxHeight: 110,
  },
  modalUrlInput: {
    fontSize: 12,
    color: COLORS.textDark,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    padding: 0,
  },
  copiedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'center',
    gap: 6,
    backgroundColor: '#DCFCE7',
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: RADIUS.full,
    marginTop: 10,
  },
  copiedBadgeText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#16A34A',
  },
  modalBtnRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: SPACING.lg,
  },
  modalActionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 12,
    borderRadius: RADIUS.md,
  },
  modalCopyBtn: {
    backgroundColor: '#EEF2FF',
    borderWidth: 1,
    borderColor: '#C7D2FE',
  },
  modalCopyBtnActive: {
    backgroundColor: '#16A34A',
    borderColor: '#16A34A',
  },
  modalCopyBtnText: {
    fontSize: 13,
    fontWeight: '700',
    color: COLORS.primaryNavy,
  },
  modalShareBtn: {
    backgroundColor: COLORS.primaryNavy,
  },
  modalShareBtnText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#FFFFFF',
  },
});
