import { ComponentProps } from 'react';
import { Pressable, PressableProps, StyleProp, ViewStyle } from 'react-native';
import Animated, {
  AnimatedStyle,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';

const Base = Animated.createAnimatedComponent(Pressable);

type LayoutProps = Pick<ComponentProps<typeof Base>, 'entering' | 'exiting' | 'layout'>;

type Props = PressableProps &
  LayoutProps & {
    scaleTo?: number;
    style?: StyleProp<AnimatedStyle<ViewStyle>>;
  };

/**
 * Pressable with a spring scale-down on touch instead of a flat opacity
 * swap. Accepts the same `entering`/`layout` Reanimated props as any
 * Animated component, so list items can fade/slide in on mount.
 */
export function AnimatedPressable({ scaleTo = 0.96, style, onPressIn, onPressOut, ...rest }: Props) {
  const scale = useSharedValue(1);
  const animatedStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  return (
    <Base
      style={[style, animatedStyle]}
      onPressIn={(e) => {
        scale.value = withSpring(scaleTo, { damping: 16, stiffness: 320 });
        onPressIn?.(e);
      }}
      onPressOut={(e) => {
        scale.value = withSpring(1, { damping: 14, stiffness: 220 });
        onPressOut?.(e);
      }}
      {...rest}
    />
  );
}
