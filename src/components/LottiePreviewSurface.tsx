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
  setSubframe?: (value: boolean) => void;
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
  playbackSpeed?: number;
  autoplay?: boolean;
  loop?: boolean;
  showFallbackUnderlay?: boolean;
  showFallbackBeforeReady?: boolean;
};

export const LottiePreviewSurface = forwardRef<LottiePreviewSurfaceHandle, LottiePreviewSurfaceProps>(({
  src,
  fallbackPreview,
  alt,
  className,
  startAtProgress = 0,
  playbackSpeed = 1,
  autoplay = true,
  loop = false,
  showFallbackUnderlay = false,
  showFallbackBeforeReady = true,
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
    rafId: 0,
    lastTimestamp: 0,
  });
  const [hasError, setHasError] = useState(import.meta.env.MODE === "test");
  const [isReady, setIsReady] = useState(false);
  const [hasStartedPlayback, setHasStartedPlayback] = useState(autoplay);

  const stopPlaybackLoop = () => {
    if (playbackRef.current.rafId) {
      cancelAnimationFrame(playbackRef.current.rafId);
      playbackRef.current.rafId = 0;
    }
    playbackRef.current.lastTimestamp = 0;
  };

  const runPlaybackLoop = () => {
    if (playbackRef.current.rafId) return;

    const tick = (timestamp: number) => {
      const animation = animationRef.current;
      if (!animation || !playbackRef.current.isPlaying) {
        playbackRef.current.rafId = 0;
        playbackRef.current.lastTimestamp = 0;
        return;
      }

      const lastTimestamp = playbackRef.current.lastTimestamp || timestamp;
      const deltaSeconds = Math.min(0.08, Math.max(0, (timestamp - lastTimestamp) / 1000));
      playbackRef.current.lastTimestamp = timestamp;

      const totalFrames = frameWindowRef.current.totalFrames;
      const inPoint = frameWindowRef.current.inPoint;
      const endFrame = inPoint + totalFrames;
      const advancedFrame = playbackRef.current.currentFrame + (playbackRef.current.frameRate * playbackSpeed * deltaSeconds);

      if (!loop && advancedFrame >= endFrame) {
        const finalFrame = Math.max(inPoint, endFrame - 1);
        playbackRef.current.currentFrame = finalFrame;
        playbackRef.current.isPlaying = false;
        containerRef.current?.setAttribute("data-current-frame", `${Math.round(finalFrame)}`);
        animation.goToAndStop?.(finalFrame, true);
        stopPlaybackLoop();
        return;
      }

      let nextFrame = advancedFrame;
      while (nextFrame >= endFrame) {
        nextFrame -= totalFrames;
      }

      playbackRef.current.currentFrame = nextFrame;
      containerRef.current?.setAttribute("data-current-frame", `${Math.round(nextFrame)}`);
      animation.goToAndStop?.(nextFrame, true);
      playbackRef.current.rafId = requestAnimationFrame(tick);
    };

    playbackRef.current.rafId = requestAnimationFrame(tick);
  };

  const playFromProgress = (progress: number) => {
    const animation = animationRef.current;
    if (!animation) return;

    const clampedProgress = Math.min(0.999, Math.max(0, progress));
    const startFrame = Math.max(
      frameWindowRef.current.inPoint,
      Math.min(
        frameWindowRef.current.inPoint + frameWindowRef.current.totalFrames - 1,
        Math.round(frameWindowRef.current.inPoint + (frameWindowRef.current.totalFrames * clampedProgress)),
      ),
    );

    animation.setSpeed?.(playbackSpeed);
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
    let hasStarted = false;
    const fallbackStartTimers: number[] = [];

    const loadAnimation = async () => {
      try {
        const { default: lottie } = await import("lottie-web");
        const response = await fetch(src, { cache: "no-store" });
        if (!response.ok) {
          throw new Error(`Unable to load ${src}`);
        }

        const animationData = await response.json();
        if (!active || !containerRef.current) return;

        containerRef.current.innerHTML = "";
        const animation = lottie.loadAnimation({
          container: containerRef.current,
          renderer: "svg",
          loop: false,
          autoplay: false,
          animationData,
          rendererSettings: {
            preserveAspectRatio: "xMidYMid meet",
            progressiveLoad: true,
          },
        });
        animation.setSubframe?.(true);

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
          if (!active || hasStarted) return;
          hasStarted = true;
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
          fallbackStartTimers.push(window.setTimeout(startPlayback, delay));
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
      hasStarted = false;
      for (const timerId of fallbackStartTimers) {
        window.clearTimeout(timerId);
      }
      pendingPlaybackProgressRef.current = null;
      playbackRef.current.isPlaying = false;
      stopPlaybackLoop();
      animationRef.current?.destroy();
      animationRef.current = null;
    };
  }, [autoplay, loop, playbackSpeed, src, startAtProgress]);

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
        showFallbackBeforeReady || showFallbackUnderlay || !hasStartedPlayback ? (
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
        ) : null
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
