import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router/dom";
import { createBrowserRouter } from "react-router";
import { polyfillCountryFlagEmojis } from "country-flag-emoji-polyfill";
import App from "./App.js";
import { installGlobalErrorReporting } from "./globalErrorReporting.js";
import { enableDeferredStylesheets } from "./utils/deferred-styles.js";
import { revealIconsWhenLoaded } from "./utils/icon-font.js";
import countryFlagFontUrl from "./assets/TwemojiCountryFlags.woff2?url";
import "@tabler/icons-webfont/dist/tabler-icons.min.css";
import { syncLoaderClockToSplash } from "@admitto/ui";
import "@admitto/ui/styles.css";
import "@admitto/ui/shell.css";
import "./staff.css";

installGlobalErrorReporting();
polyfillCountryFlagEmojis(undefined, countryFlagFontUrl);

const router = createBrowserRouter([{ path: "*", element: <App /> }]);

const root = document.getElementById("root");
if (!root) throw new Error("Missing #root");

// The build leaves the stylesheets switched off so they do not hold back the splash (build-html.ts).
// Switch them on once they have arrived, then start the app: it never mounts unstyled.
await enableDeferredStylesheets();
// The icon font is declared in that stylesheet; icons stay invisible until it has loaded.
revealIconsWhenLoaded();

// The splash from index.html is still in #root here. Line the loaders' animation clock up with it,
// so the tick keeps drawing when React replaces the splash instead of starting over.
syncLoaderClockToSplash(root);

createRoot(root).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
