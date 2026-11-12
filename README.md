# Ride App (Uber-style) — Flutter + Node.js

نظام نقل ركاب كامل: خادم API مع تتبع لحظي، تطبيق راكب، تطبيق سائق، ولوحة إدارة.

```
backend/      Node.js + Express + PostgreSQL + Redis + Socket.io
rider_app/    Flutter (تطبيق الراكب)
driver_app/   Flutter (تطبيق السائق)
admin_panel/  لوحة إدارة (ملف HTML واحد)
```

## 1) تشغيل الخادم
```bash
docker compose up --build          # PostgreSQL + Redis + API على المنفذ 3000
# إنشاء حساب مدير:
docker compose exec backend node scripts/create-admin.js "Admin" 0500000000 "StrongPass123"
```
بدون Docker: انسخ `backend/.env.example` إلى `backend/.env`، ثم `npm install && npm run migrate && npm start`.
الاختبارات: `cd backend && npm test`.

## 2) تشغيل تطبيقات Flutter
مجلدا التطبيقين يحتويان على كود `lib/` و`pubspec.yaml` فقط، فولّد ملفات المنصات أولاً:
```bash
cd rider_app            # ثم كرر نفس الخطوات في driver_app
flutter create . --org com.example --project-name rider_app
flutter pub get
```
**مفتاح Google Maps (إجباري):**
- أندرويد: في `android/app/src/main/AndroidManifest.xml` داخل `<application>` أضف
  `<meta-data android:name="com.google.android.geo.API_KEY" android:value="YOUR_KEY"/>`
- iOS: في `ios/Runner/AppDelegate.swift` استدعِ `GMSServices.provideAPIKey("YOUR_KEY")`

**صلاحيات الموقع:**
- أندرويد: أضف `ACCESS_FINE_LOCATION` و`ACCESS_COARSE_LOCATION` و`INTERNET` في الـ Manifest.
- iOS: أضف `NSLocationWhenInUseUsageDescription` في `Info.plist`.

التشغيل (عنوان الخادم على محاكي أندرويد هو الافتراضي):
```bash
flutter run --dart-define=API_BASE=http://10.0.2.2:3000
```
على جهاز حقيقي استخدم عنوان IP لجهازك أو دومين الخادم، وللإنتاج استخدم HTTPS.

## 3) لوحة الإدارة
افتح `admin_panel/index.html` في المتصفح (عدّل عنوان `API` داخل الملف)، وسجل بحساب المدير.

## تجربة سريعة
1. سجّل سائقاً في تطبيق السائق، سجّل مركبة من أيقونة السيارة، ثم فعّل "متصل".
2. سجّل راكباً، اضغط مطولاً على الخريطة لاختيار الوجهة، ثم "اطلب رحلة".
3. السائق يقبل الطلب ويتابع: وصلت ← بدء الرحلة ← إنهاء الرحلة. الراكب يرى موقع السائق مباشرة ثم يقيّمه.

## ما هو مكتمل وما يحتاج ربطاً خارجياً
| مكتمل | يحتاج ربطاً |
|---|---|
| تسجيل ودخول JWT + Refresh | إرسال OTP عبر SMS (Twilio…) — مكان الربط في `routes/auth.js` |
| طلب رحلة، مطابقة أقرب سائق، مهلة 15 ثانية | دفع بالبطاقة (Stripe أو بوابة محلية) — حالياً نقداً أو محفظة |
| تسعير + ذروة + أكواد خصم | شحن المحفظة الحقيقي (الحالي تجريبي ويتعطل في production) |
| تتبع لحظي عبر Socket.io | إشعارات Firebase (FCM) عند إغلاق التطبيق |
| تقييم، سجل رحلات، أرباح السائق | تتبع السائق في الخلفية (يحتاج خدمة foreground على أندرويد) |
| لوحة إدارة واعتماد السائقين | رسم مسار الرحلة على الخريطة (Directions API) |

## الأمان قبل النشر
- غيّر `JWT_SECRET` و`JWT_REFRESH_SECRET` وكلمات مرور قاعدة البيانات، واجعل `AUTO_APPROVE_DRIVERS=false` و`NODE_ENV=production`.
- ضع الخادم خلف HTTPS، وقيّد `cors` على نطاق لوحة الإدارة.
