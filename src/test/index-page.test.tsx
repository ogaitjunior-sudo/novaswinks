import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { chatWinks, fullscreenWinkCategoryOrder, fullscreenWinks } from "@/lib/winks";
import Index from "@/pages/Index";

describe("Index page", () => {
  it("renders the active chat and fullscreen wink lanes", () => {
    render(<Index />);
    const defaultFullscreenWinks = fullscreenWinks.filter((asset) => !asset.audioPath);

    expect(screen.getAllByText("Gabriel e Oscar").length).toBeGreaterThan(0);
    expect(screen.getAllByText("CHAT WINKS").length).toBeGreaterThan(0);
    expect(screen.getAllByText("FULL BINGO WINKS").length).toBeGreaterThan(0);

    for (const asset of [...chatWinks, ...defaultFullscreenWinks]) {
      expect(screen.getAllByText(asset.name).length).toBeGreaterThan(0);
    }

    expect(chatWinks.length).toBeGreaterThan(0);
    expect(fullscreenWinks.length).toBeGreaterThan(0);
    expect(screen.queryByText("EM CONSTRUÇÃO")).not.toBeInTheDocument();
    expect(screen.queryByText("EM RECONSTRUCAO")).not.toBeInTheDocument();

    const totalEffects = chatWinks.length + defaultFullscreenWinks.length;
    expect(screen.getAllByRole("button", { name: "PREVIEW" })).toHaveLength(totalEffects);
    expect(screen.getAllByRole("link", { name: /BAIXAR/i })).toHaveLength(totalEffects);
  }, 60000);

  it("filters fullscreen effects by selected category", () => {
    render(<Index />);

    const category = fullscreenWinkCategoryOrder.find((entry) => entry !== "Celebration") ?? "Golden Stars";
    fireEvent.click(screen.getByRole("button", { name: category }));

    const expectedAssets = fullscreenWinks.filter((asset) => asset.fullscreenCategory === category);
    const hiddenAssets = fullscreenWinks.filter((asset) => asset.fullscreenCategory !== category);
    const fullscreenSection = document.querySelector("#fullscreen-winks");
    expect(fullscreenSection).toBeInTheDocument();
    const fullscreenQueries = within(fullscreenSection as HTMLElement);

    expect(expectedAssets.length).toBeGreaterThan(0);
    for (const asset of expectedAssets) {
      expect(fullscreenQueries.getAllByText(asset.name).length).toBeGreaterThan(0);
    }
    for (const asset of hiddenAssets) {
      expect(fullscreenQueries.queryAllByText(asset.name)).toHaveLength(0);
    }
    expect(fullscreenQueries.queryByText("MAIS EFEITOS")).not.toBeInTheDocument();

    fireEvent.click(fullscreenQueries.getByRole("button", { name: "TODOS" }));
    for (const asset of fullscreenWinks.filter((entry) => !entry.audioPath)) {
      expect(fullscreenQueries.getAllByText(asset.name).length).toBeGreaterThan(0);
    }
  }, 20000);

  it("toggles favorites from wink cards", () => {
    render(<Index />);

    const favoriteButton = screen.getByRole("button", { name: `Favorite ${chatWinks[0].name}` });
    expect(favoriteButton).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(favoriteButton);
    expect(favoriteButton).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(screen.getByRole("link", { name: /FAVORITES/i }));
    expect(screen.getAllByText(chatWinks[0].name).length).toBeGreaterThan(0);
  }, 20000);
});
