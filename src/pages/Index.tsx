import { useState } from "react";
import {
  ChevronDown,
  Crown,
  Download,
  Heart,
  LayoutGrid,
  LifeBuoy,
  MessageSquare,
  Monitor,
  Plus,
  RefreshCw,
  Settings2,
  Star,
  UserRound,
  Volume2,
} from "lucide-react";

import { WinkCard } from "@/components/WinkCard";
import { WinkPreviewDialog } from "@/components/WinkPreviewDialog";
import {
  chatWinkCategoryOrder,
  chatWinks,
  fullscreenWinkCategoryOrder,
  fullscreenWinks,
  type ChatWinkCategory,
  type FullscreenWinkCategory,
  type WinkAsset,
} from "@/lib/winks";

const floatingParticles = [
  { left: "7%", top: "12%", animationDelay: "0s", animationDuration: "12s" },
  { left: "21%", top: "38%", animationDelay: "-2s", animationDuration: "15s" },
  { left: "33%", top: "74%", animationDelay: "-6s", animationDuration: "17s" },
  { left: "47%", top: "18%", animationDelay: "-3s", animationDuration: "13s" },
  { left: "59%", top: "61%", animationDelay: "-7s", animationDuration: "16s" },
  { left: "72%", top: "27%", animationDelay: "-5s", animationDuration: "18s" },
  { left: "84%", top: "15%", animationDelay: "-1s", animationDuration: "14s" },
  { left: "91%", top: "72%", animationDelay: "-4s", animationDuration: "19s" },
];

const getFullscreenPreviewSpeed = (_asset: WinkAsset) => 1.35;

const withCacheVersion = (url: string, cacheVersion?: string) => {
  if (!cacheVersion) {
    return url;
  }

  return `${url}${url.includes("?") ? "&" : "?"}v=${encodeURIComponent(cacheVersion)}`;
};

const sidebarItems = [
  { label: "WINK STUDIO", icon: Star, href: "#" },
  { label: "CHAT WINKS", icon: MessageSquare, href: "#chat-winks" },
  { label: "FULL BINGO WINKS", icon: Monitor, href: "#fullscreen-winks" },
  { label: "SOUND", icon: Volume2, href: "#fullscreen-winks", soundOnly: true },
  { label: "FAVORITES", icon: Heart, href: "#" },
  { label: "DOWNLOADS", icon: Download, href: "#" },
  { label: "CATEGORIES", icon: LayoutGrid, href: "#" },
  { label: "SETTINGS", icon: Settings2, href: "#" },
  { label: "HELP", icon: LifeBuoy, href: "#" },
];

const laneCards = [
  {
    href: "#chat-winks",
    icon: MessageSquare,
    title: "CHAT WINKS",
    subtitle: "APNG 768x1024",
    active: true,
  },
  {
    href: "#fullscreen-winks",
    icon: Monitor,
    title: "FULL BINGO WINKS",
    subtitle: "LOTTIE / JSON 1920x1024",
    active: false,
  },
];

const Index = () => {
  const [selectedAsset, setSelectedAsset] = useState<WinkAsset | null>(null);
  const [previewSessionId, setPreviewSessionId] = useState(0);
  const [selectedChatCategory, setSelectedChatCategory] = useState<ChatWinkCategory | "all">("all");
  const [selectedFullscreenCategory, setSelectedFullscreenCategory] = useState<FullscreenWinkCategory | "all" | "sound">("all");
  const [assetCacheVersion, setAssetCacheVersion] = useState("");
  const [cacheStatus, setCacheStatus] = useState("");
  const hasChatWinks = chatWinks.length > 0;
  const hasFullscreenWinks = fullscreenWinks.length > 0;
  const visibleChatWinks = selectedChatCategory === "all"
    ? chatWinks
    : chatWinks.filter((asset) => asset.chatCategory === selectedChatCategory);
  const visibleFullscreenWinks = selectedFullscreenCategory === "all"
    ? fullscreenWinks.filter((asset) => !asset.audioPath)
    : selectedFullscreenCategory === "sound"
      ? fullscreenWinks.filter((asset) => Boolean(asset.audioPath))
    : fullscreenWinks.filter((asset) => asset.fullscreenCategory === selectedFullscreenCategory);

  const handleClearSiteCache = async () => {
    try {
      if ("caches" in window) {
        const cacheNames = await window.caches.keys();
        await Promise.all(cacheNames.map((cacheName) => window.caches.delete(cacheName)));
      }
    } finally {
      setAssetCacheVersion(`${Date.now()}`);
      setCacheStatus("Cache limpo");
      window.setTimeout(() => setCacheStatus(""), 2400);
    }
  };

  const handleOpenAssetPreview = (asset: WinkAsset) => {
    setPreviewSessionId((current) => current + 1);
    setSelectedAsset(asset);
  };

  return (
    <main className="relative min-h-screen overflow-hidden">
      <div className="studio-orb studio-orb-primary" />
      <div className="studio-orb studio-orb-secondary" />
      <div className="studio-grid-overlay" />
      <div className="studio-particle-field" aria-hidden="true">
        {floatingParticles.map((particle, index) => (
          <span
            key={`${particle.left}-${particle.top}-${index}`}
            className="floating-particle"
            style={particle as React.CSSProperties}
          />
        ))}
      </div>

      <div className="studio-app-shell relative z-10 mx-auto grid min-h-screen max-w-[1720px] lg:grid-cols-[260px_minmax(0,1fr)]">
        <aside className="studio-sidebar">
          <div className="studio-sidebar-brand">
            <h1 className="studio-brand-title">Gabriel e Oscar</h1>
            <p className="studio-brand-subtitle">WINK STUDIO</p>
          </div>

          <nav className="studio-sidebar-nav">
            {sidebarItems.map(({ label, icon: Icon, href, fullscreenCategory, soundOnly }) => (
              <a
                key={label}
                href={href}
                className={`studio-sidebar-link ${
                  (label === "WINK STUDIO" && selectedFullscreenCategory === "all") ||
                  (soundOnly && selectedFullscreenCategory === "sound") ||
                  selectedFullscreenCategory === fullscreenCategory ? "is-active" : ""
                }`}
                onClick={(event) => {
                  if (!fullscreenCategory && !soundOnly) {
                    return;
                  }

                  event.preventDefault();
                  setSelectedFullscreenCategory(soundOnly ? "sound" : fullscreenCategory);
                  document.querySelector("#fullscreen-winks")?.scrollIntoView({ behavior: "smooth", block: "start" });
                }}
              >
                <Icon className="h-5 w-5" />
                <span>{label}</span>
              </a>
            ))}
          </nav>

          <div className="studio-sidebar-promo">
            <div className="studio-sidebar-promo-icon">
              <Crown className="h-8 w-8" />
            </div>
            <p className="studio-sidebar-promo-title">Gabriel e Oscar</p>
            <p className="studio-sidebar-promo-copy">PREMIUM PLATFORM</p>
          </div>
        </aside>

        <div className="studio-main-area">
          <header className="studio-topbar">
            <div className="studio-mobile-brand">
              <p className="studio-brand-title">Gabriel e Oscar</p>
              <p className="studio-brand-subtitle">WINK STUDIO</p>
            </div>

            <div className="ml-auto flex items-center gap-3">
              <button type="button" className="studio-sort-button" onClick={handleClearSiteCache}>
                <RefreshCw className="h-4 w-4" />
                Limpar cache
              </button>
              {cacheStatus ? (
                <span className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-200">
                  {cacheStatus}
                </span>
              ) : null}
              <button type="button" className="studio-premium-pill">
                <Crown className="h-4 w-4" />
                PREMIUM ACCESS
              </button>
              <button type="button" className="studio-profile-button" aria-label="Open profile">
                <UserRound className="h-5 w-5" />
              </button>
            </div>
          </header>

          <div className="studio-content">
            <section className="studio-lane-selector">
              {laneCards.map(({ href, icon: Icon, title, subtitle, active }) => (
                <a key={title} href={href} className={`studio-lane-card ${active ? "is-active" : ""}`}>
                  <Icon className="h-8 w-8" />
                  <div>
                    <p className="studio-lane-card-title">{title}</p>
                    <p className="studio-lane-card-subtitle">{subtitle}</p>
                  </div>
                </a>
              ))}
            </section>

            <section id="chat-winks" className="studio-market-section scroll-mt-20">
              <div className="studio-section-header">
                <div>
                  <div className="studio-section-heading">
                    <MessageSquare className="h-6 w-6" />
                    <h2>CHAT WINKS</h2>
                  </div>
                  <p className="studio-section-copy">APNG - 768x1024 - Overlays transparentes de bingo, jackpot e celebracao para chat</p>
                </div>

                {hasChatWinks ? (
                  <button type="button" className="studio-sort-button">
                    Mais recentes
                    <ChevronDown className="h-4 w-4" />
                  </button>
                ) : (
                  <div className="studio-info-tile">
                    <MessageSquare className="h-4 w-4" />
                    <span>Colecao em construcao</span>
                  </div>
                )}
              </div>

              {hasChatWinks ? (
                <div className="studio-filter-row">
                  <button
                    type="button"
                    className={`studio-filter-pill ${selectedChatCategory === "all" ? "is-active" : ""}`}
                    aria-pressed={selectedChatCategory === "all"}
                    onClick={() => setSelectedChatCategory("all")}
                  >
                    TODOS
                  </button>
                  {chatWinkCategoryOrder.map((category) => (
                    <button
                      key={category}
                      type="button"
                      className={`studio-filter-pill ${selectedChatCategory === category ? "is-active" : ""}`}
                      aria-pressed={selectedChatCategory === category}
                      onClick={() => setSelectedChatCategory(category)}
                    >
                      {category}
                    </button>
                  ))}
                </div>
              ) : null}

              <div className="chat-gallery-grid">
                {hasChatWinks ? (
                  visibleChatWinks.map((asset) => (
                    <WinkCard
                      key={asset.id}
                      id={asset.id}
                      title={asset.name}
                      type="CHAT WINK"
                      format={asset.format}
                      resolution={asset.resolution}
                      preview={withCacheVersion(asset.previewPath, assetCacheVersion)}
                      hoverPreviewUrl={withCacheVersion(asset.filePath, assetCacheVersion)}
                      autoplayPreviewOnHover
                      downloadUrl={asset.filePath}
                      downloadLabel="BAIXAR APNG"
                      accentColor={asset.accent}
                      className="chat-wink-card"
                      onOpenPreview={() => handleOpenAssetPreview(asset)}
                    />
                  ))
                ) : (
                  <article className="more-effects-card fullscreen-empty-card">
                    <div className="more-effects-card-icon">
                      <Plus className="h-7 w-7" />
                    </div>
                    <p className="more-effects-card-title">EM CONSTRUÇÃO</p>
                    <p className="more-effects-card-copy">
                      Removemos a colecao atual de CHAT WINKS para recriar os efeitos com mais calma.
                    </p>
                  </article>
                )}
              </div>

              {hasChatWinks ? (
                <div className="studio-slider-dots" aria-hidden="true">
                  <span className="is-active" />
                  <span />
                  <span />
                  <span />
                  <span />
                  <span />
                </div>
              ) : null}
            </section>

            <div className="studio-section-divider" />

            <section id="fullscreen-winks" className="studio-market-section scroll-mt-20">
              <div className="studio-section-header">
                <div>
                  <div className="studio-section-heading">
                    <Monitor className="h-6 w-6" />
                    <h2>FULL BINGO WINKS</h2>
                  </div>
                  <p className="studio-section-copy">LOTTIE / JSON - 1920x1024 - Efeitos para tela cheia inspirados em Winks e jackpot screens</p>
                </div>

                {hasFullscreenWinks ? (
                  <button type="button" className="studio-sort-button">
                    Mais recentes
                    <ChevronDown className="h-4 w-4" />
                  </button>
                ) : (
                  <div className="studio-info-tile">
                    <Monitor className="h-4 w-4" />
                    <span>Colecao em reconstrucao</span>
                  </div>
                )}
              </div>

              {hasFullscreenWinks ? (
                <div className="studio-filter-row">
                  <button
                    type="button"
                    className={`studio-filter-pill ${selectedFullscreenCategory === "all" ? "is-active" : ""}`}
                    aria-pressed={selectedFullscreenCategory === "all"}
                    onClick={() => setSelectedFullscreenCategory("all")}
                  >
                    TODOS
                  </button>
                  {fullscreenWinkCategoryOrder.map((category) => (
                    <button
                      key={category}
                      type="button"
                      className={`studio-filter-pill ${selectedFullscreenCategory === category ? "is-active" : ""}`}
                      aria-pressed={selectedFullscreenCategory === category}
                      onClick={() => setSelectedFullscreenCategory(category)}
                    >
                      {category}
                    </button>
                  ))}
                </div>
              ) : null}

              <div className="fullscreen-gallery-grid">
                {hasFullscreenWinks ? (
                  <>
                    {visibleFullscreenWinks.map((asset) => (
                      <WinkCard
                        key={asset.id}
                        id={asset.id}
                        title={asset.name}
                        type="FULL BINGO WINK"
                        format={asset.format}
                        resolution={asset.resolution}
                        preview={withCacheVersion(asset.previewPath, assetCacheVersion)}
                        lottiePreviewUrl={withCacheVersion(asset.filePath, assetCacheVersion)}
                        lottieStartAtProgress={0}
                        lottiePlaybackSpeed={getFullscreenPreviewSpeed(asset)}
                        hasSound={Boolean(asset.audioPath)}
                        audioUrl={asset.audioPath}
                        downloadUrl={asset.filePath}
                        downloadLabel="BAIXAR JSON"
                        accentColor={asset.accent}
                        className="fullscreen-wink-card"
                        onOpenPreview={() => handleOpenAssetPreview(asset)}
                      />
                    ))}

                    {selectedFullscreenCategory === "all" ? (
                      <article className="more-effects-card">
                        <div className="more-effects-card-icon">
                          <Plus className="h-7 w-7" />
                        </div>
                        <p className="more-effects-card-title">MAIS EFEITOS</p>
                        <p className="more-effects-card-copy">Novos efeitos incriveis em breve!</p>
                      </article>
                    ) : null}
                  </>
                ) : (
                  <article className="more-effects-card fullscreen-empty-card">
                    <div className="more-effects-card-icon">
                      <Plus className="h-7 w-7" />
                    </div>
                    <p className="more-effects-card-title">EM RECONSTRUCAO</p>
                    <p className="more-effects-card-copy">
                      Removemos a colecao atual de FULL BINGO WINKS para refazer os efeitos com mais calma.
                    </p>
                  </article>
                )}
              </div>
            </section>

            <footer className="studio-footer">
              <span>Gabriel e Oscar Wink Studio</span>
              <span>PREMIUM EFFECTS FOR PREMIUM PLAYERS</span>
            </footer>
          </div>
        </div>
      </div>

      <WinkPreviewDialog
        asset={selectedAsset}
        cacheVersion={assetCacheVersion}
        previewSessionId={previewSessionId}
        onOpenChange={(open) => !open && setSelectedAsset(null)}
      />
    </main>
  );
};

export default Index;
