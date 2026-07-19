# إعداد رسالة تفعيل الحساب بالكود

## 1. فعّل تأكيد البريد

Supabase Dashboard:

```text
Authentication → Providers → Email
Confirm email: ON
```

## 2. غيّر Confirm signup template

```text
Authentication → Email Templates → Confirm signup
```

انسخ محتوى:

```text
SUPABASE_EMAIL_OTP_TEMPLATE.html
```

المهم وجود:

```html
{{ .Token }}
```

وهذا يعرض كود OTP من 6 أرقام بدل الاعتماد على رابط فقط.

## 3. إعداد SMTP

الخدمة الافتراضية محدودة جدًا. للإنتاج استخدم Custom SMTP مثل Resend أو SendGrid أو مزود موثوق، وليس حساب Gmail شخصيًا إن أمكن.

```text
Authentication → SMTP Settings
Enable Custom SMTP
```

## 4. التدفق في الموقع

```text
Register
→ /#/verify-email?email=...
→ إدخال 6 أرقام
→ supabase.auth.verifyOtp(type: signup)
→ الحساب يتفعّل ويفتح Overview
```

تسجيل Google أو GitHub لا يحتاج صفحة OTP منفصلة لأن البريد يتم التحقق منه عبر المزود.
