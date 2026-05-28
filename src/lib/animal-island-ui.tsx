import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from 'react';
import { CalendarDays, Clock3, Sparkles } from 'lucide-react';

type ButtonVariant = 'primary' | 'ghost' | 'island';

type IslandButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  icon?: ReactNode;
};

export function IslandButton({
  variant = 'primary',
  icon,
  children,
  className = '',
  ...props
}: IslandButtonProps) {
  return (
    <button className={`island-button island-button--${variant} ${className}`} {...props}>
      {icon ? <span className="island-button__icon">{icon}</span> : null}
      <span>{children}</span>
    </button>
  );
}

export function IslandCard({
  className = '',
  children,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <section className={`island-card ${className}`} {...props}>
      {children}
    </section>
  );
}

export function IslandBadge({
  className = '',
  children,
  ...props
}: HTMLAttributes<HTMLSpanElement>) {
  return (
    <span className={`island-badge ${className}`} {...props}>
      <Sparkles size={14} aria-hidden="true" />
      {children}
    </span>
  );
}

export function IslandTime({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="island-time">
      <Clock3 size={16} aria-hidden="true" />
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

export function IslandCalendarIcon() {
  return <CalendarDays size={18} aria-hidden="true" />;
}
