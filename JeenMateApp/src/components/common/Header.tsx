import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  StyleProp,
  ViewStyle,
  TextStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { Icon } from './Icon';
import { COLORS, SPACING } from '../../constants/theme';

export interface HeaderProps {
  title?: string;
  subtitle?: string;
  showBack?: boolean;
  onBack?: () => void;
  rightContent?: React.ReactNode;
  children?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  titleStyle?: StyleProp<TextStyle>;
  subtitleStyle?: StyleProp<TextStyle>;
  backgroundColor?: string;
  hideBottomBorder?: boolean;
  borderBottomColor?: string;
}

export const Header: React.FC<HeaderProps> = ({
  title,
  subtitle,
  showBack = true,
  onBack,
  rightContent,
  children,
  style,
  titleStyle,
  subtitleStyle,
  backgroundColor = COLORS.bgWhite,
  hideBottomBorder = false,
  borderBottomColor = COLORS.borderColor,
}) => {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<any>();

  const handleBackPress = () => {
    if (onBack) {
      onBack();
    } else if (navigation.canGoBack()) {
      navigation.goBack();
    } else {
      navigation.navigate('Home');
    }
  };

  return (
    <View
      style={[
        styles.headerContainer,
        {
          backgroundColor,
          paddingTop: Math.max(insets.top, 20) + 13,
          paddingBottom: children ? SPACING.md : SPACING.lg,
          borderBottomWidth: hideBottomBorder ? 0 : StyleSheet.hairlineWidth,
          borderBottomColor,
        },
        style,
      ]}
    >
      <View style={[styles.topRow, children ? styles.topRowWithChildren : null]}>
        <View style={styles.leftCol}>
          {showBack && (
            <TouchableOpacity
              style={styles.backButton}
              onPress={handleBackPress}
              activeOpacity={0.7}
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            >
              <Icon name="arrow-left" size={20} color={COLORS.primaryNavy} strokeWidth={2.5} />
            </TouchableOpacity>
          )}
          {title ? (
            <View style={styles.titleContainer}>
              <Text style={[styles.headerTitle, titleStyle]} numberOfLines={1}>
                {title}
              </Text>
              {subtitle ? (
                <Text style={[styles.headerSubtitle, subtitleStyle]} numberOfLines={1}>
                  {subtitle}
                </Text>
              ) : null}
            </View>
          ) : null}
        </View>

        {rightContent ? <View style={styles.rightCol}>{rightContent}</View> : null}
      </View>

      {children}
    </View>
  );
};

const styles = StyleSheet.create({
  headerContainer: {
    backgroundColor: COLORS.bgWhite,
    paddingHorizontal: SPACING.lg,
    paddingBottom: SPACING.lg,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.borderColor,
  },
  topRow: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  topRowWithChildren: {
    marginBottom: 12,
  },
  leftCol: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
  },
  backButton: {
    backgroundColor: 'transparent',
    borderWidth: 0,
    borderColor: 'transparent',
    paddingVertical: 4,
    paddingRight: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  titleContainer: {
    flex: 1,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: COLORS.primaryNavy,
  },
  headerSubtitle: {
    fontSize: 12,
    color: COLORS.textMuted,
    marginTop: 1,
  },
  rightCol: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
});
