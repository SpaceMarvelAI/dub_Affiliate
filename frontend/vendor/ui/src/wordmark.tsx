import { cn } from "@dub/utils";

export function Wordmark({ className }: { className?: string }) {
  return (
    <img
      src="/space-marvel-logo.png"
      alt="Space Marvel"
      className={cn("h-8 w-auto invert dark:invert-0", className)}
    />
  );
}
