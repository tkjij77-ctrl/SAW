# SAW MC Hosting v2.0.0-beta.6 — نشر تقوية الـ Backend

هذه النسخة هي أول مرحلة في طريق النسخة المستقرة. لا تحتاج بطاقة بنكية ولا تطلب وضع أي Token داخل الواجهة أو المحادثة.

## ما تم تحسينه

- طبقة أمان مشتركة لكل Edge Functions.
- CORS مقيد بدومين GitHub Pages الخاص بـ SAW.
- التحقق من JWT مرة أخرى داخل كل Function.
- Request IDs وأخطاء منظمة بدون تسريب أخطاء داخلية أو Tokens.
- حدود لحجم ومدى كل Input.
- Rate Limiting ذري داخل PostgreSQL.
- Timeouts واضحة لاتصالات Hugging Face وMinecraft Agent.
- تشديد صلاحيات Owner/Admin/Operator/Editor/Viewer.
- حماية أقوى للأوامر ومسارات الملفات واسم الملف والرفع.
- منع SSRF من عنوان Agent غير تابع إلى `hf.space`.
- Provisioning أكثر أمانًا مع منع العمليات المتزامنة المكررة.
- التحقق من حساب Hugging Face قبل إنشاء الموارد.
- توحيد Template Version على Agent v2.5.0.
- CI يفحص تنسيق وTypeScript الخاص بكل Edge Function قبل النشر.
- إزالة Workflow القديم المكرر الذي كان ينشر Provisioning مرتين.

## ترتيب النشر الإجباري

> مهم: قاعدة البيانات أولًا، ثم Functions. عكس الترتيب سيجعل Functions تبحث عن `consume_rate_limit` قبل إنشائها.

### 1. ارفع الملفات إلى GitHub مع إيقاف نشر Functions مؤقتًا

يمكنك قبل الرفع تعطيل Workflow من:

`GitHub → Actions → Validate and Deploy Supabase Edge Functions → Disable workflow`

اترك GitHub Pages يعمل بصورة طبيعية.

### 2. طبق SQL الموحد

افتح:

https://supabase.com/dashboard/project/seiqkubajnwpzdunyovm/sql/new

ثم انسخ محتوى الملف التالي كاملًا وشغله مرة واحدة:

```text
supabase/APPLY-BETA6.sql
```

المفروض تظهر رسالة نجاح بدون Error.

### 3. تحقق من قاعدة البيانات

شغّل:

```text
supabase/VERIFY-BETA6.sql
```

يجب أن تكون القيم الأساسية `true`، ويجب ألا يملك `anon` أو `authenticated` أي صلاحية على `hf_connections`.

### 4. شغّل نشر Functions

من:

`GitHub → Actions → Validate and Deploy Supabase Edge Functions → Enable workflow → Run workflow`

الـ Workflow سينفذ:

1. `deno fmt --check`
2. `deno check`
3. نشر Functions الستة فقط إذا نجحت الاختبارات.

### 5. اختبارات Smoke Test

نفذ من نافذة Incognito:

1. تسجيل الدخول بالبريد.
2. تسجيل الخروج والدخول بـ GitHub.
3. فتح Connections وربط Hugging Face.
4. فتح قائمة السيرفرات.
5. فتح Dashboard ثم Console وFiles.
6. إضافة عضو ثم إزالته.
7. إنشاء سيرفر تجريبي واحد فقط.

## Rollback

لو فشل نشر Functions:

1. لا تحذف Migration؛ الإضافات متوافقة مع beta.5.
2. ارفع ملفات `supabase/functions` من حزمة beta.5 فقط.
3. شغّل Workflow النشر يدويًا.
4. احتفظ بـ `api_rate_limits`؛ لا تؤثر على beta.5.

## أسرار GitHub المطلوبة

أسماء الأسرار فقط، لا ترسل قيمها لأي شخص:

```text
SUPABASE_ACCESS_TOKEN
SUPABASE_PROJECT_ID
```

ويجب أن تكون `SUPABASE_PROJECT_ID` هي Project Ref وليست Service Role Key.
