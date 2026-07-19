# beta.10 — Playit Session Readiness Fix

## ما أثبته اللوج الحقيقي

الـhandoff نجح: Minecraft توقف بأمان، Plugin اتعطل، Program Agent v1.0.10 اشتغل، والسيرفر رجع بدون Plugin وGeyser استمع على UDP 19132.

الفشل الوحيد كان التوقيت:

```text
14:40:04 /v1/tunnels/create failed
14:40:05 playit connected; tunnels loaded
```

أي أن إنشاء Tunnel تم قبل جاهزية Playit control session بثانية.

كما أن Java/Jackson الرسمي يستخدم NON_NULL، بينما beta.9 أرسلت `fields:null`, `port:null`, و`firewall_id:null`. beta.10 تطابق Payload الرسمي وتحذف هذه الحقول.

## سلوك Agent v2.8

1. يبدأ Program Agent.
2. يعيد تشغيل Minecraft فورًا لتقليل التوقف.
3. Background worker ينتظر حتى يظهر `playit connected; tunnels loaded` لمدة تصل إلى 90 ثانية.
4. يفحص Java وBedrock معًا.
5. يعيد استخدام الموجود.
6. ينشئ المفقود فقط.
7. يعيد List قبل كل Retry لمنع التكرار لو استجابة Create ضاعت.
8. ينفذ 5 Create retries و3 provisioning passes.
9. يعرض HTTP status ورسالة Playit المختصرة بدون طباعة Agent Key.

## اللوج المتوقع

```text
[PLAYIT-HANDOFF] Program Agent process started for Java TCP + Bedrock UDP
[PLAYIT-HANDOFF] Program Agent control session is ready
[PLAYIT-JAVA] Existing tunnel ready: ...
[PLAYIT-BEDROCK] Automatic minecraft-bedrock tunnel requested (attempt 1)
[PLAYIT-BEDROCK] Tunnel ready: host:port
[PLAYIT-TUNNELS] Java + Bedrock automatic setup complete
```

إذا Program Agent أظهر `tunnel_count=0`، SAW تنشئ Java وBedrock تلقائيًا على Agent الحالي.

## الترقية

1. Backup VERIFIED.
2. شغل `supabase/APPLY-BETA10.sql` ثم `VERIFY-BETA10.sql`.
3. ارفع beta.10 وانتظر Actions.
4. Server → Backups → Upgrade Agent v2.8.
5. وافق على Claim لو ظهر.
6. راقب العلامات السابقة ثم افتح Network لنسخ العنوانين.
