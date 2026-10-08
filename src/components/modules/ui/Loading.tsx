interface LoadingProps {
  classNames?: string;
  loading?: "spinner" | "ring" | "dots" | "ball" | "bars" | "infinity";
  size?: "xs" | "sm" | "md" | "lg" | "xl";
  color?:
    | "primary"
    | "secondary"
    | "accent"
    | "neutral"
    | "info"
    | "success"
    | "warning"
    | "error";
}

const loadingClassMap: Record<string, string> = {
  spinner: "loading-spinner",
  ring: "loading-ring",
  dots: "loading-dots",
  ball: "loading-ball",
  bars: "loading-bars",
  infinity: "loading-infinity",
};

const sizeClassMap: Record<string, string> = {
  xs: "loading-xs",
  sm: "loading-sm",
  md: "loading-md",
  lg: "loading-lg",
  xl: "loading-xl",
};

const colorClassMap: Record<string, string> = {
  primary: "text-primary",
  secondary: "text-secondary",
  accent: "text-accent",
  neutral: "text-neutral",
  info: "text-info",
  success: "text-success",
  warning: "text-warning",
  error: "text-error",
};

const Loading = ({
  loading = "spinner",
  size = "md",
  color = "info",
  classNames,
}: LoadingProps) => {
  const loadingClass = loadingClassMap[loading];
  const sizeClass = sizeClassMap[size];
  const colorClass = colorClassMap[color];

  return (
    <span role="status" aria-label="Loading Stargram" className={classNames}>
      <span className="relative inline-flex items-center justify-center">
        <span className="absolute inset-0 rounded-2xl bg-[#4f08ec]/20 blur-lg animate-pulse" />
        <img src="/images/stargram-logo.svg" alt="" aria-hidden="true" className="relative size-12 object-contain animate-pulse drop-shadow-[0_0_16px_rgba(94,235,255,0.2)]" />
        <span className="absolute -bottom-4 left-1/2 -translate-x-1/2 whitespace-nowrap text-[9px] tracking-[0.2em] uppercase text-white/30">Stargram</span>
      </span>
    </span>
  );
};

export default Loading;
