import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { colors, radius } from '../theme';

type IconName = keyof typeof Ionicons.glyphMap;

const ICONS: Record<string, { active: IconName; inactive: IconName }> = {
  index: { active: 'map', inactive: 'map-outline' },
  missions: { active: 'list', inactive: 'list-outline' },
  earnings: { active: 'wallet', inactive: 'wallet-outline' },
  menu: { active: 'grid', inactive: 'grid-outline' },
};

const LABELS: Record<string, string> = {
  index: 'Carte',
  missions: 'Missions',
  earnings: 'Portefeuille',
  menu: 'Menu',
};

export default function TabBar({ state, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  const bottomPad = Math.max(insets.bottom, Platform.OS === 'ios' ? 20 : 12);

  return (
    <View style={[styles.wrap, { paddingBottom: bottomPad }]} testID="tab-bar">
      <View style={styles.bar}>
        {state.routes.map((route, index) => {
          const focused = state.index === index;
          const icons = ICONS[route.name] ?? { active: 'ellipse', inactive: 'ellipse-outline' };
          const label = LABELS[route.name] ?? route.name;

          const onPress = () => {
            const event = navigation.emit({
              type: 'tabPress',
              target: route.key,
              canPreventDefault: true,
            });
            if (!focused && !event.defaultPrevented) {
              navigation.navigate(route.name as never);
            }
          };

          return (
            <TabItem
              key={route.key}
              focused={focused}
              icon={focused ? icons.active : icons.inactive}
              label={label}
              onPress={onPress}
              testID={`tab-${route.name === 'index' ? 'map' : route.name}`}
            />
          );
        })}
      </View>
    </View>
  );
}

function TabItem({
  focused,
  icon,
  label,
  onPress,
  testID,
}: {
  focused: boolean;
  icon: IconName;
  label: string;
  onPress: () => void;
  testID?: string;
}) {
  const scale = useSharedValue(focused ? 1 : 0.92);
  const indicatorOpacity = useSharedValue(focused ? 1 : 0);
  const indicatorWidth = useSharedValue(focused ? 24 : 0);

  React.useEffect(() => {
    scale.value = withSpring(focused ? 1 : 0.92, { damping: 18, stiffness: 220 });
    indicatorOpacity.value = withTiming(focused ? 1 : 0, { duration: 180 });
    indicatorWidth.value = withSpring(focused ? 24 : 0, { damping: 16, stiffness: 200 });
  }, [focused, scale, indicatorOpacity, indicatorWidth]);

  const iconStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));
  const dotStyle = useAnimatedStyle(() => ({
    opacity: indicatorOpacity.value,
    width: indicatorWidth.value,
  }));

  return (
    <TouchableOpacity
      activeOpacity={0.7}
      onPress={onPress}
      style={styles.item}
      hitSlop={{ top: 12, bottom: 12, left: 6, right: 6 }}
      testID={testID}
    >
      <Animated.View style={[styles.iconWrap, iconStyle]}>
        <Ionicons
          name={icon}
          size={24}
          color={focused ? colors.primary : colors.textSecondary}
        />
      </Animated.View>
      <Text
        numberOfLines={1}
        style={[
          styles.label,
          { color: focused ? colors.primary : colors.textSecondary, fontWeight: focused ? '800' : '600' },
        ]}
      >
        {label}
      </Text>
      <Animated.View style={[styles.indicator, dotStyle]} />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: colors.bg,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    paddingTop: 10,
    paddingHorizontal: 10,
  },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    backgroundColor: colors.surface,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: 8,
    paddingHorizontal: 6,
  },
  item: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 4,
    minHeight: 52,
    gap: 2,
  },
  iconWrap: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    fontSize: 11,
    letterSpacing: 0.3,
  },
  indicator: {
    height: 3,
    borderRadius: 2,
    backgroundColor: colors.primary,
    marginTop: 2,
  },
});
