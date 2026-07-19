# SAW MC Hosting beta.13 — Public Beta Preparation

## الجديد

- Privacy Policy وTerms وAcceptable Use عامة.
- موافقة إجبارية قبل Email أوGitHub signup.
- تسجيل terms version/time داخل profile.
- Diagnostics للحساب وAuth وFrontend و9 Functions وRLS.
- تغيير كلمة المرور.
- حذف Server للمالك فقط، مع حذف Space واختيار حذف/حفظ Dataset.
- حذف الحساب بعد التأكد من عدم وجود سيرفرات مملوكة.
- نشر delete-server وdelete-account مع باقي Functions.

## النشر

1. شغّل `APPLY-BETA13.sql` ثم `VERIFY-BETA13.sql`.
2. ارفع الحزمة إلى GitHub.
3. انتظر Frontend deployment.
4. تأكد من نجاح Workflow نشر Functions التسعة.
5. افتح Account → Diagnostics وتأكد من النتائج.
6. اضبط Brevo SMTP وConfirm Email قبل فتح التسجيل للجمهور.

## Functions المتوقعة

```text
link-huggingface
unlink-huggingface
agent-command
provision-server
provision-status
sync-servers
upgrade-agent
delete-server
delete-account
```

## تنبيه الحذف

Delete Server يحذف Space افتراضيًا، ويسأل إن كنت تريد حذف Dataset. Account deletion يرفض التنفيذ حتى تُحذف كل السيرفرات المملوكة، حتى لا يترك موارد خارجية بلا إدارة.
