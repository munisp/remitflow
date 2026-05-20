// animation-library.ts - PWA Animation System using Web Animations API
// Production-ready CSS and JavaScript animations

export class AnimationLibrary {
  // 1. Fade Transitions
  static fade(element: HTMLElement, toOpacity: number, duration: number = 300): Animation {
    return element.animate(
      [{ opacity: element.style.opacity || 1 }, { opacity: toOpacity }],
      { duration, easing: 'ease', fill: 'forwards' }
    );
  }

  static fadeIn(element: HTMLElement, duration?: number): Animation {
    return this.fade(element, 1, duration);
  }

  static fadeOut(element: HTMLElement, duration?: number): Animation {
    return this.fade(element, 0, duration);
  }

  // 2. Slide Animations
  static slide(
    element: HTMLElement,
    direction: 'up' | 'down' | 'left' | 'right',
    distance: number = 100,
    duration: number = 300
  ): Animation {
    const transforms: Record<string, string> = {
      up: `translateY(-${distance}px)`,
      down: `translateY(${distance}px)`,
      left: `translateX(-${distance}px)`,
      right: `translateX(${distance}px)`,
    };

    return element.animate(
      [{ transform: 'translate(0, 0)' }, { transform: transforms[direction] }],
      { duration, easing: 'cubic-bezier(0.4, 0.0, 0.2, 1)', fill: 'forwards' }
    );
  }

  // 3. Scale Effects
  static scale(element: HTMLElement, toScale: number, duration: number = 200): Animation {
    return element.animate(
      [{ transform: 'scale(1)' }, { transform: `scale(${toScale})` }],
      { duration, easing: 'cubic-bezier(0.34, 1.56, 0.64, 1)', fill: 'forwards' }
    );
  }

  static scaleIn(element: HTMLElement): Animation {
    return this.scale(element, 1);
  }

  static scaleOut(element: HTMLElement): Animation {
    return this.scale(element, 0);
  }

  // 4. Pulse Animation
  static pulse(element: HTMLElement, duration: number = 1000): Animation {
    return element.animate(
      [
        { transform: 'scale(1)' },
        { transform: 'scale(1.05)' },
        { transform: 'scale(0.95)' },
        { transform: 'scale(1)' },
      ],
      { duration, iterations: Infinity, easing: 'ease-in-out' }
    );
  }

  // 5. Shake Animation
  static shake(element: HTMLElement, intensity: number = 10, duration: number = 400): Animation {
    return element.animate(
      [
        { transform: 'translateX(0)' },
        { transform: `translateX(${intensity}px)` },
        { transform: `translateX(-${intensity}px)` },
        { transform: `translateX(${intensity}px)` },
        { transform: `translateX(-${intensity}px)` },
        { transform: 'translateX(0)' },
      ],
      { duration, easing: 'ease-in-out' }
    );
  }

  // 6. Press Animation
  static press(element: HTMLElement, pressScale: number = 0.95): Animation {
    return element.animate(
      [
        { transform: 'scale(1)' },
        { transform: `scale(${pressScale})` },
        { transform: 'scale(1)' },
      ],
      { duration: 200, easing: 'ease' }
    );
  }
}

export default AnimationLibrary;
