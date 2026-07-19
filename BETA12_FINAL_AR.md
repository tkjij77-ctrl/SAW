# SAW MC Hosting v2.0.0-beta.12 — Final Beta

## المكونات

```text
Frontend: 2.0.0-beta.12
Minecraft Agent: 2.9.0
Supabase Functions: 7 + shared core
Database migration: APPLY-BETA12.sql
```

## الوظائف المكتملة

- Email/password وGitHub OAuth، بدون Google.
- Hugging Face OAuth وربط آمن Server-side.
- Private Dataset + Private ZeroGPU Space provisioning.
- Java/Purpur وتشغيل Java ديناميكي 8/16/17/21/25.
- Geyser + Floodgate + ViaVersion suite.
- Playit Claim ثم Safe Handoff تلقائي إلى Program Agent.
- إنشاء/reuse تلقائي لـJava TCP وBedrock UDP.
- معالجة Session readiness وLOG_LOCK regression.
- Console وFiles وPlayers وMembers وAudit وSettings.
- Private Dataset Backups: create/list/status/delete/restore وSHA-256.
- Verified Modrinth Plugins وSHA-512.
- Agent Upgrade v2.9.
- RLS وRate Limiting وRequest IDs وCORS المقيد.
- Wake-on-demand: لو Space في PAUSED/STOPPED/SLEEPING، أول طلب من اللوحة يستدعي Restart API تلقائيًا ثم Polling يكمل حتى RUNNING.
- File Editor واسع ومتجاوب، بأزرار واضحة ودعم Ctrl+S.
- Safe Apply للملفات: يفحص الحالة، يوقف Minecraft، يكتب الملف، يعيد قراءته للتحقق، ثم يشغل السيرفر؛ وهذا يمنع Plugin/Server shutdown من استرجاع نسخة الإعدادات القديمة.

> لا يوجد Keep-alive مصطنع: الخطة المجانية تظل تنام طبيعيًا، ويحدث Restart فقط عندما يطلب المستخدم إدارة السيرفر.

## إصلاح نشر Supabase النهائي

تم حذف `esm.sh` تمامًا من Edge Functions واستخدام:

```typescript
npm:@supabase/supabase-js@2.57.4
```

Workflow ينفذ 3 محاولات لكل Function مع انتظار 15 ثم 30 ثانية عند أخطاء الشبكة المؤقتة.

## ترتيب النشر

1. شغّل `supabase/APPLY-BETA12.sql`.
2. شغّل `supabase/VERIFY-BETA12.sql`.
3. ارفع محتويات الحزمة إلى GitHub مع الاستبدال.
4. انتظر `Deploy SAW Frontend v2`.
5. شغّل/راقب `Validate and Deploy Supabase Edge Functions`.
6. تحقق أن `validate` و`deploy-functions` ناجحان.
7. افتح الموقع بـ`?v=beta12#/login`.

## النتيجة المتوقعة لنشر Functions

```text
Successfully deployed link-huggingface
Successfully deployed unlink-huggingface
Successfully deployed agent-command
Successfully deployed provision-server
Successfully deployed provision-status
Successfully deployed sync-servers
Successfully deployed upgrade-agent
```

## Auth Production Note

لو أردت OTP إجباريًا، اجعل Confirm Email مفعّلًا؛ `mailer_autoconfirm=true` يتجاوز OTP. استخدم Template يحتوي `{{ .Token }}` وCustom SMTP.
