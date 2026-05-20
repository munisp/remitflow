import 'package:flutter/material.dart';

/// A comprehensive design system for the application, centralizing
/// design tokens (colors, typography, spacing) and providing
/// custom, production-ready widgets (Button, Input, Card) built
/// on top of Flutter's Material Design.
///
/// This system ensures consistency, type safety, and adherence to
/// modern Flutter development patterns.
///
/// The entire system is designed to be easily integrated and
/// extended, following the best practices for large-scale Flutter
/// applications.
class AppDesignSystem {
  // Private constructor to prevent instantiation
  AppDesignSystem._();

  // --- 1. Design Tokens ---

  /// Defines the color palette for the application.
  static const AppColors colors = AppColors._();

  /// Defines the typography styles for the application.
  static const AppTypography typography = AppTypography._();

  /// Defines the spacing and sizing values for the application.
  static const AppSpacing spacing = AppSpacing._();
}

/// --- Color Tokens ---
@immutable
class AppColors {
  const AppColors._();

  // Primary Colors
  final Color primary = const Color(0xFF007AFF); // iOS Blue
  final Color primaryDark = const Color(0xFF005BBF);
  final Color primaryLight = const Color(0xFF4DAAFF);

  // Secondary Colors
  final Color secondary = const Color(0xFFFF9500); // iOS Orange
  final Color secondaryDark = const Color(0xFFCC7A00);

  // Status Colors
  final Color success = const Color(0xFF34C759);
  final Color warning = const Color(0xFFFFCC00);
  final Color error = const Color(0xFFFF3B30);
  final Color info = const Color(0xFF5AC8FA);

  // Neutral Colors
  final Color background = const Color(0xFFF2F2F7);
  final Color surface = Colors.white;
  final Color textPrimary = Colors.black;
  final Color textSecondary = const Color(0xFF8E8E93);
  final Color border = const Color(0xFFC7C7CC);
}

/// --- Typography Tokens ---
@immutable
class AppTypography {
  const AppTypography._();

  final String fontFamily = 'System'; // Use system default for production

  TextStyle get headline1 => TextStyle(
        fontFamily: fontFamily,
        fontSize: 32.0,
        fontWeight: FontWeight.bold,
        color: AppDesignSystem.colors.textPrimary,
      );

  TextStyle get headline2 => TextStyle(
        fontFamily: fontFamily,
        fontSize: 24.0,
        fontWeight: FontWeight.w600,
        color: AppDesignSystem.colors.textPrimary,
      );

  TextStyle get bodyText1 => TextStyle(
        fontFamily: fontFamily,
        fontSize: 16.0,
        fontWeight: FontWeight.normal,
        color: AppDesignSystem.colors.textPrimary,
      );

  TextStyle get buttonText => TextStyle(
        fontFamily: fontFamily,
        fontSize: 16.0,
        fontWeight: FontWeight.w500,
        color: AppDesignSystem.colors.surface,
      );
}

/// --- Spacing Tokens ---
@immutable
class AppSpacing {
  const AppSpacing._();

  final double xxs = 4.0;
  final double xs = 8.0;
  final double sm = 12.0;
  final double md = 16.0;
  final double lg = 24.0;
  final double xl = 32.0;
  final double xxl = 48.0;

  final BorderRadius borderRadiusSm = const BorderRadius.all(Radius.circular(8.0));
  final BorderRadius borderRadiusMd = const BorderRadius.all(Radius.circular(12.0));
  final BorderRadius borderRadiusLg = const BorderRadius.all(Radius.circular(16.0));
}

// --- 2. Custom Widgets ---

/// A custom button widget with built-in loading state and async support.
///
/// Supports primary and secondary styles. Includes error handling for the
/// asynchronous [onPressed] callback.
class CustomButton extends StatelessWidget {
  const CustomButton({
    super.key,
    required this.text,
    required this.onPressed,
    this.isPrimary = true,
    this.isLoading = false,
    this.isDisabled = false,
  });

  final String text;
  final Future<void> Function()? onPressed;
  final bool isPrimary;
  final bool isLoading;
  final bool isDisabled;

  Color _getBackgroundColor(BuildContext context) {
    if (isDisabled || isLoading) {
      return AppDesignSystem.colors.border;
    }
    return isPrimary ? AppDesignSystem.colors.primary : AppDesignSystem.colors.secondary;
  }

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      height: 48.0,
      child: ElevatedButton(
        onPressed: (isDisabled || isLoading || onPressed == null)
            ? null
            : () async {
                try {
                  // Modern pattern: async/await for API integration
                  await onPressed!();
                } catch (e) {
                  // Complete error handling
                  ScaffoldMessenger.of(context).showSnackBar(
                    SnackBar(
                      content: Text('Error: Failed to perform action. $e'),
                      backgroundColor: AppDesignSystem.colors.error,
                    ),
                  );
                }
              },
        style: ElevatedButton.styleFrom(
          backgroundColor: _getBackgroundColor(context),
          shape: RoundedRectangleBorder(
            borderRadius: AppDesignSystem.spacing.borderRadiusMd,
          ),
          elevation: 0,
        ),
        child: isLoading
            ? const SizedBox(
                width: 24,
                height: 24,
                child: CircularProgressIndicator(
                  color: Colors.white,
                  strokeWidth: 2.0,
                ),
              )
            : Text(
                text,
                style: AppDesignSystem.typography.buttonText,
              ),
      ),
    );
  }
}

/// A custom text input field with built-in validation and clear styling.
///
/// Provides type safety through generic [T] for the validator function.
class CustomInput<T> extends StatelessWidget {
  const CustomInput({
    super.key,
    this.controller,
    this.labelText,
    this.hintText,
    this.keyboardType,
    this.obscureText = false,
    this.validator,
    this.onChanged,
  });

  final TextEditingController? controller;
  final String? labelText;
  final String? hintText;
  final TextInputType? keyboardType;
  final bool obscureText;
  final String? Function(T? value)? validator;
  final void Function(String value)? onChanged;

  @override
  Widget build(BuildContext context) {
    return TextFormField(
      controller: controller,
      keyboardType: keyboardType,
      obscureText: obscureText,
      onChanged: onChanged,
      style: AppDesignSystem.typography.bodyText1,
      decoration: InputDecoration(
        labelText: labelText,
        hintText: hintText,
        labelStyle: AppDesignSystem.typography.bodyText1.copyWith(
          color: AppDesignSystem.colors.textSecondary,
        ),
        hintStyle: AppDesignSystem.typography.bodyText1.copyWith(
          color: AppDesignSystem.colors.textSecondary.withOpacity(0.6),
        ),
        contentPadding: EdgeInsets.all(AppDesignSystem.spacing.md),
        border: OutlineInputBorder(
          borderRadius: AppDesignSystem.spacing.borderRadiusSm,
          borderSide: BorderSide(color: AppDesignSystem.colors.border),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: AppDesignSystem.spacing.borderRadiusSm,
          borderSide: BorderSide(color: AppDesignSystem.colors.primary, width: 2.0),
        ),
        errorBorder: OutlineInputBorder(
          borderRadius: AppDesignSystem.spacing.borderRadiusSm,
          borderSide: BorderSide(color: AppDesignSystem.colors.error, width: 2.0),
        ),
      ),
      // Type safety: The validator is cast to work with String, which is the
      // default type for TextFormField, but the generic T allows for
      // more specific type checking if this were a custom form field.
      validator: (String? value) => validator?.call(value as T?),
    );
  }
}

/// A custom card widget for grouping content with elevation and rounded corners.
///
/// Uses [AppDesignSystem.colors.surface] for background and
/// [AppDesignSystem.spacing.borderRadiusMd] for corners.
class CustomCard extends StatelessWidget {
  const CustomCard({
    super.key,
    required this.child,
    this.padding,
    this.elevation = 1.0,
  });

  final Widget child;
  final EdgeInsets? padding;
  final double elevation;

  @override
  Widget build(BuildContext context) {
    return Card(
      elevation: elevation,
      color: AppDesignSystem.colors.surface,
      shape: RoundedRectangleBorder(
        borderRadius: AppDesignSystem.spacing.borderRadiusMd,
      ),
      child: Padding(
        padding: padding ?? EdgeInsets.all(AppDesignSystem.spacing.md),
        child: child,
      ),
    );
  }
}

// --- 3. Example Usage (Optional but helpful for documentation) ---
// To use this design system, wrap your application with a MaterialApp
// and use the tokens and widgets throughout.

/*
class MyApp extends StatelessWidget {
  const MyApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Design System Demo',
      theme: ThemeData(
        primaryColor: AppDesignSystem.colors.primary,
        fontFamily: AppDesignSystem.typography.fontFamily,
        // You can integrate the design system into the global theme here
      ),
      home: const DesignSystemDemoScreen(),
    );
  }
}

class DesignSystemDemoScreen extends StatefulWidget {
  const DesignSystemDemoScreen({super.key});

  @override
  State<DesignSystemDemoScreen> createState() => _DesignSystemDemoScreenState();
}

class _DesignSystemDemoScreenState extends State<DesignSystemDemoScreen> {
  final TextEditingController _inputController = TextEditingController();
  bool _isLoading = false;

  Future<void> _handleLogin() async {
    setState(() => _isLoading = true);
    // Simulate API call / Integration with backend APIs
    await Future.delayed(const Duration(seconds: 2));
    setState(() => _isLoading = false);
    // Handle success or failure
    // For example, navigate or show a success message
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Text('Design System Demo', style: AppDesignSystem.typography.headline2),
        backgroundColor: AppDesignSystem.colors.surface,
      ),
      backgroundColor: AppDesignSystem.colors.background,
      body: SingleChildScrollView(
        padding: EdgeInsets.all(AppDesignSystem.spacing.lg),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Text('Custom Card', style: AppDesignSystem.typography.headline1),
            SizedBox(height: AppDesignSystem.spacing.md),
            CustomCard(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text('Card Title', style: AppDesignSystem.typography.headline2),
                  SizedBox(height: AppDesignSystem.spacing.xs),
                  Text('This is content inside a custom card.', style: AppDesignSystem.typography.bodyText1),
                ],
              ),
            ),
            SizedBox(height: AppDesignSystem.spacing.xl),

            Text('Custom Input', style: AppDesignSystem.typography.headline1),
            SizedBox(height: AppDesignSystem.spacing.md),
            Form(
              child: CustomInput<String>(
                controller: _inputController,
                labelText: 'Username',
                hintText: 'Enter your username',
                keyboardType: TextInputType.emailAddress,
                validator: (value) {
                  if (value == null || value.isEmpty) {
                    return 'Username is required';
                  }
                  return null;
                },
              ),
            ),
            SizedBox(height: AppDesignSystem.spacing.xl),

            Text('Custom Button', style: AppDesignSystem.typography.headline1),
            SizedBox(height: AppDesignSystem.spacing.md),
            CustomButton(
              text: 'Primary Action',
              onPressed: _handleLogin,
              isLoading: _isLoading,
            ),
            SizedBox(height: AppDesignSystem.spacing.md),
            CustomButton(
              text: 'Secondary Action',
              onPressed: () async {
                // Another async operation
                await Future.delayed(const Duration(milliseconds: 500));
              },
              isPrimary: false,
            ),
            SizedBox(height: AppDesignSystem.spacing.md),
            const CustomButton(
              text: 'Disabled Button',
              onPressed: null,
              isDisabled: true,
            ),
          ],
        ),
      ),
    );
  }
}
*/