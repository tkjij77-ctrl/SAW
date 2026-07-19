# SAW MC Hosting v2.0.0-beta.7

## الهدف

تحويل أهم صفحات اللوحة من واجهات شكلية إلى عمليات حقيقية مع الحفاظ على ميزانية صفر وعدم كشف أسرار Supabase أو Hugging Face للمتصفح.

## الوظائف الجديدة

### Private Dataset Backups

- إنشاء نسخة متسقة باستخدام `save-off` و`save-all flush` ثم `save-on`.
- ضغط بيانات السيرفر ورفعها مباشرة من الـAgent إلى Private Dataset.
- مهام Background مع `backup_status` حتى لا تنتهي مهلة Supabase Edge Function أثناء النسخ الكبيرة.
- SHA-256 لكل Archive وManifest مستقل.
- عرض، تنزيل، حذف واستعادة.
- التحقق من SHA-256 قبل الاستعادة.
- رفض الاستعادة والسيرفر يعمل.
- منع Tar path traversal والروابط الرمزية والأجهزة.
- Retention تلقائي لأحدث 5 نسخ.

### Agent v2.6.0

- Upgrade Agent للسيرفرات القديمة من صفحة Backups.
- إعداد `DATASET_REPO_ID` و`SERVER_ID` وSecret الخاص بالنسخ تلقائيًا.
- Java وPlayit يعملان في Environment منقح لا يحتوي `TOKEN` أو`SECRET` أو`PASSWORD`؛ لذلك Minecraft Plugins لا ترث Hugging Face Token.

### Verified Modrinth Installer

- بحث Modrinth حقيقي.
- اختيار الإصدار المتوافق مع Minecraft وPaper/Purpur تلقائيًا.
- قبول التنزيل من `cdn.modrinth.com` فقط.
- التحقق من SHA-512 قبل وضع JAR في `plugins/`.
- Enable / Disable / Delete حقيقي.
- Mods غير المتوافقة مع Purpur لا يتم تثبيتها بصورة مضللة.

### UI حقيقية

- Console: Status حقيقي، Wrap، Copy، Download logs، أخطاء وإرسال آمن.
- Files: Rename وحفظ الملفات الفارغة ومعالجة أخطاء العمليات.
- Players: Tell وOP وKick بصلاحيات Backend.
- Settings: قراءة وتحديث `server.properties` مع `.bak` وإعادة تشغيل آمنة.
- Audit: Export CSV مع حماية CSV Injection.
- Global Activity حقيقي.
- Worlds تعرض المجلدات الحقيقية وتوجه إلى Files/Backups.
- إزالة الأزرار الشكلية في Versions وSchedules وDatabases.

### Database وPrivacy

- Profiles لم تعد قابلة للتعداد من كل مستخدم مسجل.
- المستخدم يرى ملفه والمستخدمين المرتبطين بسيرفر متاح له فقط.
- إيقاف تسجيل Status/Logs polling داخل `audit_logs`.
- حذف Polling logs القديمة.
- Retention تلقائي 90 يومًا لسجل التدقيق.

## ترتيب النشر

### 1. طبّق SQL أولًا

افتح:

https://supabase.com/dashboard/project/seiqkubajnwpzdunyovm/sql/new

وشغل الملف كاملًا:

```text
supabase/APPLY-BETA7.sql
```

هذا الملف شامل beta.6 وbeta.7 وآمن لإعادة التشغيل.

### 2. تحقق من النتائج

شغل:

```text
supabase/VERIFY-BETA7.sql
```

يجب أن تكون القيم الأساسية `true`، ولا تظهر صلاحيات `anon` أو`authenticated` على `hf_connections`.

### 3. ارفع ملفات الحزمة إلى GitHub

ارفع المصدر إلى جذر مستودع SAW. لا ترفع:

```text
frontend-v2/node_modules
frontend-v2/dist
```

### 4. راقب GitHub Actions

يجب نجاح:

```text
Validate and Deploy Supabase Edge Functions
Build Frontend v2
Deploy SAW Frontend v2
GitHub Pages deployment
```

### 5. ترقية السيرفرات القديمة

لكل سيرفر قديم:

```text
Server → Backups → Upgrade Agent v2.6
```

انتظر اكتمال Hugging Face Space Build، ثم اضغط Refresh وأنشئ نسخة تجريبية.

السيرفرات الجديدة تحصل على Agent v2.6 وBackup secret تلقائيًا.

## Smoke Test

1. Login وGitHub OAuth.
2. Hugging Face Connection.
3. افتح سيرفرًا قديمًا واضغط Upgrade Agent.
4. انتظر Running.
5. أنشئ Backup باسم `pre-stable-test`.
6. تحقق من ظهور `VERIFIED` وحجم الملف.
7. ثبّت Plugin صغيرًا من Modrinth.
8. أعد تشغيل السيرفر وتحقق من Console.
9. اختبر Rename وSave لملف نصي فارغ.
10. أضف عضوًا ثم أزله.
11. افتح Activity وصدّر Audit CSV.

## ملاحظات الخطة المجانية

- Space قد يدخل Sleep؛ مهمة Backup الجارية قد تتوقف إذا أوقف Hugging Face الـRuntime.
- Schedules الدائمة غير مفعلة لأن الادعاء بتنفيذ Cron أثناء Sleep غير موثوق.
- تنزيل Private Backup يفتح Hugging Face، ويلزم أن يكون المتصفح مسجلًا بحساب المالك.
- لا ترسل HF Token أو Service Role في المحادثة أو GitHub.
