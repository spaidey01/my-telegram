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

const Loading = ({ classNames }: LoadingProps) => {

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
