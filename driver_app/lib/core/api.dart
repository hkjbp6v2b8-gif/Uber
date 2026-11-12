import 'package:dio/dio.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'config.dart';

class Api {
  static final Api I = Api._();
  final _store = const FlutterSecureStorage();
  late final Dio dio;
  String? token;

  Api._() {
    dio = Dio(BaseOptions(baseUrl: Config.apiBase, connectTimeout: const Duration(seconds: 10)));
    dio.interceptors.add(InterceptorsWrapper(
      onRequest: (o, h) {
        if (token != null) o.headers['Authorization'] = 'Bearer $token';
        h.next(o);
      },
      onError: (e, h) async {
        final isAuthCall = e.requestOptions.path.startsWith('/auth');
        if (e.response?.statusCode == 401 && !isAuthCall && await _refresh()) {
          final opts = e.requestOptions..headers['Authorization'] = 'Bearer $token';
          try {
            return h.resolve(await dio.fetch(opts));
          } catch (_) {}
        }
        h.next(e);
      },
    ));
  }

  Future<bool> loadSaved() async {
    token = await _store.read(key: 'access');
    return token != null;
  }

  Future<void> _save(Map d) async {
    token = d['accessToken'];
    await _store.write(key: 'access', value: d['accessToken']);
    await _store.write(key: 'refresh', value: d['refreshToken']);
  }

  Future<bool> _refresh() async {
    final rt = await _store.read(key: 'refresh');
    if (rt == null) return false;
    try {
      final r = await Dio(BaseOptions(baseUrl: Config.apiBase)).post('/auth/refresh', data: {'refreshToken': rt});
      await _save(r.data);
      return true;
    } catch (_) {
      return false;
    }
  }

  /// Returns null on success, or an error message.
  Future<String?> login(String phone, String password, String role) async {
    try {
      final r = await dio.post('/auth/login', data: {'phone': phone, 'password': password});
      if (r.data['user']['role'] != role) return 'هذا الحساب ليس حساب $role';
      await _save(r.data);
      return null;
    } on DioException catch (e) {
      return e.response?.data?['error']?.toString() ?? 'تعذر الاتصال بالخادم';
    }
  }

  Future<String?> register(Map<String, dynamic> body) async {
    try {
      final r = await dio.post('/auth/register', data: body);
      await _save(r.data);
      return null;
    } on DioException catch (e) {
      return e.response?.data?['error']?.toString() ?? 'تعذر الاتصال بالخادم';
    }
  }

  Future<void> logout() async {
    token = null;
    await _store.deleteAll();
  }
}
