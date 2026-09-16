import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  Modal,
  TextInput,
  ActivityIndicator,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useAuthStore } from '../../store/authStore';
import { useWhatsAppStore } from '../../store/whatsappStore';
import { useTaskStore } from '../../store/taskStore';
import { COLORS, SPACING, RADIUS } from '../../constants/theme';
import { Icon } from '../../components/common/Icon';
import { Header } from '../../components/common/Header';

export const SettingsScreen: React.FC = () => {
  const navigation = useNavigation<any>();
  const { user, logout, createUser } = useAuthStore();
  const { isConnected, phone, name, fetchStatus } = useWhatsAppStore();
  const { teamMembers, fetchTeamMembers } = useTaskStore();

  // User List Collapse/Expand State
  const [isUserListExpanded, setIsUserListExpanded] = useState(true);

  // Add User Modal State
  const [showAddModal, setShowAddModal] = useState(false);
  const [newName, setNewName] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newRole, setNewRole] = useState<'user' | 'admin'>('user');
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    fetchTeamMembers();
    fetchStatus();
  }, []);

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

  const handleCreateUser = async () => {
    if (!newName.trim() || !newEmail.trim() || !newPassword.trim()) {
      Alert.alert('Required Fields', 'Please enter full name, email address, and password.');
      return;
    }

    try {
      setIsSubmitting(true);
      const res = await createUser(newName.trim(), newEmail.trim(), newPassword.trim(), newRole);
      if (res.success) {
        Alert.alert('Success', res.message || 'User created successfully.');
        setShowAddModal(false);
        setNewName('');
        setNewEmail('');
        setNewPassword('');
        setNewRole('user');
        await fetchTeamMembers();
      } else {
        Alert.alert('Error', res.message || 'Failed to create user.');
      }
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Something went wrong.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const isAdmin = user?.role?.toLowerCase() === 'admin';

  return (
    <View style={styles.screenWrapper}>
      {/* Reusable Header */}
      <Header
        title="Settings"
        onBack={() => navigation.navigate('Home')}
      />

      <ScrollView
        contentContainerStyle={styles.container}
        showsVerticalScrollIndicator={false}
      >
        {/* Profile Hero Card */}
        <View style={styles.card}>
          <View style={styles.profileRow}>
            <View style={styles.profileAvatarBox}>
              <Text style={styles.profileAvatarText}>
                {user?.name?.trim() ? user.name.trim()[0].toUpperCase() : 'U'}
              </Text>
            </View>
            <View style={styles.profileInfoCol}>
              <Text style={styles.profileName} numberOfLines={1}>
                {user?.name || 'Staff Member'}
              </Text>
              <Text style={styles.profileEmail} numberOfLines={1}>
                {user?.email || 'staff@jeenmate.com'}
              </Text>
              <View style={styles.roleBadgeRow}>
                <View style={styles.roleBadge}>
                  <Icon name="shield" size={11} color={COLORS.primary} />
                  <Text style={styles.roleBadgeText}>
                    {user?.role?.toUpperCase() || 'STAFF'}
                  </Text>
                </View>
              </View>
            </View>
          </View>
        </View>

        {/* All-in-One Settings Card (Bottom 3 Cards Combined) */}
        <View style={styles.allInOneCard}>
          {/* 1. WhatsApp Connection Section */}
          <View style={styles.cardSection}>
            <View style={styles.cardHeaderRow}>
              <View style={styles.cardHeaderLeft}>
                <View style={styles.cardHeaderIconBoxWA}>
                  <Icon name="phone" size={15} color={COLORS.whatsappGreen} />
                </View>
                <Text style={styles.cardSectionTitle}>WhatsApp Connection</Text>
              </View>
              <View style={[styles.waStatusBadge, isConnected ? styles.waStatusBadgeOnline : styles.waStatusBadgeOffline]}>
                <View style={[styles.waDot, isConnected ? styles.waDotOnline : styles.waDotOffline]} />
                <Text style={[styles.waStatusBadgeText, isConnected ? styles.waStatusBadgeTextOnline : styles.waStatusBadgeTextOffline]}>
                  {isConnected ? 'Active' : 'Offline'}
                </Text>
              </View>
            </View>

            <View style={styles.waInfoRow}>
              <Text style={styles.waStatusLabel}>
                {isConnected ? 'Connected & Active' : 'Offline / Not Linked'}
              </Text>
              <Text style={styles.waPhoneLabel}>
                Linked Name: {name || ''}
              </Text>
              <Text style={styles.waPhoneLabel}>
                {isConnected ? `Linked Phone: ${phone || 'Active'}` : 'Link WhatsApp to sync live customer chats'}
              </Text>
            </View>

            <TouchableOpacity
              style={styles.cardActionRow}
              onPress={() => navigation.navigate('Link')}
              activeOpacity={0.7}
            >
              <Text style={styles.cardActionText}>Manage Session & QR Code</Text>
              <Icon name="chevron-right" size={16} color={COLORS.primary} />
            </TouchableOpacity>
          </View>

          {/* Divider Border Between Cards */}
          <View style={styles.sectionDividerBorder} />

          {/* 2. Users / Team Members Section */}
          <View style={styles.cardSection}>
            <View style={styles.userListHeaderRow}>
              <TouchableOpacity
                style={styles.cardHeaderLeft}
                onPress={() => setIsUserListExpanded(!isUserListExpanded)}
                activeOpacity={0.7}
              >
                <View style={styles.cardHeaderIconBoxUsers}>
                  <Icon name="users" size={15} color={COLORS.primary} />
                </View>
                <Text style={styles.cardSectionTitle}>User List</Text>
              </TouchableOpacity>

              <View style={styles.userListHeaderRight}>
                {isAdmin && (
                  <TouchableOpacity
                    style={styles.addUserBtn}
                    onPress={() => setShowAddModal(true)}
                    activeOpacity={0.7}
                  >
                    <Icon name="plus" size={12} color={COLORS.primary} />
                    <Text style={styles.addUserBtnText}>Create User</Text>
                  </TouchableOpacity>
                )}

                <TouchableOpacity
                  style={styles.collapseArrowBtn}
                  onPress={() => setIsUserListExpanded(!isUserListExpanded)}
                  activeOpacity={0.7}
                >
                  <Icon
                    name={isUserListExpanded ? 'chevron-up' : 'chevron-down'}
                    size={18}
                    color={COLORS.textMuted}
                  />
                </TouchableOpacity>
              </View>
            </View>

            {/* User List with Collapse & Max Height Scroll */}
            {isUserListExpanded && (
              <ScrollView
                style={styles.userListScrollContainer}
                contentContainerStyle={styles.userListContainer}
                nestedScrollEnabled={true}
                showsVerticalScrollIndicator={false}
              >
                {teamMembers.map((member, index) => {
                  const isCurrent = user?.email?.toLowerCase() === member.email?.toLowerCase();
                  const memberIsAdmin = member.role?.toLowerCase() === 'admin';
                  const initial = member.name?.trim() ? member.name.trim()[0].toUpperCase() : 'U';

                  return (
                    <View
                      key={member.id || index}
                      style={[styles.userRow, index > 0 && styles.userRowBorder]}
                    >
                      <View
                        style={[
                          styles.userAvatar,
                          memberIsAdmin ? styles.userAvatarAdmin : styles.userAvatarStaff,
                        ]}
                      >
                        <Text
                          style={[
                            styles.userAvatarText,
                            memberIsAdmin ? styles.userAvatarTextAdmin : styles.userAvatarTextStaff,
                          ]}
                        >
                          {initial}
                        </Text>
                      </View>

                      <View style={styles.userInfoCol}>
                        <View style={styles.userNameRow}>
                          <Text style={styles.userName} numberOfLines={1}>
                            {member.name}
                          </Text>
                          {isCurrent && (
                            <View style={styles.youBadge}>
                              <Text style={styles.youBadgeText}>You</Text>
                            </View>
                          )}
                        </View>
                      </View>

                      <View
                        style={[
                          styles.userRoleBadge,
                          memberIsAdmin ? styles.userRoleBadgeAdmin : styles.userRoleBadgeStaff,
                        ]}
                      >
                        {memberIsAdmin && <Icon name="shield" size={10} color="#7E22CE" />}
                        <Text
                          style={[
                            styles.userRoleText,
                            memberIsAdmin ? styles.userRoleTextAdmin : styles.userRoleTextStaff,
                          ]}
                        >
                          {member.role ? member.role.toUpperCase() : 'STAFF'}
                        </Text>
                      </View>
                    </View>
                  );
                })}
              </ScrollView>
            )}
          </View>

          {/* Divider Border Between Cards */}
          <View style={styles.sectionDividerBorder} />

          {/* 3. Preferences Section (Theme & Notification - Text Only) */}
          <View style={styles.cardSection}>
            <View style={styles.cardHeaderRow}>
              <View style={styles.cardHeaderLeft}>
                <View style={styles.cardHeaderIconBoxPref}>
                  <Icon name="settings" size={15} color={COLORS.primary} />
                </View>
                <Text style={styles.cardSectionTitle}>Preferences</Text>
              </View>
            </View>

            {/* Theme Option (Text Only) */}
            <View style={styles.prefRow}>
              <View style={styles.prefLeft}>
                <View style={styles.prefIconBoxTheme}>
                  <Icon name="moon" size={15} color="#6366F1" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.prefTitle}>Theme</Text>
                  <Text style={styles.prefSubtitle}>Light mode</Text>
                </View>
              </View>
              <View style={styles.prefRight}>
                <Text style={styles.prefValueText}>Light</Text>
                <Icon name="chevron-right" size={15} color={COLORS.textMuted} />
              </View>
            </View>

            {/* Divider */}
            <View style={styles.prefDivider} />

            {/* Notification Option (Text Only) */}
            <View style={styles.prefRow}>
              <View style={styles.prefLeft}>
                <View style={styles.prefIconBoxNotif}>
                  <Icon name="bell" size={15} color="#D97706" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.prefTitle}>Notifications</Text>
                  <Text style={styles.prefSubtitle}>Messages, calls & alerts</Text>
                </View>
              </View>
              <View style={styles.prefRight}>
                <Text style={styles.prefValueText}>Enabled</Text>
                <Icon name="chevron-right" size={15} color={COLORS.textMuted} />
              </View>
            </View>
          </View>
        </View>

        {/* Logout Card Button */}
        <TouchableOpacity
          style={styles.logoutCard}
          onPress={handleLogout}
          activeOpacity={0.8}
        >
          <Icon name="logout" size={17} color={COLORS.accentRed} />
          <Text style={styles.logoutCardText}>Sign Out</Text>
        </TouchableOpacity>

        {/* App Version Info */}
        <Text style={styles.versionText}>jeenMate Mobile App • v1.0.0</Text>
      </ScrollView>

      {/* Add User Modal */}
      <Modal
        visible={showAddModal}
        transparent
        animationType="fade"
        onRequestClose={() => {
          if (!isSubmitting) setShowAddModal(false);
        }}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeaderRow}>
              <View style={styles.modalHeaderIconBox}>
                <Icon name="user-plus" size={18} color={COLORS.primary} />
              </View>
              <Text style={styles.modalTitle}>Add New User</Text>
            </View>
            <Text style={styles.modalSub}>
              Create a new staff or administrator account for jeenMate.
            </Text>

            {/* Name Input */}
            <Text style={styles.inputLabel}>Full Name</Text>
            <TextInput
              style={styles.modalInput}
              value={newName}
              onChangeText={setNewName}
              placeholder="e.g. Rahul Sharma"
              placeholderTextColor={COLORS.textMuted}
              editable={!isSubmitting}
            />

            {/* Email Input */}
            <Text style={styles.inputLabel}>Email Address</Text>
            <TextInput
              style={styles.modalInput}
              value={newEmail}
              onChangeText={setNewEmail}
              placeholder="e.g. rahul@jeenmate.com"
              placeholderTextColor={COLORS.textMuted}
              keyboardType="email-address"
              autoCapitalize="none"
              editable={!isSubmitting}
            />

            {/* Password Input */}
            <Text style={styles.inputLabel}>Password</Text>
            <TextInput
              style={styles.modalInput}
              value={newPassword}
              onChangeText={setNewPassword}
              placeholder="Temporary password"
              placeholderTextColor={COLORS.textMuted}
              secureTextEntry
              editable={!isSubmitting}
            />

            {/* Role Selection */}
            <Text style={styles.inputLabel}>Role</Text>
            <View style={styles.rolePickerRow}>
              <TouchableOpacity
                style={[
                  styles.rolePickerBtn,
                  newRole === 'user' && styles.rolePickerBtnActive,
                ]}
                onPress={() => setNewRole('user')}
                disabled={isSubmitting}
              >
                <Text
                  style={[
                    styles.rolePickerBtnText,
                    newRole === 'user' && styles.rolePickerBtnTextActive,
                  ]}
                >
                  Staff
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.rolePickerBtn,
                  newRole === 'admin' && styles.rolePickerBtnActive,
                ]}
                onPress={() => setNewRole('admin')}
                disabled={isSubmitting}
              >
                <Text
                  style={[
                    styles.rolePickerBtnText,
                    newRole === 'admin' && styles.rolePickerBtnTextActive,
                  ]}
                >
                  Admin
                </Text>
              </TouchableOpacity>
            </View>

            {/* Action Buttons */}
            <View style={styles.modalBtnRow}>
              <TouchableOpacity
                style={styles.modalCancelBtn}
                onPress={() => setShowAddModal(false)}
                disabled={isSubmitting}
              >
                <Text style={styles.modalCancelBtnText}>Cancel</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.modalCreateBtn}
                onPress={handleCreateUser}
                disabled={isSubmitting}
              >
                {isSubmitting ? (
                  <ActivityIndicator size="small" color={COLORS.bgWhite} />
                ) : (
                  <Text style={styles.modalCreateBtnText}>Create User</Text>
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
    backgroundColor: '#F8FAFC',
  },
  container: {
    padding: 16,
    paddingBottom: 36,
    gap: 12,
  },

  // Profile Card
  profileCard: {
    backgroundColor: COLORS.bgWhite,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 5,
    elevation: 1.5,
  },
  profileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  profileAvatarBox: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: COLORS.primaryNavy,
    alignItems: 'center',
    justifyContent: 'center',
  },
  profileAvatarText: {
    color: COLORS.bgWhite,
    fontSize: 22,
    fontWeight: '800',
  },
  profileInfoCol: {
    flex: 1,
  },
  profileName: {
    fontSize: 16,
    fontWeight: '800',
    color: COLORS.primaryNavy,
  },
  profileEmail: {
    fontSize: 12,
    color: COLORS.textMuted,
    marginTop: 2,
  },
  roleBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 6,
  },
  roleBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: '#EEF2F6',
    paddingHorizontal: 9,
    paddingVertical: 3,
    borderRadius: RADIUS.full,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  roleBadgeText: {
    fontSize: 10,
    fontWeight: '800',
    color: COLORS.primary,
    letterSpacing: 0.4,
  },

  // Base Card Style
  card: {
    backgroundColor: COLORS.bgWhite,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 5,
    elevation: 1.5,
  },
  allInOneCard: {
    backgroundColor: COLORS.bgWhite,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 5,
    elevation: 1.5,
    overflow: 'hidden',
  },
  cardSection: {
    padding: 16,
  },
  sectionDividerBorder: {
    height: 1,
    backgroundColor: '#E2E8F0',
  },
  cardHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  cardHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
  },
  cardHeaderIconBoxWA: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: COLORS.whatsappLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardSectionTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: COLORS.primaryNavy,
  },

  // WhatsApp Connection Card
  waStatusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: RADIUS.full,
  },
  waStatusBadgeOnline: {
    backgroundColor: '#DCFCE7',
  },
  waStatusBadgeOffline: {
    backgroundColor: '#FEF3C7',
  },
  waStatusBadgeText: {
    fontSize: 11,
    fontWeight: '700',
  },
  waStatusBadgeTextOnline: {
    color: '#15803D',
  },
  waStatusBadgeTextOffline: {
    color: '#B45309',
  },
  waInfoRow: {
    marginTop: 2,
    marginBottom: 4,
  },
  waDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  waDotOnline: {
    backgroundColor: COLORS.whatsappGreen,
  },
  waDotOffline: {
    backgroundColor: '#EAB308',
  },
  waStatusLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: COLORS.textDark,
  },
  waNameLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: COLORS.primaryNavy,
    marginTop: 2,
  },
  waPhoneLabel: {
    fontSize: 11,
    color: COLORS.textMuted,
    marginTop: 2,
  },
  cardActionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 12,
    marginTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
  },
  cardActionText: {
    fontSize: 13,
    fontWeight: '700',
    color: COLORS.primary,
  },

  // User List Section
  userListHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  userListHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  cardHeaderIconBoxUsers: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#EEF2F6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  userListHeaderRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  collapseArrowBtn: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 14,
  },
  addUserBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: '#EFF6FF',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: RADIUS.full,
    borderWidth: 1,
    borderColor: '#BFDBFE',
  },
  addUserBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: COLORS.primary,
  },
  userListScrollContainer: {
    maxHeight: 220,
    marginTop: 4,
  },
  userListContainer: {
    marginTop: 2,
    paddingRight: 2,
  },
  userRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 9,
    gap: 12,
  },
  userRowBorder: {
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
  },
  userAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  userAvatarAdmin: {
    backgroundColor: '#FAF5FF',
    borderWidth: 1,
    borderColor: '#E9D5FF',
  },
  userAvatarStaff: {
    backgroundColor: '#EFF6FF',
    borderWidth: 1,
    borderColor: '#DBEAFE',
  },
  userAvatarText: {
    fontSize: 14,
    fontWeight: '800',
  },
  userAvatarTextAdmin: {
    color: '#7E22CE',
  },
  userAvatarTextStaff: {
    color: COLORS.primary,
  },
  userInfoCol: {
    flex: 1,
  },
  userNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  userName: {
    fontSize: 14,
    fontWeight: '700',
    color: COLORS.primaryNavy,
  },
  youBadge: {
    backgroundColor: '#DCFCE7',
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: RADIUS.full,
  },
  youBadgeText: {
    fontSize: 9,
    fontWeight: '800',
    color: '#15803D',
  },
  userEmail: {
    fontSize: 11,
    color: COLORS.textMuted,
    marginTop: 2,
  },
  userRoleBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: RADIUS.full,
    borderWidth: 1,
  },
  userRoleBadgeAdmin: {
    backgroundColor: '#FAF5FF',
    borderColor: '#E9D5FF',
  },
  userRoleBadgeStaff: {
    backgroundColor: '#F8FAFC',
    borderColor: '#E2E8F0',
  },
  userRoleText: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  userRoleTextAdmin: {
    color: '#7E22CE',
  },
  userRoleTextStaff: {
    color: '#64748B',
  },

  // Preferences Section
  cardHeaderIconBoxPref: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#EEF2F6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  prefRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 9,
  },
  prefLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
  },
  prefIconBoxTheme: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#EEF2FF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  prefIconBoxNotif: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#FEF3C7',
    alignItems: 'center',
    justifyContent: 'center',
  },
  prefTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: COLORS.primaryNavy,
  },
  prefSubtitle: {
    fontSize: 11,
    color: COLORS.textMuted,
    marginTop: 2,
  },
  prefRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  prefValueText: {
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.textMuted,
  },
  prefDivider: {
    height: 1,
    backgroundColor: '#F1F5F9',
    marginVertical: 4,
  },

  // Logout Card
  logoutCard: {
    backgroundColor: '#FEF2F2',
    height: 48,
    borderRadius: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
    gap: 8,
    borderWidth: 1,
    borderColor: '#FECACA',
    shadowColor: COLORS.accentRed,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 3,
    elevation: 1,
  },
  logoutCardText: {
    color: COLORS.accentRed,
    fontSize: 14,
    fontWeight: '700',
  },
  versionText: {
    textAlign: 'center',
    marginTop: 6,
    fontSize: 11,
    color: COLORS.textSubtle,
    fontWeight: '500',
  },

  // Add User Modal
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(7, 15, 30, 0.65)',
    justifyContent: 'center',
    padding: SPACING.xl,
  },
  modalCard: {
    backgroundColor: COLORS.bgWhite,
    borderRadius: 20,
    padding: SPACING.xl,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 5,
  },
  modalHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  modalHeaderIconBox: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#EFF6FF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: COLORS.primaryNavy,
  },
  modalSub: {
    fontSize: 12,
    color: COLORS.textMuted,
    marginTop: 4,
    marginBottom: SPACING.md,
    lineHeight: 17,
  },
  inputLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: COLORS.textDark,
    marginBottom: 4,
    marginTop: 6,
  },
  modalInput: {
    height: 44,
    borderWidth: 1,
    borderColor: COLORS.borderColor,
    borderRadius: RADIUS.md,
    paddingHorizontal: 12,
    fontSize: 13,
    color: COLORS.textDark,
    backgroundColor: '#F8FAFC',
    marginBottom: 6,
  },
  rolePickerRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 4,
    marginBottom: 16,
  },
  rolePickerBtn: {
    flex: 1,
    paddingVertical: 9,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.borderColor,
    backgroundColor: '#F8FAFC',
    alignItems: 'center',
    justifyContent: 'center',
  },
  rolePickerBtnActive: {
    backgroundColor: COLORS.primaryNavy,
    borderColor: COLORS.primaryNavy,
  },
  rolePickerBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: COLORS.textMuted,
  },
  rolePickerBtnTextActive: {
    color: COLORS.bgWhite,
  },
  modalBtnRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 6,
  },
  modalCancelBtn: {
    flex: 1,
    height: 44,
    borderRadius: RADIUS.md,
    backgroundColor: '#F1F5F9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalCancelBtnText: {
    color: COLORS.textMuted,
    fontSize: 13,
    fontWeight: '700',
  },
  modalCreateBtn: {
    flex: 1,
    height: 44,
    borderRadius: RADIUS.md,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalCreateBtnText: {
    color: COLORS.bgWhite,
    fontSize: 13,
    fontWeight: '700',
  },
});
