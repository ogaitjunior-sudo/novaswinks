import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { WinkCard } from "@/components/WinkCard";

describe("WinkCard", () => {
  it("renders the reusable prop-driven card and routes PREVIEW to the larger preview flow", () => {
    const onOpenPreview = vi.fn();

    render(
      <WinkCard
        title="Mega Finale"
        type="FULL BINGO WINK"
        format={["LOTTIE", "JSON"]}
        resolution="1920x1024"
        preview="/previews/fullscreen/trh-bingo-mega-finale.png"
        downloadUrl="/winks/fullscreen/trh-bingo-mega-finale.json"
        onOpenPreview={onOpenPreview}
      />,
    );

    expect(screen.getAllByText("Mega Finale").length).toBeGreaterThan(0);
    expect(screen.getByText(/FULL BINGO WINK/i)).toBeInTheDocument();
    expect(screen.getAllByText("LOTTIE").length).toBeGreaterThan(0);
    expect(screen.getAllByText("JSON").length).toBeGreaterThan(0);
    expect(screen.getByText("1920x1024")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Play preview for Mega Finale" }));
    expect(onOpenPreview).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "PREVIEW" }));
    expect(onOpenPreview).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("link", { name: "BAIXAR" })).toHaveAttribute(
      "href",
      "/winks/fullscreen/trh-bingo-mega-finale.json",
    );
  });

  it("renders the APNG animated preview immediately and lets PLAY restart it", () => {
    render(
      <WinkCard
        title="Bingo Jackpot Explosion"
        type="CHAT WINK"
        format="APNG"
        resolution="768x1024"
        preview="/previews/chat/trh-chat-bingo-jackpot-explosion.png"
        hoverPreviewUrl="/winks/chat/trh-chat-bingo-jackpot-explosion.apng"
        autoplayPreviewOnHover
        downloadUrl="/winks/chat/trh-chat-bingo-jackpot-explosion.apng"
      />,
    );

    expect(screen.getByAltText("Bingo Jackpot Explosion preview")).toHaveAttribute(
      "src",
      "/winks/chat/trh-chat-bingo-jackpot-explosion.apng?preview=0",
    );
    expect(screen.queryByAltText("Bingo Jackpot Explosion preview snapshot")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Play preview for Bingo Jackpot Explosion" }));

    expect(screen.getByAltText("Bingo Jackpot Explosion preview")).toHaveAttribute(
      "src",
      "/winks/chat/trh-chat-bingo-jackpot-explosion.apng?preview=1",
    );
  });
});
