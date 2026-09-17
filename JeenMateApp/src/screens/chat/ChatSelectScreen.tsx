import React, { useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useWhatsAppStore } from '../../store/whatsappStore';
import { useChatStore } from '../../store/chatStore';
import { Header } from '../../components/common/Header';
import { Icon } from '../../components/common/Icon';
import { COLORS, SPACING, RADIUS } from '../../constants/theme';

export const ChatSelectScreen: React.FC = () => {
  const navigation = useNavigation<any>();
  const { isConnected, fetchStatus } = useWhatsAppStore();
  const { conversations, fetchConversations } = useChatStore();

  useEffect(() => {
    fetchStatus();
    fetchConversations();
  }, [fetchStatus, fetchConversations]);

  const unreadCount = conversations.reduce(
    (acc, conv) => acc + (conv.unread_count || 0),
    0
  );

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
        {/* 1. WhatsApp Chat Card */}
        <TouchableOpacity
          style={styles.chatCard}
          onPress={() => navigation.navigate('WhatsAppChat')}
          activeOpacity={0.82}
        >
          <View style={[styles.iconContainer, styles.whatsappIconBg]}>
            <Icon name="whatsapp" size={26} color={COLORS.bgWhite} strokeWidth={2.2} />
          </View>

          <View style={styles.cardDetails}>
            <View style={styles.titleRow}>
              <Text style={styles.cardTitle}>WhatsApp Chat</Text>
            </View>
            <Text style={styles.cardSubtitle}>
              Customer conversations, live chats, sync & follow-up tasks.
            </Text>

            <View style={styles.badgeRow}>
              <View
                style={[
                  styles.statusIndicator,
                  { backgroundColor: isConnected ? COLORS.whatsappGreen : '#94A3B8' },
                ]}
              />
              <Text style={styles.statusText}>
                {isConnected ? 'Connected & Active' : 'Not Linked'}
              </Text>
            </View>
          </View>

          <View style={styles.arrowBox}>
            <Icon name="chevron-right" size={20} color={COLORS.textSubtle} strokeWidth={2.2} />
          </View>
        </TouchableOpacity>

        {/* 2. Jeenmate Chat Card */}
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
              <Text style={styles.cardTitle}>Jeenmate Chat</Text>
            </View>

            <Text style={styles.cardSubtitle}>
              Internal team messaging, private chats & channels.
            </Text>

            <View style={styles.badgeRow}>
              <View style={[styles.statusIndicator, { backgroundColor: '#8B5CF6' }]} />
              <Text style={[styles.statusText, { color: '#8B5CF6' }]}>
                In Active Development 
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
    backgroundColor: COLORS.bgLinen,
  },
  scrollContent: {
    padding: SPACING.lg,
    paddingBottom: SPACING.xxxl + 20,
  },
  sectionHeader: {
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.8,
    color: COLORS.textMuted,
    marginBottom: SPACING.md,
    marginLeft: 2,
  },
  chatCard: {
    backgroundColor: COLORS.bgWhite,
    borderRadius: RADIUS.xl,
    padding: SPACING.lg,
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: SPACING.md,
    borderWidth: 1,
    borderColor: COLORS.borderColor,
    elevation: 3,
    shadowColor: COLORS.shadowColor,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 6,
  },
  iconContainer: {
    width: 52,
    height: 52,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: SPACING.md,
  },
  whatsappIconBg: {
    backgroundColor: COLORS.whatsappGreen,
  },
  jeenmateIconBg: {
    backgroundColor: COLORS.primaryNavy,
  },
  cardDetails: {
    flex: 1,
    justifyContent: 'center',
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 4,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: COLORS.primaryNavy,
  },
  cardSubtitle: {
    fontSize: 12.5,
    color: COLORS.textMuted,
    lineHeight: 18,
    marginBottom: 8,
  },
  badgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  statusIndicator: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  statusText: {
    fontSize: 11.5,
    fontWeight: '700',
    color: COLORS.textMuted,
  },
  dotDivider: {
    fontSize: 12,
    color: COLORS.textSubtle,
  },
  chatsCountText: {
    fontSize: 11.5,
    fontWeight: '600',
    color: COLORS.textMuted,
  },
  unreadBadge: {
    backgroundColor: COLORS.accentRed,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: RADIUS.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  unreadText: {
    color: COLORS.bgWhite,
    fontSize: 10,
    fontWeight: '800',
  },
  comingSoonPill: {
    backgroundColor: 'rgba(139, 92, 246, 0.12)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: RADIUS.full,
    borderWidth: 1,
    borderColor: 'rgba(139, 92, 246, 0.25)',
  },
  comingSoonPillText: {
    color: '#8B5CF6',
    fontSize: 10.5,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  arrowBox: {
    marginLeft: SPACING.sm,
    padding: 4,
  },
  infoBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: 'rgba(22, 50, 91, 0.04)',
    borderRadius: RADIUS.lg,
    padding: SPACING.md,
    marginTop: SPACING.sm,
    borderWidth: 1,
    borderColor: 'rgba(22, 50, 91, 0.08)',
    gap: 12,
  },
  infoIconWrapper: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: 'rgba(22, 50, 91, 0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  infoContent: {
    flex: 1,
  },
  infoTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: COLORS.primaryNavy,
    marginBottom: 2,
  },
  infoDesc: {
    fontSize: 12,
    color: COLORS.textMuted,
    lineHeight: 17,
  },
});
