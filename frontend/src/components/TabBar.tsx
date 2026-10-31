import React from 'react';
import { View, TouchableOpacity, StyleSheet, Platform } from 'react-native';
import { Text } from '../ui/Text';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
} from 'react-native-reanimated';
import { colors, radius, shadow } from '../theme';
import { useRides } from '../ridesContext';

type IconName = keyof typeof Ionicons.glyphMap;

const ICONS: Record<string, { active: IconName; inactive: IconName }> = {
  index: { active: 'home', inactive: 'home-outline' },
  missions: { active: 'car', inactive: 'car-outline' },
  earnings: { active: 'wallet', inactive: 'wallet-outline' },
  menu: { active: 'person', inactive: 'person-outline' },
};

const LABELS: Record<string, string> = {
  index: 'Accueil',
  missions: 'Courses',
  earnings: 'Gains',
  menu: 'Compte',
};

export default function TabBar({ state, navigation, descriptors }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  const { newRidesCount } = useRides();
  const bottomPad = Math.max(insets.bottom, Platform.OS === 'ios' ? 20 : 12);

  // Respect expo-router's `href: null` convention — a screen with a null
  // href stays mounted for direct navigation but should not be rendered in
  // the tab bar. Our custom bar filters both from the descriptor options and
  // from an explicit deny list because expo-router transforms `href: null`
  // into a `tabBarButton: () => null` in newer versions, which we handle too.
  const HIDDEN_ROUTES = new Set(['history']);
  const visibleRoutes = state.routes.filter((route) => {
    if (HIDDEN_ROUTES.has(route.name)) return false;
    const opts: any = descriptors[route.key]?.options ?? {};
    if (opts.href === null) return false;
    if (opts.tabBarButton === null) return false;
    return true;
  });

  return (
    <View style={[styles.wrap, { paddingBottom: bottomPad }]} testID="tab-bar">
      <View style={styles.bar}>
        {visibleRoutes.map((route) => {
          const index = state.routes.indexOf(route);
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
              badge={route.name === 'missions' ? newRidesCount : 0}
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
  badge = 0,
  testID,
}: {
  focused: boolean;
  icon: IconName;
  label: string;
  onPress: () => void;
  badge?: number;
  testID?: string;
}) {
  const pill = useSharedValue(focused ? 1 : 0);

  React.useEffect(() => {
    pill.value = withTiming(focused ? 1 : 0, { duration: 180 });
  }, [focused, pill]);

  const pillStyle = useAnimatedStyle(() => ({
    opacity: pill.value,
    transform: [{ scaleX: 0.6 + pill.value * 0.4 }],
  }));

  return (
    <TouchableOpacity
      activeOpacity={0.7}
      onPress={onPress}
      style={styles.item}
      hitSlop={{ top: 12, bottom: 12, left: 6, right: 6 }}
      accessibilityRole="tab"
      accessibilityState={{ selected: focused }}
      accessibilityLabel={label}
      testID={testID}
    >
      <View style={styles.iconWrap}>
        <Animated.View style={[styles.pill, pillStyle]} />
        <Ionicons name={icon} size={22} color={focused ? colors.primary : colors.textMuted} />
        {badge > 0 ? (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{badge > 9 ? '9+' : badge}</Text>
          </View>
        ) : null}
      </View>
      <Text
        numberOfLines={1}
        style={[styles.label, focused ? styles.labelActive : null]}
      >
        {label}
      </Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: colors.bg,
    paddingTop: 6,
    paddingHorizontal: 12,
  },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: 8,
    paddingHorizontal: 6,
    ...shadow,
  },
  item: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 54,
    gap: 4,
  },
  iconWrap: {
    width: 56,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pill: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 16,
    backgroundColor: colors.primarySoft,
  },
  badge: {
    position: 'absolute',
    top: -4,
    right: 6,
    minWidth: 18,
    height: 18,
    paddingHorizontal: 5,
    borderRadius: 9,
    backgroundColor: colors.danger,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: colors.surface,
  },
  badgeText: { color: '#fff', fontSize: 10, fontWeight: '800' },
  label: {
    fontSize: 11.5,
    fontWeight: '600',
    color: colors.textMuted,
  },
  labelActive: { color: colors.text, fontWeight: '700' },
});
