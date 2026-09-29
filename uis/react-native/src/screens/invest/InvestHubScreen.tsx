/**
 * wave17 C1 (SPEC-wave17, rn-invest) — InvestHub RN screen.
 *
 * Mirrors uis/pwa/src/pages/invest/InvestHub.tsx exactly: same six sections,
 * same status badges and honesty footnotes (badges reflect verified backend
 * reality, not marketing copy). Entry point for all investment surfaces.
 */
import React from 'react';
import { View, Text, ScrollView, TouchableOpacity } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Badge, styles } from './common';

type Tone = 'ok' | 'warn';

interface InvestSection {
  screen: string;
  title: string;
  description: string;
  badge: string;
  tone: Tone;
  footnote?: string;
}

const TONE_COLORS: Record<Tone, { bg: string; fg: string }> = {
  ok: { bg: 'rgba(16,185,129,0.12)', fg: '#10b981' },
  warn: { bg: 'rgba(245,158,11,0.12)', fg: '#f59e0b' },
};

const SECTIONS: InvestSection[] = [
  {
    screen: 'InvestBonds',
    title: 'Diaspora Bonds',
    description:
      'Government and infrastructure bonds for the diaspora — subscribe from your USD wallet, track coupons, trade on the secondary market, or redeem early.',
    badge: 'Live',
    tone: 'ok',
  },
  {
    screen: 'InvestStocks',
    title: 'NGX Stocks',
    description:
      'Nigerian Exchange equities — browse listings, watchlist, and place orders from your NGN wallet.',
    badge: 'Broker connectivity in progress',
    tone: 'warn',
    footnote:
      'Orders are captured and funds held, but broker settlement is not yet automated — executions are reconciled manually by operations. Orders are never presented as executed trades.',
  },
  {
    screen: 'InvestRealEstate',
    title: 'Real Estate',
    description:
      'Fractional ownership of vetted property listings — invest per share and track holdings.',
    badge: 'Live — custody settled by operations',
    tone: 'ok',
    footnote:
      'Investments debit your wallet immediately; asset custody is confirmed manually by operations.',
  },
  {
    screen: 'InvestStartups',
    title: 'Startup Deals',
    description:
      'Curated African startup raises — commit capital and track your portfolio.',
    badge: 'Live — custody settled by operations',
    tone: 'ok',
    footnote:
      'Commitments debit your wallet immediately; custody/agreements are confirmed manually by operations.',
  },
  {
    screen: 'InvestCommunity',
    title: 'Community Funds',
    description:
      'Community investment pools — browse funds, contribute, and vote on proposals.',
    badge: 'Live',
    tone: 'ok',
  },
  {
    screen: 'InvestEscrow',
    title: 'Property Escrow',
    description:
      'Milestone-based property purchase escrow — deposits, installments, and evidence tracking.',
    badge: 'Live — releases reviewed by operations',
    tone: 'ok',
    footnote:
      'Milestone releases and dispute resolutions are reviewed and executed by operations, not self-serve.',
  },
];

export default function InvestHubScreen() {
  const navigation = useNavigation<any>();
  return (
    <View style={styles.container}>
      <View style={[styles.header, { justifyContent: 'center' }]}>
        <Text style={styles.title}>Invest</Text>
      </View>
      <ScrollView style={styles.content} contentContainerStyle={styles.contentPad}>
        <Text style={[styles.textMuted, { marginBottom: 12, lineHeight: 18 }]}>
          Bonds, equities, property, startups and community pools — every surface below is wired to a
          live backend router; status badges reflect real backend capability.
        </Text>

        <View style={styles.infoBox}>
          <Text style={styles.infoText}>
            Investment actions are guarded: tier-2 KYC and an eligible plan are required by the
            backend, and money-moving steps ask for your 6-digit 2FA code when you have two-factor
            authentication enrolled. Rejections from those guards are shown to you verbatim — they
            are never hidden.
          </Text>
        </View>

        {SECTIONS.map((sec) => {
          const tone = TONE_COLORS[sec.tone];
          return (
            <TouchableOpacity
              key={sec.screen}
              style={styles.card}
              onPress={() => navigation.navigate(sec.screen)}
            >
              <View style={styles.rowBetween}>
                <Text style={[styles.textMain, { flex: 1, marginRight: 8 }]}>{sec.title}</Text>
                <Badge label={sec.badge} color={tone.fg} bg={tone.bg} />
              </View>
              <Text style={[styles.textMuted, { marginTop: 6, lineHeight: 17 }]}>{sec.description}</Text>
              {sec.footnote ? (
                <Text style={[styles.textDim, { marginTop: 6, lineHeight: 15 }]}>{sec.footnote}</Text>
              ) : null}
              <Text style={[styles.linkText, { marginTop: 8 }]}>Open →</Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </View>
  );
}
