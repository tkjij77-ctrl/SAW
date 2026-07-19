# SAW MC Hosting beta.9 — Java + Bedrock Crossplay

## قراءة اللوج الحالي

اللوج الذي ظهر يعني:

- Purpur 1.21.10 يعمل.
- Java 21 صحيح.
- `online-mode=true` واتصال Mojang Production صحيح.
- ViaVersion/ViaBackwards/ViaRewind تعمل.
- Floodgate يعمل.
- Geyser يعمل على `UDP 19132`.
- Java Playit tunnel يعمل.
- الناقص فقط هو Playit Program Agent وBedrock UDP tunnel.

Minecraft Playit Plugin لا يدعم UDP. Agent v2.7 يحل مشكلة التوقيت: الإصدار القديم كان يبحث عن `agent-secret` قبل قبول Claim فقط، فلا يجده ولا يعيد الفحص.

## ما يفعله Agent v2.7 تلقائيًا

1. يراقب `plugins/playit-gg/config.yml` بدون طباعة السر.
2. ينتظر ظهور Java tunnel المؤكد، وليس مجرد Claim مؤقت.
3. يقرأ المفتاح بعد اكتمال التحقق.
4. يوقف Minecraft باستخدام `save-all flush` و`stop`.
5. يحول `plugins/playit.jar` إلى `plugins/playit.jar.disabled`.
6. يشغل Playit Program Agent الرسمي بنفس Agent Key.
7. يتأكد أن البرنامج لم يخرج أثناء Startup.
8. يعيد تشغيل Minecraft تلقائيًا.
9. يستدعي نفس Agent API المستخدم في Plugin الرسمي لفحص Bedrock tunnel.
10. إذا لم يوجد، ينشئ `minecraft-bedrock` تلقائيًا على نفس Agent.
11. إذا فشل Program Agent، يعيد Plugin القديم ويعيد تشغيل السيرفر.
12. إذا تغيّر Playit API فقط، يبقي Program Agent شغالًا ويعرض رابط Dashboard كـFallback.

## اللوج المتوقع

```text
[PLAYIT-HANDOFF] Claimed Java tunnel detected; switching to Program Agent for Java + Bedrock UDP
[PLAYIT-HANDOFF] Minecraft Playit plugin disabled to prevent duplicate agents
[PLAYIT-AGENT] started PID=...
[PLAYIT-HANDOFF] Program Agent is online for Java TCP + Bedrock UDP
[PLAYIT-BEDROCK] Automatic Bedrock UDP tunnel requested for 127.0.0.1:19132
[PLAYIT-BEDROCK] Bedrock tunnel ready: example.gl.at.ply.gg:12345
```

بعدها يجب ألا يظهر `playit-gg` ضمن Bukkit plugins في التشغيل التالي، لأن Program Agent أصبح المسؤول عن الشبكة.

## إنشاء Bedrock Tunnel تلقائيًا

بعد الـClaim، SAW تفحص Tunnels الموجودة. إذا وجدت Bedrock تعيد استخدامه، وإذا لم تجده تطلب إنشاء `minecraft-bedrock` تلقائيًا على نفس Agent. لا ترسل كلمة مرور Playit ولا Cookie.

فقط إذا ظهر:

```text
[PLAYIT-BEDROCK] Automatic creation unavailable
```

استخدم الرابط الاحتياطي https://playit.gg/account/tunnels وأنشئه بالقيم: `Minecraft Bedrock`, `127.0.0.1`, UDP `19132`, وProxy Protocol Disabled.

العنوان النهائي يكون مثل:

```text
example.gl.at.ply.gg:12345
```

داخل Minecraft Bedrock:

```text
Server Address: example.gl.at.ply.gg
Port: 12345
```

لا تستخدم Java address داخل Bedrock، ولا تحذف رقم Port الخاص بـBedrock.

## ترقية سيرفرك الحالي بأمان

1. من beta.8 أنشئ Backup وتأكد من `VERIFIED`.
2. طبّق `supabase/APPLY-BETA9.sql`.
3. ارفع beta.9 إلى GitHub وانتظر نجاح Actions.
4. افتح Server → Backups.
5. اضغط `Upgrade Agent v2.7`.
6. انتظر Space Build ثم راقب Console.
7. إذا عاد Space بدون ملفات العالم، استخدم Restore للنسخة ثم شغّل السيرفر.
8. لو ظهر Claim جديد، افتحه مرة واحدة وانتظر الـhandoff التلقائي.
9. انتظر `[PLAYIT-BEDROCK] Bedrock tunnel ready`; افتح Dashboard فقط لو ظهر fallback.

## الأمان

- لا ترسل `agent-secret` أو `PLAYIT_AGENT_SECRET` في المحادثة.
- لا تضع المفتاح في GitHub.
- لا تشغل Plugin وProgram Agent بنفس المفتاح في نفس الوقت؛ Agent v2.7 يمنع ذلك تلقائيًا.
- Java يبقى `online-mode=true`، وBedrock يدخل عبر Floodgate بحساب Bedrock شرعي.
