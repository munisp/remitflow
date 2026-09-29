/**
 * wave17 C1 (SPEC-wave17, rn-invest) — Bond detail + subscribe RN screen.
 *
 * Mirrors uis/pwa/src/pages/invest/BondDetailPage.tsx: consumes
 * diasporaBond.getBond (detail + live pricing), getSubscriptionQuote
 * (pre-trade estimate) and subscribe (KYC-gated, guarded USD debit, TOTP
 * step-up). All backend rejections — terms not accepted, below minimum, not
 * a whole multiple of face value, tranche remaining cap, KYC gate, 2FA
 * required/invalid, insufficient balance, float not provisioned — are shown
 * verbatim. The subscription result honestly distinguishes "active" (wallet
 * debit settled) from "pending_payment" (off-rail payment still to be
 * confirmed).
 */
import React, { useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, ActivityIndicator, Linking } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { trpc } from '../../services/trpc';
import {
  ChipSelector,
  ErrorBanner,
  InvestHeader,
  LabeledInput,
  StatusBadge,
  SuccessNote,
  TotpField,
  fmtDateTime,
  fmtMoney,
  investErrMsg,
  styles,
} from './common';

const MIN_SUBSCRIPTION_USD = 500;

type PaymentSource = 'wallet' | 'bank_transfer' | 'card';

export default function BondDetailScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const id = Number(route.params?.bondId);
  const validId = Number.isInteger(id) && id > 0;

  const bondQ = trpc.diasporaBond.getBond.useQuery({ id }, { enabled: validId });
  const bond = bondQ.data;

  // Subscribe form
  const [amountUsd, setAmountUsd] = useState('');
  const [quote, setQuote] = useState<any | null>(null);
  const [quoteErr, setQuoteErr] = useState<string | null>(null);
  const [paymentSource, setPaymentSource] = useState<PaymentSource>('wallet');
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [totp, setTotp] = useState('');
  const [subErr, setSubErr] = useState<string | null>(null);
  const [subResult, setSubResult] = useState<any | null>(null);

  // Quote is on-demand (explicit "Get quote" press), not on every keystroke.
  const quoteQ = trpc.diasporaBond.getSubscriptionQuote.useQuery(
    { bondId: id, amountUsd: Number(amountUsd) },
    { enabled: false },
  );
  const subscribeMutation = trpc.diasporaBond.subscribe.useMutation({
    onSuccess: (res: any) => {
      setSubResult(res);
      setTotp('');
      bondQ.refetch();
    },
    onError: (e: unknown) => {
      // FORBIDDEN: KYC required; PRECONDITION_FAILED: 2FA code required;
      // UNAUTHORIZED: invalid 2FA; BAD_REQUEST: amount/balance rules;
      // CONFLICT: concurrent debit; PRECONDITION_FAILED: float not provisioned.
      setSubErr(investErrMsg(e));
    },
  });

  const runQuote = async () => {
    setQuoteErr(null);
    setQuote(null);
    try {
      const res = await quoteQ.refetch();
      if (res.error) throw res.error;
      setQuote(res.data);
    } catch (e) {
      // BAD_REQUEST: below minimum / above tranche remaining / bond not open.
      setQuoteErr(investErrMsg(e));
    }
  };

  const subscribe = () => {
    setSubErr(null);
    setSubResult(null);
    subscribeMutation.mutate({
      bondId: id,
      amountUsd: Number(amountUsd),
      paymentSource,
      acceptedTerms,
      totpCode: totp || undefined,
    });
  };

  if (!validId) {
    return (
      <View style={styles.container}>
        <InvestHeader title="Bond" />
        <View style={styles.contentPad}>
          <ErrorBanner message="Invalid bond id" />
        </View>
      </View>
    );
  }

  const isOpen = bond?.status === 'open';
  const faceValue = bond ? Number(bond.faceValue) : 0;
  const amountOk = !!amountUsd && Number(amountUsd) > 0 && Number(amountUsd) % faceValue === 0;

  return (
    <View style={styles.container}>
      <InvestHeader title="Bond detail" />
      <ScrollView style={styles.content} contentContainerStyle={styles.contentPad}>
        {bondQ.isLoading ? <ActivityIndicator color="#6366f1" style={{ marginTop: 30 }} /> : null}
        <ErrorBanner message={bondQ.error ? investErrMsg(bondQ.error) : null} />
        {!bond || bondQ.error ? null : (
          <View>
            <View style={styles.rowBetween}>
              <View style={{ flex: 1, marginRight: 8 }}>
                <Text style={[styles.title, { fontSize: 18 }]}>{bond.name}</Text>
                <Text style={[styles.textMuted, { marginTop: 4 }]}>
                  {bond.issuer}
                  {bond.isin ? ` · ISIN ${bond.isin}` : ''}
                  {bond.creditRating ? ` · rated ${bond.creditRating}${bond.ratingAgency ? ` by ${bond.ratingAgency}` : ''}` : ''}
                </Text>
              </View>
              <StatusBadge status={bond.status} />
            </View>

            {bond.description ? (
              <View style={[styles.card, { marginTop: 12 }]}>
                <Text style={styles.textBody}>{bond.description}</Text>
              </View>
            ) : null}

            <View style={[styles.statGrid, { marginTop: 12 }]}>
              {[
                ['Coupon rate', `${(Number(bond.couponRate) * 100).toFixed(2)}% ${bond.couponFrequency ?? ''}`],
                ['Face value', `$${fmtMoney(bond.faceValue)}`],
                ['Maturity', fmtDateTime(bond.maturityDate).split(',')[0]],
                ['Next coupon', fmtDateTime(bond.nextCouponDate).split(',')[0]],
                ['Clean price', `$${fmtMoney(bond.pricing.cleanPrice)}`],
                ['Dirty price', `$${fmtMoney(bond.pricing.dirtyPrice)}`],
                ['YTM (indicative)', `${(bond.pricing.yieldToMaturity * 100).toFixed(2)}%`],
                ['Mod. duration', Number(bond.pricing.modifiedDuration).toFixed(2)],
              ].map(([label, value]) => (
                <View key={label as string} style={styles.statCell}>
                  <Text style={styles.statLabel}>{label}</Text>
                  <Text style={styles.statValue}>{value}</Text>
                </View>
              ))}
            </View>

            {/* Raise progress */}
            <View style={[styles.card, { marginTop: 12 }]}>
              <Text style={styles.sectionTitle}>Raise progress</Text>
              <View style={styles.rowBetween}>
                <Text style={styles.textDim}>Raised ${fmtMoney(bond.raisedAmount)}</Text>
                <Text style={styles.textDim}>
                  {Number(bond.fillPercentage).toFixed(1)}% of ${fmtMoney(bond.targetRaise)}
                </Text>
              </View>
              <View style={styles.progressTrack}>
                <View style={[styles.progressFill, { width: `${Math.min(100, Number(bond.fillPercentage))}%` }]} />
              </View>
              <Text style={[styles.textDim, { marginTop: 6, lineHeight: 16 }]}>
                Offer window {fmtDateTime(bond.offerOpenDate).split(',')[0]} → {fmtDateTime(bond.offerCloseDate).split(',')[0]}
                {bond.eligibleCountries && bond.eligibleCountries.length > 0 ? ` · eligible countries: ${bond.eligibleCountries.join(', ')}` : ''}
                {bond.isTaxExempt ? ' · tax-exempt' : ''}
              </Text>
              {bond.prospectusUrl ? (
                <TouchableOpacity onPress={() => Linking.openURL(bond.prospectusUrl)}>
                  <Text style={[styles.linkText, { marginTop: 6 }]}>View prospectus →</Text>
                </TouchableOpacity>
              ) : null}
            </View>

            {/* ── Subscribe ── */}
            <View style={[styles.card, { marginTop: 12 }]}>
              <Text style={styles.sectionTitle}>Subscribe</Text>
              {!isOpen ? (
                <Text style={[styles.textMuted, { marginTop: 6, lineHeight: 17 }]}>
                  This bond is not open for subscription (status: {bond.status ?? 'unknown'}).
                  Secondary-market orders may still be available on the bonds screen.
                </Text>
              ) : subResult ? (
                <View style={{ marginTop: 8 }}>
                  <SuccessNote
                    message={
                      subResult.subscription.status === 'active'
                        ? `Subscription ${subResult.subscription.subscriptionRef} is ACTIVE — $${fmtMoney(subResult.quote.amountUsd)} + $${fmtMoney(subResult.quote.platformFee)} fee debited from your USD wallet. First coupon estimated ${fmtDateTime(subResult.quote.nextCouponDate)}.`
                        : `Subscription ${subResult.subscription.subscriptionRef} created as PENDING PAYMENT — no wallet funds moved. Pay via your chosen rail, then confirm the payment reference from My holdings.`
                    }
                  />
                  <TouchableOpacity style={styles.btnSecondary} onPress={() => navigation.navigate('InvestBonds')}>
                    <Text style={styles.btnText}>Go to my holdings</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.btnSecondary} onPress={() => setSubResult(null)}>
                    <Text style={styles.btnText}>Subscribe again</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <View style={{ marginTop: 8 }}>
                  <LabeledInput
                    label="Amount (USD)"
                    hint={`Min $${MIN_SUBSCRIPTION_USD.toLocaleString()} · whole multiple of face value $${fmtMoney(bond.faceValue)} (backend enforced)`}
                    value={amountUsd}
                    onChange={(v) => setAmountUsd(v.replace(/[^\d.]/g, ''))}
                    numeric
                    placeholder={bond.faceValue}
                  />
                  <TouchableOpacity
                    style={[styles.btnSecondary, (quoteQ.isFetching || !amountUsd || Number(amountUsd) <= 0) && styles.btnDisabled]}
                    disabled={quoteQ.isFetching || !amountUsd || Number(amountUsd) <= 0}
                    onPress={runQuote}
                  >
                    <Text style={styles.btnText}>{quoteQ.isFetching ? 'Quoting...' : 'Get quote'}</Text>
                  </TouchableOpacity>

                  <View style={{ marginTop: 10 }}>
                    <ErrorBanner message={quoteErr} />
                  </View>
                  {quote ? (
                    <View style={styles.statGrid}>
                      {[
                        ['Units', String(quote.units)],
                        ['Coupon/period', `$${fmtMoney(quote.couponPerPeriod)}`],
                        ['Annual coupon', `$${fmtMoney(quote.annualCoupon)}`],
                        ['Platform fee', `$${fmtMoney(quote.platformFee)}`],
                        ['Years to maturity', String(quote.yearsToMaturity)],
                        ['Est. total coupons', `$${fmtMoney(quote.totalCouponsEstimate)}`],
                        ['Est. total return', `$${fmtMoney(quote.totalReturnEstimate)}`],
                        ['Next coupon', fmtDateTime(quote.nextCouponDate).split(',')[0]],
                      ].map(([label, value]) => (
                        <View key={label} style={styles.statCell}>
                          <Text style={styles.statLabel}>{label}</Text>
                          <Text style={styles.statValue}>{value}</Text>
                        </View>
                      ))}
                    </View>
                  ) : null}

                  <Text style={[styles.label, { marginTop: 12 }]}>Payment source</Text>
                  <ChipSelector<PaymentSource>
                    value={paymentSource}
                    onChange={setPaymentSource}
                    options={[
                      { value: 'wallet', label: 'USD wallet (immediate debit)' },
                      { value: 'bank_transfer', label: 'Bank transfer (off-rail)' },
                      { value: 'card', label: 'Card (off-rail)' },
                    ]}
                  />
                  <TotpField value={totp} onChange={setTotp} />

                  <TouchableOpacity style={[styles.row, { marginTop: 12 }]} onPress={() => setAcceptedTerms((v) => !v)}>
                    <Text style={{ fontSize: 18, color: acceptedTerms ? '#6366f1' : '#6b7280', marginRight: 8 }}>
                      {acceptedTerms ? '☑' : '☐'}
                    </Text>
                    <Text style={[styles.textMuted, { flex: 1, lineHeight: 17 }]}>
                      I accept the bond subscription terms. I understand subscribing requires
                      approved KYC, that wallet payment debits my USD wallet immediately (plus the
                      0.1% platform fee), and that early redemption incurs a 2% penalty.
                    </Text>
                  </TouchableOpacity>

                  <View style={{ marginTop: 10 }}>
                    <ErrorBanner message={subErr} />
                  </View>

                  <TouchableOpacity
                    style={[styles.btn, (subscribeMutation.isPending || !acceptedTerms || !amountOk) && styles.btnDisabled]}
                    disabled={subscribeMutation.isPending || !acceptedTerms || !amountOk}
                    onPress={subscribe}
                  >
                    <Text style={styles.btnText}>{subscribeMutation.isPending ? 'Subscribing...' : 'Subscribe'}</Text>
                  </TouchableOpacity>
                  {amountUsd && Number(amountUsd) % faceValue !== 0 ? (
                    <Text style={[styles.warnText, { marginTop: 6 }]}>
                      Amount must be a whole multiple of ${fmtMoney(bond.faceValue)}
                    </Text>
                  ) : null}
                  <Text style={[styles.textDim, { marginTop: 8, lineHeight: 16 }]}>
                    Guarded server-side: tier-2 KYC + plan check, balance check, and an atomic debit
                    that cannot overdraw. If you have 2FA enrolled, your 6-digit code is required.
                  </Text>
                </View>
              )}
            </View>
          </View>
        )}
      </ScrollView>
    </View>
  );
}
