import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";

import { cn } from "@/lib/utils";

type AnimationController = {
  addEventListener?: (eventName: string, callback: (event?: unknown) => void) => void;
  destroy: () => void;
  goToAndPlay?: (value: number, isFrame?: boolean) => void;
  goToAndStop?: (value: number, isFrame?: boolean) => void;
  play?: () => void;
  removeEventListener?: (eventName: string, callback: (event?: unknown) => void) => void;
  resize?: () => void;
  setSpeed?: (value: number) => void;
};

export type LottiePreviewSurfaceHandle = {
  restart: () => void;
};

type LottiePreviewSurfaceProps = {
  src: string;
  fallbackPreview: string;
  alt: string;
  className?: string;
  startAtProgress?: number;
  autoplay?: boolean;
  showFallbackUnderlay?: boolean;
};

export const LottiePreviewSurface = forwardRef<LottiePreviewSurfaceHandle, LottiePreviewSurfaceProps>(({
  src,
  fallbackPreview,
  alt,
  className,
  startAtProgress = 0.38,
  autoplay = true,
  showFallbackUnderlay = false,
}, ref) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const animationRef = useRef<AnimationController | null>(null);
  const pendingPlaybackProgressRef = useRef<null | number>(null);
  const frameWindowRef = useRef({
    inPoint: 0,
    totalFrames: 1,
  });
  const playbackRef = useRef({
    currentFrame: 0,
    frameRate: 30,
    isPlaying: false,
    intervalId: 0,
  });
  const [hasError, setHasError] = useState(import.meta.env.MODE === "test");
  const [isReady, setIsReady] = useState(false);
  const [hasStartedPlayback, setHasStartedPlayback] = useState(autoplay);

  const stopPlaybackLoop = () => {
    if (playbackRef.current.intervalId) {
      clearInterval(playbackRef.current.intervalId);
      playbackRef.current.intervalId = 0;
    }
  };

  const runPlaybackLoop = () => {
    if (playbackRef.current.intervalId) return;

    playbackRef.current.intervalId = window.setInterval(() => {
      const animation = animationRef.current;
      if (!animation || !playbackRef.current.isPlaying) {
        return;
      }

      const totalFrames = frameWindowRef.current.totalFrames;
      const inPoint = frameWindowRef.current.inPoint;
      const endFrame = inPoint + totalFrames;
      const advancedFrame = playbackRef.current.currentFrame + 1.08;

      let nextFrame = advancedFrame;
      while (nextFrame >= endFrame) {
        nextFrame -= totalFrames;
      }

      playbackRef.current.currentFrame = nextFrame;
      containerRef.current?.setAttribute("data-current-frame", `${Math.round(nextFrame)}`);
      animation.goToAndStop?.(nextFrame, true);
    }, Math.max(16, Math.round(1000 / playbackRef.current.frameRate)));
  };

  const playFromProgress = (progress: number) => {
    const animation = animationRef.current;
    if (!animation) return;

    const clampedProgress = Math.min(0.98, Math.max(0, progress));
    const startFrame = Math.max(
      frameWindowRef.current.inPoint,
      Math.min(
        frameWindowRef.current.inPoint + frameWindowRef.current.totalFrames - 1,
        Math.round(frameWindowRef.current.inPoint + (frameWindowRef.current.totalFrames * clampedProgress)),
      ),
    );

    animation.setSpeed?.(1);
    playbackRef.current.currentFrame = startFrame;
    playbackRef.current.isPlaying = true;
    setHasStartedPlayback(true);
    containerRef.current?.setAttribute("data-current-frame", `${Math.round(startFrame)}`);
    animation.goToAndStop?.(startFrame, true);
    runPlaybackLoop();
  };

  useImperativeHandle(
    ref,
    () => ({
      restart: () => {
        pendingPlaybackProgressRef.current = 0;
        setHasStartedPlayback(true);
        playFromProgress(0);
      },
    }),
    [],
  );

  useEffect(() => {
    setHasStartedPlayback(autoplay);
  }, [autoplay]);

  useEffect(() => {
    if (import.meta.env.MODE === "test") {
      return;
    }

    if (!containerRef.current) return;

    let active = true;

    const loadAnimation = async () => {
      try {
        const { default: lottie } = await import("lottie-web");
        const response = await fetch(src);
        if (!response.ok) {
          throw new Error(`Unable to load ${src}`);
        }

        const animationData = await response.json();
        if (!active || !containerRef.current) return;

        containerRef.current.innerHTML = "";
        const animation = lottie.loadAnimation({
          container: containerRef.current,
          renderer: "svg",
          loop: true,
          autoplay: false,
          animationData,
          rendererSettings: {
            preserveAspectRatio: "xMidYMid meet",
            progressiveLoad: true,
          },
        });

        const inPoint = typeof animationData.ip === "number" ? animationData.ip : 0;
        const outPoint = typeof animationData.op === "number" ? animationData.op : inPoint + 1;
        const totalFrames = Math.max(1, outPoint - inPoint);
        animationRef.current = animation;
        frameWindowRef.current = {
          inPoint,
          totalFrames,
        };
        playbackRef.current.frameRate = typeof animationData.fr === "number" ? animationData.fr : 30;
        const restingStartFrame = Math.max(
          inPoint,
          Math.min(outPoint - 1, Math.round(inPoint + (totalFrames * startAtProgress))),
        );
        playbackRef.current.currentFrame = restingStartFrame;
        containerRef.current?.setAttribute("data-current-frame", `${Math.round(restingStartFrame)}`);
        animation.goToAndStop?.(restingStartFrame, true);

        const startPlayback = () => {
          if (!active) return;
          setIsReady(true);
          if (autoplay) {
            playFromProgress(startAtProgress);
          } else if (pendingPlaybackProgressRef.current !== null) {
            const pendingProgress = pendingPlaybackProgressRef.current;
            pendingPlaybackProgressRef.current = null;
            playFromProgress(pendingProgress);
          }
          requestAnimationFrame(() => {
            animation?.resize?.();
          });
        };

        animation.addEventListener?.("DOMLoaded", startPlayback);
        animation.addEventListener?.("data_ready", startPlayback);

        for (const delay of [80, 420, 1100, 2100]) {
          setTimeout(startPlayback, delay);
        }
      } catch {
        if (active) {
          setHasError(true);
        }
      }
    };

    setHasError(false);
    setIsReady(false);
    loadAnimation();

    return () => {
      active = false;
      pendingPlaybackProgressRef.current = null;
      playbackRef.current.isPlaying = false;
      stopPlaybackLoop();
      animationRef.current?.destroy();
      animationRef.current = null;
    };
  }, [autoplay, src, startAtProgress]);

  if (hasError) {
    return (
      <img
        src={fallbackPreview}
        alt={alt}
        className={cn("h-full w-full object-contain", className)}
        decoding="async"
        loading="lazy"
      />
    );
  }

  return (
    <div className={cn("relative h-full w-full", className)}>
      {!isReady || showFallbackUnderlay || !hasStartedPlayback ? (
        <img
          src={fallbackPreview}
          alt={alt}
          className={cn(
            "absolute inset-0 h-full w-full object-contain transition-opacity duration-500",
            isReady && showFallbackUnderlay ? "opacity-100" : isReady && hasStartedPlayback ? "opacity-0" : "opacity-100",
          )}
          decoding="async"
          loading={showFallbackUnderlay ? "eager" : "lazy"}
        />
      ) : null}
      <div
        ref={containerRef}
        aria-label={alt}
        className={cn(
          "absolute inset-0 h-full w-full transition-opacity duration-500",
          isReady && hasStartedPlayback ? "opacity-100" : "opacity-0",
        )}
      />
    </div>
  );
});

LottiePreviewSurface.displayName = "LottiePreviewSurface";
