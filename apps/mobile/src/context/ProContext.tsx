import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import { fetchQuota } from "../store";

interface ProContextValue {
  isPro: boolean;
  /** Call after a successful purchase or restore to refresh entitlement status. */
  refreshPro: () => Promise<void>;
}

const ProContext = createContext<ProContextValue>({
  isPro: false,
  refreshPro: async () => {},
});

// Pro entitlement comes from /me/quota (server-truth), NOT RevenueCat directly.
// The server is the canonical source: it aggregates the is_pro DB flag (which
// the RC webhook flips on real purchases), manual overrides, and the
// BYPASS_USER_IDS allowlist. Reading RC's getIsPro() client-side here would
// only see real-subscription state and miss manual-flip / bypass accounts —
// causing the "Unlimited" quota pill and the Watch button to disagree.
export function ProProvider({ children }: { children: React.ReactNode }) {
  const [isPro, setIsPro] = useState(false);

  const refreshPro = useCallback(async () => {
    const result = await fetchQuota();
    setIsPro(result?.isPro ?? false);
  }, []);

  // Check entitlement on mount + re-check whenever this provider re-mounts
  // (covers sign-out → sign-in cycles that swap users without a full reload).
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
