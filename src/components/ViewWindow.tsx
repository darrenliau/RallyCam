import { forwardRef, useImperativeHandle, useRef, type ReactNode } from 'react';
import { Animated, Easing, StyleSheet } from 'react-native';
import type { ViewTransform } from '../analysis/framing';

export interface ViewWindowHandle {
  /** Moves to a transform, gliding there over `ms` (the next update normally arrives about then, so the motion is continuous). */
  set(t: ViewTransform, ms?: number): void;
}

/**
 * Shows only a window of what it holds: the content is scaled and shifted by a view transform (framing.ts). The animation runs on the
 * native side, so updating it a few times a second does not re-draw the screen.
 */
export const ViewWindow = forwardRef<ViewWindowHandle, { children: ReactNode; pointerEvents?: 'box-none' | 'none' | 'auto' }>(function ViewWindow({ children, pointerEvents = 'box-none' }, ref) {
  const scale = useRef(new Animated.Value(1)).current;
  const tx = useRef(new Animated.Value(0)).current;
  const ty = useRef(new Animated.Value(0)).current;
  useImperativeHandle(ref, () => ({
    set(t, ms = 150) {
      const to = (v: Animated.Value, toValue: number) => Animated.timing(v, { toValue, duration: ms, easing: Easing.linear, useNativeDriver: true });
      Animated.parallel([to(scale, t.scale), to(tx, t.tx), to(ty, t.ty)]).start();
    },
  }), [scale, tx, ty]);
  return (
    <Animated.View style={[StyleSheet.absoluteFill, { transform: [{ translateX: tx }, { translateY: ty }, { scale }] }]} pointerEvents={pointerEvents}>
      {children}
    </Animated.View>
  );
});
