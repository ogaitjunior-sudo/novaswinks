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
  Settings2,
  Star,
  UserRound,
} from "lucide-react";

import { WinkCard } from "@/components/WinkCard";
import { WinkPreviewDialog } from "@/components/WinkPreviewDialog";
import {
  chatWinkCategoryOrder,
  chatWinks,
  fullscreenWinkCategoryOrder,
  fullscreenWinks,
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

const sidebarItems = [
  { label: "WINK STUDIO", icon: Star, active: true },
  { label: "CHAT WINKS", icon: MessageSquare },
  { label: "FULL BINGO WINKS", icon: Monitor },
  { label: "FAVORITES", icon: Heart },
  { label: "DOWNLOADS", icon: Download },
  { label: "CATEGORIES", icon: LayoutGrid },
  { label: "SETTINGS", icon: Settings2 },
  { label: "HELP", icon: LifeBuoy },
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
  const hasFullscreenWinks = fullscreenWinks.length > 0;

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
            <h1 className="studio-brand-title">TR HUNTER</h1>
            <p className="studio-brand-subtitle">WINK STUDIO</p>
          </div>

          <nav className="studio-sidebar-nav">
            {sidebarItems.map(({ label, icon: Icon, active }) => (
              <a
                key={label}
                href={label === "CHAT WINKS" ? "#chat-winks" : label === "FULL BINGO WINKS" ? "#fullscreen-winks" : "#"}
                className={`studio-sidebar-link ${active ? "is-active" : ""}`}
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
            <p className="studio-sidebar-promo-title">TR HUNTER</p>
            <p className="studio-sidebar-promo-copy">PREMIUM PLATFORM</p>
          </div>
        </aside>

        <div className="studio-main-area">
          <header className="studio-topbar">
            <div className="studio-mobile-brand">
              <p className="studio-brand-title">TR HUNTER</p>
              <p className="studio-brand-subtitle">WINK STUDIO</p>
            </div>

            <div className="ml-auto flex items-center gap-3">
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

                <button type="button" className="studio-sort-button">
                  Mais recentes
                  <ChevronDown className="h-4 w-4" />
                </button>
              </div>

              <div className="studio-filter-row">
                <button type="button" className="studio-filter-pill is-active">
                  TODOS
                </button>
                {chatWinkCategoryOrder.map((category) => (
                  <button key={category} type="button" className="studio-filter-pill">
                    {category}
                  </button>
                ))}
              </div>

              <div className="chat-gallery-grid">
                {chatWinks.map((asset) => (
                  <WinkCard
                    key={asset.id}
                    id={asset.id}
                    title={asset.name}
                    type="CHAT WINK"
                    format={asset.format}
                    resolution={asset.resolution}
                    preview={asset.previewPath}
                    hoverPreviewUrl={asset.filePath}
                    autoplayPreviewOnHover
                    downloadUrl={asset.filePath}
                    downloadLabel="BAIXAR APNG"
                    accentColor={asset.accent}
                    className="chat-wink-card"
                    onOpenPreview={() => setSelectedAsset(asset)}
                  />
                ))}
              </div>

              <div className="studio-slider-dots" aria-hidden="true">
                <span className="is-active" />
                <span />
                <span />
                <span />
                <span />
                <span />
              </div>
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
                  <button type="button" className="studio-filter-pill is-active">
                    TODOS
                  </button>
                  {fullscreenWinkCategoryOrder.map((category) => (
                    <button key={category} type="button" className="studio-filter-pill">
                      {category}
                    </button>
                  ))}
                </div>
              ) : null}

              <div className="fullscreen-gallery-grid">
                {hasFullscreenWinks ? (
                  <>
                    {fullscreenWinks.map((asset) => (
                      <WinkCard
                        key={asset.id}
                        id={asset.id}
                        title={asset.name}
                        type="FULL BINGO WINK"
                        format={asset.format}
                        resolution={asset.resolution}
                        preview={asset.previewPath}
                        lottiePreviewUrl={asset.filePath}
                        lottieStartAtProgress={asset.previewStartProgress}
                        downloadUrl={asset.filePath}
                        downloadLabel="BAIXAR JSON"
                        accentColor={asset.accent}
                        className="fullscreen-wink-card"
                        onOpenPreview={() => setSelectedAsset(asset)}
                      />
                    ))}

                    <article className="more-effects-card">
                      <div className="more-effects-card-icon">
                        <Plus className="h-7 w-7" />
                      </div>
                      <p className="more-effects-card-title">MAIS EFEITOS</p>
                      <p className="more-effects-card-copy">Novos efeitos incriveis em breve!</p>
                    </article>
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
              <span>TR HUNTER WINK STUDIO</span>
              <span>PREMIUM EFFECTS FOR PREMIUM PLAYERS</span>
            </footer>
          </div>
        </div>
      </div>

      <WinkPreviewDialog asset={selectedAsset} onOpenChange={(open) => !open && setSelectedAsset(null)} />
    </main>
  );
};

export default Index;
