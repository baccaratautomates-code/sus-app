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
  // null while we're loading the persisted flag.
  onboarded: boolean | null;
  markComplete: () => Promise<void>;
}

const OnboardedContext = createContext<OnboardedState | undefined>(undefined);

export function OnboardedProvider({ children }: { children: ReactNode }) {
  const [onboarded, setOnboarded] = useState<boolean | null>(null);

  useEffect(() => {
    isOnboarded().then(setOnboarded);
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
