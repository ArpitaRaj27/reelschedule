import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { makeQueryClient } from "../src/App";
import { AuthProvider } from "../src/lib/auth";
import { SignInPage } from "../src/pages/SignIn";
import { json, mockFetch } from "./fixtures";

// HW5 Task 7, found with the keyboard and not by axe: the Sign in button was disabled until 20 characters (so Tab
// skipped it and nothing said why), disabling it while "Checking…" dropped focus to <body>, and the error was not
// tied to the field.
function renderSignIn(routes: Parameters<typeof mockFetch>[0] = {}) {
  const mock = mockFetch(routes);
  vi.stubGlobal("fetch", mock.fn);
  render(
    <QueryClientProvider client={makeQueryClient()}>
      <AuthProvider>
        <MemoryRouter initialEntries={["/sign-in"]}>
          <SignInPage />
        </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>,
  );
  return mock;
}

describe("sign-in form with the keyboard", () => {
  it("keeps the button reachable and explains a token that is too short", async () => {
    renderSignIn();
    const user = userEvent.setup();
    const field = screen.getByLabelText("Access token");
    await user.click(field);
    await user.keyboard("short");
    await user.tab();
    const button = screen.getByRole("button", { name: "Sign in" });
    expect(button).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(field).toHaveFocus();
    expect(field).toHaveAttribute("aria-invalid", "true");
    expect(field).toHaveAccessibleDescription(/too short to be a token/);
  });

  it("keeps focus on the page when the server rejects the token, and ties the error to the field", async () => {
    renderSignIn({
      "GET /api/me": () => json({ error: { code: "invalid_token", message: "No identity provider is configured on this server" } }, 401),
    });
    const user = userEvent.setup();
    const field = screen.getByLabelText("Access token");
    await user.click(field);
    await user.keyboard("not-a-real-token-just-testing-123");
    await user.tab();
    await user.keyboard("{Enter}");
    expect(await screen.findByText(/That token wasn't accepted/)).toBeInTheDocument();
    expect(field).toHaveFocus();
    expect(document.activeElement).not.toBe(document.body);
    expect(field).toHaveAttribute("aria-invalid", "true");
    expect(field).toHaveAccessibleDescription(
      "That token wasn't accepted. The server said: No identity provider is configured on this server. Kept for this browser tab only and cleared when you sign out.",
    );
    expect(screen.getByRole("button", { name: "Sign in" })).not.toBeDisabled();
  });
});
