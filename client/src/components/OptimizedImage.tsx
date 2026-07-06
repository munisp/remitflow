/**
 * OptimizedImage.tsx — Cloudinary/imgix CDN image optimization
 *
 * Features:
 * - Responsive srcSet generation (320w, 640w, 960w, 1280w, 1920w)
 * - Auto-format (WebP/AVIF) based on browser support
 * - Lazy loading with IntersectionObserver
 * - Blur-up placeholder (LQIP)
 * - Art direction with different crops per breakpoint
 * - Retina display support (2x, 3x)
 */

import React, { useState, useRef, useEffect } from "react";

interface OptimizedImageProps {
  src: string;
  alt: string;
  width?: number;
  height?: number;
  className?: string;
  sizes?: string;
  priority?: boolean; // Skip lazy loading for above-the-fold images
  objectFit?: "cover" | "contain" | "fill" | "none";
  quality?: number;
  placeholder?: "blur" | "empty";
  onLoad?: () => void;
}

const CDN_BASE = process.env.REACT_APP_CDN_URL || "https://res.cloudinary.com/remitflow";
const IMGIX_BASE = process.env.REACT_APP_IMGIX_URL || "https://remitflow.imgix.net";

const BREAKPOINTS = [320, 640, 960, 1280, 1920];
const DEFAULT_QUALITY = 80;

function buildCloudinaryUrl(src: string, width: number, quality: number, format?: string): string {
  const transforms = [
    `w_${width}`,
    `q_${quality}`,
    `f_${format || "auto"}`,
    "c_fill",
    "dpr_auto",
  ].join(",");
  return `${CDN_BASE}/image/upload/${transforms}/${src}`;
}

function buildImgixUrl(src: string, width: number, quality: number, format?: string): string {
  const params = new URLSearchParams({
    w: String(width),
    q: String(quality),
    auto: format || "format,compress",
    fit: "crop",
    dpr: "1",
  });
  return `${IMGIX_BASE}/${src}?${params.toString()}`;
}

function buildSrcSet(src: string, quality: number): string {
  return BREAKPOINTS.map((w) => `${buildCloudinaryUrl(src, w, quality)} ${w}w`).join(", ");
}

function buildBlurPlaceholder(src: string): string {
  return buildCloudinaryUrl(src, 20, 10, "webp");
}

export default function OptimizedImage({
  src,
  alt,
  width,
  height,
  className = "",
  sizes = "(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw",
  priority = false,
  objectFit = "cover",
  quality = DEFAULT_QUALITY,
  placeholder = "blur",
  onLoad,
}: OptimizedImageProps) {
  const [loaded, setLoaded] = useState(false);
  const [inView, setInView] = useState(priority);
  const imgRef = useRef<HTMLImageElement>(null);

  // Intersection Observer for lazy loading
  useEffect(() => {
    if (priority || !imgRef.current) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setInView(true);
          observer.disconnect();
        }
      },
      { rootMargin: "200px" } // Start loading 200px before viewport
    );

    observer.observe(imgRef.current);
    return () => observer.disconnect();
  }, [priority]);

  const isExternal = src.startsWith("http://") || src.startsWith("https://");
  const srcSet = isExternal ? undefined : buildSrcSet(src, quality);
  const mainSrc = isExternal ? src : buildCloudinaryUrl(src, width || 640, quality);
  const blurSrc = isExternal ? undefined : buildBlurPlaceholder(src);

  return (
    <div
      className={`relative overflow-hidden ${className}`}
      style={{ width: width ? `${width}px` : "100%", height: height ? `${height}px` : "auto" }}
    >
      {/* Blur placeholder */}
      {placeholder === "blur" && blurSrc && !loaded && (
        <img
          src={blurSrc}
          alt=""
          aria-hidden="true"
          className="absolute inset-0 w-full h-full object-cover blur-lg scale-110 transition-opacity duration-300"
          style={{ opacity: loaded ? 0 : 1 }}
        />
      )}

      {/* Main image */}
      <img
        ref={imgRef}
        src={inView ? mainSrc : undefined}
        srcSet={inView ? srcSet : undefined}
        sizes={sizes}
        alt={alt}
        width={width}
        height={height}
        loading={priority ? "eager" : "lazy"}
        decoding={priority ? "sync" : "async"}
        fetchPriority={priority ? "high" : "auto"}
        onLoad={() => {
          setLoaded(true);
          onLoad?.();
        }}
        className={`w-full h-full transition-opacity duration-300 ${loaded ? "opacity-100" : "opacity-0"}`}
        style={{ objectFit }}
      />
    </div>
  );
}

// Avatar variant with circular crop
export function OptimizedAvatar({
  src,
  alt,
  size = 40,
  className = "",
}: {
  src: string;
  alt: string;
  size?: number;
  className?: string;
}) {
  const isExternal = src.startsWith("http://") || src.startsWith("https://");
  const optimizedSrc = isExternal
    ? src
    : buildCloudinaryUrl(src, size * 2, 85); // 2x for retina

  return (
    <img
      src={optimizedSrc}
      alt={alt}
      width={size}
      height={size}
      loading="lazy"
      className={`rounded-full object-cover ${className}`}
      style={{ width: `${size}px`, height: `${size}px` }}
    />
  );
}

// Hero image with art direction
export function HeroImage({
  mobileSrc,
  desktopSrc,
  alt,
  className = "",
}: {
  mobileSrc: string;
  desktopSrc: string;
  alt: string;
  className?: string;
}) {
  return (
    <picture className={className}>
      <source
        media="(min-width: 1024px)"
        srcSet={buildCloudinaryUrl(desktopSrc, 1920, 85)}
        type="image/webp"
      />
      <source
        media="(min-width: 640px)"
        srcSet={buildCloudinaryUrl(desktopSrc, 1280, 80)}
        type="image/webp"
      />
      <img
        src={buildCloudinaryUrl(mobileSrc, 640, 75)}
        alt={alt}
        loading="eager"
        className="w-full h-full object-cover"
      />
    </picture>
  );
}
