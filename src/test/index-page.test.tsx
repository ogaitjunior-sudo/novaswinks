import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { chatWinks, fullscreenWinks } from "@/lib/winks";
import Index from "@/pages/Index";

describe("Index page", () => {
  it("renders chat and fullscreen wink lanes with active fullscreen wink effects", () => {
    render(<Index />);

    expect(screen.getAllByText("TR HUNTER").length).toBeGreaterThan(0);
    expect(screen.getAllByText("CHAT WINKS").length).toBeGreaterThan(0);
    expect(screen.getAllByText("FULL BINGO WINKS").length).toBeGreaterThan(0);

    for (const asset of [...chatWinks, ...fullscreenWinks]) {
      expect(screen.getAllByText(asset.name).length).toBeGreaterThan(0);
    }

    expect(fullscreenWinks.length).toBeGreaterThan(0);
    expect(screen.queryByText("EM RECONSTRUCAO")).not.toBeInTheDocument();

    const totalEffects = chatWinks.length + fullscreenWinks.length;
    expect(screen.getAllByRole("button", { name: "PREVIEW" })).toHaveLength(totalEffects);
    expect(screen.getAllByRole("link", { name: /BAIXAR/i })).toHaveLength(totalEffects);
  }, 20000);
});
