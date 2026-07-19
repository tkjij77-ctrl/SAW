# إعداد Google وGitHub Login

## قبل البدء

شغّل في Supabase SQL Editor:

```text
supabase/social-auth-migration.sql
```

وهو يسمح بإنشاء Profile مؤقت لمستخدمي OAuth ثم يطلب منهم اختيار Username فريد.

## Supabase URLs

Authentication > URL Configuration:

```text
Site URL:
https://tkjij77-ctrl.github.io/SAW/

Redirect URLs:
https://tkjij77-ctrl.github.io/SAW/**
```

## Google

1. Google Cloud Console > APIs & Services > Credentials.
2. Create OAuth Client ID > Web application.
3. Authorized JavaScript origin:

```text
https://tkjij77-ctrl.github.io
```

4. Authorized redirect URI هو Callback الذي يعرضه Supabase داخل Google Provider، بالشكل:

```text
https://seiqkubajnwpzdunyovm.supabase.co/auth/v1/callback
```

5. انسخ Client ID وClient Secret إلى Supabase > Authentication > Providers > Google.

## GitHub

1. GitHub Settings > Developer settings > OAuth Apps > New OAuth App.
2. Homepage:

```text
https://tkjij77-ctrl.github.io/SAW/
```

3. Authorization callback URL:

```text
https://seiqkubajnwpzdunyovm.supabase.co/auth/v1/callback
```

4. انسخ Client ID وClient Secret إلى Supabase > Authentication > Providers > GitHub.

لا تضع Google/GitHub Client Secret داخل GitHub Pages أو Vite env. الأسرار تبقى في Supabase فقط.
