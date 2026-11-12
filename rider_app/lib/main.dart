import 'package:flutter/material.dart';
import 'core/api.dart';
import 'features/auth/login_screen.dart';
import 'features/map/map_screen.dart';

void main() => runApp(const RiderApp());

class RiderApp extends StatefulWidget {
  const RiderApp({super.key});
  @override
  State<RiderApp> createState() => _RiderAppState();
}

class _RiderAppState extends State<RiderApp> {
  bool? _loggedIn;

  @override
  void initState() {
    super.initState();
    Api.I.loadSaved().then((v) => setState(() => _loggedIn = v));
  }

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Rider',
      theme: ThemeData(useMaterial3: true, colorSchemeSeed: Colors.black),
      builder: (c, child) => Directionality(textDirection: TextDirection.rtl, child: child!),
      home: _loggedIn == null
          ? const Scaffold(body: Center(child: CircularProgressIndicator()))
          : _loggedIn!
              ? MapScreen(onLogout: () => setState(() => _loggedIn = false))
              : LoginScreen(role: 'rider', onDone: () => setState(() => _loggedIn = true)),
    );
  }
}
