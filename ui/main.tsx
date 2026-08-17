import React from "react";
import ReactDOM from "react-dom/client";
import { IntlProvider } from "react-intl";
import { AppRoot } from "@dynatrace/strato-components/core";
import { App } from "./App";

const root = ReactDOM.createRoot(document.getElementById("root") as HTMLElement);

root.render(
  <React.StrictMode>
    <IntlProvider locale="en" defaultLocale="en" messages={{}}>
      <AppRoot>
        <App />
      </AppRoot>
    </IntlProvider>
  </React.StrictMode>,
);
