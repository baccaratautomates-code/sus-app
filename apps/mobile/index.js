// Build-shim entry. Kept as .js because Expo CLI on Windows mangles paths
// inside node_modules into backslash-encoded URLs, and TS extensions
// (.ts/.tsx) get appended to the bundle URL literally and fail to resolve.
// All application code stays in App.tsx and src/.
import "@expo/metro-runtime";
import { registerRootComponent } from "expo";
import App from "./App";

registerRootComponent(App);
