import React from 'react';
import { View, ScrollView, StyleSheet } from 'react-native';
import { Text, Card, Button } from 'react-native-paper';
export const Screen3: React.FC = () => {
  return (
    <ScrollView style={styles.container}>
      <Card style={styles.card}>
        <Card.Content>
          <Text variant="headlineMedium">fulfillment Screen 3</Text>
        </Card.Content>
      </Card>
    </ScrollView>
  );
};
const styles = StyleSheet.create({
  container: { flex: 1 },
  card: { margin: 16 },
});
