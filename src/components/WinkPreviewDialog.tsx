import { useEffect, useState } from "react";
import { Download, Folder, Gauge, Play } from "lucide-react";

import { ApngPreviewSurface } from "@/components/ApngPreviewSurface";
import { LottiePreviewSurface } from "@/components/LottiePreviewSurface";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { normalizeWinkFormats, type WinkAsset } from "@/lib/winks";

type WinkPreviewDialogProps = {
  asset: WinkAsset | null;
  cacheVersion?: string;
  previewSessionId?: number;
  onOpenChange: (open: boolean) => void;
};

const withCacheVersion = (url: string, cacheVersion?: string) => {
  if (!cacheVersion) {
    return url;
  }

  return `${url}${url.includes("?") ? "&" : "?"}v=${encodeURIComponent(cacheVersion)}`;
};

export const WinkPreviewDialog = ({ asset, cacheVersion, previewSessionId = 0, onOpenChange }: WinkPreviewDialogProps) => {
  const defaultFullscreenPlaybackSpeed = 1.35;
  const [fullscreenPlaybackSpeed, setFullscreenPlaybackSpeed] = useState(defaultFullscreenPlaybackSpeed);

  useEffect(() => {
    setFullscreenPlaybackSpeed(defaultFullscreenPlaybackSpeed);
  }, [asset?.id, defaultFullscreenPlaybackSpeed]);

  if (!asset) {
    return null;
  }

  const isChat = asset.category === "chat";
  const formatBadges = normalizeWinkFormats(asset.format);
  const fullscreenStartProgress = 0;
  const previewPath = withCacheVersion(asset.previewPath, cacheVersion);
  const filePath = withCacheVersion(asset.filePath, cacheVersion);

  const speedOptions = [
    { label: "0.75x", value: 0.75 },
    { label: "1x", value: 1 },
    { label: "1.35x", value: 1.35 },
    { label: "1.5x", value: 1.5 },
    { label: "1.75x", value: 1.75 },
    { label: "2x", value: 2 },
    { label: "2.5x", value: 2.5 },
    { label: "3x", value: 3 },
  ];

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-5xl overflow-y-auto border-white/10 bg-[#060914]/95 p-0 text-white shadow-[0_40px_120px_rgba(0,0,0,0.6)] backdrop-blur-xl">
        <div
          className="relative overflow-hidden rounded-[28px]"
          style={
            {
              ["--wink-accent" as string]: asset.accent,
            } as React.CSSProperties
          }
        >
          <div className={cn("absolute inset-0 bg-gradient-to-br opacity-80", asset.surfaceClass)} />
          <div
            className="absolute inset-0 opacity-50"
            style={{
              background: `radial-gradient(circle at 50% 18%, ${asset.accent}2a 0%, transparent 48%)`,
            }}
          />

          <div className="relative p-7 md:p-10">
            <DialogHeader className="space-y-4 text-left">
              <div className="flex flex-wrap items-center gap-2">
                {formatBadges.map((badge) => (
                  <Badge
                    key={badge}
                    variant="outline"
                    className={cn("wink-card-badge px-3 py-1 text-xs uppercase tracking-[0.24em] text-white", asset.badgeClass)}
                  >
                    {badge}
                  </Badge>
                ))}
                <Badge
                  variant="outline"
                  className="wink-card-resolution-badge px-3 py-1 text-xs uppercase tracking-[0.24em] text-white/80"
                >
                  {asset.resolution}
                </Badge>
              </div>
              <DialogTitle className="max-w-3xl text-4xl font-semibold uppercase tracking-[0.08em] text-white md:text-5xl">
                {asset.name}
              </DialogTitle>
              <DialogDescription className="max-w-2xl text-base leading-7 text-white/70">
                {asset.description}
              </DialogDescription>
            </DialogHeader>

            <div className="mt-8">
              {isChat ? (
                <div className="mx-auto flex max-w-[420px] justify-center rounded-[36px] border border-white/12 bg-black/25 p-4 shadow-[0_35px_90px_rgba(0,0,0,0.55)]">
                  <div className="wink-preview-stage relative aspect-[3/4] w-full overflow-hidden rounded-[30px] border border-white/12 bg-[#060914] p-3">
                    <div className="wink-alpha-grid rounded-[24px]" aria-hidden="true" />
                    <ApngPreviewSurface
                      src={filePath}
                      fallbackPreview={previewPath}
                      alt={`${asset.name} live preview`}
                      className="relative h-full w-full overflow-hidden rounded-[24px]"
                      mediaClassName="wink-card-live-preview wink-card-apng-preview rounded-[24px]"
                      fallbackClassName="rounded-[24px]"
                      eager
                      loadAfterFallback
                    />
                    <div className="wink-card-live-halo rounded-[24px]" aria-hidden="true" />
                  </div>
                </div>
              ) : (
                <div className="wink-preview-stage relative aspect-[15/8] overflow-hidden rounded-[28px] border border-white/12 bg-[#060914] p-4">
                  <div className="wink-alpha-grid rounded-[22px]" aria-hidden="true" />
                  <div className="absolute right-5 top-5 z-20 flex items-center gap-1 rounded-full border border-white/12 bg-black/45 p-1 text-xs text-white/80 shadow-[0_12px_32px_rgba(0,0,0,0.35)] backdrop-blur-md">
                    <Gauge className="ml-2 h-3.5 w-3.5 text-white/70" />
                    {speedOptions.map((option) => (
                      <Button
                        key={option.label}
                        type="button"
                        variant="ghost"
                        size="sm"
                        className={cn(
                          "h-7 rounded-full px-2.5 font-semibold tracking-[0.12em] text-white/70 hover:bg-white/10 hover:text-white",
                          fullscreenPlaybackSpeed === option.value && "bg-white/18 text-white shadow-[0_0_18px_var(--wink-accent)]",
                        )}
                        onClick={() => setFullscreenPlaybackSpeed(option.value)}
                      >
                        {option.label}
                      </Button>
                    ))}
                  </div>
                  <LottiePreviewSurface
                    key={`${asset.id}-${previewSessionId}-${fullscreenPlaybackSpeed}-${cacheVersion ?? "live"}`}
                    src={filePath}
                    fallbackPreview={previewPath}
                    alt={`${asset.name} live Lottie preview`}
                    className="wink-card-live-preview rounded-[22px]"
                    startAtProgress={fullscreenStartProgress}
                    playbackSpeed={fullscreenPlaybackSpeed}
                    showFallbackBeforeReady={false}
                  />
                  <div className="wink-card-live-halo rounded-[22px]" aria-hidden="true" />
                </div>
              )}
            </div>

            <div className="mt-8 grid gap-4 md:grid-cols-[1fr_auto] md:items-end">
              <div className="grid gap-3 text-sm text-white/68 md:grid-cols-2">
                <div className="studio-info-tile">
                  <Folder className="h-4 w-4 text-white/70" />
                  <span>{asset.folderPath}</span>
                </div>
                <div className="studio-info-tile">
                  <Play className="h-4 w-4 text-white/70" />
                  <span>{asset.previewFolderPath}</span>
                </div>
              </div>

              <Button asChild className="studio-primary-button h-11 rounded-full px-6">
                <a href={asset.filePath} download>
                  <Download className="h-4 w-4" />
                  Download asset
                </a>
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};
