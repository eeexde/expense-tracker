import React, { useCallback, useRef } from 'react';
import { StyleProp, View, ViewStyle } from 'react-native';
import { useTourOptional } from './TourProvider';

/**
 * Wraps a real UI element so the overlay can spotlight it.
 *
 * Measuring is deliberately lazy: with no provider (every screen test, and any
 * modal route mounted outside the root layout's tree) or with no tour running,
 * this is a plain `View` and `measureInWindow` is never called.
 */
export function TourTarget({
  id,
  children,
  style,
}: {
  id: string;
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const tour = useTourOptional();
  const ref = useRef<View>(null);
  const active = tour?.active ?? false;
  const register = tour?.registerTarget;
  const unregister = tour?.unregisterTarget;

  const onLayout = useCallback(() => {
    if (!active || !register) return;
    // `measureInWindow` is what the overlay needs: the overlay is a sibling of
    // the whole navigator, so target coordinates have to be window-absolute,
    // not relative to whatever scroll container the target happens to sit in.
    ref.current?.measureInWindow((x, y, width, height) => {
      if (width === 0 && height === 0) return;
      register(id, { x, y, width, height });
    });
  }, [active, id, register]);

  React.useEffect(() => {
    if (!active) return;
    return () => unregister?.(id);
  }, [active, id, unregister]);

  // Re-measure when a tour starts on an element that was already laid out.
  React.useEffect(() => {
    if (active) onLayout();
  }, [active, onLayout]);

  return (
    <View ref={ref} style={style} onLayout={onLayout} collapsable={false}>
      {children}
    </View>
  );
}
