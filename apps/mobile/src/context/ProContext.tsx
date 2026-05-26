import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import { getIsPro } from "../purchases";

interface ProContextValue {
  isPro: boolean;
  /** Call after a successful purchase or restore to refresh entitlement status. */
  refreshPro: () => Promise<void>;
}

const ProContext = createContext<ProContextValue>({
  isPro: false,
  refreshPro: async () => {},
});

export function ProProvider({ children }: { children: React.ReactNode }) {
  const [isPro, setIsPro] = useState(false);

  const refreshPro = useCallback(async () => {
    const result = await getIsPro();
    setIsPro(result);
  }, []);

  // Check entitlement on mount (covers returning users with active subs).
  useEffect(() => {
    refreshPro();
  }, [refreshPro]);

  return (
    <ProContext.Provider value={{ isPro, refreshPro }}>
      {children}
    </ProContext.Provider>
  );
}

/** Use this hook anywhere in the app to read isPro or trigger a refresh. */
export function usePro(): ProContextValue {
  return useContext(ProContext);
}
