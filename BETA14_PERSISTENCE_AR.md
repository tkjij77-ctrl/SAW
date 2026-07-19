# SAW beta.14 — Persistence & Large Files

## Agent v3.0

### Auto Restore

قبل AUTO_START، Agent يفحص وجود `level.dat`. إذا القرص فارغ وDataset يحتوي Backup verified:

```text
[PERSISTENCE] Empty local disk detected
[PERSISTENCE] Auto-restore completed
[SYSTEM] Started Minecraft
```

لو Dataset يحتوي Backups لكن لا يوجد Manifest SHA-256 صحيح، يمنع تشغيل Minecraft لحماية البيانات بدل إنشاء عالم جديد فوق الحالة المفقودة.

### Adaptive Auto Backup

- كل 60 دقيقة أثناء عمل Space.
- Metadata fingerprint للمجلدات المتغيرة.
- لا Dataset commit لو الملفات لم تتغير.
- Backup إجباري قبل Restart؛ لو فشل، يُلغى Restart.
- آخر 5 نسخ.
- SHA-256 manifest وArchive.

### Chunked Upload

- حتى 512 MB.
- Chunk = 3 MB.
- SHA-256 لكل Chunk.
- جلسة قابلة للاستكمال لمدة ساعتين.
- Duplicate chunk idempotency.
- Final size + SHA-256.
- Atomic rename إلى الملف النهائي.
- Frontend يحفظ Upload ID في localStorage ويستكمل عند إعادة اختيار نفس الملف.

## النشر

1. شغّل `APPLY-BETA14.sql` ثم `VERIFY-BETA14.sql`.
2. ارفع الحزمة.
3. انشر Functions.
4. من Backups اضغط Upgrade Agent v3.0 لكل سيرفر قديم.
5. أنشئ Backup VERIFIED قبل اختبار قرص فارغ.
6. اختبر ملفًا أكبر من 8MB من File Manager.

## اختبار Auto Restore الآمن

- أنشئ Backup وتأكد VERIFIED.
- Restart/Factory rebuild للـSpace سيزيل القرص المؤقت.
- عند الإقلاع يجب أن يظهر Auto-restore قبل Start Minecraft.
- افحص العالم والـconfigs والـplugins وPlayit.
