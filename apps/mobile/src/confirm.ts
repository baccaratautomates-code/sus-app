import { Alert, Platform } from "react-native";

interface ConfirmOptions {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
}

// Cross-platform confirm dialog. React Native's Alert.alert(title, msg, buttons)
// does NOT work on react-native-web — it falls back to window.alert() which
// only renders an OK button, and the custom buttons + onPress callbacks are
// silently dropped. That's why our prior "Sign out" prompt looked like it
// didn't do anything. Use window.confirm on web, real Alert on native.
export async function confirm(opts: ConfirmOptions): Promise<boolean> {
  if (Platform.OS === "web") {
    return window.confirm(`${opts.title}\n\n${opts.message}`);
  }
  return new Promise((resolve) => {
    Alert.alert(
      opts.title,
      opts.message,
      [
        {
          text: opts.cancelLabel ?? "Cancel",
          style: "cancel",
          onPress: () => resolve(false),
        },
        {
          text: opts.confirmLabel ?? "Confirm",
          style: opts.destructive ? "destructive" : "default",
          onPress: () => resolve(true),
        },
      ],
      { onDismiss: () => resolve(false), cancelable: true },
    );
  });
}
