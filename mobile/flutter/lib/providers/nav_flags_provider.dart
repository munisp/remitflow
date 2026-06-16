import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../services/api_service.dart';

/// Server-driven navigation feature flags.
/// Mirrors the PWA's `getNavFlags` tRPC call — resolves which features are
/// enabled for the current user based on:
///   1. User-level override (beta access / suspension)
///   2. Tenant-level toggle
///   3. Tenant plan gate (starter < growth < enterprise < white_label)
///   4. Role-based rules
///   5. KYC tier requirements
///   6. Global rollout %
class NavFlagsState {
  final Map<String, bool> flags;
  final bool isLoading;
  final String? error;

  const NavFlagsState({
    this.flags = const {},
    this.isLoading = false,
    this.error,
  });

  /// Check if a feature key is enabled. Defaults to true if flag not loaded.
  bool isEnabled(String? key) {
    if (key == null) return true;
    return flags[key] ?? true; // default visible if not explicitly disabled
  }

  NavFlagsState copyWith({
    Map<String, bool>? flags,
    bool? isLoading,
    String? error,
  }) =>
      NavFlagsState(
        flags: flags ?? this.flags,
        isLoading: isLoading ?? this.isLoading,
        error: error ?? this.error,
      );
}

class NavFlagsNotifier extends StateNotifier<NavFlagsState> {
  NavFlagsNotifier() : super(const NavFlagsState(isLoading: true)) {
    _loadFlags();
  }

  Future<void> _loadFlags() async {
    try {
      final result = await apiService.query('featureFlags.getNavFlags');
      if (result is Map) {
        final flags = <String, bool>{};
        result.forEach((key, value) {
          if (value is bool) flags[key.toString()] = value;
        });
        state = state.copyWith(flags: flags, isLoading: false);
      } else {
        state = state.copyWith(isLoading: false);
      }
    } catch (e) {
      // On failure, default to all-visible (graceful degradation)
      state = state.copyWith(isLoading: false, error: e.toString());
    }
  }

  /// Force refresh flags (e.g., after role change or plan upgrade)
  Future<void> refresh() async {
    state = state.copyWith(isLoading: true);
    await _loadFlags();
  }
}

final navFlagsProvider = StateNotifierProvider<NavFlagsNotifier, NavFlagsState>(
  (ref) => NavFlagsNotifier(),
);
