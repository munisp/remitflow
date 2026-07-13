/**
 * RemitFlow — React Native Stablecoin Screen
 * Provides 7 tabs: On-Ramp, Off-Ramp, Swap, Send, Yield, Bridge, Bill Pay
 * Supports all 9 chains: ethereum, polygon, bsc, solana, tron, arbitrum, optimism, base, avalanche
 */

import React, { useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
} from "react-native";
import { trpc } from "../utils/trpc";

const TABS = ["On-Ramp", "Off-Ramp", "Swap", "Send", "Yield", "Bridge", "Bill Pay"] as const;
type Tab = typeof TABS[number];

const SUPPORTED_CHAINS = [
  "ethereum",
  "polygon",
  "bsc",
  "solana",
  "tron",
  "arbitrum",
  "optimism",
  "base",
  "avalanche",
] as const;

const SUPPORTED_STABLECOINS = ["USDT", "USDC", "BUSD", "DAI", "NGNT", "cUSD", "PYUSD"] as const;
const SUPPORTED_FIATS = ["USD", "NGN", "GBP", "EUR", "GHS", "KES", "ZAR", "XOF"] as const;

export function StablecoinScreen() {
  const [activeTab, setActiveTab] = useState<Tab>("On-Ramp");
  const [amount, setAmount] = useState("");
  const [recipient, setRecipient] = useState("");
  const [selectedChain, setSelectedChain] = useState<string>("ethereum");
  const [selectedCoin, setSelectedCoin] = useState<string>("USDC");
  const [selectedFiat, setSelectedFiat] = useState<string>("USD");

  // tRPC mutations
  const buyWithFiat = trpc.stablecoinPlatform.onramp.useMutation();
  const sellToFiat = trpc.stablecoinPlatform.offramp.useMutation();
  const swap = trpc.stablecoinPlatform.swap?.useMutation?.();
  const send = trpc.stablecoinPlatform.send?.useMutation?.();
  const stakeForYield = trpc.stablecoinPlatform.stakeForYield?.useMutation?.();
  const unstake = trpc.stablecoinPlatform.unstake?.useMutation?.();
  const bridgeChain = trpc.stablecoinPlatform.bridgeChain?.useMutation?.();
  const payBill = trpc.stablecoinPlatform.payBill?.useMutation?.();

  const renderTab = () => {
    switch (activeTab) {
      case "On-Ramp":
        return (
          <View style={styles.tabContent}>
            <Text style={styles.title}>Buy {selectedCoin} with {selectedFiat}</Text>
            <TextInput
              style={styles.input}
              placeholder="Amount"
              value={amount}
              onChangeText={setAmount}
              keyboardType="numeric"
            />
            <TouchableOpacity
              style={styles.button}
              onPress={() =>
                buyWithFiat.mutate({
                  fiatCurrency: selectedFiat as any,
                  fiatAmount: parseFloat(amount) || 0,
                  stablecoin: selectedCoin as any,
                  chain: selectedChain as any,
                })
              }
            >
              <Text style={styles.buttonText}>Buy {selectedCoin}</Text>
            </TouchableOpacity>
          </View>
        );

      case "Off-Ramp":
        return (
          <View style={styles.tabContent}>
            <Text style={styles.title}>Sell {selectedCoin} to {selectedFiat}</Text>
            <TextInput
              style={styles.input}
              placeholder="Amount"
              value={amount}
              onChangeText={setAmount}
              keyboardType="numeric"
            />
            <TouchableOpacity
              style={styles.button}
              onPress={() =>
                sellToFiat.mutate({
                  stablecoin: selectedCoin as any,
                  stablecoinAmount: parseFloat(amount) || 0,
                  fiatCurrency: selectedFiat as any,
                  bankAccountId: "default",
                })
              }
            >
              <Text style={styles.buttonText}>Sell to Bank</Text>
            </TouchableOpacity>
          </View>
        );

      case "Swap":
        return (
          <View style={styles.tabContent}>
            <Text style={styles.title}>Swap Stablecoins</Text>
            <TextInput
              style={styles.input}
              placeholder="Amount"
              value={amount}
              onChangeText={setAmount}
              keyboardType="numeric"
            />
            <TouchableOpacity style={styles.button} onPress={() => swap?.mutate?.({ fromStablecoin: "USDC", toStablecoin: "USDT", amount: parseFloat(amount) || 0 })}>
              <Text style={styles.buttonText}>Swap USDC → USDT</Text>
            </TouchableOpacity>
          </View>
        );

      case "Send":
        return (
          <View style={styles.tabContent}>
            <Text style={styles.title}>Send {selectedCoin}</Text>
            <TextInput
              style={styles.input}
              placeholder="Recipient address or phone"
              value={recipient}
              onChangeText={setRecipient}
            />
            <TextInput
              style={styles.input}
              placeholder="Amount"
              value={amount}
              onChangeText={setAmount}
              keyboardType="numeric"
            />
            <TouchableOpacity style={styles.button} onPress={() => send?.mutate?.({ stablecoin: selectedCoin, amount: parseFloat(amount) || 0, toAddress: recipient })}>
              <Text style={styles.buttonText}>Send</Text>
            </TouchableOpacity>
          </View>
        );

      case "Yield":
        return (
          <View style={styles.tabContent}>
            <Text style={styles.title}>Earn Yield on {selectedCoin}</Text>
            <TextInput
              style={styles.input}
              placeholder="Amount to stake"
              value={amount}
              onChangeText={setAmount}
              keyboardType="numeric"
            />
            <TouchableOpacity style={styles.button} onPress={() => stakeForYield?.mutate?.({ stablecoin: selectedCoin, amount: parseFloat(amount) || 0 })}>
              <Text style={styles.buttonText}>Stake for Yield</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.button, styles.secondaryButton]} onPress={() => unstake?.mutate?.({ stablecoin: selectedCoin, amount: parseFloat(amount) || 0 })}>
              <Text style={styles.buttonText}>Unstake</Text>
            </TouchableOpacity>
          </View>
        );

      case "Bridge":
        return (
          <View style={styles.tabContent}>
            <Text style={styles.title}>Bridge {selectedCoin} Across Chains</Text>
            <Text style={styles.label}>Supported chains:</Text>
            <ScrollView horizontal>
              {SUPPORTED_CHAINS.map((chain) => (
                <TouchableOpacity
                  key={chain}
                  style={[styles.chainChip, selectedChain === chain && styles.chainChipActive]}
                  onPress={() => setSelectedChain(chain)}
                >
                  <Text style={styles.chainChipText}>{chain}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
            <TextInput
              style={styles.input}
              placeholder="Amount"
              value={amount}
              onChangeText={setAmount}
              keyboardType="numeric"
            />
            <TouchableOpacity style={styles.button} onPress={() => bridgeChain?.mutate?.({ stablecoin: selectedCoin, amount: parseFloat(amount) || 0, fromChain: "ethereum", toChain: selectedChain })}>
              <Text style={styles.buttonText}>Bridge to {selectedChain}</Text>
            </TouchableOpacity>
          </View>
        );

      case "Bill Pay":
        return (
          <View style={styles.tabContent}>
            <Text style={styles.title}>Pay Bills with {selectedCoin}</Text>
            <TextInput
              style={styles.input}
              placeholder="Bill reference"
              value={recipient}
              onChangeText={setRecipient}
            />
            <TextInput
              style={styles.input}
              placeholder="Amount"
              value={amount}
              onChangeText={setAmount}
              keyboardType="numeric"
            />
            <TouchableOpacity style={styles.button} onPress={() => payBill?.mutate?.({ stablecoin: selectedCoin, amount: parseFloat(amount) || 0, billRef: recipient, provider: "generic" })}>
              <Text style={styles.buttonText}>Pay Bill</Text>
            </TouchableOpacity>
          </View>
        );

      default:
        return null;
    }
  };

  return (
    <View style={styles.container}>
      {/* Tab bar */}
      <ScrollView horizontal style={styles.tabBar} showsHorizontalScrollIndicator={false}>
        {TABS.map((tab) => (
          <TouchableOpacity
            key={tab}
            style={[styles.tab, activeTab === tab && styles.activeTab]}
            onPress={() => setActiveTab(tab)}
          >
            <Text style={[styles.tabText, activeTab === tab && styles.activeTabText]}>{tab}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* Tab content */}
      <ScrollView style={styles.content}>{renderTab()}</ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#fff" },
  tabBar: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: "#e0e0e0" },
  tab: { paddingHorizontal: 16, paddingVertical: 12 },
  activeTab: { borderBottomWidth: 2, borderBottomColor: "#2563eb" },
  tabText: { color: "#666", fontSize: 14 },
  activeTabText: { color: "#2563eb", fontWeight: "600" },
  content: { flex: 1 },
  tabContent: { padding: 16 },
  title: { fontSize: 18, fontWeight: "600", marginBottom: 16 },
  label: { fontSize: 14, color: "#666", marginBottom: 8 },
  input: { borderWidth: 1, borderColor: "#ddd", borderRadius: 8, padding: 12, marginBottom: 12, fontSize: 16 },
  button: { backgroundColor: "#2563eb", borderRadius: 8, padding: 14, alignItems: "center", marginBottom: 8 },
  secondaryButton: { backgroundColor: "#64748b" },
  buttonText: { color: "#fff", fontSize: 16, fontWeight: "600" },
  chainChip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16, borderWidth: 1, borderColor: "#ddd", marginRight: 8, marginBottom: 8 },
  chainChipActive: { backgroundColor: "#2563eb", borderColor: "#2563eb" },
  chainChipText: { fontSize: 12, color: "#333" },
});

export default StablecoinScreen;
