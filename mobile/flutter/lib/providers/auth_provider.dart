import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../services/api_service.dart';

class User {
  final String id;
  final String name;
  final String email;
  final String role;
  final String? avatarUrl;

  const User({
    required this.id,
    required this.name,
    required this.email,
    required this.role,
    this.avatarUrl,
  });

  factory User.fromJson(Map<String, dynamic> json) => User(
    id: json['id'] as String,
    name: json['name'] as String? ?? 'User',
    email: json['email'] as String? ?? '',
    role: json['role'] as String? ?? 'user',
    avatarUrl: json['avatarUrl'] as String?,
  );
}

class AuthState {
  final User? user;
  final bool isLoading;
  final String? error;

  const AuthState({this.user, this.isLoading = false, this.error});

  bool get isAuthenticated => user != null;

  AuthState copyWith({User? user, bool? isLoading, String? error}) => AuthState(
    user: user ?? this.user,
    isLoading: isLoading ?? this.isLoading,
    error: error ?? this.error,
  );
}

class AuthNotifier extends StateNotifier<AuthState> {
  AuthNotifier() : super(const AuthState(isLoading: true)) {
    _init();
  }

  Future<void> _init() async {
    final sessionId = await apiService.getSession();
    if (sessionId != null) {
      await _fetchUser();
    } else {
      state = const AuthState();
    }
  }

  Future<void> _fetchUser() async {
    try {
      state = state.copyWith(isLoading: true);
      final data = await apiService.query('auth.me');
      state = AuthState(user: User.fromJson(data));
    } catch (e) {
      await apiService.clearSession();
      state = AuthState(error: e.toString());
    }
  }

  Future<bool> login(String sessionId) async {
    try {
      state = state.copyWith(isLoading: true);
      await apiService.saveSession(sessionId);
      await _fetchUser();
      return state.isAuthenticated;
    } catch (e) {
      state = AuthState(error: e.toString());
      return false;
    }
  }

  Future<void> logout() async {
    try {
      await apiService.mutate('auth.logout', {});
    } catch (_) {}
    await apiService.clearSession();
    state = const AuthState();
  }
}

final authProvider = StateNotifierProvider<AuthNotifier, AuthState>((ref) => AuthNotifier());
