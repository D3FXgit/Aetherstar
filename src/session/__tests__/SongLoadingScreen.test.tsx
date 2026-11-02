import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { SongLoadingScreen } from "../SongLoadingScreen"

describe("SongLoadingScreen", () => {
  it("renders the loading screen with title, artist and status", () => {
    render(
      <SongLoadingScreen
        title="Orbit Seven"
        artist="Mira Castell"
        statusMessage="Preparing stage & audio…"
      />
    )

    expect(screen.getByTestId("song-loading-screen")).toBeInTheDocument()
    expect(screen.getByText("Orbit Seven")).toBeInTheDocument()
    expect(screen.getByText("Mira Castell")).toBeInTheDocument()
    expect(screen.getByText("Preparing stage & audio…")).toBeInTheDocument()
  })

  it("renders cover art when provided", () => {
    render(
      <SongLoadingScreen
        title="Orbit Seven"
        artist="Mira Castell"
        coverUrl="aetherstar-media://roots/thumb.jpg"
      />
    )

    const img = screen.getByRole("img")
    expect(img).toHaveAttribute("src", "aetherstar-media://roots/thumb.jpg")
  })
})
