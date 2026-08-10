import { cn } from "@dub/utils";

export function Wordmark({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex h-6 items-center whitespace-nowrap text-base font-bold leading-none tracking-tight text-black dark:text-white",
        className,
      )}
    >
      Space Marvel
    </span>
  );
}
