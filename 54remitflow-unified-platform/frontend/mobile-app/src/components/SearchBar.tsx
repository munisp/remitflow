import React from 'react';
import { TextInput, StyleSheet } from 'react-native';

interface SearchBarProps {
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
}

export const SearchBar: React.FC<SearchBarProps> = ({ value, onChangeText, placeholder = 'Search...' }) => {
  return (
    <TextInput
      style={styles.searchBar}
      value={value}
      onChangeText={onChangeText}
      placeholder={placeholder}
    />
  );
};

const styles = StyleSheet.create({
  searchBar: { backgroundColor: '#f5f5f5', borderRadius: 8, padding: 12, fontSize: 16, margin: 15 },
});