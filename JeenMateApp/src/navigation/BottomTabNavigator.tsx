import React from 'react';
import { StyleSheet, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { HomeScreen } from '../screens/home/HomeScreen';
import { LinkScreen } from '../screens/link/LinkScreen';
import { ChatScreen } from '../screens/chat/ChatScreen';
import { CallsScreen } from '../screens/calls/CallsScreen';
import { SettingsScreen } from '../screens/settings/SettingsScreen';
import { COLORS } from '../constants/theme';
import { Icon } from '../components/common/Icon';

const Tab = createBottomTabNavigator();

export const BottomTabNavigator: React.FC = () => {
  const insets = useSafeAreaInsets();

  // Calculate safe bottom padding for Android gesture navigation bar
  const safeBottomInset = Math.max(insets.bottom, Platform.OS === 'android' ? 12 : 0);
  const tabBarHeight = 56 + safeBottomInset;

  return (
    <Tab.Navigator
      initialRouteName="Home"
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: COLORS.primary,
        tabBarInactiveTintColor: COLORS.textMuted,
        tabBarStyle: [
          styles.tabBar,
          {
            height: tabBarHeight,
            paddingBottom: safeBottomInset > 0 ? safeBottomInset : 6,
          },
        ],
        tabBarLabelStyle: styles.tabBarLabel,
      }}
    >
      <Tab.Screen
        name="Home"
        component={HomeScreen}
        options={{
          tabBarLabel: 'Home',
          tabBarIcon: ({ color, focused }) => (
            <Icon name="home" size={22} color={color} strokeWidth={focused ? 2.5 : 1.8} />
          ),
        }}
      />

      <Tab.Screen
        name="Link"
        component={LinkScreen}
        options={{
          tabBarLabel: 'Link',
          tabBarIcon: ({ color, focused }) => (
            <Icon name="link" size={22} color={color} strokeWidth={focused ? 2.5 : 1.8} />
          ),
        }}
      />

      <Tab.Screen
        name="Chat"
        component={ChatScreen}
        options={{
          tabBarLabel: 'Chat',
          tabBarIcon: ({ color, focused }) => (
            <Icon name="chat" size={22} color={color} strokeWidth={focused ? 2.5 : 1.8} />
          ),
        }}
      />

      <Tab.Screen
        name="Calls"
        component={CallsScreen}
        options={{
          tabBarLabel: 'Calls',
          tabBarIcon: ({ color, focused }) => (
            <Icon name="call" size={22} color={color} strokeWidth={focused ? 2.5 : 1.8} />
          ),
        }}
      />

      <Tab.Screen
        name="Setting"
        component={SettingsScreen}
        options={{
          tabBarLabel: 'Setting',
          tabBarIcon: ({ color, focused }) => (
            <Icon name="settings" size={22} color={color} strokeWidth={focused ? 2.5 : 1.8} />
          ),
        }}
      />
    </Tab.Navigator>
  );
};

const styles = StyleSheet.create({
  tabBar: {
    backgroundColor: COLORS.bgWhite,
    borderTopColor: COLORS.borderColor,
    borderTopWidth: 1,
    paddingTop: 6,
    elevation: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
  },
  tabBarLabel: {
    fontSize: 11,
    fontWeight: '700',
  },
  badge: {
    backgroundColor: COLORS.primary,
    fontSize: 10,
    fontWeight: '700',
  },
});
