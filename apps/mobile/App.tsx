import { StatusBar } from "expo-status-bar";
import { StyleSheet, Text, View } from "react-native";

export default function App() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Sus</Text>
      <Text style={styles.subtitle}>Is this product legit?</Text>
      <StatusBar style="auto" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#000",
    alignItems: "center",
    justifyContent: "center",
  },
  title: {
    color: "#fff",
    fontSize: 48,
    fontWeight: "700",
  },
  subtitle: {
    color: "#888",
    fontSize: 16,
    marginTop: 8,
  },
});
