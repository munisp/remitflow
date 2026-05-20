// AnimationLibrary.ts - Complete Animation System
// 9 types of micro-animations for polished UX

import { Animated, Easing } from 'react';

export class AnimationLibrary {
  // 1. Fade Transition
  static fade(
    animatedValue: Animated.Value,
    toValue: number,
    duration: number = 300
  ): Animated.CompositeAnimation {
    return Animated.timing(animatedValue, {
      toValue,
      duration,
      easing: Easing.ease,
      useNativeDriver: true,
    });
  }

  static fadeIn(animatedValue: Animated.Value, duration?: number): Animated.CompositeAnimation {
    return this.fade(animatedValue, 1, duration);
  }

  static fadeOut(animatedValue: Animated.Value, duration?: number): Animated.CompositeAnimation {
    return this.fade(animatedValue, 0, duration);
  }

  // 2. Slide Animation
  static slide(
    animatedValue: Animated.Value,
    toValue: number,
    duration: number = 300,
    direction: 'up' | 'down' | 'left' | 'right' = 'up'
  ): Animated.CompositeAnimation {
    return Animated.spring(animatedValue, {
      toValue,
      friction: 8,
      tension: 40,
      useNativeDriver: true,
    });
  }

  static slideUp(animatedValue: Animated.Value): Animated.CompositeAnimation {
    return this.slide(animatedValue, 0);
  }

  static slideDown(animatedValue: Animated.Value, distance: number = 100): Animated.CompositeAnimation {
    return this.slide(animatedValue, distance);
  }

  static slideLeft(animatedValue: Animated.Value, distance: number = 100): Animated.CompositeAnimation {
    return this.slide(animatedValue, -distance);
  }

  static slideRight(animatedValue: Animated.Value, distance: number = 100): Animated.CompositeAnimation {
    return this.slide(animatedValue, distance);
  }

  // 3. Scale Effects
  static scale(
    animatedValue: Animated.Value,
    toValue: number,
    duration: number = 200
  ): Animated.CompositeAnimation {
    return Animated.spring(animatedValue, {
      toValue,
      friction: 5,
      tension: 100,
      useNativeDriver: true,
    });
  }

  static scaleIn(animatedValue: Animated.Value): Animated.CompositeAnimation {
    return this.scale(animatedValue, 1);
  }

  static scaleOut(animatedValue: Animated.Value): Animated.CompositeAnimation {
    return this.scale(animatedValue, 0);
  }

  static zoomIn(animatedValue: Animated.Value): Animated.CompositeAnimation {
    return this.scale(animatedValue, 1.1);
  }

  // 4. Card Flip Animation
  static flip(
    animatedValue: Animated.Value,
    duration: number = 600
  ): Animated.CompositeAnimation {
    return Animated.timing(animatedValue, {
      toValue: 1,
      duration,
      easing: Easing.linear,
      useNativeDriver: true,
    });
  }

  static getFlipInterpolation(animatedValue: Animated.Value) {
    return {
      transform: [
        {
          rotateY: animatedValue.interpolate({
            inputRange: [0, 1],
            outputRange: ['0deg', '180deg'],
          }),
        },
      ],
    };
  }

  // 5. Number Count-Up Animation
  static countUp(
    animatedValue: Animated.Value,
    toValue: number,
    duration: number = 1000
  ): Animated.CompositeAnimation {
    return Animated.timing(animatedValue, {
      toValue,
      duration,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false, // Can't use native driver for non-transform values
    });
  }

  // 6. Shimmer Loading Effect
  static shimmer(
    animatedValue: Animated.Value,
    duration: number = 1500
  ): Animated.CompositeAnimation {
    return Animated.loop(
      Animated.sequence([
        Animated.timing(animatedValue, {
          toValue: 1,
          duration,
          easing: Easing.linear,
          useNativeDriver: true,
        }),
        Animated.timing(animatedValue, {
          toValue: 0,
          duration: 0,
          useNativeDriver: true,
        }),
      ])
    );
  }

  static getShimmerInterpolation(animatedValue: Animated.Value, width: number) {
    return {
      transform: [
        {
          translateX: animatedValue.interpolate({
            inputRange: [0, 1],
            outputRange: [-width, width],
          }),
        },
      ],
    };
  }

  // 7. Pulse Animation
  static pulse(
    animatedValue: Animated.Value,
    minScale: number = 0.95,
    maxScale: number = 1.05,
    duration: number = 1000
  ): Animated.CompositeAnimation {
    return Animated.loop(
      Animated.sequence([
        Animated.timing(animatedValue, {
          toValue: maxScale,
          duration: duration / 2,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(animatedValue, {
          toValue: minScale,
          duration: duration / 2,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ])
    );
  }

  // 8. Shake Animation
  static shake(
    animatedValue: Animated.Value,
    intensity: number = 10,
    duration: number = 400
  ): Animated.CompositeAnimation {
    return Animated.sequence([
      Animated.timing(animatedValue, {
        toValue: intensity,
        duration: duration / 8,
        useNativeDriver: true,
      }),
      Animated.timing(animatedValue, {
        toValue: -intensity,
        duration: duration / 8,
        useNativeDriver: true,
      }),
      Animated.timing(animatedValue, {
        toValue: intensity,
        duration: duration / 8,
        useNativeDriver: true,
      }),
      Animated.timing(animatedValue, {
        toValue: -intensity,
        duration: duration / 8,
        useNativeDriver: true,
      }),
      Animated.timing(animatedValue, {
        toValue: 0,
        duration: duration / 2,
        useNativeDriver: true,
      }),
    ]);
  }

  static getShakeInterpolation(animatedValue: Animated.Value) {
    return {
      transform: [{ translateX: animatedValue }],
    };
  }

  // 9. Press Animation
  static press(
    animatedValue: Animated.Value,
    pressScale: number = 0.95,
    duration: number = 100
  ): Animated.CompositeAnimation {
    return Animated.sequence([
      Animated.timing(animatedValue, {
        toValue: pressScale,
        duration,
        easing: Easing.ease,
        useNativeDriver: true,
      }),
      Animated.timing(animatedValue, {
        toValue: 1,
        duration,
        easing: Easing.ease,
        useNativeDriver: true,
      }),
    ]);
  }

  // Composite Animations
  static parallel(...animations: Animated.CompositeAnimation[]): Animated.CompositeAnimation {
    return Animated.parallel(animations);
  }

  static sequence(...animations: Animated.CompositeAnimation[]): Animated.CompositeAnimation {
    return Animated.sequence(animations);
  }

  static stagger(
    time: number,
    animations: Animated.CompositeAnimation[]
  ): Animated.CompositeAnimation {
    return Animated.stagger(time, animations);
  }
}

export default AnimationLibrary;
