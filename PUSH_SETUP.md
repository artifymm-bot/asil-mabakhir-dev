# إشعارات تطبيق الأصيل — FCM + Supabase

## المعمارية

- الفواتير والطلبات تبقى في Supabase.
- APK Android يستخدم Capacitor Push Notifications.
- كل جهاز يسجل FCM token مع الدور: `manager` أو `preparer`.
- عند إنشاء طلبية للتحضير: Supabase Edge Function ترسل FCM إلى أجهزة المحضرين.
- عند إتمام التحضير: Edge Function ترسل FCM إلى أجهزة المديرين.
- بيانات الإشعار تتضمن `order_id` و`order_number` حتى يفتح التطبيق الطلبية المحددة عند الضغط.

## ما تم تجهيزه في المشروع

1. `@capacitor/push-notifications` موجود في `package.json`.
2. إعداد PushNotifications موجود في `capacitor.config.json`.
3. كود تسجيل الـFCM token وربطه بالدور موجود داخل `index.html`.
4. كود التعامل مع الضغط على الإشعار موجود داخل `index.html`.
5. Edge Function: `supabase/functions/send-order-push/index.ts`.
6. Migration: `supabase/migrations/20261005_push_notifications.sql`.
7. إعداد Firebase Android: `android/app/google-services.json`.

## إعداد Supabase

نفّذ migration أولًا.

ثم أضف Secret باسم:

`FCM_SERVICE_ACCOUNT_JSON`

وقيمته هي **محتوى JSON لحساب Service Account من Firebase/Google Cloud**. لا تستخدم `google-services.json` كـservice account؛ الملفان مختلفان.

Secrets المطلوبة للـEdge Function:
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `FCM_SERVICE_ACCOUNT_JSON`

بعد نشر الـfunction:

`supabase functions deploy send-order-push`

## إعداد Android

يجب أن يكون ملف:

`android/app/google-services.json`

داخل مشروع Capacitor Android، مع تطبيق Google Services Gradle plugin في مشروع Android.

المشروع يستخدم:
- App ID: `com.artify.asilmabakhir`
- Firebase Project: `asilmabakhirdov`

Capacitor plugin:
`@capacitor/push-notifications@7.0.7`

Android 13+ سيطلب إذن الإشعارات من خلال `requestPermissions()` الموجود في التطبيق.

## اختبار

### هاتف المحضر
1. افتح APK.
2. اختر «وضع المحضر».
3. وافق على الإشعارات.
4. تأكد أن token ظهر في `push_devices`.

### هاتف المدير
1. افتح APK.
2. اختر «وضع المدير».
3. وافق على الإشعارات.
4. تأكد أن token ظهر في `push_devices`.

### اختبار طلبية جديدة
من المدير: «إرسال للتحضير».
النتيجة: إشعار على هاتف المحضر، وعند الضغط يفتح الطلبية.

### اختبار الإتمام
من المحضر: «تم التحضير».
النتيجة: إشعار على هاتف المدير، وعند الضغط يفتح الطلبية.

لا تضع Service Account JSON داخل GitHub أو داخل ملفات الواجهة.
