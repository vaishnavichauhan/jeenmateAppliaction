import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Alert,
  ActivityIndicator,
  Platform,
  KeyboardAvoidingView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuthStore } from '../../store/authStore';
import { COLORS, SPACING, RADIUS } from '../../constants/theme';
import { Icon } from '../../components/common/Icon';
import { Header } from '../../components/common/Header';

type RoleOption = 'admin' | 'user';

const ROLES: { label: string; value: RoleOption }[] = [
  { label: 'User', value: 'user' },
  { label: 'Admin', value: 'admin' },
];

export const CreateUserScreen: React.FC<{ navigation: any }> = ({ navigation }) => {
  const insets = useSafeAreaInsets();
  const { createUser } = useAuthStore();

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [role, setRole] = useState<RoleOption>('user');
  const [isLoading, setIsLoading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const validate = () => {
    const newErrors: Record<string, string> = {};
    if (!name.trim()) newErrors.name = 'Name is required';
    if (!email.trim()) newErrors.email = 'Email is required';
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()))
      newErrors.email = 'Enter a valid email address';
    if (!password) newErrors.password = 'Password is required';
    else if (password.length < 6) newErrors.password = 'Password must be at least 6 characters';
    return newErrors;
  };

  const handleSubmit = async () => {
    const validationErrors = validate();
    if (Object.keys(validationErrors).length > 0) {
      setErrors(validationErrors);
      return;
    }
    setErrors({});
    setIsLoading(true);
    try {
      const result = await createUser(name.trim(), email.trim().toLowerCase(), password, role);
      if (result.success) {
        Alert.alert(
          '✅ User Created',
          `"${name.trim()}" has been created successfully as ${role === 'admin' ? 'an Admin' : 'a User'}.`,
          [{ text: 'OK', onPress: () => navigation.goBack() }]
        );
      } else {
        Alert.alert('Failed', result.message || 'Could not create user. Please try again.');
      }
    } catch {
      Alert.alert('Error', 'Something went wrong. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={[styles.container]}>
        {/* Header */}
        <Header
          title="Create User"
          subtitle="Add a new team member"
          showBack={true}
          onBack={() => navigation.goBack()}
        />

        <ScrollView
          contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 40 }]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Form Card */}
          <View style={styles.card}>
            {/* Name */}
            <View style={styles.formGroup}>
              <Text style={styles.label}>Full Name <Text style={styles.required}>*</Text></Text>
              <View style={[styles.inputWrapper, errors.name ? styles.inputError : null]}>
                <Icon name="user" size={16} color={COLORS.textMuted} />
                <TextInput
                  style={styles.input}
                  placeholder="Enter Full Name"
                  placeholderTextColor={COLORS.textSubtle}
                  value={name}
                  onChangeText={(v) => { setName(v); setErrors((e) => ({ ...e, name: '' })); }}
                  autoCapitalize="words"
                />
              </View>
              {errors.name ? <Text style={styles.errorText}>{errors.name}</Text> : null}
            </View>

            {/* Email (Login ID) */}
            <View style={styles.formGroup}>
              <Text style={styles.label}>Email (Login ID) <Text style={styles.required}>*</Text></Text>
              <View style={[styles.inputWrapper, errors.email ? styles.inputError : null]}>
                <Icon name="mail" size={16} color={COLORS.textMuted} />
                <TextInput
                  style={styles.input}
                  placeholder="Enter Email ID"
                  placeholderTextColor={COLORS.textSubtle}
                  value={email}
                  onChangeText={(v) => { setEmail(v); setErrors((e) => ({ ...e, email: '' })); }}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoCorrect={false}
                />
              </View>
              {errors.email ? <Text style={styles.errorText}>{errors.email}</Text> : null}
            </View>

            {/* Password */}
            <View style={styles.formGroup}>
              <Text style={styles.label}>Password <Text style={styles.required}>*</Text></Text>
              <View style={[styles.inputWrapper, errors.password ? styles.inputError : null]}>
                <Icon name="lock" size={16} color={COLORS.textMuted} />
                <TextInput
                  style={[styles.input, { flex: 1 }]}
                  placeholder="Minimum 6 characters"
                  placeholderTextColor={COLORS.textSubtle}
                  value={password}
                  onChangeText={(v) => { setPassword(v); setErrors((e) => ({ ...e, password: '' })); }}
                  secureTextEntry={!showPassword}
                  autoCapitalize="none"
                  autoCorrect={false}
                />
                <TouchableOpacity onPress={() => setShowPassword((s) => !s)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                  <Icon name={showPassword ? 'eye' : 'eye-off'} size={16} color={COLORS.textMuted} />
                </TouchableOpacity>
              </View>
              {errors.password ? <Text style={styles.errorText}>{errors.password}</Text> : null}
            </View>

            {/* Role Dropdown */}
            <View style={styles.formGroup}>
              <Text style={styles.label}>Role <Text style={styles.required}>*</Text></Text>
              <View style={styles.roleRow}>
                {ROLES.map((r) => (
                  <TouchableOpacity
                    key={r.value}
                    style={[styles.roleChip, role === r.value && styles.roleChipActive]}
                    onPress={() => setRole(r.value)}
                    activeOpacity={0.7}
                  >
                    <Icon
                      name={r.value === 'admin' ? 'shield' : 'user'}
                      size={15}
                      color={role === r.value ? COLORS.bgWhite : COLORS.textMuted}
                    />
                    <Text style={[styles.roleChipText, role === r.value && styles.roleChipTextActive]}>
                      {r.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          </View>

          {/* Submit Button */}
          <TouchableOpacity
            style={[styles.submitBtn, isLoading && styles.submitBtnDisabled]}
            onPress={handleSubmit}
            activeOpacity={0.85}
            disabled={isLoading}
          >
            {isLoading ? (
              <ActivityIndicator size="small" color={COLORS.bgWhite} />
            ) : (
              <Text style={styles.submitBtnText}>Create User</Text>
            )}
          </TouchableOpacity>
        </ScrollView>
      </View>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.bgLinen,
  },
  scrollContent: {
    padding: SPACING.lg,
  },
  card: {
    backgroundColor: COLORS.bgWhite,
    borderRadius: RADIUS.xl,
    padding: SPACING.lg,
    borderWidth: 1,
    borderColor: COLORS.borderColor,
    shadowColor: COLORS.shadowColor,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 3,
    marginBottom: SPACING.lg,
  },
  formGroup: {
    marginBottom: SPACING.md,
  },
  label: {
    fontSize: 12,
    fontWeight: '700',
    color: COLORS.textDark,
    marginBottom: 7,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  required: {
    color: COLORS.accentRed,
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.inputBg,
    borderRadius: RADIUS.md,
    borderWidth: 1.5,
    borderColor: COLORS.borderColor,
    paddingHorizontal: 12,
    height: 48,
    gap: 10,
  },
  inputError: {
    borderColor: COLORS.accentRed,
    backgroundColor: '#FFF8F8',
  },
  input: {
    flex: 1,
    fontSize: 14,
    color: COLORS.textDark,
  },
  errorText: {
    fontSize: 11,
    color: COLORS.accentRed,
    marginTop: 4,
    fontWeight: '600',
  },
  roleRow: {
    flexDirection: 'row',
    gap: 10,
  },
  roleChip: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    paddingVertical: 12,
    borderRadius: RADIUS.md,
    borderWidth: 1.5,
    borderColor: COLORS.borderColor,
    backgroundColor: COLORS.bgLinen,
  },
  roleChipActive: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  roleChipText: {
    fontSize: 14,
    fontWeight: '700',
    color: COLORS.textMuted,
  },
  roleChipTextActive: {
    color: COLORS.bgWhite,
  },
  roleHint: {
    fontSize: 12,
    color: COLORS.textMuted,
    marginTop: 8,
    lineHeight: 17,
  },
  submitBtn: {
    backgroundColor: COLORS.primary,
    height: 54,
    borderRadius: RADIUS.lg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    shadowColor: COLORS.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 4,
  },
  submitBtnDisabled: {
    opacity: 0.7,
  },
  submitBtnText: {
    color: COLORS.bgWhite,
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
});
