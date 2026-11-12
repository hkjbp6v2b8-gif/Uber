import 'dart:async';
import 'package:flutter/material.dart';
import 'package:geolocator/geolocator.dart';
import 'package:google_maps_flutter/google_maps_flutter.dart';
import '../../core/api.dart';
import '../../core/socket.dart';

class HomeScreen extends StatefulWidget {
  final VoidCallback onLogout;
  const HomeScreen({super.key, required this.onLogout});
  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  bool _online = false, _busy = false;
  Map<String, dynamic>? _offer, _ride;
  Timer? _offerTimer;
  StreamSubscription<Position>? _posSub;
  LatLng? _me;

  @override
  void initState() {
    super.initState();
    _init();
  }

  @override
  void dispose() {
    _posSub?.cancel();
    _offerTimer?.cancel();
    SocketService.I.disconnect();
    super.dispose();
  }

  Future<void> _init() async {
    final s = SocketService.I..connect(Api.I.token!);
    s.on('ride:new_request', (d) {
      if (!mounted) return;
      setState(() => _offer = Map<String, dynamic>.from(d));
      _offerTimer?.cancel();
      _offerTimer = Timer(Duration(seconds: (d['expires_in'] ?? 15) as int), () {
        if (mounted) setState(() => _offer = null);
      });
    });
    s.on('ride:status_changed', (d) {
      if (!mounted) return;
      if (_offer != null && d['rideId'] == _offer!['rideId']) setState(() => _offer = null); // rider cancelled
      if (_ride != null && d['rideId'] == _ride!['id']) _refreshRide();
    });
    try {
      final r = await Api.I.dio.get('/rides/active');
      if (mounted && r.data['ride'] != null) setState(() => _ride = Map<String, dynamic>.from(r.data['ride']));
    } catch (_) {}
  }

  void _toast(String m) => ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(m)));
  LatLng _ll(dynamic lat, dynamic lng) => LatLng((lat as num).toDouble(), (lng as num).toDouble());

  Future<bool> _ensurePermission() async {
    var p = await Geolocator.checkPermission();
    if (p == LocationPermission.denied) p = await Geolocator.requestPermission();
    return p != LocationPermission.denied && p != LocationPermission.deniedForever;
  }

  Future<void> _toggleOnline(bool v) async {
    if (!await _ensurePermission()) { _toast('يلزم السماح بالموقع'); return; }
    setState(() => _busy = true);
    try {
      final pos = await Geolocator.getCurrentPosition();
      _me = LatLng(pos.latitude, pos.longitude);
      await Api.I.dio.patch('/drivers/status', data: {'status': v ? 'online' : 'offline', 'lat': pos.latitude, 'lng': pos.longitude});
      setState(() => _online = v);
      _posSub?.cancel();
      if (v) {
        // stream position; while on a ride it is forwarded to the rider
        _posSub = Geolocator.getPositionStream(locationSettings: const LocationSettings(accuracy: LocationAccuracy.high, distanceFilter: 10)).listen((p) {
          _me = LatLng(p.latitude, p.longitude);
          SocketService.I.emit('driver:location', {'lat': p.latitude, 'lng': p.longitude, if (_ride != null) 'rideId': _ride!['id']});
        });
      }
    } catch (e) {
      _toast(_dioMsg(e));
    }
    if (mounted) setState(() => _busy = false);
  }

  String _dioMsg(Object e) {
    try {
      final r = (e as dynamic).response;
      return r?.data?['error']?.toString() ?? 'تعذر الاتصال بالخادم';
    } catch (_) {
      return 'حدث خطأ';
    }
  }

  Future<void> _accept() async {
    final id = _offer!['rideId'];
    _offerTimer?.cancel();
    try {
      final r = await Api.I.dio.post('/rides/$id/accept');
      setState(() { _ride = Map<String, dynamic>.from(r.data['ride']); _offer = null; });
    } catch (e) {
      setState(() => _offer = null);
      _toast(_dioMsg(e));
    }
  }

  Future<void> _refreshRide() async {
    try {
      final r = await Api.I.dio.get('/rides/${_ride!['id']}');
      final ride = Map<String, dynamic>.from(r.data['ride']);
      if (!mounted) return;
      setState(() => _ride = (ride['status'] as String).startsWith('cancelled') ? null : ride);
      if (_ride == null) _toast('ألغى الراكب الرحلة');
    } catch (_) {}
  }

  Future<void> _step(String action) async {
    try {
      final r = await Api.I.dio.post('/rides/${_ride!['id']}/$action');
      final ride = Map<String, dynamic>.from(r.data['ride']);
      setState(() => _ride = ride['status'] == 'completed' ? null : ride);
      if (ride['status'] == 'completed') _toast('تمت الرحلة • الأجرة ${ride['fare']}');
    } catch (e) {
      _toast(_dioMsg(e));
    }
  }

  Future<void> _cancelRide() async {
    try { await Api.I.dio.post('/rides/${_ride!['id']}/cancel'); } catch (_) {}
    setState(() => _ride = null);
  }

  Future<void> _vehicleDialog() async {
    final make = TextEditingController(), model = TextEditingController(), plate = TextEditingController(), color = TextEditingController();
    String type = 'economy';
    await showDialog(
      context: context,
      builder: (c) => StatefulBuilder(
        builder: (c, set) => AlertDialog(
          title: const Text('تسجيل مركبة'),
          content: SingleChildScrollView(
            child: Column(mainAxisSize: MainAxisSize.min, children: [
              TextField(controller: make, decoration: const InputDecoration(labelText: 'الصنع')),
              TextField(controller: model, decoration: const InputDecoration(labelText: 'الموديل')),
              TextField(controller: plate, decoration: const InputDecoration(labelText: 'رقم اللوحة')),
              TextField(controller: color, decoration: const InputDecoration(labelText: 'اللون')),
              DropdownButton<String>(value: type, items: const [
                DropdownMenuItem(value: 'economy', child: Text('اقتصادي')),
                DropdownMenuItem(value: 'comfort', child: Text('مريح')),
                DropdownMenuItem(value: 'van', child: Text('عائلي')),
              ], onChanged: (v) => set(() => type = v!)),
            ]),
          ),
          actions: [
            TextButton(onPressed: () => Navigator.pop(c), child: const Text('إلغاء')),
            FilledButton(
              onPressed: () async {
                try {
                  await Api.I.dio.post('/drivers/vehicle', data: {'make': make.text, 'model': model.text, 'plate': plate.text, 'color': color.text, 'type': type});
                  if (c.mounted) Navigator.pop(c);
                  _toast('تم تسجيل المركبة');
                } catch (e) {
                  _toast(_dioMsg(e));
                }
              },
              child: const Text('حفظ'),
            ),
          ],
        ),
      ),
    );
  }

  Future<void> _earnings() async {
    try {
      final r = await Api.I.dio.get('/drivers/earnings');
      if (!mounted) return;
      showDialog(
        context: context,
        builder: (c) => AlertDialog(
          title: const Text('الأرباح'),
          content: Text('اليوم: ${r.data['today']}\nالإجمالي: ${r.data['total']}\nعدد الرحلات: ${r.data['rides']}'),
          actions: [TextButton(onPressed: () => Navigator.pop(c), child: const Text('إغلاق'))],
        ),
      );
    } catch (_) {
      _toast('تعذر تحميل الأرباح');
    }
  }

  Widget _panel() {
    if (_offer != null) {
      final o = _offer!;
      return Column(mainAxisSize: MainAxisSize.min, children: [
        Text('طلب جديد • ${o['fare']} • ${o['distance_km']} كم', style: Theme.of(context).textTheme.titleMedium),
        const SizedBox(height: 8),
        Row(children: [
          Expanded(child: FilledButton(onPressed: _accept, child: const Text('قبول'))),
          const SizedBox(width: 8),
          Expanded(child: OutlinedButton(onPressed: () => setState(() => _offer = null), child: const Text('تجاهل'))),
        ]),
      ]);
    }
    if (_ride != null) {
      final st = _ride!['status'];
      final label = {'accepted': 'وصلت إلى الراكب', 'arrived': 'بدء الرحلة', 'in_progress': 'إنهاء الرحلة'}[st]!;
      final action = {'accepted': 'arrived', 'arrived': 'start', 'in_progress': 'complete'}[st]!;
      return Column(mainAxisSize: MainAxisSize.min, children: [
        Text('الراكب: ${_ride!['rider_name'] ?? ''} • ${_ride!['fare']}', style: Theme.of(context).textTheme.titleMedium),
        const SizedBox(height: 8),
        FilledButton(onPressed: () => _step(action), child: Text(label)),
        if (st != 'in_progress') TextButton(onPressed: _cancelRide, child: const Text('إلغاء الرحلة')),
      ]);
    }
    return Text(_online ? 'بانتظار الطلبات...' : 'أنت غير متصل');
  }

  @override
  Widget build(BuildContext context) {
    final markers = <Marker>{
      if (_ride != null) ...{
        Marker(markerId: const MarkerId('pickup'), position: _ll(_ride!['pickup_lat'], _ride!['pickup_lng']), infoWindow: const InfoWindow(title: 'الالتقاط')),
        Marker(markerId: const MarkerId('drop'), position: _ll(_ride!['dropoff_lat'], _ride!['dropoff_lng']), infoWindow: const InfoWindow(title: 'الوجهة')),
      },
      if (_offer != null) Marker(markerId: const MarkerId('offer'), position: _ll(_offer!['pickup']['lat'], _offer!['pickup']['lng'])),
    };
    return Scaffold(
      appBar: AppBar(title: const Text('السائق'), actions: [
        IconButton(icon: const Icon(Icons.directions_car), tooltip: 'المركبة', onPressed: _vehicleDialog),
        IconButton(icon: const Icon(Icons.payments), tooltip: 'الأرباح', onPressed: _earnings),
        IconButton(icon: const Icon(Icons.logout), onPressed: () async { _posSub?.cancel(); await Api.I.logout(); widget.onLogout(); }),
      ]),
      body: Stack(children: [
        GoogleMap(
          initialCameraPosition: CameraPosition(target: _me ?? const LatLng(24.7136, 46.6753), zoom: 14),
          myLocationEnabled: true,
          markers: markers,
        ),
        Positioned(
          left: 12, right: 12, bottom: 12,
          child: Card(
            child: Padding(
              padding: const EdgeInsets.all(12),
              child: Column(mainAxisSize: MainAxisSize.min, children: [
                SwitchListTile(
                  title: Text(_online ? 'متصل' : 'غير متصل'),
                  value: _online,
                  onChanged: (_busy || _ride != null) ? null : _toggleOnline,
                ),
                _panel(),
              ]),
            ),
          ),
        ),
      ]),
    );
  }
}
