import type { LucideIcon } from "lucide-react";
import { Card } from "../ui/Card";

export function StatCard({ label, value, caption, icon: Icon }: { label: string; value: string | number; caption: string; icon: LucideIcon }) {
  return <Card className="stat-card"><div className="stat-card__label"><Icon size={16} /><span>{label}</span></div><strong>{value}</strong><small>{caption}</small></Card>;
}
