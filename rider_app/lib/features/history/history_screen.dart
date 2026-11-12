import 'package:flutter/material.dart';
import '../../core/api.dart';

const statusAr = {
  'requested': 'جاري البحث عن سائق', 'accepted': 'السائق في الطريق إليك', 'arrived': 'السائق وصل',
  'in_progress': 'الرحلة جارية', 'completed': 'مكتملة', 'cancelled_by_rider': 'ألغيتها',
  'cancelled_by_driver': 'ألغاها السائق', 'no_drivers_found': 'لا يوجد سائقون',
};

class HistoryScreen extends StatelessWidget {
  const HistoryScreen({super.key});

  Future<List> _load() async => (await Api.I.dio.get('/rides/history')).data['rides'];

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('رحلاتي')),
      body: FutureBuilder<List>(
        future: _load(),
        builder: (c, s) {
          if (s.hasError) return const Center(child: Text('تعذر تحميل الرحلات'));
          if (!s.hasData) return const Center(child: CircularProgressIndicator());
          if (s.data!.isEmpty) return const Center(child: Text('لا توجد رحلات بعد'));
          return ListView(children: [
            for (final r in s.data!)
              ListTile(
                leading: const Icon(Icons.directions_car),
                title: Text('${r['fare']} • ${statusAr[r['status']] ?? r['status']}'),
                subtitle: Text('${r['distance_km']} كم • ${r['requested_at'].toString().substring(0, 16).replaceAll('T', ' ')}'),
              ),
          ]);
        },
      ),
    );
  }
}
