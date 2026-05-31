import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { isOnboarded, markOnboarded } from "../storage";

interface OnboardedState {
  // null while we're loading the persisted flag from AsyncStorage.
  onboarded: boolean | null;
  markComplete: () => Promise<void>;
}

const OnboardedContext = createContext<OnboardedState | undefined>(undefined);

export function OnboardedProvider({ children }: { children: ReactNode }) {
  const [onboarded, setOnboarded] = useState<boolean | null>(null);

  // Device-wide flag — read once at boot. Onboarding shows before sign-in,
  // so we can't key off user ID; a new user on the same device skips the
  // carousel if anyone already completed it on this browser/install.
  useEffect(() => {
    let cancelled = false;
    isOnboarded().then((flag) => {
      if (!cancelled) setOnboarded(flag);
    });
    return () => { cancelled = true; };
  }, []);

  const value = useMemo<OnboardedState>(
    () => ({
      onboarded,
      markComplete: async () => {
        await markOnboarded();
        setOnboarded(true);
      },
    }),
    [onboarded],
  );

  return (
    <OnboardedContext.Provider value={value}>
      {children}
    </OnboardedContext.Provider>
  );
}

export function useOnboarded(): OnboardedState {
  const ctx = useContext(OnboardedContext);
  if (!ctx) throw new Error("useOnboarded must be used inside <OnboardedProvider>");
  return ctx;
}
