import 'package:flutter/material.dart';
import 'package:geolocator/geolocator.dart';
import 'package:google_maps_flutter/google_maps_flutter.dart';
import '../../core/api.dart';
import '../../core/socket.dart';
import '../history/history_screen.dart';

class MapScreen extends StatefulWidget {
  final VoidCallback onLogout;
  const MapScreen({super.key, required this.onLogout});
  @override
  State<MapScreen> createState() => _MapScreenState();
}

class _MapScreenState extends State<MapScreen> {
  GoogleMapController? _map;
  LatLng? _me, _dest, _driver;
  Map<String, dynamic>? _est, _ride;
  String _type = 'economy';
  String _pay = 'cash';
  int _score = 5;
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    _init();
  }

  @override
  void dispose() {
    SocketService.I.off('ride:status_changed');
    SocketService.I.off('ride:driver_location');
    SocketService.I.disconnect();
    super.dispose();
  }

  Future<void> _init() async {
    final s = SocketService.I..connect(Api.I.token!);
    s.on('ride:status_changed', (d) {
      if (mounted && _ride != null && d['rideId'] == _ride!['id']) _refreshRide();
    });
    s.on('ride:driver_location', (d) {
      if (mounted) setState(() => _driver = LatLng((d['lat'] as num).toDouble(), (d['lng'] as num).toDouble()));
    });
    await _locate();
    try {
      final r = await Api.I.dio.get('/rides/active');
      if (mounted && r.data['ride'] != null) setState(() => _ride = Map<String, dynamic>.from(r.data['ride']));
    } catch (_) {}
  }

  Future<void> _locate() async {
    var p = await Geolocator.checkPermission();
    if (p == LocationPermission.denied) p = await Geolocator.requestPermission();
    if (p == LocationPermission.denied || p == LocationPermission.deniedForever) return;
    final pos = await Geolocator.getCurrentPosition();
    if (!mounted) return;
    setState(() => _me = LatLng(pos.latitude, pos.longitude));
    _map?.animateCamera(CameraUpdate.newLatLngZoom(_me!, 15));
  }

  void _toast(String m) => ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(m)));
  Map<String, double> _pt(LatLng p) => {'lat': p.latitude, 'lng': p.longitude};

  Future<void> _estimate() async {
    if (_me == null || _dest == null) return;
    setState(() => _busy = true);
    try {
      final r = await Api.I.dio.post('/rides/estimate', data: {'pickup': _pt(_me!), 'dropoff': _pt(_dest!), 'vehicle_type': _type});
      setState(() => _est = Map<String, dynamic>.from(r.data));
    } catch (_) {
      _toast('تعذر حساب السعر');
    }
    if (mounted) setState(() => _busy = false);
  }

  Future<void> _request() async {
    setState(() => _busy = true);
    try {
      final r = await Api.I.dio.post('/rides', data: {
        'pickup': _pt(_me!), 'dropoff': _pt(_dest!), 'vehicle_type': _type, 'payment_method': _pay,
      });
      setState(() => _ride = Map<String, dynamic>.from(r.data['ride']));
    } catch (e) {
      _toast(e.toString().contains('409') ? 'لديك رحلة نشطة بالفعل' : 'تعذر إرسال الطلب');
    }
    if (mounted) setState(() => _busy = false);
  }

  Future<void> _refreshRide() async {
    try {
      final r = await Api.I.dio.get('/rides/${_ride!['id']}');
      if (mounted) setState(() => _ride = Map<String, dynamic>.from(r.data['ride']));
    } catch (_) {}
  }

  void _reset() => setState(() { _ride = null; _dest = null; _est = null; _driver = null; _score = 5; });

  Future<void> _cancel() async {
    try { await Api.I.dio.post('/rides/${_ride!['id']}/cancel'); } catch (_) {}
    _reset();
  }

  Future<void> _rate() async {
    try { await Api.I.dio.post('/rides/${_ride!['id']}/rate', data: {'score': _score}); } catch (_) {}
    _reset();
  }

  Widget _panel() {
    final r = _ride;
    if (r != null) {
      final st = r['status'] as String;
      if (st == 'completed') {
        return Column(mainAxisSize: MainAxisSize.min, children: [
          Text('انتهت الرحلة • ${r['fare']}', style: Theme.of(context).textTheme.titleMedium),
          Row(mainAxisAlignment: MainAxisAlignment.center, children: [
            for (var i = 1; i <= 5; i++)
              IconButton(onPressed: () => setState(() => _score = i), icon: Icon(i <= _score ? Icons.star : Icons.star_border, color: Colors.amber)),
          ]),
          FilledButton(onPressed: _rate, child: const Text('تقييم السائق')),
        ]);
      }
      if (st.startsWith('cancelled') || st == 'no_drivers_found') {
        return Column(mainAxisSize: MainAxisSize.min, children: [
          Text(statusAr[st] ?? st),
          FilledButton(onPressed: _reset, child: const Text('حسناً')),
        ]);
      }
      return Column(mainAxisSize: MainAxisSize.min, children: [
        Text(statusAr[st] ?? st, style: Theme.of(context).textTheme.titleMedium),
        if (r['driver_name'] != null)
          ListTile(
            leading: const Icon(Icons.person),
            title: Text('${r['driver_name']}  ★ ${r['driver_rating']}'),
            subtitle: Text('${r['make'] ?? ''} ${r['model'] ?? ''} • ${r['plate'] ?? ''}'),
          ),
        if (st != 'in_progress') TextButton(onPressed: _cancel, child: const Text('إلغاء الرحلة')),
      ]);
    }
    if (_dest == null) return const Text('اضغط مطولاً على الخريطة لاختيار وجهتك');
    return Column(mainAxisSize: MainAxisSize.min, children: [
      SegmentedButton<String>(
        segments: const [
          ButtonSegment(value: 'economy', label: Text('اقتصادي')),
          ButtonSegment(value: 'comfort', label: Text('مريح')),
          ButtonSegment(value: 'van', label: Text('عائلي')),
        ],
        selected: {_type},
        onSelectionChanged: (s) { setState(() => _type = s.first); _estimate(); },
      ),
      const SizedBox(height: 8),
      if (_est != null) Text('${_est!['fare']} • ${_est!['distance_km']} كم • ${_est!['duration_min']} د${(_est!['surge'] as num) > 1 ? '  (ذروة x${_est!['surge']})' : ''}'),
      Row(mainAxisAlignment: MainAxisAlignment.center, children: [
        const Text('الدفع: '),
        DropdownButton<String>(value: _pay, items: const [
          DropdownMenuItem(value: 'cash', child: Text('نقداً')),
          DropdownMenuItem(value: 'wallet', child: Text('المحفظة')),
        ], onChanged: (v) => setState(() => _pay = v!)),
      ]),
      FilledButton(onPressed: _busy || _est == null ? null : _request, child: const Text('اطلب رحلة')),
    ]);
  }

  @override
  Widget build(BuildContext context) {
    final markers = <Marker>{
      if (_dest != null) Marker(markerId: const MarkerId('dest'), position: _dest!),
      if (_driver != null)
        Marker(markerId: const MarkerId('driver'), position: _driver!, icon: BitmapDescriptor.defaultMarkerWithHue(BitmapDescriptor.hueAzure)),
    };
    return Scaffold(
      appBar: AppBar(title: const Text('اطلب رحلة'), actions: [
        IconButton(icon: const Icon(Icons.history), onPressed: () => Navigator.push(context, MaterialPageRoute(builder: (_) => const HistoryScreen()))),
        IconButton(icon: const Icon(Icons.logout), onPressed: () async { await Api.I.logout(); widget.onLogout(); }),
      ]),
      body: Stack(children: [
        GoogleMap(
          initialCameraPosition: CameraPosition(target: _me ?? const LatLng(24.7136, 46.6753), zoom: 14),
          myLocationEnabled: true,
          myLocationButtonEnabled: true,
          markers: markers,
          onMapCreated: (c) => _map = c,
          onLongPress: _ride != null ? null : (p) { setState(() { _dest = p; _est = null; }); _estimate(); },
        ),
        Positioned(
          left: 12, right: 12, bottom: 12,
          child: Card(child: Padding(padding: const EdgeInsets.all(12), child: _panel())),
        ),
      ]),
    );
  }
}
