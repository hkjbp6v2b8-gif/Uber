import 'package:flutter/material.dart';
import 'core/api.dart';
import 'features/auth/login_screen.dart';
import 'features/home/home_screen.dart';

void main() => runApp(const DriverApp());

class DriverApp extends StatefulWidget {
  const DriverApp({super.key});
  @override
  State<DriverApp> createState() => _DriverAppState();
}

class _DriverAppState extends State<DriverApp> {
  bool? _loggedIn;

  @override
  void initState() {
    super.initState();
    Api.I.loadSaved().then((v) => setState(() => _loggedIn = v));
  }

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Driver',
      theme: ThemeData(useMaterial3: true, colorSchemeSeed: Colors.green),
      builder: (c, child) => Directionality(textDirection: TextDirection.rtl, child: child!),
      home: _loggedIn == null
          ? const Scaffold(body: Center(child: CircularProgressIndicator()))
          : _loggedIn!
              ? HomeScreen(onLogout: () => setState(() => _loggedIn = false))
              : LoginScreen(role: 'driver', onDone: () => setState(() => _loggedIn = true)),
    );
  }
}
