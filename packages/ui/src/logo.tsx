import { cn } from "@dub/utils";

export function Logo({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "flex h-10 w-10 items-center justify-center rounded-full bg-black text-lg font-bold leading-none text-white dark:bg-white dark:text-black",
        className,
      )}
    >
      S
    </span>
  );
}
