# beta.15 — Backend Stabilization

## سبب ضياع تعديلات الملفات

التدفق القديم كان عدة طلبات Frontend منفصلة: status ثم stop ثم write ثم read ثم start. أي فشل/Waking/نسخة Edge قديمة يقطع العملية، وبعض Plugins تكتب config الذاكرة عند shutdown فوق تعديل المستخدم.

## Agent v3.1 Safe Apply

Endpoint واحد `file_write_safe` ينفذ تحت Lock:

```text
Stop Minecraft
Backup old file (.bak)
Normalize protected security values
Atomic write
Read bytes back
SHA-256 compare
Private Dataset snapshot
Restart Minecraft
```

إذا فشلت الكتابة أو القراءة أو Dataset snapshot:

```text
Restore .bak
Restart Minecraft
Return structured error
```

القيم المحمية في server.properties تُضبط تلقائيًا:

```text
online-mode=true
enforce-secure-profile=false
```

Frontend يعرض SHA-256 وDataset archive وحالة Restart، ويحدّث المحرر لو تم Normalize.

## النشر

1. `APPLY-BETA15.sql` ثم `VERIFY-BETA15.sql`.
2. رفع الحزمة.
3. تشغيل Supabase workflow يدويًا لأن آخر commits يتم رفعها كRoot commits.
4. Upgrade Agent v3.1.
5. افتح ملف config، عدل قيمة عادية مثل motd، واضغط حفظ وتطبيق.
6. انتظر Dataset snapshot وRestart، ثم أعد فتح الملف وتأكد.
