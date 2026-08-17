import React, { createContext, useContext, useMemo, useState, useCallback } from "react";
import type { SelectedEntity } from "../types";

interface SelectionState {
  /** Currently active entity type key in the picker. */
  typeKey: string;
  setTypeKey: (k: string) => void;
  selected: SelectedEntity[];
  isSelected: (id: string) => boolean;
  toggle: (e: SelectedEntity) => void;
  selectMany: (entities: SelectedEntity[]) => void;
  deselectMany: (ids: string[]) => void;
  clear: () => void;
  /** Entity type keys present in the current selection. */
  selectedTypeKeys: string[];
}

const Ctx = createContext<SelectionState | null>(null);

export const SelectionProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [typeKey, setTypeKey] = useState<string>("service");
  const [selected, setSelected] = useState<SelectedEntity[]>([]);

  const isSelected = useCallback(
    (id: string) => selected.some((e) => e.id === id),
    [selected],
  );

  const toggle = useCallback((e: SelectedEntity) => {
    setSelected((prev) =>
      prev.some((p) => p.id === e.id) ? prev.filter((p) => p.id !== e.id) : [...prev, e],
    );
  }, []);

  const selectMany = useCallback((entities: SelectedEntity[]) => {
    setSelected((prev) => {
      const seen = new Set(prev.map((p) => p.id));
      return [...prev, ...entities.filter((e) => !seen.has(e.id))];
    });
  }, []);

  const deselectMany = useCallback((ids: string[]) => {
    const drop = new Set(ids);
    setSelected((prev) => prev.filter((e) => !drop.has(e.id)));
  }, []);

  const clear = useCallback(() => setSelected([]), []);

  const value = useMemo<SelectionState>(
    () => ({
      typeKey,
      setTypeKey,
      selected,
      isSelected,
      toggle,
      selectMany,
      deselectMany,
      clear,
      selectedTypeKeys: [...new Set(selected.map((e) => e.typeKey))],
    }),
    [typeKey, selected, isSelected, toggle, selectMany, deselectMany, clear],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
};

export function useSelection(): SelectionState {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useSelection must be used inside <SelectionProvider>");
  return ctx;
}
