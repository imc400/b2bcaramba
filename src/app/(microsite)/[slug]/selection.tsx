"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

/** Ítem elegido: snapshot mínimo para pintar el carrito sin re-fetch. */
export type SelectedItem = {
  variantId: number;
  productId: number;
  title: string;
  vendor: string | null;
  imageUrl: string | null;
  ageTag: string | null;
};

type SelectionContextValue = {
  items: SelectedItem[];
  quota: number;
  isSelected: (variantId: number) => boolean;
  toggle: (item: SelectedItem) => "added" | "removed" | "quota_full";
  remove: (variantId: number) => void;
  clear: () => void;
};

const SelectionContext = createContext<SelectionContextValue | null>(null);

export function SelectionProvider({
  campaignId,
  quota,
  children,
}: {
  campaignId: string;
  quota: number;
  children: ReactNode;
}) {
  const storageKey = `caramba-sel-${campaignId}`;
  const [items, setItems] = useState<SelectedItem[]>([]);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    // Carga desde localStorage tras hidratar: no puede ser useState inicial
    // porque el primer render (SSR) no tiene acceso a storage.
    try {
      const raw = localStorage.getItem(storageKey);
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (raw) setItems(JSON.parse(raw));
    } catch {
      /* storage corrupto: partir de cero */
    }
    setHydrated(true);
  }, [storageKey]);

  useEffect(() => {
    if (hydrated) localStorage.setItem(storageKey, JSON.stringify(items));
  }, [items, hydrated, storageKey]);

  const isSelected = useCallback(
    (variantId: number) => items.some((i) => i.variantId === variantId),
    [items],
  );

  const toggle = useCallback(
    (item: SelectedItem): "added" | "removed" | "quota_full" => {
      if (items.some((i) => i.variantId === item.variantId)) {
        setItems((prev) => prev.filter((i) => i.variantId !== item.variantId));
        return "removed";
      }
      if (items.length >= quota) return "quota_full";
      setItems((prev) => [...prev, item]);
      return "added";
    },
    [items, quota],
  );

  const remove = useCallback((variantId: number) => {
    setItems((prev) => prev.filter((i) => i.variantId !== variantId));
  }, []);

  const clear = useCallback(() => setItems([]), []);

  const value = useMemo(
    () => ({ items, quota, isSelected, toggle, remove, clear }),
    [items, quota, isSelected, toggle, remove, clear],
  );

  return <SelectionContext.Provider value={value}>{children}</SelectionContext.Provider>;
}

export function useSelection(): SelectionContextValue {
  const ctx = useContext(SelectionContext);
  if (!ctx) throw new Error("useSelection debe usarse dentro de SelectionProvider");
  return ctx;
}
