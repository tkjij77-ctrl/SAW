import { CalendarClock, Info, ShieldCheck } from "lucide-react";
import { Card } from "../../components/ui/Card";

export function SchedulesPage() {
  return <div className="page"><header className="page-header"><div><span className="eyebrow">FREE-TIER AUTOMATION</span><h1>الجدولة</h1><p>Automation availability on sleeping ZeroGPU Spaces</p></div></header><Card className="schedule-empty"><CalendarClock /><h2>الجدولة الدائمة غير مفعلة</h2><p>Hugging Face Free Spaces تدخل Sleep، لذلك تشغيل Cron داخل Space لن يكون موثوقًا. لن تعرض SAW زرًا وهميًا أو تعد بتنفيذ مهمة أثناء نوم الخدمة.</p><span><Info size={14} /> النسخ اليدوية والاستعادة تعمل الآن من صفحة Backups.</span><span><ShieldCheck size={14} /> عند إضافة Scheduler خارجي مجاني موثوق سيتم تفعيله بدون تعريض HF Token.</span></Card></div>;
}
