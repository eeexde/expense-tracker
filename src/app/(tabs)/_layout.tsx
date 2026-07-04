import { Tabs } from 'expo-router';
import { ColorValue } from 'react-native';
import Animated, { useAnimatedStyle, withSpring } from 'react-native-reanimated';
import { Icon } from '@/components/Icon';
import { colors, fonts } from '@/theme';

function TabIcon({
  name,
  color,
  focused,
}: {
  name: string;
  color: ColorValue;
  focused: boolean;
}) {
  const style = useAnimatedStyle(() => ({
    transform: [{ scale: withSpring(focused ? 1.15 : 1, { damping: 12, stiffness: 260 }) }],
  }));
  return (
    <Animated.View style={style}>
      <Icon name={name} size={22} color={color} />
    </Animated.View>
  );
}

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.gold,
        tabBarInactiveTintColor: colors.inkFaint,
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.border,
          borderTopWidth: 1,
        },
        tabBarLabelStyle: { fontFamily: fonts.bodyMedium, fontSize: 11 },
        sceneStyle: { backgroundColor: colors.bg },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Home',
          tabBarIcon: ({ color, focused }) => <TabIcon name="home" color={color} focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="transactions"
        options={{
          title: 'Transactions',
          tabBarIcon: ({ color, focused }) => <TabIcon name="list" color={color} focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="recurring"
        options={{
          title: 'Recurring',
          tabBarIcon: ({ color, focused }) => <TabIcon name="repeat" color={color} focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="utang"
        options={{
          title: 'Utang',
          tabBarIcon: ({ color, focused }) => <TabIcon name="users" color={color} focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="stats"
        options={{
          title: 'Stats',
          tabBarIcon: ({ color, focused }) => <TabIcon name="chart" color={color} focused={focused} />,
        }}
      />
    </Tabs>
  );
}
