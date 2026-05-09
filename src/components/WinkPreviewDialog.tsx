import { Download, Folder, Play } from "lucide-react";

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
  onOpenChange: (open: boolean) => void;
};

export const WinkPreviewDialog = ({ asset, onOpenChange }: WinkPreviewDialogProps) => {
  if (!asset) {
    return null;
  }

  const isChat = asset.category === "chat";
  const formatBadges = normalizeWinkFormats(asset.format);

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
                    <img
                      src={asset.filePath}
                      alt={`${asset.name} live preview`}
                      className="wink-card-live-preview relative h-full w-full rounded-[24px] object-contain"
                      decoding="async"
                      loading="eager"
                    />
                    <div className="wink-card-live-halo rounded-[24px]" aria-hidden="true" />
                  </div>
                </div>
              ) : (
                <div className="wink-preview-stage relative aspect-[15/8] overflow-hidden rounded-[28px] border border-white/12 bg-[#060914] p-4">
                  <div className="wink-alpha-grid rounded-[22px]" aria-hidden="true" />
                  <LottiePreviewSurface
                    src={asset.filePath}
                    fallbackPreview={asset.previewPath}
                    alt={`${asset.name} live Lottie preview`}
                    className="wink-card-live-preview rounded-[22px]"
                    startAtProgress={asset.previewStartProgress}
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
