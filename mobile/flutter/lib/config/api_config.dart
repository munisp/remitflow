/// ApiConfig — centralised base URL for all Flutter services.
/// In production this is injected via --dart-define=API_BASE_URL=...
class ApiConfig {
  static const String baseUrl = String.fromEnvironment(
    'API_BASE_URL',
    defaultValue: 'https://remitflow.manus.space',
  );
}
