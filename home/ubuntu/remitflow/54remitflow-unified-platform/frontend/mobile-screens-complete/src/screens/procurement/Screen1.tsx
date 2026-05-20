import React from 'react';
import { View, ScrollView, StyleSheet } from 'react-native';
import { Text, Card, Button } from 'react-native-paper';
export const Screen1: React.FC = () => {
  return (
    <ScrollView style={styles.container}>
      <Card style={styles.card}>
        <Card.Content>
          <Text variant="headlineMedium">procurement Screen 1</Text>
        </Card.Content>
      </Card>
    </ScrollView>
  );
};
const styles = StyleSheet.create({
  container: { flex: 1 },
  card: { margin: 16 },
});
