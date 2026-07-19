import type { PropsWithChildren } from "react";

export function Badge({ tone = "neutral", children }: PropsWithChildren<{ tone?: "success" | "warning" | "danger" | "info" | "neutral" }>) {
  return <span className={`badge badge--${tone}`}>{children}</span>;
}
