import { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  icon: LucideIcon;
  name: string;
  description: string;
  count: number;
  active: boolean;
  featured?: boolean;
  gradient: string; // tailwind classes
  onClick: () => void;
}

export const CelebrationCard = ({ icon: Icon, name, description, count, active, featured, gradient, onClick }: Props) => {
  return (
    <button
      onClick={onClick}
      className={cn(
        "group relative overflow-hidden rounded-2xl p-5 text-left hover-lift glass shadow-card",
        "border transition-all duration-300",
        active
          ? "border-primary/80 shadow-elegant ring-2 ring-primary/40"
          : "border-border/60 hover:border-primary/50",
        featured && "md:col-span-2 md:row-span-1"
      )}
    >
      {/* Gradient halo */}
      <div
        className={cn(
          "pointer-events-none absolute -inset-1 opacity-0 blur-2xl transition-opacity duration-500 group-hover:opacity-60",
          gradient
        )}
      />

      <div className="relative flex items-start gap-4">
        <div
          className={cn(
            "flex h-14 w-14 shrink-0 items-center justify-center rounded-xl shadow-lg transition-transform duration-300 group-hover:scale-110 group-hover:rotate-6",
            gradient
          )}
        >
          <Icon className="h-7 w-7 text-white drop-shadow" strokeWidth={2.2} />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-lg font-bold tracking-tight">{name}</h3>
            {count > 0 && (
              <span className="shrink-0 rounded-full bg-muted/70 px-2 py-0.5 text-xs font-semibold text-muted-foreground">
                {count}
              </span>
            )}
          </div>
          <p className="mt-1 text-sm text-muted-foreground line-clamp-2">{description}</p>
          {featured && (
            <span className="mt-3 inline-flex items-center gap-1 rounded-full bg-gradient-gold px-3 py-1 text-xs font-bold text-background">
              ★ Destaque principal
            </span>
          )}
        </div>
      </div>
    </button>
  );
};
