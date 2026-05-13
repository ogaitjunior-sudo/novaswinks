import { act, fireEvent, render, screen } from "@testing-library/react";
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

  it("renders the APNG as a live preview immediately and lets PLAY restart it", () => {
    vi.useFakeTimers();

    try {
      render(
        <WinkCard
          title="Big Heart Formation"
          type="CHAT WINK"
          format="APNG"
          resolution="768x1024"
          preview="/previews/chat/trh-chat-big-heart-formation.png"
          hoverPreviewUrl="/winks/chat/trh-chat-big-heart-formation.apng"
          autoplayPreviewOnHover
          downloadUrl="/winks/chat/trh-chat-big-heart-formation.apng"
        />,
      );

      expect(screen.queryByAltText("Big Heart Formation preview snapshot")).not.toBeInTheDocument();
      const firstRun = screen.getByAltText("Big Heart Formation live preview");
      expect(firstRun).toHaveAttribute("src", "/winks/chat/trh-chat-big-heart-formation.apng?preview=0");

      fireEvent.load(firstRun);
      act(() => {
        vi.advanceTimersByTime(8100);
      });
      expect(screen.queryByAltText("Big Heart Formation live preview")).not.toBeInTheDocument();

      fireEvent.click(screen.getByRole("button", { name: "Play preview for Big Heart Formation" }));

      const restartedRun = screen.getByAltText("Big Heart Formation live preview");
      expect(restartedRun).toHaveAttribute("src", "/winks/chat/trh-chat-big-heart-formation.apng?preview=1");
    } finally {
      vi.useRealTimers();
    }
  });
});
