import { Database, ShieldCheck } from "lucide-react";
import { Card } from "../../components/ui/Card";

export function DatabasesPage() {
  return <div className="page"><header className="page-header"><div><span className="eyebrow">DATABASE SAFETY</span><h1>قواعد البيانات</h1><p>External database compatibility</p></div></header><Card className="database-empty"><Database /><h2>لا توجد Database مدمجة مع الخطة المجانية</h2><p>Minecraft على Hugging Face لا يحتوي MySQL أو Redis دائمًا، وتخزين كلمات مرور قواعد خارجية قبل بناء Secret Manager مخصص سيكون غير آمن؛ لذلك تم تعطيل الإضافة بدل عرض Connection وهمي.</p><span><ShieldCheck size={14} /> بيانات SAW الأساسية محمية حاليًا داخل Supabase Postgres مع RLS.</span></Card></div>;
}
