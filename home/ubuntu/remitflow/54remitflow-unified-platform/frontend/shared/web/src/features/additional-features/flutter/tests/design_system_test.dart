import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'DesignSystem.dart'; // Import the hypothetical DesignSystem.dart

void main() {
  // --- 1. Test Design Tokens (AppColors, AppTextStyles, AppSpacing) ---

  group('Design Tokens Tests', () {
    test('AppColors defines correct color values', () {
      expect(AppColors.primary, const Color(0xFF007AFF));
      expect(AppColors.secondary, const Color(0xFFFF9500));
      expect(AppColors.background, const Color(0xFFF2F2F7));
      expect(AppColors.error, const Color(0xFFFF3B30));
      expect(AppColors.success, const Color(0xFF34C759));
    });

    test('AppTextStyles defines correct text styles', () {
      // headline1
      expect(AppTextStyles.headline1.fontSize, 28);
      expect(AppTextStyles.headline1.fontWeight, FontWeight.bold);
      expect(AppTextStyles.headline1.color, AppColors.primary);

      // bodyText1
      expect(AppTextStyles.bodyText1.fontSize, 16);
      expect(AppTextStyles.bodyText1.fontWeight, FontWeight.normal);
      expect(AppTextStyles.bodyText1.color, Colors.black87);

      // buttonText
      expect(AppTextStyles.buttonText.fontSize, 16);
      expect(AppTextStyles.buttonText.fontWeight, FontWeight.w600);
      expect(AppTextStyles.buttonText.color, Colors.white);
    });

    test('AppSpacing defines correct spacing values', () {
      expect(AppSpacing.small, 8.0);
      expect(AppSpacing.medium, 16.0);
      expect(AppSpacing.large, 24.0);
    });
  });

  // --- 2. Test Custom Widget (PrimaryButton) ---

  group('PrimaryButton Tests', () {
    testWidgets('Button displays text and is tappable when onPressed is provided', (WidgetTester tester) async {
      bool tapped = false;
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: PrimaryButton(
              text: 'Test Button',
              onPressed: () {
                tapped = true;
              },
            ),
          ),
        ),
      );

      // Verify the button text is displayed
      expect(find.text('Test Button'), findsOneWidget);

      // Verify the button is enabled and tap it
      await tester.tap(find.byType(ElevatedButton));
      await tester.pump();

      // Verify the tap callback was executed
      expect(tapped, isTrue);

      // Verify the correct styling (using tokens)
      final ElevatedButton button = tester.widget(find.byType(ElevatedButton));
      expect(button.style?.backgroundColor?.resolve({MaterialState.pressed}), AppColors.primary);
      expect(button.style?.padding?.resolve({MaterialState.selected}), const EdgeInsets.symmetric(horizontal: AppSpacing.large, vertical: AppSpacing.medium));
    });

    testWidgets('Button is disabled and has reduced opacity when onPressed is null', (WidgetTester tester) async {
      await tester.pumpWidget(
        const MaterialApp(
          home: Scaffold(
            body: PrimaryButton(
              text: 'Disabled Button',
              onPressed: null,
            ),
          ),
        ),
      );

      // Verify the button is disabled
      final ElevatedButton button = tester.widget(find.byType(ElevatedButton));
      expect(button.onPressed, isNull);

      // Verify the Opacity widget is present and has the correct value
      final Opacity opacityWidget = tester.widget(find.byType(Opacity));
      expect(opacityWidget.opacity, 0.5);
    });

    testWidgets('Button shows CircularProgressIndicator when isLoading is true', (WidgetTester tester) async {
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: PrimaryButton(
              text: 'Loading Button',
              onPressed: () {},
              isLoading: true,
            ),
          ),
        ),
      );

      // Verify the button is disabled (onPressed is nullified by isLoading)
      final ElevatedButton button = tester.widget(find.byType(ElevatedButton));
      expect(button.onPressed, isNull);

      // Verify the CircularProgressIndicator is displayed
      expect(find.byType(CircularProgressIndicator), findsOneWidget);

      // Verify the text is NOT displayed
      expect(find.text('Loading Button'), findsNothing);
    });
  });

  // --- 3. Test Material Design Integration (AppTheme) ---

  group('AppTheme Tests', () {
    test('lightTheme defines correct primary color and background', () {
      final theme = AppTheme.lightTheme;
      expect(theme.primaryColor, AppColors.primary);
      expect(theme.scaffoldBackgroundColor, AppColors.background);
    });

    test('lightTheme ColorScheme is correctly configured', () {
      final colorScheme = AppTheme.lightTheme.colorScheme;
      expect(colorScheme.primary, AppColors.primary);
      expect(colorScheme.secondary, AppColors.secondary);
      expect(colorScheme.error, AppColors.error);
      expect(colorScheme.background, AppColors.background);
    });

    test('lightTheme TextTheme uses AppTextStyles', () {
      final textTheme = AppTheme.lightTheme.textTheme;
      expect(textTheme.headlineLarge, AppTextStyles.headline1);
      expect(textTheme.bodyLarge, AppTextStyles.bodyText1);
    });

    test('lightTheme ElevatedButtonThemeData is correctly configured', () {
      final buttonTheme = AppTheme.lightTheme.elevatedButtonTheme;
      final style = buttonTheme.style;

      // Check background color
      expect(style?.backgroundColor?.resolve({MaterialState.selected}), AppColors.primary);
      // Check foreground color (text color)
      expect(style?.foregroundColor?.resolve({MaterialState.selected}), Colors.white);
      // Check text style
      expect(style?.textStyle?.resolve({MaterialState.selected}), AppTextStyles.buttonText);
    });

    test('lightTheme sets VisualDensity for accessibility', () {
      final theme = AppTheme.lightTheme;
      expect(theme.visualDensity, VisualDensity.adaptivePlatformDensity);
    });
  });

  // --- 4. Test Accessibility Component (AccessibleText) ---

  group('AccessibleText Tests', () {
    testWidgets('AccessibleText enforces minimum text scale factor of 1.0', (WidgetTester tester) async {
      // Set a low text scale factor in the environment
      await tester.pumpWidget(
        MediaQuery(
          data: const MediaQueryData(textScaleFactor: 0.5),
          child: const MaterialApp(
            home: Scaffold(
              body: AccessibleText(text: 'Small Scale Test'),
            ),
          ),
        ),
      );

      // Find the Text widget and check its scale factor
      final Text textWidget = tester.widget(find.byType(Text));
      // The clamp(1.0, 2.0) in the widget should enforce 1.0
      expect(textWidget.textScaleFactor, 1.0);
    });

    testWidgets('AccessibleText clamps large text scale factor to 2.0', (WidgetTester tester) async {
      // Set a high text scale factor in the environment
      await tester.pumpWidget(
        MediaQuery(
          data: const MediaQueryData(textScaleFactor: 3.0),
          child: const MaterialApp(
            home: Scaffold(
              body: AccessibleText(text: 'Large Scale Test'),
            ),
          ),
        ),
      );

      // Find the Text widget and check its scale factor
      final Text textWidget = tester.widget(find.byType(Text));
      // The clamp(1.0, 2.0) in the widget should enforce 2.0
      expect(textWidget.textScaleFactor, 2.0);
    });

    testWidgets('AccessibleText uses environment text scale factor when between 1.0 and 2.0', (WidgetTester tester) async {
      // Set a medium text scale factor in the environment
      await tester.pumpWidget(
        MediaQuery(
          data: const MediaQueryData(textScaleFactor: 1.5),
          child: const MaterialApp(
            home: Scaffold(
              body: AccessibleText(text: 'Medium Scale Test'),
            ),
          ),
        ),
      );

      // Find the Text widget and check its scale factor
      final Text textWidget = tester.widget(find.byType(Text));
      // The clamp(1.0, 2.0) should return the original 1.5
      expect(textWidget.textScaleFactor, 1.5);
    });

    testWidgets('AccessibleText uses provided style', (WidgetTester tester) async {
      const customStyle = TextStyle(color: Colors.red, fontSize: 30);
      await tester.pumpWidget(
        const MaterialApp(
          home: Scaffold(
            body: AccessibleText(text: 'Styled Text', style: customStyle),
          ),
        ),
      );

      final Text textWidget = tester.widget(find.byType(Text));
      expect(textWidget.style?.color, Colors.red);
      expect(textWidget.style?.fontSize, 30);
    });
  });
}