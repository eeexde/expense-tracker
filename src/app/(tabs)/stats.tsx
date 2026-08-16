import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { BarChart, PieChart } from 'react-native-gifted-charts';
import { Icon } from '@/components/Icon';
import { QueryErrorNotice } from '@/components/QueryError';
import { useAppQuery, useAppQueryResult } from '@/db/hooks';
import { allBucketBalances, totalMoney } from '@/db/repo';
import { expensesByCategory, monthlyCommitments, monthSummary, sixMonthTrend } from '@/db/statsRepo';
import { utangTotals } from '@/db/utangRepo';
import { formatPeso } from '@/lib/money';
import { monthLabel, monthShort, shiftMonth } from '@/lib/months';
import {
  chartCategorical,
  chartExpense,
  chartIncome,
  chartOther,
  colors,
  currentMonth,
  fonts,
  radii,
  spacing,
} from '@/theme';

const TOP_CATEGORIES = 5;
const AXIS_SECTIONS = 3;
/** Rough advance of one glyph of the 10px body font, for sizing the Y gutter. */
const AXIS_CHAR_WIDTH = 6;

/**
 * Y-axis money label: same ₱ and thousands separators as formatPeso, minus the
 * centavos — axis ticks are whole pesos and ".00" only eats label width.
 */
function axisLabel(centavos: number): string {
  return formatPeso(centavos).replace(/\.\d{2}$/, '');
}

/**
 * Rounds the raw gridline step up to two significant digits so the axis lands on
 * readable pesos (₱5,100 rather than ₱5,078) without leaving the bars stranded
 * at half height the way a 1/2/5 "nice number" step would.
 */
function axisStepFor(maxValue: number): number {
  if (maxValue <= 0) return 1;
  const raw = maxValue / AXIS_SECTIONS;
  const magnitude = 10 ** Math.max(0, Math.floor(Math.log10(raw)) - 1);
  return Math.max(1, Math.ceil(raw / magnitude) * magnitude);
}

export default function StatsScreen() {
  const [month, setMonth] = useState(currentMonth());

  // The four queries behind a loading branch take the non-throwing hook, so a
  // rejection costs that section an inline retry rather than the whole
  // navigator. `failed` is `error && no data`: once a result has landed the
  // last good one keeps rendering, which is the point of holding on to it.
  const {
    data: summary,
    error: summaryError,
    retry: retrySummary,
  } = useAppQueryResult((db) => monthSummary(db, month), [month]);
  const {
    data: byCategory,
    error: byCategoryError,
    retry: retryByCategory,
  } = useAppQueryResult((db) => expensesByCategory(db, month), [month]);
  const {
    data: trend,
    error: trendError,
    retry: retryTrend,
  } = useAppQueryResult((db) => sixMonthTrend(db, month), [month]);
  const {
    data: balances,
    error: balancesError,
    retry: retryBalances,
  } = useAppQueryResult((db) => allBucketBalances(db));
  const total = useAppQuery((db) => totalMoney(db));
  const commitments = useAppQuery((db) => monthlyCommitments(db));
  const utang = useAppQuery((db) => utangTotals(db));

  const summaryFailed = summaryError !== null && summary === undefined;
  const categoryFailed = (byCategoryError !== null && byCategory === undefined) || summaryFailed;
  const trendFailed = trendError !== null && trend === undefined;
  const balancesFailed = balancesError !== null && balances === undefined;

  // Top 5 categories keep their fixed-order slot color; the rest fold into "Others".
  const top = (byCategory ?? []).slice(0, TOP_CATEGORIES);
  const rest = (byCategory ?? []).slice(TOP_CATEGORIES);
  const restTotal = rest.reduce((acc, r) => acc + r.total, 0);
  // Round the sum, never sum the rounds. `expensesByCategory` already rounded
  // each row's own pct to a whole number, so adding those up loses everything
  // that rounded to zero: ten ₱3.99 rows out of a ₱1,000 month are 0% each and
  // "Others" read 0% while its slice was correctly drawn at 4%.
  const grandTotal = (byCategory ?? []).reduce((acc, r) => acc + r.total, 0);
  const slices = [
    ...top.map((c, i) => ({ ...c, color: chartCategorical[i] })),
    ...(restTotal > 0
      ? [
          {
            categoryId: null,
            categoryName: 'Others',
            total: restTotal,
            pct: grandTotal === 0 ? 0 : Math.round((restTotal / grandTotal) * 100),
            color: chartOther,
          },
        ]
      : []),
  ];

  // sixMonthTrend always returns six points, zero-filled for months with no
  // activity, so barData is never empty once the query resolves — its length
  // says nothing about whether there is anything to chart. Distinguish the two
  // real cases instead: still loading, vs. six months of genuine zeroes (a fresh
  // install), which would otherwise render 12 flat bars under a fabricated
  // ₱0–₱3 money axis.
  const trendEmpty =
    trend !== undefined && trend.every((point) => point.income === 0 && point.expenses === 0);

  // labelWidth spans the income+expense pair so month names never ellipsize;
  // tight in-pair spacing keeps each pair reading as one month.
  const barData = (trend ?? []).flatMap((point) => [
    {
      value: point.income / 100,
      frontColor: chartIncome,
      spacing: 2,
      label: monthShort(point.ym),
      labelWidth: 38,
      labelTextStyle: {
        color: colors.inkFaint,
        fontSize: 10,
        fontFamily: fonts.body,
        textAlign: 'center' as const,
      },
    },
    { value: point.expenses / 100, frontColor: chartExpense, spacing: 12 },
  ]);

  // gifted-charts derives its own bare-number axis labels; pin the scale and
  // hand it money-formatted texts so the gridlines read like the rest of the app.
  const axisStep = axisStepFor(Math.max(0, ...barData.map((bar) => bar.value)));
  const axisLabels = Array.from({ length: AXIS_SECTIONS + 1 }, (_, i) =>
    axisLabel(i * axisStep * 100),
  );
  // The widest label sizes the gutter. A fixed width fits "₱5,100" and nothing
  // more: a month with real money in it prints "₱1,250,000" and gets clipped
  // against the bars.
  const axisLabelWidth = Math.max(
    50,
    Math.max(...axisLabels.map((label) => label.length)) * AXIS_CHAR_WIDTH + spacing.xs,
  );

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.monthNav}>
        {/* "‹" and "›" are all a screen reader would otherwise have to go on. */}
        <Pressable
          onPress={() => setMonth(shiftMonth(month, -1))}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="Previous month"
        >
          <Text style={styles.monthArrow}>‹</Text>
        </Pressable>
        <Text style={styles.monthLabel}>{monthLabel(month)}</Text>
        <Pressable
          onPress={() => setMonth(shiftMonth(month, 1))}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="Next month"
        >
          <Text style={styles.monthArrow}>›</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.tileRow}>
          <StatTile label="Income" value={summary?.income} color={colors.income} />
          <StatTile label="Expenses" value={summary?.expenses} color={colors.expense} />
          <StatTile
            label="Net"
            value={summary?.net}
            color={(summary?.net ?? 0) >= 0 ? colors.income : colors.expense}
          />
        </View>

        <Text style={styles.sectionTitle}>Where the money went</Text>
        {/* Three-way, for the same reason the trend section below is: an
            unresolved query and a month with no expenses both leave `slices`
            empty, so gating on its length alone makes "No expenses this month."
            a loading placeholder that flashes before the donut appears.
            `summary` is gated too even though only the centre label reads it:
            the two queries resolve independently, so gating on `byCategory`
            alone draws the donut around a flashed ₱0.00 total. */}
        {categoryFailed ? (
          <QueryErrorNotice
            message="Couldn't load this month's breakdown."
            onRetry={() => {
              retryByCategory();
              retrySummary();
            }}
            testID="category-error"
          />
        ) : byCategory === undefined || summary === undefined ? (
          <ActivityIndicator testID="category-loading" style={styles.loading} color={colors.gold} />
        ) : slices.length === 0 ? (
          <Text style={styles.empty}>No expenses this month.</Text>
        ) : (
          <View style={styles.card}>
            <View style={styles.donutRow}>
              <PieChart
                data={slices.map((s) => ({ value: s.total, color: s.color }))}
                donut
                radius={72}
                innerRadius={46}
                innerCircleColor={colors.surface}
                strokeWidth={2}
                strokeColor={colors.surface}
                centerLabelComponent={() => (
                  <Text style={styles.donutCenter}>{formatPeso(summary.expenses)}</Text>
                )}
              />
              <View style={styles.legend}>
                {slices.map((s) => (
                  <View key={s.categoryName} style={styles.legendRow}>
                    <View style={[styles.legendDot, { backgroundColor: s.color }]} />
                    <Text style={styles.legendName} numberOfLines={1}>
                      {s.categoryName}
                    </Text>
                    <Text style={styles.legendValue}>{s.pct}%</Text>
                  </View>
                ))}
              </View>
            </View>
            {slices.map((s) => (
              <View key={s.categoryName} style={styles.categoryRow}>
                <Text style={styles.categoryName} numberOfLines={1}>
                  {s.categoryName}
                </Text>
                <Text style={styles.categoryAmount}>{formatPeso(s.total)}</Text>
              </View>
            ))}
          </View>
        )}

        <Text style={styles.sectionTitle}>Last 6 months</Text>
        {trendFailed ? (
          <QueryErrorNotice
            message="Couldn't load the last six months."
            onRetry={retryTrend}
            testID="trend-error"
          />
        ) : trend === undefined ? (
          <ActivityIndicator testID="trend-loading" style={styles.loading} color={colors.gold} />
        ) : trendEmpty ? (
          <Text style={styles.empty}>No data yet.</Text>
        ) : (
        <View style={styles.card}>
          <View style={styles.legendInline}>
            <View style={[styles.legendDot, { backgroundColor: chartIncome }]} />
            <Text style={styles.legendName}>Income</Text>
            <View style={[styles.legendDot, { backgroundColor: chartExpense }]} />
            <Text style={styles.legendName}>Expenses</Text>
          </View>
          <BarChart
            data={barData}
            barWidth={12}
            barBorderTopLeftRadius={4}
            barBorderTopRightRadius={4}
            noOfSections={AXIS_SECTIONS}
            maxValue={axisStep * AXIS_SECTIONS}
            yAxisLabelTexts={axisLabels}
            yAxisLabelWidth={axisLabelWidth}
            yAxisThickness={0}
            xAxisThickness={1}
            xAxisColor={colors.border}
            rulesColor={colors.border}
            rulesType="solid"
            yAxisTextStyle={{ color: colors.inkFaint, fontSize: 10, fontFamily: fonts.body }}
            height={140}
            initialSpacing={8}
            disableScroll
          />
          {/* The bars themselves are an SVG with nothing readable in it, so the
              same trick the donut above uses: state the data in text. `+`/`−`
              carry the direction so the two colors are never the only channel,
              and the row is one accessibility node so TalkBack reads a whole
              month at a time rather than three disconnected fragments. */}
          {(trend ?? []).map((point) => (
            <View
              key={point.ym}
              style={styles.categoryRow}
              accessible
              accessibilityLabel={`${monthLabel(point.ym)}: income ${formatPeso(
                point.income,
              )}, expenses ${formatPeso(point.expenses)}`}
            >
              <Text style={styles.categoryName} numberOfLines={1}>
                {monthLabel(point.ym)}
              </Text>
              {/* `colors.income`/`colors.expense`, not the `chart*` pair the
                  bars are drawn in: those are validated at 3:1 for fills and
                  read 4.87 / 3.81 against `surface`, which is under AA for
                  text. Same semantic pair the tiles at the top of this screen
                  already use. */}
              <View style={styles.trendValues}>
                <Text style={[styles.categoryAmount, { color: colors.income }]}>
                  +{formatPeso(point.income)}
                </Text>
                <Text style={[styles.categoryAmount, { color: colors.expense }]}>
                  −{formatPeso(point.expenses)}
                </Text>
              </View>
            </View>
          ))}
        </View>
        )}

        <Text style={styles.sectionTitle}>Money per bucket</Text>
        {/* Same three-way as the two sections above, for the same reason: an
            unresolved query and a fresh install with no buckets both leave
            `balances` with nothing to map, so a card that always renders shows
            a lone "Total ₱0.00" row as its loading state. */}
        {balancesFailed ? (
          <QueryErrorNotice
            message="Couldn't load your buckets."
            onRetry={retryBalances}
            testID="bucket-error"
          />
        ) : balances === undefined ? (
          <ActivityIndicator testID="bucket-loading" style={styles.loading} color={colors.gold} />
        ) : balances.length === 0 ? (
          <Text style={styles.empty}>No buckets yet.</Text>
        ) : (
          <View style={styles.card}>
            {balances.map(({ bucket, balance }) => (
              <View key={bucket.id} style={styles.categoryRow}>
                <View style={styles.bucketName}>
                  <Icon name={bucket.icon} size={15} color={colors.inkDim} />
                  <Text style={styles.categoryName} numberOfLines={1}>
                    {bucket.name}
                  </Text>
                </View>
                <Text style={[styles.categoryAmount, balance < 0 && { color: colors.expense }]}>
                  {balance < 0 ? `−${formatPeso(-balance)}` : formatPeso(balance)}
                </Text>
              </View>
            ))}
            <View style={[styles.categoryRow, styles.totalRow]}>
              <Text style={[styles.categoryName, { fontFamily: fonts.bodyBold }]}>Total</Text>
              <Text style={[styles.categoryAmount, { color: colors.gold }]}>
                {total === undefined ? '…' : formatPeso(total)}
              </Text>
            </View>
          </View>
        )}

        <Text style={styles.sectionTitle}>Monthly commitments</Text>
        <View style={styles.card}>
          <View style={styles.categoryRow}>
            <View style={styles.bucketName}>
              <Icon name="repeat" size={15} color={colors.inkDim} />
              <Text style={styles.categoryName}>Recurring</Text>
            </View>
            <Text style={styles.categoryAmount}>
              {commitments === undefined ? '…' : formatPeso(commitments.recurring)}
            </Text>
          </View>
          <View style={styles.categoryRow}>
            <View style={styles.bucketName}>
              <Icon name="receipt" size={15} color={colors.inkDim} />
              <Text style={styles.categoryName}>Installments</Text>
            </View>
            <Text style={styles.categoryAmount}>
              {commitments === undefined ? '…' : formatPeso(commitments.installments)}
            </Text>
          </View>
          <View style={[styles.categoryRow, styles.totalRow]}>
            <Text style={[styles.categoryName, { fontFamily: fonts.bodyBold }]}>Total per month</Text>
            <Text style={[styles.categoryAmount, { color: colors.expense }]}>
              {commitments === undefined ? '…' : formatPeso(commitments.total)}
            </Text>
          </View>
        </View>

        <Text style={styles.sectionTitle}>Utang</Text>
        <View style={styles.tileRow}>
          <StatTile label="I owe" value={utang?.iOwe} color={colors.expense} />
          <StatTile label="Owed to me" value={utang?.owedToMe} color={colors.income} />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function StatTile({
  label,
  value,
  color,
}: {
  label: string;
  value: number | undefined;
  color: string;
}) {
  return (
    <View style={styles.tile}>
      <Text style={styles.tileLabel}>{label}</Text>
      <Text style={[styles.tileValue, { color }]} numberOfLines={1} adjustsFontSizeToFit>
        {value === undefined ? '…' : formatPeso(value)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  monthNav: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  monthArrow: { fontFamily: fonts.display, fontSize: 26, color: colors.gold },
  monthLabel: { fontFamily: fonts.display, fontSize: 18, color: colors.ink },
  content: { padding: spacing.md, paddingTop: 0, paddingBottom: spacing.xl },
  tileRow: { flexDirection: 'row', gap: spacing.sm },
  tile: {
    flex: 1,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radii.md,
    padding: spacing.md,
    gap: spacing.xs,
  },
  tileLabel: {
    fontFamily: fonts.bodyBold,
    fontSize: 11,
    color: colors.inkDim,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  tileValue: { fontFamily: fonts.display, fontSize: 17 },
  sectionTitle: {
    fontFamily: fonts.display,
    fontSize: 17,
    color: colors.ink,
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
  },
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radii.md,
    padding: spacing.md,
  },
  donutRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  donutCenter: { fontFamily: fonts.display, fontSize: 14, color: colors.ink },
  legend: { flex: 1, gap: spacing.xs },
  legendRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  legendInline: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  legendDot: { width: 10, height: 10, borderRadius: 5 },
  legendName: { flexShrink: 1, fontFamily: fonts.body, fontSize: 13, color: colors.inkDim },
  legendValue: { marginLeft: 'auto', fontFamily: fonts.bodyMedium, fontSize: 13, color: colors.ink },
  categoryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    marginTop: spacing.xs,
  },
  // flexShrink (0 by default in RN) lets a long user-defined bucket/category
  // name ellipsize instead of squeezing the peso amount out of the row.
  bucketName: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexShrink: 1 },
  categoryName: { flexShrink: 1, fontFamily: fonts.body, fontSize: 14, color: colors.ink },
  categoryAmount: { fontFamily: fonts.display, fontSize: 14, color: colors.ink },
  trendValues: { flexDirection: 'row', gap: spacing.sm },
  totalRow: { borderTopWidth: 1 },
  empty: { fontFamily: fonts.body, fontSize: 14, color: colors.inkFaint, paddingVertical: spacing.sm },
  loading: { paddingVertical: spacing.md },
});
