import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { BarChart, PieChart } from 'react-native-gifted-charts';
import { Icon } from '@/components/Icon';
import { useAppQuery } from '@/db/hooks';
import { allBucketBalances, totalMoney } from '@/db/repo';
import { expensesByCategory, monthSummary, sixMonthTrend } from '@/db/statsRepo';
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

export default function StatsScreen() {
  const [month, setMonth] = useState(currentMonth());

  const summary = useAppQuery((db) => monthSummary(db, month), [month]);
  const byCategory = useAppQuery((db) => expensesByCategory(db, month), [month]);
  const trend = useAppQuery((db) => sixMonthTrend(db, month), [month]);
  const balances = useAppQuery((db) => allBucketBalances(db));
  const total = useAppQuery((db) => totalMoney(db));
  const utang = useAppQuery((db) => utangTotals(db));

  // Top 5 categories keep their fixed-order slot color; the rest fold into "Others".
  const top = (byCategory ?? []).slice(0, TOP_CATEGORIES);
  const rest = (byCategory ?? []).slice(TOP_CATEGORIES);
  const restTotal = rest.reduce((acc, r) => acc + r.total, 0);
  const slices = [
    ...top.map((c, i) => ({ ...c, color: chartCategorical[i] })),
    ...(restTotal > 0
      ? [
          {
            categoryId: null,
            categoryName: 'Others',
            total: restTotal,
            pct: rest.reduce((acc, r) => acc + r.pct, 0),
            color: chartOther,
          },
        ]
      : []),
  ];

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

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.monthNav}>
        <Pressable onPress={() => setMonth(shiftMonth(month, -1))} hitSlop={12}>
          <Text style={styles.monthArrow}>‹</Text>
        </Pressable>
        <Text style={styles.monthLabel}>{monthLabel(month)}</Text>
        <Pressable onPress={() => setMonth(shiftMonth(month, 1))} hitSlop={12}>
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
        {slices.length === 0 ? (
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
                  <Text style={styles.donutCenter}>{formatPeso(summary?.expenses ?? 0)}</Text>
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
                <Text style={styles.categoryName}>{s.categoryName}</Text>
                <Text style={styles.categoryAmount}>{formatPeso(s.total)}</Text>
              </View>
            ))}
          </View>
        )}

        <Text style={styles.sectionTitle}>Last 6 months</Text>
        {barData.length === 0 ? (
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
            noOfSections={3}
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
        </View>
        )}

        <Text style={styles.sectionTitle}>Money per bucket</Text>
        <View style={styles.card}>
          {(balances ?? []).map(({ bucket, balance }) => (
            <View key={bucket.id} style={styles.categoryRow}>
              <View style={styles.bucketName}>
                <Icon name={bucket.icon} size={15} color={colors.inkDim} />
                <Text style={styles.categoryName}>{bucket.name}</Text>
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
    paddingVertical: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    marginTop: spacing.xs,
  },
  bucketName: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  categoryName: { fontFamily: fonts.body, fontSize: 14, color: colors.ink },
  categoryAmount: { fontFamily: fonts.display, fontSize: 14, color: colors.ink },
  totalRow: { borderTopWidth: 1 },
  empty: { fontFamily: fonts.body, fontSize: 14, color: colors.inkFaint, paddingVertical: spacing.sm },
});
