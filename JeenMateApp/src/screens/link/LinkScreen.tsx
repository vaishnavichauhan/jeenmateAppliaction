import React, { useEffect } from 'react';
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
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useWhatsAppStore } from '../../store/whatsappStore';
import { COLORS, SPACING, RADIUS } from '../../constants/theme';
import { Icon } from '../../components/common/Icon';

export const LinkScreen: React.FC = () => {
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();
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
    isResetting,
  } = useWhatsAppStore();

  const qrPageUrl = getQrPageUrl();

  useEffect(() => {
    fetchStatus();
    fetchQr();

    // Auto-refresh QR code every 3 seconds if not connected
    const interval = setInterval(() => {
      fetchStatus();
      if (!isConnected) {
        fetchQr();
      }
    }, 3000);

    return () => clearInterval(interval);
  }, [fetchStatus, fetchQr, isConnected]);

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
    Alert.alert(
      'QR Page URL',
      `URL:\n${qrPageUrl}\n\nYou can open this address directly on your computer browser to scan the WhatsApp QR code.`,
      [{ text: 'OK' }]
    );
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
    <ScrollView contentContainerStyle={styles.container} showsVerticalScrollIndicator={false}>
      {/* Top Header */}
      <View style={[styles.topHeader, { paddingTop: Math.max(insets.top, 20) + 12 }]}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => navigation.navigate('Home')}
          activeOpacity={0.7}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          <Icon name="arrow-left" size={20} color={COLORS.primaryNavy} strokeWidth={2.5} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>WhatsApp Session</Text>
      </View>

      {/* Main Connection Card */}
      <View style={styles.card}>
        {isConnected ? (
          <View style={styles.connectedContainer}>
            <View style={styles.successIconBox}>
              <Icon name="check-double" size={32} color={COLORS.whatsappGreen} strokeWidth={2.5} />
            </View>
            <Text style={styles.connectedTitle}>Session Active & Ready</Text>
            <Text style={styles.connectedDesc}>
              Incoming customer messages will automatically appear in your live inbox and can be
              converted into CRM tasks with 1-tap.
            </Text>

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
              {qrDataUrl ? (
                <Image
                  source={{ uri: qrDataUrl }}
                  style={styles.qrImage}
                  resizeMode="contain"
                />
              ) : (
                <View style={styles.qrLoadingBox}>
                  <ActivityIndicator size="large" color={COLORS.primary} />
                  <Text style={styles.qrLoadingText}>
                    {isLoading ? 'Fetching QR code...' : 'Generating QR code in background...'}
                  </Text>
                </View>
              )}
            </View>

            <View style={styles.autoRefreshBadge}>
              <Icon name="clock" size={12} color={COLORS.textMuted} />
              <Text style={styles.autoRefreshText}>Auto-refreshes every 3 seconds</Text>
            </View>

            {/* Direct Regenerate QR button */}
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
                  <Icon name="refresh" size={15} color={COLORS.primaryNavy} strokeWidth={2.2} />
                  <Text style={styles.regenerateButtonText}>Regenerate QR Code</Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        )}

        {/* QR Page Link & Sharing */}
        <View style={styles.linkShareSection}>
          <Text style={styles.linkShareLabel}>Web Browser Scanner URL</Text>
          <View style={styles.urlBox}>
            <Text style={styles.urlText} numberOfLines={1}>
              {qrPageUrl}
            </Text>
          </View>

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

        {/* Instructions list */}
        <View style={styles.guideBox}>
          <Text style={styles.guideTitle}>How to connect:</Text>
          <Text style={styles.guideStep}>1. Open WhatsApp on your device</Text>
          <Text style={styles.guideStep}>2. Tap Settings &gt; Linked Devices &gt; Link a Device</Text>
          <Text style={styles.guideStep}>3. Scan the QR code shown above or open the shared link on PC</Text>
        </View>

        {/* Reset Session Button */}
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
      </View>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    paddingBottom: SPACING.xxxl,
    backgroundColor: COLORS.bgLinen,
  },
  topHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: SPACING.lg,
    paddingTop: Platform.OS === 'ios' ? 12 : SPACING.sm,
    paddingHorizontal: SPACING.lg,
    gap: 14,
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
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderLeftWidth: 0,
    borderRightWidth: 0,
    borderColor: COLORS.borderColor,
    shadowColor: COLORS.shadowColor,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.05,
    shadowRadius: 10,
    elevation: 2,
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
  autoRefreshBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 10,
  },
  autoRefreshText: {
    fontSize: 11,
    color: COLORS.textMuted,
    fontWeight: '500',
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
});
