# SAW MC Hosting Frontend v2

## التقنية

- React 18
- TypeScript
- Vite
- React Router HashRouter
- TanStack Query
- Supabase Auth/Database/Functions
- Lucide Icons

## التشغيل

```bash
npm install
npm run dev
```

## الفحص والبناء

```bash
npm run typecheck
npm run build
```

الإخراج في `dist/`، والمسار الأساسي `/SAW/`.

## ما تم تنفيذه

- Routes منفصلة.
- Auth layouts وصفحات Email/Google/GitHub.
- Username onboarding لمستخدمي Social login.
- Global وServer layouts.
- Overview وServers.
- Create server وProvisioning timeline.
- Server dashboard.
- Console مستقلة.
- File Manager أولي.
- Account profile/connections.
- Routes جاهزة لباقي صفحات الاستضافة.

## مهم

هذه Alpha تعمل بجانب الموقع الحالي ولا تستبدله بعد. Workflow يبني Artifact فقط. بعد اختبار Auth وRoutes وProvisioning نضيف Workflow نشر `/v2/` ثم نستبدل الواجهة القديمة لاحقًا.
