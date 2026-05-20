// OnboardingFlow.tsx - Interactive Onboarding Tutorial
// 9-screen onboarding experience with animations and progress tracking

import React, { useState, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Animated,
  Dimensions,
  TouchableOpacity,
  ScrollView,
} from 'react-native';
import HapticManager from '../utils/HapticManager';
import { AnimationLibrary } from '../utils/AnimationLibrary';

const { width, height } = Dimensions.get('window');

interface OnboardingScreen {
  id: number;
  title: string;
  description: string;
  animation: string;
}

const ONBOARDING_SCREENS: OnboardingScreen[] = [
  {
    id: 1,
    title: 'Welcome to Remittance Platform',
    description: 'Your complete financial solution',
    animation: 'welcome',
  },
  {
    id: 2,
    title: 'Instant Transfers',
    description: 'Send money in seconds, not hours',
    animation: 'transfer',
  },
  {
    id: 3,
    title: 'Bank-Level Security',
    description: 'Your money is protected with enterprise encryption',
    animation: 'security',
  },
  {
    id: 4,
    title: 'Smart Insights',
    description: 'Track spending and discover savings opportunities',
    animation: 'insights',
  },
  {
    id: 5,
    title: 'What brings you here?',
    description: 'Help us personalize your experience',
    animation: 'personalization',
  },
  {
    id: 6,
    title: 'Set up your account',
    description: 'Just a few quick steps',
    animation: 'account',
  },
  {
    id: 7,
    title: 'Secure your account',
    description: 'Enable Face ID or Touch ID',
    animation: 'biometric',
  },
  {
    id: 8,
    title: 'Send your first transfer',
    description: 'Let us guide you through it',
    animation: 'first_transaction',
  },
  {
    id: 9,
    title: 'You're all set!',
    description: 'Start sending money today',
    animation: 'completion',
  },
];

export const OnboardingFlow: React.FC = () => {
  const [currentScreen, setCurrentScreen] = useState(0);
  const [canSkip, setCanSkip] = useState(true);
  const scrollX = useRef(new Animated.Value(0)).current;
  const scrollViewRef = useRef<ScrollView>(null);

  const handleNext = () => {
    HapticManager.medium();
    if (currentScreen < ONBOARDING_SCREENS.length - 1) {
      const nextScreen = currentScreen + 1;
      setCurrentScreen(nextScreen);
      scrollViewRef.current?.scrollTo({
        x: nextScreen * width,
        animated: true,
      });
    } else {
      handleComplete();
    }
  };

  const handleSkip = () => {
    HapticManager.light();
    handleComplete();
  };

  const handleComplete = () => {
    HapticManager.success();
    // Navigate to main app
    console.log('Onboarding complete!');
  };

  const renderProgressIndicator = () => {
    return (
      <View style={styles.progressContainer}>
        {ONBOARDING_SCREENS.map((_, index) => {
          const isActive = index === currentScreen;
          return (
            <View
              key={index}
              style={[
                styles.progressDot,
                isActive && styles.progressDotActive,
              ]}
            />
          );
        })}
      </View>
    );
  };

  const renderScreen = (screen: OnboardingScreen, index: number) => {
    return (
      <View key={screen.id} style={styles.screenContainer}>
        <View style={styles.animationContainer}>
          {/* Animation placeholder - integrate with Lottie or custom animations */}
          <View style={styles.animationPlaceholder}>
            <Text style={styles.animationText}>{screen.animation}</Text>
          </View>
        </View>
        <Text style={styles.title}>{screen.title}</Text>
        <Text style={styles.description}>{screen.description}</Text>
      </View>
    );
  };

  return (
    <View style={styles.container}>
      {canSkip && currentScreen < ONBOARDING_SCREENS.length - 1 && (
        <TouchableOpacity
          style={styles.skipButton}
          onPress={handleSkip}
          activeOpacity={0.7}
        >
          <Text style={styles.skipText}>Skip</Text>
        </TouchableOpacity>
      )}

      <ScrollView
        ref={scrollViewRef}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        scrollEventThrottle={16}
        onScroll={Animated.event(
          [{ nativeEvent: { contentOffset: { x: scrollX } } }],
          { useNativeDriver: false }
        )}
        scrollEnabled={false}
      >
        {ONBOARDING_SCREENS.map((screen, index) =>
          renderScreen(screen, index)
        )}
      </ScrollView>

      {renderProgressIndicator()}

      <TouchableOpacity
        style={styles.nextButton}
        onPress={handleNext}
        activeOpacity={0.8}
      >
        <Text style={styles.nextButtonText}>
          {currentScreen === ONBOARDING_SCREENS.length - 1
            ? 'Get Started'
            : 'Next'}
        </Text>
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  skipButton: {
    position: 'absolute',
    top: 50,
    right: 20,
    zIndex: 10,
    padding: 10,
  },
  skipText: {
    fontSize: 16,
    color: '#666666',
    fontWeight: '600',
  },
  screenContainer: {
    width,
    height,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 40,
  },
  animationContainer: {
    width: width * 0.8,
    height: height * 0.4,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 40,
  },
  animationPlaceholder: {
    width: 200,
    height: 200,
    borderRadius: 100,
    backgroundColor: '#F0F0F0',
    justifyContent: 'center',
    alignItems: 'center',
  },
  animationText: {
    fontSize: 14,
    color: '#999999',
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#000000',
    textAlign: 'center',
    marginBottom: 16,
  },
  description: {
    fontSize: 16,
    color: '#666666',
    textAlign: 'center',
    lineHeight: 24,
  },
  progressContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    position: 'absolute',
    bottom: 120,
    left: 0,
    right: 0,
  },
  progressDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#CCCCCC',
    marginHorizontal: 4,
  },
  progressDotActive: {
    width: 24,
    backgroundColor: '#007AFF',
  },
  nextButton: {
    position: 'absolute',
    bottom: 50,
    left: 40,
    right: 40,
    height: 56,
    backgroundColor: '#007AFF',
    borderRadius: 28,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#007AFF',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  nextButtonText: {
    fontSize: 18,
    fontWeight: '600',
    color: '#FFFFFF',
  },
});

export default OnboardingFlow;
