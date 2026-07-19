import { AlertTriangle, Box, LoaderCircle } from "lucide-react";
import { Button } from "./Button";

export function PageLoading({ label = "جارٍ التحميل..." }: { label?: string }) {
  return <div className="page-state"><LoaderCircle className="spin" /><p>{label}</p></div>;
}

export function PageError({ message, retry }: { message: string; retry?: () => void }) {
  return <div className="page-state page-state--error"><AlertTriangle /><h3>تعذر تحميل الصفحة</h3><p>{message}</p>{retry && <Button onClick={retry}>إعادة المحاولة</Button>}</div>;
}

export function EmptyState({ title, body, action }: { title: string; body: string; action?: React.ReactNode }) {
  return <div className="page-state"><Box /><h3>{title}</h3><p>{body}</p>{action}</div>;
}
