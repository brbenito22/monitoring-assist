import React from "react";
import { Page, AppHeader } from "@dynatrace/strato-components-preview/layouts";
import { Wizard } from "./pages/Wizard";
import { SelectionProvider } from "./context/SelectionContext";

export const App: React.FC = () => (
  <SelectionProvider>
    <Page>
      <Page.Header>
        <AppHeader>
          <AppHeader.NavItems>
            <AppHeader.AppNavLink href="/" />
          </AppHeader.NavItems>
        </AppHeader>
      </Page.Header>

      <Page.Main>
        <Wizard />
      </Page.Main>
    </Page>
  </SelectionProvider>
);
