/**
 * RemitFlow — PWA Stablecoin Page
 * Provides 11 tabs: onramp, offramp, swap, send, yield, bridge, dca, card, bill, p2p, history
 * Supports 7 stablecoins: USDT, USDC, BUSD, DAI, NGNT, cUSD, PYUSD
 * Supports 8 fiats: USD, NGN, GBP, EUR, GHS, KES, ZAR, XOF
 */

import React, { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { trpc } from "@/utils/trpc";

const STABLECOINS = ["USDT", "USDC", "BUSD", "DAI", "NGNT", "cUSD", "PYUSD"] as const;
const FIATS = ["USD", "NGN", "GBP", "EUR", "GHS", "KES", "ZAR", "XOF"] as const;
const CHAINS = ["ethereum", "polygon", "bsc", "solana", "tron", "arbitrum", "optimism", "base", "avalanche"] as const;

export default function StablecoinPage() {
  const [amount, setAmount] = useState("");
  const [selectedCoin, setSelectedCoin] = useState<string>("USDC");
  const [selectedFiat, setSelectedFiat] = useState<string>("USD");
  const [selectedChain, setSelectedChain] = useState<string>("ethereum");
  const [recipient, setRecipient] = useState("");

  const buyWithFiat = trpc.stablecoinPlatform.onramp.useMutation();
  const sellToFiat = trpc.stablecoinPlatform.offramp.useMutation();

  return (
    <div className="container mx-auto p-4 max-w-4xl">
      <h1 className="text-2xl font-bold mb-6">Stablecoin</h1>

      <Tabs defaultValue="onramp">
        <TabsList className="flex flex-wrap gap-1 mb-4">
          <TabsTrigger value="onramp">On-Ramp</TabsTrigger>
          <TabsTrigger value="offramp">Off-Ramp</TabsTrigger>
          <TabsTrigger value="swap">Swap</TabsTrigger>
          <TabsTrigger value="send">Send</TabsTrigger>
          <TabsTrigger value="yield">Yield</TabsTrigger>
          <TabsTrigger value="bridge">Bridge</TabsTrigger>
          <TabsTrigger value="dca">DCA</TabsTrigger>
          <TabsTrigger value="card">Card</TabsTrigger>
          <TabsTrigger value="bill">Bill Pay</TabsTrigger>
          <TabsTrigger value="p2p">P2P</TabsTrigger>
          <TabsTrigger value="history">History</TabsTrigger>
        </TabsList>

        {/* On-Ramp Tab */}
        <TabsContent value="onramp">
          <Card>
            <CardHeader>
              <CardTitle>Buy Stablecoins with Fiat</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <Select value={selectedFiat} onValueChange={setSelectedFiat}>
                <SelectTrigger>
                  <SelectValue placeholder="Select fiat currency" />
                </SelectTrigger>
                <SelectContent>
                  {FIATS.map((f) => (
                    <SelectItem key={f} value={f}>{f}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={selectedCoin} onValueChange={setSelectedCoin}>
                <SelectTrigger>
                  <SelectValue placeholder="Select stablecoin" />
                </SelectTrigger>
                <SelectContent>
                  {STABLECOINS.map((c) => (
                    <SelectItem key={c} value={c}>{c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                type="number"
                placeholder="Amount"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
              <Button
                className="w-full"
                onClick={() =>
                  buyWithFiat.mutate({
                    fiatCurrency: selectedFiat as any,
                    fiatAmount: parseFloat(amount) || 0,
                    stablecoin: selectedCoin as any,
                    chain: selectedChain as any,
                  })
                }
                disabled={buyWithFiat.isPending}
              >
                {buyWithFiat.isPending ? "Processing..." : `Buy ${selectedCoin}`}
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Off-Ramp Tab */}
        <TabsContent value="offramp">
          <Card>
            <CardHeader>
              <CardTitle>Sell Stablecoins to Fiat</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <Select value={selectedCoin} onValueChange={setSelectedCoin}>
                <SelectTrigger>
                  <SelectValue placeholder="Select stablecoin" />
                </SelectTrigger>
                <SelectContent>
                  {STABLECOINS.map((c) => (
                    <SelectItem key={c} value={c}>{c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={selectedFiat} onValueChange={setSelectedFiat}>
                <SelectTrigger>
                  <SelectValue placeholder="Select fiat currency" />
                </SelectTrigger>
                <SelectContent>
                  {FIATS.map((f) => (
                    <SelectItem key={f} value={f}>{f}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                type="number"
                placeholder="Amount"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
              <Button
                className="w-full"
                onClick={() =>
                  sellToFiat.mutate({
                    stablecoin: selectedCoin as any,
                    stablecoinAmount: parseFloat(amount) || 0,
                    fiatCurrency: selectedFiat as any,
                    bankAccountId: "default",
                  })
                }
                disabled={sellToFiat.isPending}
              >
                {sellToFiat.isPending ? "Processing..." : `Sell ${selectedCoin}`}
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Swap Tab */}
        <TabsContent value="swap">
          <Card>
            <CardHeader><CardTitle>Swap Stablecoins</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <Input type="number" placeholder="Amount" value={amount} onChange={(e) => setAmount(e.target.value)} />
              <Button className="w-full">Swap USDC → USDT</Button>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Send Tab */}
        <TabsContent value="send">
          <Card>
            <CardHeader><CardTitle>Send Stablecoins</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <Input placeholder="Recipient address" value={recipient} onChange={(e) => setRecipient(e.target.value)} />
              <Input type="number" placeholder="Amount" value={amount} onChange={(e) => setAmount(e.target.value)} />
              <Button className="w-full">Send</Button>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Yield Tab */}
        <TabsContent value="yield">
          <Card>
            <CardHeader><CardTitle>Earn Yield</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <Input type="number" placeholder="Amount to stake" value={amount} onChange={(e) => setAmount(e.target.value)} />
              <Button className="w-full">Stake for Yield</Button>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Bridge Tab */}
        <TabsContent value="bridge">
          <Card>
            <CardHeader><CardTitle>Bridge Across Chains</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <Select value={selectedChain} onValueChange={setSelectedChain}>
                <SelectTrigger>
                  <SelectValue placeholder="Select destination chain" />
                </SelectTrigger>
                <SelectContent>
                  {CHAINS.map((c) => (
                    <SelectItem key={c} value={c}>{c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input type="number" placeholder="Amount" value={amount} onChange={(e) => setAmount(e.target.value)} />
              <Button className="w-full">Bridge to {selectedChain}</Button>
            </CardContent>
          </Card>
        </TabsContent>

        {/* DCA Tab */}
        <TabsContent value="dca">
          <Card>
            <CardHeader><CardTitle>Dollar-Cost Averaging</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <Input type="number" placeholder="Amount per purchase" value={amount} onChange={(e) => setAmount(e.target.value)} />
              <Button className="w-full">Create DCA Plan</Button>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Card Tab */}
        <TabsContent value="card">
          <Card>
            <CardHeader><CardTitle>Virtual Stablecoin Card</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <Button className="w-full">Create Virtual Card</Button>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Bill Pay Tab */}
        <TabsContent value="bill">
          <Card>
            <CardHeader><CardTitle>Pay Bills with Stablecoins</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <Input placeholder="Bill reference" value={recipient} onChange={(e) => setRecipient(e.target.value)} />
              <Input type="number" placeholder="Amount" value={amount} onChange={(e) => setAmount(e.target.value)} />
              <Button className="w-full">Pay Bill</Button>
            </CardContent>
          </Card>
        </TabsContent>

        {/* P2P Tab */}
        <TabsContent value="p2p">
          <Card>
            <CardHeader><CardTitle>P2P Transfer</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <Input placeholder="Phone or email" value={recipient} onChange={(e) => setRecipient(e.target.value)} />
              <Input type="number" placeholder="Amount" value={amount} onChange={(e) => setAmount(e.target.value)} />
              <Button className="w-full">Send to Contact</Button>
            </CardContent>
          </Card>
        </TabsContent>

        {/* History Tab */}
        <TabsContent value="history">
          <Card>
            <CardHeader><CardTitle>Transaction History</CardTitle></CardHeader>
            <CardContent>
              <p className="text-gray-500">No transactions yet.</p>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
