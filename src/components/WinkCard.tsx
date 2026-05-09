import { useRef, useState } from "react";
import { Download, Heart, Play } from "lucide-react";

import {
  LottiePreviewSurface,
  type LottiePreviewSurfaceHandle,
} from "@/components/LottiePreviewSurface";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  normalizeWinkFormats,
  type WinkFormatInput,
  type WinkResolution,
} from "@/lib/winks";

type WinkCardProps = {
  title: string;
  type: string;
  format: WinkFormatInput;
  resolution: WinkResolution;
  preview: string;
  downloadUrl: string;
  hoverPreviewUrl?: string;
  autoplayPreviewOnHover?: boolean;
  lottiePreviewUrl?: string;
  lottieStartAtProgress?: number;
  onOpenPreview?: () => void;
  description?: string;
  eyebrow?: string;
  accentColor?: string;
  className?: string;
  id?: string;
  downloadLabel?: string;
};

const DEFAULT_ACCENTS: Record<string, string> = {
  APNG: "#8f5bff",
  LOTTIE: "#58c7ff",
  JSON: "#f5c65b",
};

export const WinkCard = ({
  title,
  type,
  format,
  resolution,
  preview,
  downloadUrl,
  hoverPreviewUrl,
  autoplayPreviewOnHover,
  lottiePreviewUrl,
  lottieStartAtProgress,
  onOpenPreview,
  accentColor,
  className,
  id,
  downloadLabel = "BAIXAR",
}: WinkCardProps) => {
  const lottiePreviewRef = useRef<LottiePreviewSurfaceHandle | null>(null);
  const [chatPreviewNonce, setChatPreviewNonce] = useState(0);
  const [hasStartedCardPreview, setHasStartedCardPreview] = useState(false);
  const formatBadges = normalizeWinkFormats(format);
  const primaryBadge = formatBadges[0] ?? "APNG";
  const accent = accentColor ?? DEFAULT_ACCENTS[primaryBadge] ?? "#8f5bff";
  const isPortrait = resolution === "768x1024";
  const hasAnimatedChatPreview = Boolean(hoverPreviewUrl);
  const hasAnimatedPreview = Boolean(lottiePreviewUrl || hasAnimatedChatPreview);
  const shouldShowAnimatedChatPreview = hasAnimatedChatPreview && (autoplayPreviewOnHover || hasStartedCardPreview);
  const animatedChatSrc = hoverPreviewUrl
    ? `${hoverPreviewUrl}${hoverPreviewUrl.includes("?") ? "&" : "?"}preview=${chatPreviewNonce}`
    : undefined;

  const handleRestartPreview = () => {
    setHasStartedCardPreview(true);

    if (lottiePreviewUrl) {
      lottiePreviewRef.current?.restart();
      return;
    }

    if (hasAnimatedChatPreview) {
      setChatPreviewNonce((current) => current + 1);
    }
  };

  const handleOpenPreview = () => {
    if (onOpenPreview) {
      onOpenPreview();
      return;
    }

    if (typeof window !== "undefined") {
      window.open(hoverPreviewUrl ?? lottiePreviewUrl ?? downloadUrl ?? preview, "_blank", "noopener,noreferrer");
    }
  };

  return (
    <article
      id={id}
      className={cn(
        "wink-card-shell group relative flex h-full flex-col overflow-hidden rounded-[22px]",
        className,
      )}
      style={
        {
          ["--wink-accent" as string]: accent,
        } as React.CSSProperties
      }
    >
      <div className="wink-card-glow" />

      <div
        className={cn(
          "wink-card-media wink-alpha-stage relative isolate overflow-hidden",
          isPortrait ? "aspect-[3/4]" : "aspect-[15/8]",
        )}
      >
        <div className="wink-alpha-grid" aria-hidden="true" />

        {lottiePreviewUrl ? (
          <LottiePreviewSurface
            ref={lottiePreviewRef}
            src={lottiePreviewUrl}
            fallbackPreview={preview}
            alt={`${title} live preview`}
            className="absolute inset-0 h-full w-full wink-card-live-preview"
            startAtProgress={lottieStartAtProgress}
            autoplay
            showFallbackUnderlay
          />
        ) : shouldShowAnimatedChatPreview ? (
          <img
            key={animatedChatSrc}
            src={animatedChatSrc}
            alt={`${title} preview`}
            className={cn(
              "wink-card-live-preview wink-card-hover-overlay absolute inset-0 h-full w-full object-contain",
              autoplayPreviewOnHover && "group-hover:scale-[1.02]",
            )}
            decoding="async"
            loading="lazy"
          />
        ) : (
          <img
            src={preview}
            alt={`${title} preview snapshot`}
            className="wink-card-static-preview absolute inset-0 h-full w-full object-contain"
            decoding="async"
            loading="lazy"
          />
        )}

        <div className="wink-card-media-overlay" />
        {hasAnimatedPreview ? <div className="wink-card-live-halo" aria-hidden="true" /> : null}

        <button
          type="button"
          className="wink-card-favorite-button"
          aria-label={`Favorite ${title}`}
        >
          <Heart className="h-4 w-4" />
        </button>

        <div className="absolute inset-0 flex items-center justify-center">
          <button
            type="button"
            onClick={handleRestartPreview}
            aria-label={`Play preview for ${title}`}
            className="wink-card-play-button"
          >
            <Play className="h-5 w-5 fill-current" />
          </button>
        </div>

        <div className="wink-card-bottom-meta">
          <p className="mb-2 text-[0.58rem] font-semibold uppercase tracking-[0.24em] text-white/60">
            {type} · Transparent
          </p>
          <h3 className="wink-card-title">{title}</h3>
          <div className="flex flex-wrap gap-2">
            {formatBadges.map((badge) => (
              <Badge
                key={badge}
                variant="outline"
                className="wink-card-badge px-2.5 py-1 text-[0.62rem] font-semibold uppercase tracking-[0.18em] text-white"
              >
                {badge}
              </Badge>
            ))}
            <Badge
              variant="outline"
              className="wink-card-resolution-badge px-2.5 py-1 text-[0.62rem] font-semibold uppercase tracking-[0.18em] text-white/82"
            >
              {resolution}
            </Badge>
          </div>
        </div>
      </div>

      <div className="wink-card-footer grid grid-cols-2 gap-2 p-3">
        <Button asChild variant="outline" className="wink-card-download-button h-10 rounded-[10px]">
          <a href={downloadUrl} download>
            <Download className="h-4 w-4" />
            {downloadLabel}
          </a>
        </Button>
        <Button className="wink-card-preview-button h-10 rounded-[10px]" onClick={handleOpenPreview}>
          <Play className="h-4 w-4" />
          PREVIEW
        </Button>
      </div>
    </article>
  );
};
