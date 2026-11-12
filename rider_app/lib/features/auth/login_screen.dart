import 'package:flutter/material.dart';
import '../../core/api.dart';

/// Shared by rider and driver apps. [role] = 'rider' | 'driver'.
class LoginScreen extends StatefulWidget {
  final String role;
  final VoidCallback onDone;
  const LoginScreen({super.key, required this.role, required this.onDone});
  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final _name = TextEditingController(), _phone = TextEditingController();
  final _pass = TextEditingController(), _license = TextEditingController();
  bool _register = false, _busy = false;
  String? _error;

  Future<void> _submit() async {
    setState(() { _busy = true; _error = null; });
    final err = _register
        ? await Api.I.register({
            'name': _name.text.trim(), 'phone': _phone.text.trim(), 'password': _pass.text,
            'role': widget.role, if (widget.role == 'driver') 'license_no': _license.text.trim(),
          })
        : await Api.I.login(_phone.text.trim(), _pass.text, widget.role);
    if (!mounted) return;
    if (err == null) { widget.onDone(); return; }
    setState(() { _busy = false; _error = err; });
  }

  @override
  Widget build(BuildContext context) {
    final isDriver = widget.role == 'driver';
    return Scaffold(
      body: SafeArea(
        child: ListView(padding: const EdgeInsets.all(24), children: [
          const SizedBox(height: 40),
          Icon(isDriver ? Icons.local_taxi : Icons.person_pin_circle, size: 72),
          const SizedBox(height: 12),
          Text(isDriver ? 'تطبيق السائق' : 'تطبيق الراكب', textAlign: TextAlign.center, style: Theme.of(context).textTheme.headlineSmall),
          const SizedBox(height: 24),
          if (_register) TextField(controller: _name, decoration: const InputDecoration(labelText: 'الاسم')),
          TextField(controller: _phone, keyboardType: TextInputType.phone, decoration: const InputDecoration(labelText: 'رقم الهاتف')),
          TextField(controller: _pass, obscureText: true, decoration: const InputDecoration(labelText: 'كلمة المرور (8 أحرف على الأقل)')),
          if (_register && isDriver) TextField(controller: _license, decoration: const InputDecoration(labelText: 'رقم الرخصة')),
          if (_error != null) Padding(padding: const EdgeInsets.only(top: 12), child: Text(_error!, style: const TextStyle(color: Colors.red))),
          const SizedBox(height: 20),
          FilledButton(onPressed: _busy ? null : _submit, child: Text(_register ? 'إنشاء حساب' : 'تسجيل الدخول')),
          TextButton(onPressed: () => setState(() => _register = !_register), child: Text(_register ? 'لدي حساب' : 'حساب جديد')),
        ]),
      ),
    );
  }
}
