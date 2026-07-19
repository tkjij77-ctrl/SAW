# SAW MC Hosting v2.0.0-beta.8 — الحزمة الكاملة

## ما الذي أصلحته beta.8؟

الإصدار السابق احتوى قاعدة `.gitignore` باسم `server/` جعلت Git يتجاهل مجلدات React التالية:

```text
frontend-v2/src/pages/server
frontend-v2/src/components/server
```

تم تصحيحها إلى Root-only:

```gitignore
/server/
/backups/
/logs/
```

كما تمت إضافة Release Verification يفشل برسالة واضحة قبل TypeScript لو نقص أي ملف أساسي، ويفحص:

- جميع صفحات ومكونات السيرفر الضرورية.
- ملفات Supabase وAgent Upgrader.
- رقم الإصدار.
- أخطاء `.gitignore`.
- اختلاف حالة الأحرف في أسماء الملفات.
- أنماط Tokens المحظورة داخل Frontend.

## محتوى الإصدار

beta.8 تشمل كل وظائف beta.7:

- Supabase Backend hardening وRLS وRate Limiting.
- GitHub OAuth وEmail OTP وHugging Face Connect.
- Agent v2.6.0.
- Java + Bedrock وPlayit.
- Private Dataset Backups وBackground Jobs وSHA-256.
- Agent Upgrade.
- Verified Modrinth Installer وSHA-512.
- Console وFiles وPlayers وMembers وSettings وAudit وActivity.
- Update Watcher وCache Busting.

## النشر الصحيح

### 1. قاعدة البيانات أولًا

افتح:

https://supabase.com/dashboard/project/seiqkubajnwpzdunyovm/sql/new

وشغّل كاملًا:

```text
supabase/APPLY-BETA8.sql
```

ثم شغّل:

```text
supabase/VERIFY-BETA8.sql
```

### 2. استبدال ملفات المستودع

الأفضل استخدام Git محليًا لأن الحزمة الكاملة تتجاوز عدد الملفات المريح للرفع من واجهة المتصفح:

```bash
git clone https://github.com/tkjij77-ctrl/SAW.git
cd SAW
# انسخ محتويات beta.8 هنا مع الاستبدال
git add -A
git status
```

يجب أن يظهر ضمن `git status`:

```text
frontend-v2/src/pages/server/BackupsPage.tsx
frontend-v2/src/pages/server/ConsolePage.tsx
frontend-v2/src/components/server/ServerCard.tsx
frontend-v2/src/components/server/StatCard.tsx
```

ثم:

```bash
git commit -m "Release SAW MC Hosting v2.0.0-beta.8"
git push origin master
```

لا تضع GitHub PAT داخل ملف أو رسالة. استخدم تسجيل دخول GitHub الرسمي أو GitHub Desktop.

### 3. GitHub Actions

يجب نجاح:

```text
Build Frontend v2
Validate and Deploy Supabase Edge Functions
Deploy SAW Frontend v2
GitHub Pages deployment
```

سيظهر داخل Build:

```text
SAW release verification passed
TypeScript passed
vite build passed
```

### 4. فحص الموقع

افتح نافذة Incognito:

```text
https://tkjij77-ctrl.github.io/SAW/?v=beta8#/login
```

ثم اختبر Login وServers وDashboard وConsole وFiles وBackups.

## Rollback

لو فشل النشر، لا تحذف SQL. أعد رفع حزمة beta.8 الكاملة وتأكد من وجود مجلدي `pages/server` و`components/server` ثم أعد تشغيل Actions.
