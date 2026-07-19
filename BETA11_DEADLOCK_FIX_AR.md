# beta.11 — إصلاح توقف اللوج بعد Playit Ready

## التشخيص من اللوج الحقيقي

آخر سطر كان:

```text
playit connected; tunnels loaded ... tunnel_count=0
```

ولم يظهر بعده `Program Agent control session is ready`. دالة الانتظار كانت تمسك `LOG_LOCK` ثم تستدعي `log()`، و`log()` يحاول أخذ نفس Lock غير القابل لإعادة الدخول. النتيجة: Background provisioning وMinecraft log reader ينتظران للأبد.

## الإصلاح

يتم الآن قراءة حالة الجاهزية داخل Lock، ثم تحريره، ثم كتابة اللوج خارجه:

```python
with LOG_LOCK:
    ready = any(...)
if ready:
    log("Program Agent control session is ready")
```

تمت إضافة Regression Test يستخدم Lock غير Reentrant ويفشل فورًا لو حاولت الدالة تسجيل رسالة وهي ممسكة بالقفل.

## المتوقع بعد Agent v2.9

```text
[PLAYIT-HANDOFF] Program Agent control session is ready
[PLAYIT-JAVA] Automatic minecraft-java tunnel requested (attempt 1)
[PLAYIT-JAVA] Tunnel ready: ...
[PLAYIT-BEDROCK] Automatic minecraft-bedrock tunnel requested (attempt 1)
[PLAYIT-BEDROCK] Tunnel ready: host:port
[PLAYIT-TUNNELS] Java + Bedrock automatic setup complete
```

## الترقية

1. Backup VERIFIED إن أمكن.
2. شغّل `APPLY-BETA11.sql` ثم `VERIFY-BETA11.sql`.
3. ارفع الحزمة وانتظر Actions.
4. Backups → Upgrade Agent v2.9.
5. لو Program Agent الحالي وSecret محفوظان، سيبدأ الفحص بدون Claim جديد.
6. لو ظهر Claim جديد بعد Space rebuild، وافق عليه مرة واحدة.
