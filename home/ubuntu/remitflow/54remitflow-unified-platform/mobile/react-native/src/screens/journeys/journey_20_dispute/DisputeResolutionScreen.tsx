/**
 * DisputeResolution Screen
 * Journey: Transaction Dispute
 * ID: journey_20_dispute
 */

import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
} from 'react-native';
import * as Haptics from 'expo-haptics';

interface DisputeResolutionScreenProps {
  navigation: any;
  route: any;
}

export const DisputeResolutionScreen: React.FC<DisputeResolutionScreenProps> = ({
  navigation,
  route,
}) => {
  const [isLoading, setIsLoading] = useState(false);

  const handlePrimaryAction = async () => {
    // Haptic feedback
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    
    // TODO: Implement action logic
    console.log('DisputeResolution: Primary action triggered');
    
    // Navigate to next screen
    // navigation.navigate('NextScreen');
  };

  return (
    <ScrollView style={styles.container}>
      <View style={styles.content}>
        {/* Header */}
        <Text style={styles.title}>DisputeResolution</Text>
        <Text style={styles.subtitle}>Transaction Dispute</Text>

        {/* Content */}
        <View style={styles.contentSection}>
          <Text style={styles.sectionTitle}>Screen: DisputeResolution</Text>
          
          {/* TODO: Implement DisputeResolution UI */}
          <View style={styles.placeholder} />
        </View>

        {/* Actions */}
        <TouchableOpacity
          style={styles.primaryButton}
          onPress={handlePrimaryAction}
          disabled={isLoading}
        >
          <Text style={styles.buttonText}>
            {isLoading ? 'Loading...' : 'Continue'}
          </Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  content: {
    padding: 16,
  },
  title: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#1C1C1E',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    color: '#8E8E93',
    marginBottom: 24,
  },
  contentSection: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: '#1C1C1E',
    marginBottom: 12,
  },
  placeholder: {
    height: 200,
    backgroundColor: '#F5F5F7',
    borderRadius: 12,
  },
  primaryButton: {
    backgroundColor: '#0066FF',
    padding: 16,
    borderRadius: 12,
    alignItems: 'center',
  },
  buttonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
});
