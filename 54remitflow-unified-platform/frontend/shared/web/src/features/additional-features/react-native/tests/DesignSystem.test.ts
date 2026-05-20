import { StyleSheet } from 'react-native';
import DesignSystem, {
  Tokens,
  createStyleSheet,
  getSpacing,
  getTextStyle,
  getColor,
} from './DesignSystem';

// Mock the react-native StyleSheet.create function
// This is crucial for testing createStyleSheet without a real React Native environment.
// We mock it to return the input object, as is common practice.
jest.mock('react-native', () => ({
  StyleSheet: {
    create: jest.fn((styles) => styles),
  },
}));

describe('DesignSystem', () => {
  // Setup/Teardown: Clear mock calls before each test
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // --- 1. Test Design Tokens (Tokens) ---
  describe('Tokens', () => {
    test('should have a well-defined color palette', () => {
      expect(Tokens.colors).toBeDefined();
      expect(Tokens.colors.primary).toBe('#007AFF');
      expect(Tokens.colors.text).toBe('#000000');
      expect(Object.keys(Tokens.colors).length).toBeGreaterThan(0);
    });

    test('should have a well-defined spacing scale', () => {
      expect(Tokens.spacing).toBeDefined();
      expect(Tokens.spacing.xs).toBe(4);
      expect(Tokens.spacing.xl).toBe(32);
      expect(Object.keys(Tokens.spacing).length).toBe(5); // Test specific count for coverage
    });

    test('should have a well-defined typography scale', () => {
      expect(Tokens.typography).toBeDefined();
      expect(Tokens.typography.h1.fontSize).toBe(32);
      expect(Tokens.typography.body.lineHeight).toBe(24);
      expect(Tokens.typography.caption.color).toBe('#666666');
      expect(Object.keys(Tokens.typography).length).toBe(3); // Test specific count for coverage
    });
  });

  // --- 2. Test Utility Function (createStyleSheet) ---
  describe('createStyleSheet', () => {
    test('should call StyleSheet.create with the provided styles', () => {
      const mockStyles = {
        container: { flex: 1 },
        text: { fontSize: 16 },
      };
      const createdStyles = createStyleSheet(mockStyles);

      // Check if the mock was called
      expect(StyleSheet.create).toHaveBeenCalledTimes(1);
      expect(StyleSheet.create).toHaveBeenCalledWith(mockStyles);

      // Check if the returned object is the same (due to the mock)
      expect(createdStyles).toEqual(mockStyles);
    });

    test('should throw an error if styles object is null', () => {
      // @ts-ignore: Testing runtime error for null input
      expect(() => createStyleSheet(null)).toThrow(
        'Styles object cannot be null or undefined.'
      );
    });

    test('should throw an error if styles object is undefined', () => {
      // @ts-ignore: Testing runtime error for undefined input
      expect(() => createStyleSheet(undefined)).toThrow(
        'Styles object cannot be null or undefined.'
      );
    });

    test('should handle an empty styles object gracefully', () => {
      const emptyStyles = {};
      const createdStyles = createStyleSheet(emptyStyles);
      expect(StyleSheet.create).toHaveBeenCalledTimes(1);
      expect(createdStyles).toEqual({});
    });
  });

  // --- 3. Test Utility Function (getSpacing) ---
  describe('getSpacing', () => {
    test('should return the correct spacing value for a valid key', () => {
      expect(getSpacing('md')).toBe(16);
      expect(getSpacing('xs')).toBe(4);
    });

    test('should return the fallback value for an invalid key (edge case)', () => {
      // @ts-ignore: Testing an invalid key to hit the fallback logic
      expect(getSpacing('xxl')).toBe(Tokens.spacing.md);
    });

    test('should return the fallback value if the token value is not a number (mock edge case)', () => {
      // Temporarily mock the token to simulate the edge case where the value is not a number
      const originalMd = Tokens.spacing.md;
      // @ts-ignore: Simulating a bad token value for coverage
      Tokens.spacing.md = 'not-a-number';

      // Test a valid key that now has a bad value
      // This test is designed to hit the `typeof spacingValue !== 'number'` branch
      expect(getSpacing('md')).toBe(originalMd); // Fallback is 16, which is the original value

      // Restore the original token value
      Tokens.spacing.md = originalMd;
    });
  });

  // --- 4. Test Utility Function (getTextStyle) ---
  describe('getTextStyle', () => {
    test('should return the correct style object for a valid key', () => {
      expect(getTextStyle('h1')).toEqual(Tokens.typography.h1);
      expect(getTextStyle('body')).toEqual(Tokens.typography.body);
    });

    test('should return the fallback style for an invalid key (edge case)', () => {
      // @ts-ignore: Testing an invalid key to hit the fallback logic
      expect(getTextStyle('subtitle')).toEqual(Tokens.typography.body);
    });
  });

  // --- 5. Test Utility Function (getColor) ---
  describe('getColor', () => {
    test('should return the correct color string for a valid key', () => {
      expect(getColor('primary')).toBe('#007AFF');
      expect(getColor('error')).toBe('#FF3B30');
    });

    test('should return the fallback color for an invalid key (edge case)', () => {
      // @ts-ignore: Testing an invalid key to hit the fallback logic
      expect(getColor('warning')).toBe(Tokens.colors.text);
    });
  });

  // --- 6. Test Default Export ---
  test('should export all components as default', () => {
    expect(DesignSystem.Tokens).toBe(Tokens);
    expect(DesignSystem.createStyleSheet).toBe(createStyleSheet);
    expect(DesignSystem.getSpacing).toBe(getSpacing);
    expect(DesignSystem.getTextStyle).toBe(getTextStyle);
    expect(DesignSystem.getColor).toBe(getColor);
  });
});