import React from 'react';
import { StyleSheet, View } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { HomeScreen } from '../screens/home/HomeScreen';
import { LinkScreen } from '../screens/link/LinkScreen';
import { ChatScreen } from '../screens/chat/ChatScreen';
import { CallsScreen } from '../screens/calls/CallsScreen';
import { SettingsScreen } from '../screens/settings/SettingsScreen';
import { COLORS } from '../constants/theme';
import { Icon } from '../components/common/Icon';
import { useTaskStore } from '../store/taskStore';

const Tab = createBottomTabNavigator();

export const BottomTabNavigator: React.FC = () => {
  const pendingTasks = useTaskStore((s) => s.counts.pending);

  return (
    <Tab.Navigator
      initialRouteName="Link"
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: COLORS.primary,
        tabBarInactiveTintColor: COLORS.textMuted,
        tabBarStyle: styles.tabBar,
        tabBarLabelStyle: styles.tabBarLabel,
      }}
    >
      <Tab.Screen
        name="Home"
        component={HomeScreen}
        options={{
          tabBarLabel: 'Home',
          tabBarBadge: pendingTasks > 0 ? pendingTasks : undefined,
          tabBarBadgeStyle: styles.badge,
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
    height: 60,
    paddingBottom: 6,
    paddingTop: 6,
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
