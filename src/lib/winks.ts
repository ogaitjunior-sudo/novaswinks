export type WinkCategory = "chat" | "fullscreen";
export type WinkFormatBadge = "APNG" | "LOTTIE" | "JSON";
export type WinkFormatInput = WinkFormatBadge | WinkFormatBadge[] | string;
export type WinkResolution = "768x1024" | "1920x1024";
export type ChatWinkCategory =
  | "Confetti"
  | "Hearts"
  | "Fireworks"
  | "Bingo Balls"
  | "Lucky Effects";
export type FullscreenWinkCategory = "Celebration" | "Bingo!";

export type WinkAsset = {
  id: string;
  name: string;
  category: WinkCategory;
  chatCategory?: ChatWinkCategory;
  fullscreenCategory?: FullscreenWinkCategory;
  format: WinkFormatBadge[];
  resolution: WinkResolution;
  description: string;
  filePath: string;
  previewPath: string;
  folderPath: string;
  previewFolderPath: string;
  accent: string;
  surfaceClass: string;
  badgeClass: string;
  eyebrow: string;
  previewStartProgress?: number;
};

export const winkLibrary: WinkAsset[] = [
  {
    id: "trh-chat-bingo-confetti-storm",
    name: "Bingo Confetti Storm",
    category: "chat",
    chatCategory: "Confetti",
    format: ["APNG"],
    resolution: "768x1024",
    description: "Explosao de confete nitida com particulas girando, faixas coloridas e ouro premium para chat celebrations.",
    filePath: "/winks/chat/trh-chat-bingo-confetti-storm.apng",
    previewPath: "/previews/chat/trh-chat-bingo-confetti-storm.png",
    folderPath: "public/winks/chat",
    previewFolderPath: "public/previews/chat",
    accent: "#f5c65b",
    surfaceClass: "from-[#2d153b] via-[#140b22] to-[#050816]",
    badgeClass: "border-[#f5c65b]/30 bg-[#f5c65b]/10 text-[#fde7a4]",
    eyebrow: "Confetti storm",
  },
  {
    id: "trh-chat-golden-heart-rain",
    name: "Golden Heart Rain",
    category: "chat",
    chatCategory: "Hearts",
    format: ["APNG"],
    resolution: "768x1024",
    description: "Coracoes dourados em camadas com brilho suave, profundidade real e ritmo romantico premium.",
    filePath: "/winks/chat/trh-chat-golden-heart-rain.apng",
    previewPath: "/previews/chat/trh-chat-golden-heart-rain.png",
    folderPath: "public/winks/chat",
    previewFolderPath: "public/previews/chat",
    accent: "#f5c65b",
    surfaceClass: "from-[#4a1035] via-[#170f24] to-[#08101a]",
    badgeClass: "border-[#f5c65b]/30 bg-[#f5c65b]/10 text-[#fff0c2]",
    eyebrow: "Golden hearts",
  },
  {
    id: "trh-chat-firework-impact",
    name: "Firework Impact",
    category: "chat",
    chatCategory: "Fireworks",
    format: ["APNG"],
    resolution: "768x1024",
    description: "Fogos com centro de impacto forte, trilhas brilhantes e leitura instantanea de vitoria energetica.",
    filePath: "/winks/chat/trh-chat-firework-impact.apng",
    previewPath: "/previews/chat/trh-chat-firework-impact.png",
    folderPath: "public/winks/chat",
    previewFolderPath: "public/previews/chat",
    accent: "#58c7ff",
    surfaceClass: "from-[#0d1c4f] via-[#10142b] to-[#07101a]",
    badgeClass: "border-[#58c7ff]/30 bg-[#58c7ff]/10 text-[#d0f2ff]",
    eyebrow: "Impact burst",
  },
  {
    id: "trh-chat-bingo-ball-chaos",
    name: "Bingo Ball Chaos",
    category: "chat",
    chatCategory: "Bingo Balls",
    format: ["APNG"],
    resolution: "768x1024",
    description: "Bolas glossy numeradas com colisao visual, motion blur limpo e movimento social de alta energia.",
    filePath: "/winks/chat/trh-chat-bingo-ball-chaos.apng",
    previewPath: "/previews/chat/trh-chat-bingo-ball-chaos.png",
    folderPath: "public/winks/chat",
    previewFolderPath: "public/previews/chat",
    accent: "#a7ff5a",
    surfaceClass: "from-[#2f3d10] via-[#101a14] to-[#08101a]",
    badgeClass: "border-[#a7ff5a]/30 bg-[#a7ff5a]/10 text-[#e4ffc6]",
    eyebrow: "Ball chaos",
  },
  {
    id: "trh-chat-jackpot-pop",
    name: "Jackpot Pop",
    category: "chat",
    chatCategory: "Lucky Effects",
    format: ["APNG"],
    resolution: "768x1024",
    description: "Burst rapido de moedas com flashes de jackpot, ouro vibrante e energia de premio instantanea.",
    filePath: "/winks/chat/trh-chat-jackpot-pop.apng",
    previewPath: "/previews/chat/trh-chat-jackpot-pop.png",
    folderPath: "public/winks/chat",
    previewFolderPath: "public/previews/chat",
    accent: "#f5c65b",
    surfaceClass: "from-[#0a3f31] via-[#101828] to-[#061019]",
    badgeClass: "border-[#f5c65b]/30 bg-[#f5c65b]/10 text-[#fff0c2]",
    eyebrow: "Jackpot burst",
  },
  {
    id: "trh-chat-prism-confetti-rush",
    name: "Prism Confetti Rush",
    category: "chat",
    chatCategory: "Confetti",
    format: ["APNG"],
    resolution: "768x1024",
    description: "Rajada lateral de confete premium com dupla explosao, streamers vivos e leitura forte para chat hype.",
    filePath: "/winks/chat/trh-chat-prism-confetti-rush.apng",
    previewPath: "/previews/chat/trh-chat-prism-confetti-rush.png",
    folderPath: "public/winks/chat",
    previewFolderPath: "public/previews/chat",
    accent: "#58c7ff",
    surfaceClass: "from-[#2a1247] via-[#140b23] to-[#07101a]",
    badgeClass: "border-[#58c7ff]/30 bg-[#58c7ff]/10 text-[#d0f2ff]",
    eyebrow: "Prism confetti",
  },
  {
    id: "trh-chat-neon-streamer-drop",
    name: "Neon Streamer Drop",
    category: "chat",
    chatCategory: "Confetti",
    format: ["APNG"],
    resolution: "768x1024",
    description: "Queda vertical de streamers e confete fino para mensagens com vibe social, rapida e premium.",
    filePath: "/winks/chat/trh-chat-neon-streamer-drop.apng",
    previewPath: "/previews/chat/trh-chat-neon-streamer-drop.png",
    folderPath: "public/winks/chat",
    previewFolderPath: "public/previews/chat",
    accent: "#8f5bff",
    surfaceClass: "from-[#321351] via-[#130b22] to-[#061018]",
    badgeClass: "border-[#8f5bff]/30 bg-[#8f5bff]/10 text-[#ebddff]",
    eyebrow: "Streamer drop",
  },
  {
    id: "trh-chat-velvet-heart-pulse",
    name: "Velvet Heart Pulse",
    category: "chat",
    chatCategory: "Hearts",
    format: ["APNG"],
    resolution: "768x1024",
    description: "Pulso central de coracoes glossy com halo romantico, orbitas suaves e acabamento social premium.",
    filePath: "/winks/chat/trh-chat-velvet-heart-pulse.apng",
    previewPath: "/previews/chat/trh-chat-velvet-heart-pulse.png",
    folderPath: "public/winks/chat",
    previewFolderPath: "public/previews/chat",
    accent: "#ff63c7",
    surfaceClass: "from-[#481235] via-[#170f24] to-[#07101a]",
    badgeClass: "border-[#ff63c7]/30 bg-[#ff63c7]/10 text-[#ffe0f2]",
    eyebrow: "Heart pulse",
  },
  {
    id: "trh-chat-cupid-spark-drift",
    name: "Cupid Spark Drift",
    category: "chat",
    chatCategory: "Hearts",
    format: ["APNG"],
    resolution: "768x1024",
    description: "Fluxo diagonal de coracoes pequenos com glints e rastros leves para reacoes calorosas e modernas.",
    filePath: "/winks/chat/trh-chat-cupid-spark-drift.apng",
    previewPath: "/previews/chat/trh-chat-cupid-spark-drift.png",
    folderPath: "public/winks/chat",
    previewFolderPath: "public/previews/chat",
    accent: "#f5c65b",
    surfaceClass: "from-[#3f1234] via-[#150f22] to-[#061019]",
    badgeClass: "border-[#f5c65b]/30 bg-[#f5c65b]/10 text-[#fff0c2]",
    eyebrow: "Cupid drift",
  },
  {
    id: "trh-chat-starlight-rocket-pop",
    name: "Starlight Rocket Pop",
    category: "chat",
    chatCategory: "Fireworks",
    format: ["APNG"],
    resolution: "768x1024",
    description: "Sequencia de foguetes nitidos com burst brilhante e leitura imediata de celebracao energetica.",
    filePath: "/winks/chat/trh-chat-starlight-rocket-pop.apng",
    previewPath: "/previews/chat/trh-chat-starlight-rocket-pop.png",
    folderPath: "public/winks/chat",
    previewFolderPath: "public/previews/chat",
    accent: "#ff8f45",
    surfaceClass: "from-[#30204c] via-[#11142c] to-[#06101b]",
    badgeClass: "border-[#ff8f45]/30 bg-[#ff8f45]/10 text-[#ffe4d2]",
    eyebrow: "Rocket pop",
  },
  {
    id: "trh-chat-aurora-mini-fireworks",
    name: "Aurora Mini Fireworks",
    category: "chat",
    chatCategory: "Fireworks",
    format: ["APNG"],
    resolution: "768x1024",
    description: "Coroa de mini fogos coloridos para chats premium com transparencia limpa e brilho controlado.",
    filePath: "/winks/chat/trh-chat-aurora-mini-fireworks.apng",
    previewPath: "/previews/chat/trh-chat-aurora-mini-fireworks.png",
    folderPath: "public/winks/chat",
    previewFolderPath: "public/previews/chat",
    accent: "#12f7d6",
    surfaceClass: "from-[#1a2a4f] via-[#10132b] to-[#051019]",
    badgeClass: "border-[#12f7d6]/30 bg-[#12f7d6]/10 text-[#c8fff8]",
    eyebrow: "Aurora fireworks",
  },
  {
    id: "trh-chat-lucky-ball-parade",
    name: "Lucky Ball Parade",
    category: "chat",
    chatCategory: "Bingo Balls",
    format: ["APNG"],
    resolution: "768x1024",
    description: "Desfile de bingo balls glossy subindo em camadas com trilhas limpas e energia divertida de jogo.",
    filePath: "/winks/chat/trh-chat-lucky-ball-parade.apng",
    previewPath: "/previews/chat/trh-chat-lucky-ball-parade.png",
    folderPath: "public/winks/chat",
    previewFolderPath: "public/previews/chat",
    accent: "#a7ff5a",
    surfaceClass: "from-[#254614] via-[#101a14] to-[#071019]",
    badgeClass: "border-[#a7ff5a]/30 bg-[#a7ff5a]/10 text-[#e4ffc6]",
    eyebrow: "Ball parade",
  },
  {
    id: "trh-chat-turbo-ball-bounce",
    name: "Turbo Ball Bounce",
    category: "chat",
    chatCategory: "Bingo Balls",
    format: ["APNG"],
    resolution: "768x1024",
    description: "Bolas numeradas com quique turbo, impactos brilhantes e movimento rapido de alta legibilidade.",
    filePath: "/winks/chat/trh-chat-turbo-ball-bounce.apng",
    previewPath: "/previews/chat/trh-chat-turbo-ball-bounce.png",
    folderPath: "public/winks/chat",
    previewFolderPath: "public/previews/chat",
    accent: "#58c7ff",
    surfaceClass: "from-[#16354a] via-[#0f1729] to-[#061019]",
    badgeClass: "border-[#58c7ff]/30 bg-[#58c7ff]/10 text-[#d0f2ff]",
    eyebrow: "Turbo bounce",
  },
  {
    id: "trh-chat-clover-starfall",
    name: "Clover Starfall",
    category: "chat",
    chatCategory: "Lucky Effects",
    format: ["APNG"],
    resolution: "768x1024",
    description: "Trevos brilhantes com starfall premium para momentos lucky, bonus drops e reacoes otimistas.",
    filePath: "/winks/chat/trh-chat-clover-starfall.apng",
    previewPath: "/previews/chat/trh-chat-clover-starfall.png",
    folderPath: "public/winks/chat",
    previewFolderPath: "public/previews/chat",
    accent: "#12f7d6",
    surfaceClass: "from-[#13363a] via-[#0d1526] to-[#061019]",
    badgeClass: "border-[#12f7d6]/30 bg-[#12f7d6]/10 text-[#c8fff8]",
    eyebrow: "Lucky clovers",
  },
  {
    id: "trh-chat-bonus-spark-shower",
    name: "Bonus Spark Shower",
    category: "chat",
    chatCategory: "Lucky Effects",
    format: ["APNG"],
    resolution: "768x1024",
    description: "Chuva de moedas e sparks premium com energia de bonus instantaneo para chats de alto impacto.",
    filePath: "/winks/chat/trh-chat-bonus-spark-shower.apng",
    previewPath: "/previews/chat/trh-chat-bonus-spark-shower.png",
    folderPath: "public/winks/chat",
    previewFolderPath: "public/previews/chat",
    accent: "#f5c65b",
    surfaceClass: "from-[#0f3a3f] via-[#101828] to-[#061019]",
    badgeClass: "border-[#f5c65b]/30 bg-[#f5c65b]/10 text-[#fff0c2]",
    eyebrow: "Bonus shower",
  },
  {
    id: "trh-full-party-blast",
    name: "Party Blast",
    category: "fullscreen",
    fullscreenCategory: "Celebration",
    format: ["LOTTIE", "JSON"],
    resolution: "1920x1024",
    description: "Confetti explosion fullscreen com party horns, ribbons e sparkles premium em um sticker de celebracao limpo e expressivo.",
    filePath: "/winks/fullscreen/trh-full-party-blast.json",
    previewPath: "/previews/fullscreen/trh-full-party-blast.png",
    folderPath: "public/winks/fullscreen",
    previewFolderPath: "public/previews/fullscreen",
    accent: "#ff4fd8",
    surfaceClass: "from-[#321238] via-[#101428] to-[#050816]",
    badgeClass: "border-[#ff4fd8]/30 bg-[#ff4fd8]/10 text-[#ffe0f6]",
    eyebrow: "Celebration sticker",
    previewStartProgress: 0.04,
  },
  {
    id: "trh-full-fullscreen-festival",
    name: "Fullscreen Festival",
    category: "fullscreen",
    fullscreenCategory: "Celebration",
    format: ["LOTTIE", "JSON"],
    resolution: "1920x1024",
    description: "Ribbon sweeps fullscreen com confetti waves laterais, horns elegantes e glow festivo de leitura imediata.",
    filePath: "/winks/fullscreen/trh-full-fullscreen-festival.json",
    previewPath: "/previews/fullscreen/trh-full-fullscreen-festival.png",
    folderPath: "public/winks/fullscreen",
    previewFolderPath: "public/previews/fullscreen",
    accent: "#58c7ff",
    surfaceClass: "from-[#24123a] via-[#0f152b] to-[#050816]",
    badgeClass: "border-[#58c7ff]/30 bg-[#58c7ff]/10 text-[#d7f4ff]",
    eyebrow: "Ribbon festival",
    previewStartProgress: 0.02,
  },
  {
    id: "trh-full-exploding-bingo-balls",
    name: "Exploding Bingo Balls",
    category: "fullscreen",
    fullscreenCategory: "Bingo!",
    format: ["LOTTIE", "JSON"],
    resolution: "1920x1024",
    description: "Cluster de bingo balls comprimindo no centro e explodindo para fora com shockwave dourada e sparkles de jackpot.",
    filePath: "/winks/fullscreen/trh-full-exploding-bingo-balls.json",
    previewPath: "/previews/fullscreen/trh-full-exploding-bingo-balls.png",
    folderPath: "public/winks/fullscreen",
    previewFolderPath: "public/previews/fullscreen",
    accent: "#f5c65b",
    surfaceClass: "from-[#17264d] via-[#0b1327] to-[#050816]",
    badgeClass: "border-[#f5c65b]/30 bg-[#f5c65b]/10 text-[#fff0c2]",
    eyebrow: "Bingo jackpot burst",
    previewStartProgress: 0.03,
  },
];

export const chatWinks = winkLibrary.filter((asset) => asset.category === "chat");

export const fullscreenWinks = winkLibrary.filter((asset) => asset.category === "fullscreen");

export const chatWinkCategoryOrder: ChatWinkCategory[] = [
  "Confetti",
  "Hearts",
  "Fireworks",
  "Bingo Balls",
  "Lucky Effects",
];

export const chatWinkCategoryMeta: Record<
  ChatWinkCategory,
  { accent: string; description: string; vibe: string }
> = {
  Confetti: {
    accent: "#f5c65b",
    description: "Playful blasts for instant chat hype and lightweight celebration moments.",
    vibe: "Fun and bright",
  },
  Hearts: {
    accent: "#ff6ec7",
    description: "Social-first affection drops tuned for friendship, VIP warmth, and quick reactions.",
    vibe: "Warm and social",
  },
  Fireworks: {
    accent: "#58c7ff",
    description: "Fast-impact sparkle moments that read clearly even in busy mobile chat streams.",
    vibe: "Fast and flashy",
  },
  "Bingo Balls": {
    accent: "#a7ff5a",
    description: "Game-native motion language that keeps the bingo identity front and center.",
    vibe: "Playful and native",
  },
  "Lucky Effects": {
    accent: "#12f7d6",
    description: "Quick luck cues for bonus drops, streak nudges, and optimistic social energy.",
    vibe: "Light and lucky",
  },
};

export const fullscreenWinkCategoryOrder: FullscreenWinkCategory[] = ["Celebration", "Bingo!"];

export const fullscreenWinkCategoryMeta: Record<
  FullscreenWinkCategory,
  { accent: string; description: string; vibe: string }
> = {
  Celebration: {
    accent: "#ff4fd8",
    description: "Fullscreen party stickers com confetti, horns, ribbons e sparkles premium para celebracoes grandes.",
    vibe: "Festive and iconic",
  },
  "Bingo!": {
    accent: "#f5c65b",
    description: "Jackpot stickers de bingo com hero balls, glow dourado e impacto limpo de cassino premium.",
    vibe: "Explosive and focused",
  },
};

export const normalizeWinkFormats = (format: WinkFormatInput): WinkFormatBadge[] => {
  if (Array.isArray(format)) {
    return [...new Set(format.map((value) => value.toUpperCase() as WinkFormatBadge))];
  }

  const tokenMap: Array<{ token: string; badge: WinkFormatBadge }> = [
    { token: "APNG", badge: "APNG" },
    { token: "LOTTIE", badge: "LOTTIE" },
    { token: "JSON", badge: "JSON" },
  ];

  const normalized = format.toUpperCase();

  return tokenMap
    .filter(({ token }) => normalized.includes(token))
    .map(({ badge }) => badge);
};

export const getWinkFormatLabel = (format: WinkFormatInput) =>
  normalizeWinkFormats(format).join(" / ");
