import type { ButtonHTMLAttributes, PropsWithChildren } from "react";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "danger" | "ghost";
  full?: boolean;
}

export function Button({
  variant = "secondary",
  full,
  className = "",
  children,
  ...props
}: PropsWithChildren<ButtonProps>) {
  return (
    <button
      className={`button button--${variant} ${full ? "button--full" : ""} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}
