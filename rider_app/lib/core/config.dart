class Config {
  // Android emulator -> host machine. Override: flutter run --dart-define=API_BASE=https://api.example.com
  static const apiBase = String.fromEnvironment('API_BASE', defaultValue: 'http://10.0.2.2:3000');
}
