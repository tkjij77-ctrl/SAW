import { Link, useLocation } from "react-router-dom";
import { Card } from "../components/ui/Card";
import { Brand } from "../components/navigation/Brand";

const pages = {
  "/privacy": {
    title: "سياسة الخصوصية",
    eyebrow: "PRIVACY POLICY",
    sections: [
      ["البيانات التي نعالجها", "البريد، اسم SAW، بيانات GitHub/Hugging Face العامة، معرّفات السيرفر، الصلاحيات وسجل العمليات. لا تعرض الواجهة HF Token أو Supabase Service Role."],
      ["مكان التخزين", "هوية وحسابات SAW داخل Supabase، ملفات Minecraft والنسخ داخل موارد Hugging Face الخاصة بمالكها، والواجهة على GitHub Pages."],
      ["الأسرار", "OAuth tokens تحفظ Server-side وتُستخدم فقط لتنفيذ العمليات المطلوبة. لا ترسل أي Secret في الدعم أو GitHub Issues."],
      ["المشاركة", "نستخدم Supabase وGitHub وHugging Face وPlayit ومزود SMTP لتقديم الخدمة. لا نبيع البيانات."],
      ["الاحتفاظ والحذف", "Audit logs لها مدة احتفاظ، ويمكن حذف السيرفر والحساب من الإعدادات. حذف Dataset اختياري عند حذف السيرفر."],
      ["حقوق المستخدم", "يمكنك تعديل الاسم، تغيير كلمة المرور، فصل Hugging Face، تنزيل Backups، حذف السيرفرات ثم حذف الحساب."],
    ],
  },
  "/terms": {
    title: "شروط الاستخدام",
    eyebrow: "TERMS OF SERVICE",
    sections: [
      ["طبيعة الخدمة", "SAW Public Beta لوحة تنسيق لخدمات مجانية خارجية. لا يوجد ضمان 24/7 أو SLA؛ حدود Supabase/Hugging Face/Playit تطبق."],
      ["ملكية الموارد", "Spaces وDatasets وTunnels تُنشأ داخل حساباتك، وأنت مسؤول عن حساباتك ومفاتيحك ومحتواك."],
      ["Minecraft", "يجب قبول Minecraft EULA واستخدام حسابات شرعية. SAW يفرض online-mode=true ولا يقدم تجاوز مصادقة أو نسخًا مقرصنة."],
      ["النسخ الاحتياطية", "أنت مسؤول عن إنشاء Backup قبل الترقيات. التخزين المجاني مؤقت وقد ينام أو يُعاد تشغيله."],
      ["الإيقاف والتغييرات", "قد تتغير الميزات أثناء Public Beta، وقد نوقف عمليات ضارة أو غير متوافقة لحماية الخدمة والمزودين."],
      ["حدود المسؤولية", "الخدمة مقدمة كما هي خلال Beta. اختبر نسخك الاحتياطية ولا تعتمد عليها كنسخة وحيدة لبيانات مهمة."],
    ],
  },
  "/acceptable-use": {
    title: "سياسة الاستخدام المقبول",
    eyebrow: "ACCEPTABLE USE",
    sections: [
      ["مسموح", "سيرفرات Minecraft شخصية ومجتمعية شرعية، Plugins/Mods المتوافقة، Backups وإدارة أعضاء بموافقتهم."],
      ["ممنوع", "البرمجيات الخبيثة، التعدين، DDoS، spam، phishing، استغلال الخدمات، proxy عام، سرقة الحسابات أو تجاوز حدود المزود."],
      ["المحتوى", "يُمنع المحتوى غير القانوني أو الذي ينتهك حقوق الآخرين أو سياسات GitHub/Hugging Face/Playit/Minecraft."],
      ["المصادقة", "ممنوع تعطيل online-mode أو انتحال اللاعبين أو توزيع عملاء Minecraft مقرصنة."],
      ["الإبلاغ", "لا تضع Tokens أو بيانات شخصية في بلاغ عام. اذكر Request ID ورسالة الخطأ فقط."],
      ["الإجراء", "قد يتم تعليق الوصول أو حذف سجل SAW عند إساءة الاستخدام، بينما تبقى موارد حسابك الخارجي تحت سياسات مزوده."],
    ],
  },
} as const;

export function LegalPage() {
  const path = useLocation().pathname as keyof typeof pages;
  const page = pages[path] ?? pages["/terms"];
  return <div className="auth-layout"><main className="legal-shell"><header className="legal-head"><Brand /><div><span className="eyebrow">{page.eyebrow}</span><h1>{page.title}</h1><p>آخر تحديث: 17 يوليو 2026 · SAW MC Hosting Public Beta</p></div></header><div className="legal-sections">{page.sections.map(([title, text]) => <Card className="padded" key={title}><h2>{title}</h2><p>{text}</p></Card>)}</div><footer className="legal-footer"><Link to="/login">العودة لتسجيل الدخول</Link><Link to="/privacy">الخصوصية</Link><Link to="/terms">الشروط</Link><Link to="/acceptable-use">الاستخدام المقبول</Link></footer></main></div>;
}
