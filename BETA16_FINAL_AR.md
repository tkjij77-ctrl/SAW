# SAW beta.16 — Final Verified File Control

## حرية التعديل

كل الملفات والإعدادات العادية تحفظ كما كتبها المستخدم، بدون Normalize أو تعديل صامت. يشمل motd/max players/difficulty/world/plugin configs/mod configs وملفات YAML/JSON.

## Safe Apply

Background job واحدة:

```text
Validate before stop
Stop Minecraft
.bak
Atomic write
Read-back SHA-256
Dataset verified snapshot
Restart
```

فشل أي خطوة بعد الكتابة يعيد `.bak` ويشغل السيرفر. Frontend يتابع `file_write_safe_status` حتى 15 دقيقة، فلا تنتهي Edge request أثناء Backup كبير.

## الاستثناء الأمني الواضح

لا يحدث تعديل تلقائي. إذا `server.properties` يحاول تعطيل Microsoft auth أو كسر Floodgate، تُرفض العملية قبل إيقاف السيرفر برسالة واضحة ولا يتغير الملف:

```text
online-mode=true is required

enforce-secure-profile=false is required for Floodgate
```

## Paused Space تلقائي للمستخدم

عند فتح Dashboard/Files/Console، Backend يستدعي HF restart للـPAUSED/STOPPED/SLEEPING. Frontend يفهم `SPACE_WAKING` ويعيد نفس الطلب كل 5 ثوانٍ حتى 4 دقائق، ثم ينفذ العملية الأصلية عند RUNNING. لا يحتاج المستخدم فتح Hugging Face. هذا Wake-on-demand وليس Keep-alive.

## النشر

1. APPLY-BETA16.sql ثم VERIFY-BETA16.sql.
2. ارفع الحزمة بCommit عادي.
3. شغّل Supabase Functions workflow يدويًا.
4. Upgrade Agent v3.2.
5. عدل motd واحفظ، وانتظر SHA + Dataset + restart ثم أعد فتح الملف.
