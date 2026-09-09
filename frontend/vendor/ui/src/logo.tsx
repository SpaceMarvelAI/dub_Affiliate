import { cn } from "@dub/utils";

export function Logo({ className }: { className?: string }) {
  return (
    <img
      src="/space-marvel-logo.png"
      alt="Space Marvel"
      className={cn("h-10 w-10 invert dark:invert-0", className)}
    />
  );
}
