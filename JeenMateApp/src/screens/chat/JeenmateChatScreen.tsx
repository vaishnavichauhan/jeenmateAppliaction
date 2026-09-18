import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  TextInput,
  RefreshControl,
  ActivityIndicator,
} from 'react-native';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { useInternalChatStore, Colleague } from '../../store/internalChatStore';
import { Header } from '../../components/common/Header';
import { Icon } from '../../components/common/Icon';
import { COLORS, SPACING, RADIUS } from '../../constants/theme';
import { parseInternalMessageDate } from './InternalChatDetailScreen';

export const JeenmateChatScreen: React.FC = () => {
  const navigation = useNavigation<any>();
  const {
    colleagues,
    isLoadingColleagues,
    fetchColleagues,
    setActiveColleague,
    setupSocketListeners,
  } = useInternalChatStore();

  const [searchQuery, setSearchQuery] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    setupSocketListeners();
  }, []);

  useFocusEffect(
    useCallback(() => {
      fetchColleagues();
    }, [])
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchColleagues();
    setRefreshing(false);
  };

  const handleSelectColleague = (item: Colleague) => {
    setActiveColleague(item);
    navigation.navigate('InternalChatDetail', {
      colleagueId: item.id,
      colleagueName: item.name,
      colleagueRole: item.role,
    });
  };

  const filteredColleagues = colleagues.filter((c) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      c.name.toLowerCase().includes(q) ||
      c.email.toLowerCase().includes(q) ||
      c.role.toLowerCase().includes(q)
    );
  });

  const formatTimestamp = (dateStr?: string | null) => {
    if (!dateStr) return '';
    const date = parseInternalMessageDate(dateStr);
    if (!date || isNaN(date.getTime())) return '';

    const now = new Date();
    const isToday =
      date.getDate() === now.getDate() &&
      date.getMonth() === now.getMonth() &&
      date.getFullYear() === now.getFullYear();

    if (isToday) {
      return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true });
    }

    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    const isYesterday =
      date.getDate() === yesterday.getDate() &&
      date.getMonth() === yesterday.getMonth() &&
      date.getFullYear() === yesterday.getFullYear();

    if (isYesterday) {
      return 'Yesterday';
    }

    return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
  };

  // Color generator for avatar based on name length / char code
  const getAvatarColor = (name: string) => {
    const colors = [
      '#1A3B71', // Navy
      '#0D9488', // Teal
      '#4F46E5', // Indigo
      '#E11D48', // Crimson
      '#D97706', // Amber
      '#0284C7', // Sky
      '#7C3AED', // Purple
    ];
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
      hash = name.charCodeAt(i) + ((hash << 5) - hash);
    }
    const index = Math.abs(hash) % colors.length;
    return colors[index];
  };

  const renderColleagueItem = ({ item }: { item: Colleague }) => {
    const avatarBg = getAvatarColor(item.name || 'Staff');
    const initials = item.name
      ? item.name
          .split(' ')
          .map((n) => n[0])
          .slice(0, 2)
          .join('')
          .toUpperCase()
      : 'U';

    const isAdmin = item.role?.toLowerCase() === 'admin';

    return (
      <TouchableOpacity
        style={styles.colleagueCard}
        onPress={() => handleSelectColleague(item)}
        activeOpacity={0.75}
      >
        {/* Avatar */}
        <View style={[styles.avatarCircle, { backgroundColor: avatarBg }]}>
          <Text style={styles.avatarText}>{initials}</Text>
        </View>

        {/* Info */}
        <View style={styles.colleagueInfo}>
          <View style={styles.colleagueHeaderRow}>
            <View style={styles.nameRoleRow}>
              <Text style={styles.colleagueName} numberOfLines={1}>
                {item.name}
              </Text>
              <View
                style={[
                  styles.roleBadge,
                  isAdmin ? styles.adminRoleBadge : styles.staffRoleBadge,
                ]}
              >
                <Text
                  style={[
                    styles.roleBadgeText,
                    isAdmin ? styles.adminRoleBadgeText : styles.staffRoleBadgeText,
                  ]}
                >
                  {isAdmin ? 'Admin' : 'User'}
                </Text>
              </View>
            </View>

            {item.last_message_time ? (
              <Text style={styles.timestampText}>
                {formatTimestamp(item.last_message_time)}
              </Text>
            ) : null}
          </View>

          <View style={styles.colleagueBottomRow}>
            <Text
              style={[
                styles.lastMessageText,
                item.unread_count && item.unread_count > 0 ? styles.unreadMessageText : null,
              ]}
              numberOfLines={1}
            >
              {item.last_message || 'Tap to start conversation'}
            </Text>

            {item.unread_count && item.unread_count > 0 ? (
              <View style={styles.unreadBadge}>
                <Text style={styles.unreadBadgeText}>{item.unread_count}</Text>
              </View>
            ) : (
              <Icon name="chevron-right" size={16} color={COLORS.textSubtle} strokeWidth={2.2} />
            )}
          </View>
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <View style={styles.container}>
      <Header
        title="Jeenmate Chat"
        subtitle="Internal Team Messaging"
        onBack={() => navigation.goBack()}
      />

      {/* Search Input Bar */}
      <View style={styles.searchContainer}>
        <View style={styles.searchWrapper}>
          <Icon name="search" size={16} color={COLORS.textMuted} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search colleagues by name, role..."
            placeholderTextColor={COLORS.textSubtle}
            value={searchQuery}
            onChangeText={setSearchQuery}
          />
          {searchQuery ? (
            <TouchableOpacity onPress={() => setSearchQuery('')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Text style={styles.clearSearch}>✕</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      </View>

      {/* List Content */}
      {isLoadingColleagues && colleagues.length === 0 ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={COLORS.primary} />
          <Text style={styles.loadingText}>Loading colleagues...</Text>
        </View>
      ) : (
        <FlatList
          data={filteredColleagues}
          keyExtractor={(item) => String(item.id)}
          renderItem={renderColleagueItem}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              colors={[COLORS.primary]}
            />
          }
          ItemSeparatorComponent={() => <View style={styles.separator} />}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <View style={styles.emptyIconCircle}>
                <Icon name="users" size={34} color={COLORS.primary} strokeWidth={2} />
              </View>
              <Text style={styles.emptyTitle}>No Colleagues Found</Text>
              <Text style={styles.emptySubtitle}>
                {searchQuery
                  ? 'No colleagues match your search query.'
                  : 'All registered team members in your database will appear here.'}
              </Text>
            </View>
          }
        />
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.bgLinen,
  },
  searchContainer: {
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.sm + 2,
    backgroundColor: COLORS.bgWhite,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.borderColor,
  },
  searchWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.inputBg,
    borderRadius: RADIUS.md,
    paddingHorizontal: SPACING.md,
    height: 40,
    borderWidth: 1,
    borderColor: COLORS.borderColor,
  },
  searchInput: {
    flex: 1,
    fontSize: 13,
    color: COLORS.textDark,
    marginLeft: SPACING.sm,
    paddingVertical: 0,
  },
  clearSearch: {
    fontSize: 14,
    color: COLORS.textMuted,
    paddingHorizontal: 4,
  },
  listContent: {
    paddingVertical: SPACING.sm,
    paddingBottom: SPACING.xxxl + 30,
  },
  colleagueCard: {
    backgroundColor: COLORS.bgWhite,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: SPACING.lg,
    paddingVertical: 14,
  },
  avatarCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: SPACING.md,
  },
  avatarText: {
    color: COLORS.bgWhite,
    fontSize: 16,
    fontWeight: '800',
  },
  colleagueInfo: {
    flex: 1,
  },
  colleagueHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  nameRoleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    marginRight: SPACING.sm,
    gap: 8,
  },
  colleagueName: {
    fontSize: 15,
    fontWeight: '700',
    color: COLORS.primaryNavy,
  },
  roleBadge: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: RADIUS.full,
  },
  adminRoleBadge: {
    backgroundColor: 'rgba(26, 59, 113, 0.1)',
  },
  staffRoleBadge: {
    backgroundColor: 'rgba(100, 116, 139, 0.1)',
  },
  roleBadgeText: {
    fontSize: 10,
    fontWeight: '700',
  },
  adminRoleBadgeText: {
    color: COLORS.primary,
  },
  staffRoleBadgeText: {
    color: COLORS.textMuted,
  },
  timestampText: {
    fontSize: 11,
    color: COLORS.textSubtle,
  },
  colleagueBottomRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  lastMessageText: {
    fontSize: 13,
    color: COLORS.textMuted,
    flex: 1,
    marginRight: SPACING.sm,
  },
  unreadMessageText: {
    color: COLORS.textDark,
    fontWeight: '600',
  },
  unreadBadge: {
    backgroundColor: COLORS.accentRed,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: RADIUS.full,
    minWidth: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  unreadBadgeText: {
    color: COLORS.bgWhite,
    fontSize: 10,
    fontWeight: '800',
  },
  separator: {
    height: 1,
    backgroundColor: COLORS.borderColor,
    marginLeft: 74,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 10,
    fontSize: 13,
    color: COLORS.textMuted,
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: SPACING.xxl,
    paddingTop: 80,
  },
  emptyIconCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: 'rgba(26, 59, 113, 0.08)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: SPACING.md,
  },
  emptyTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: COLORS.primaryNavy,
    marginBottom: 4,
  },
  emptySubtitle: {
    fontSize: 13,
    color: COLORS.textMuted,
    textAlign: 'center',
    lineHeight: 18,
  },
});
