import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router/dom";
import { createBrowserRouter } from "react-router";
import { polyfillCountryFlagEmojis } from "country-flag-emoji-polyfill";
import App from "./App.js";
import countryFlagFontUrl from "./assets/TwemojiCountryFlags.woff2?url";
import "@tabler/icons-webfont/dist/tabler-icons.min.css";
import "@admitto/ui/styles.css";
import "@admitto/ui/shell.css";
import "./staff.css";

polyfillCountryFlagEmojis(undefined, countryFlagFontUrl);

const router = createBrowserRouter([{ path: "*", element: <App /> }]);

const root = document.getElementById("root");
if (!root) throw new Error("Missing #root");

createRoot(root).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
