import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";

import { cn } from "@/lib/utils";

export type ApngPreviewSurfaceHandle = {
  restart: () => void;
};

type ApngPreviewSurfaceProps = {
  src: string;
  alt: string;
  className?: string;
  mediaClassName?: string;
  fallbackClassName?: string;
  fallbackPreview?: string;
  showFallbackUnderlay?: boolean;
  eager?: boolean;
  loadAfterFallback?: boolean;
  playDurationMs?: number;
};

export const ApngPreviewSurface = forwardRef<ApngPreviewSurfaceHandle, ApngPreviewSurfaceProps>(({
  src,
  alt,
  className,
  mediaClassName,
  fallbackClassName,
  fallbackPreview,
  showFallbackUnderlay = false,
  eager = false,
  loadAfterFallback = false,
  playDurationMs = 8000,
}, ref) => {
  const [previewNonce, setPreviewNonce] = useState(0);
  const [isLoaded, setIsLoaded] = useState(false);
  const [hasError, setHasError] = useState(false);
  const [isActive, setIsActive] = useState(true);
  const [canLoadAnimatedPreview, setCanLoadAnimatedPreview] = useState(!loadAfterFallback || !fallbackPreview);
  const stopTimerRef = useRef<number | null>(null);

  const previewSrc = useMemo(() => (
    `${src}${src.includes("?") ? "&" : "?"}preview=${previewNonce}`
  ), [src, previewNonce]);

  const startPlayback = () => {
    setIsActive(true);
    if (stopTimerRef.current !== null) {
      window.clearTimeout(stopTimerRef.current);
      stopTimerRef.current = null;
    }
  };

  useImperativeHandle(
    ref,
    () => ({
      restart: () => {
        setIsLoaded(false);
        setHasError(false);
        startPlayback();
        setPreviewNonce((current) => current + 1);
      },
    }),
    [],
  );

  useEffect(() => {
    setIsLoaded(false);
    setHasError(false);
    setIsActive(true);
    setCanLoadAnimatedPreview(!loadAfterFallback || !fallbackPreview);
  }, [fallbackPreview, loadAfterFallback, src]);

  useEffect(() => () => {
    if (stopTimerRef.current !== null) {
      window.clearTimeout(stopTimerRef.current);
    }
  }, []);

  const scheduleStop = () => {
    if (typeof window === "undefined") {
      return;
    }

    if (stopTimerRef.current !== null) {
      window.clearTimeout(stopTimerRef.current);
    }

    stopTimerRef.current = window.setTimeout(() => {
      setIsActive(false);
      stopTimerRef.current = null;
    }, playDurationMs);
  };

  return (
    <div className={cn("relative h-full w-full", className)}>
      {fallbackPreview ? (
        <img
          src={fallbackPreview}
          alt=""
          aria-hidden="true"
          draggable={false}
          className={cn(
            "absolute inset-0 block h-full w-full object-contain transition-opacity duration-300",
            fallbackClassName,
            isActive && isLoaded && !hasError && !showFallbackUnderlay ? "opacity-0" : "opacity-100",
          )}
          decoding="async"
          loading={eager ? "eager" : "lazy"}
          onLoad={() => setCanLoadAnimatedPreview(true)}
        />
      ) : !isLoaded && isActive ? (
        <div className="wink-preview-loading-layer absolute inset-0" aria-hidden="true" />
      ) : null}

      {isActive && canLoadAnimatedPreview ? (
        <img
          src={previewSrc}
          alt={alt}
          draggable={false}
          className={cn(
            "absolute inset-0 block h-full w-full object-contain transition-opacity duration-300",
            mediaClassName,
            isLoaded && !hasError ? "opacity-100" : "opacity-0",
          )}
          decoding="async"
          loading={eager ? "eager" : "lazy"}
          onLoad={() => {
            setHasError(false);
            setIsLoaded(true);
            scheduleStop();
          }}
          onError={() => {
            if (stopTimerRef.current !== null) {
              window.clearTimeout(stopTimerRef.current);
              stopTimerRef.current = null;
            }
            setHasError(true);
            setIsLoaded(true);
            setIsActive(false);
          }}
        />
      ) : null}
    </div>
  );
});

ApngPreviewSurface.displayName = "ApngPreviewSurface";
