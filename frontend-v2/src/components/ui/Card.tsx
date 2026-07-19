import type { HTMLAttributes, PropsWithChildren } from "react";

export function Card({ className = "", children, ...props }: PropsWithChildren<HTMLAttributes<HTMLDivElement>>) {
  return (
    <div className={`card ${className}`} {...props}>
      {children}
    </div>
  );
}
