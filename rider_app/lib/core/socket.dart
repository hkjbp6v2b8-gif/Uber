import 'package:socket_io_client/socket_io_client.dart' as io;
import 'config.dart';

class SocketService {
  static final SocketService I = SocketService._();
  SocketService._();
  io.Socket? _s;

  void connect(String token) {
    _s?.dispose();
    _s = io.io(
      Config.apiBase,
      io.OptionBuilder().setTransports(['websocket']).setAuth({'token': token}).disableAutoConnect().build(),
    );
    _s!.connect();
  }

  void on(String event, void Function(dynamic) cb) => _s?.on(event, cb);
  void off(String event) => _s?.off(event);
  void emit(String event, dynamic data) => _s?.emit(event, data);
  void disconnect() {
    _s?.dispose();
    _s = null;
  }
}
