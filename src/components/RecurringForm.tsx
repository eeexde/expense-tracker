import { useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Bucket, Category } from '@/db/schema';
import { centavosToInput, parsePesoInput } from '@/lib/money';
import {
  ChipRow,
  FormTextInput,
  formStyles,
  KeyboardAwareForm,
  NUMERIC_PAD_HAS_RETURN_KEY,
  NUMERIC_PAD_NEXT,
  Segmented,
  SubmitButton,
  useSubmitGuard,
} from './form';
import { colors, fonts, radii, spacing } from '@/theme';

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const AMOUNT_ERROR = 'Invalid amount — use numbers like 1200.50.';
const DAY_ERROR = 'Day must be a whole number from 1 to 31.';

export interface RecurringFormValues {
  name: string;
  amount: number;
  frequency: 'monthly' | 'weekly';
  /** monthly: 1-31. weekly: 0-6, Sunday=0. */
  dayDue: number;
  bucketId: number;
  categoryId?: number;
  /** Buckets tried, in order, when the one before cannot cover the amount. */
  fallbackBucketIds: number[];
}

interface Props {
  buckets: Bucket[];
  categories: Category[];
  initial?: RecurringFormValues;
  onSubmit: (values: RecurringFormValues) => void | Promise<void>;
}

/** Shared by the add and edit recurring screens. */
export function RecurringForm({ buckets, categories, initial, onSubmit }: Props) {
  const [name, setName] = useState(initial?.name ?? '');
  const [amountText, setAmountText] = useState(
    initial ? centavosToInput(initial.amount) : '',
  );
  const [frequency, setFrequency] = useState<'monthly' | 'weekly'>(initial?.frequency ?? 'monthly');
  const [dayDueText, setDayDueText] = useState(
    initial && initial.frequency === 'monthly' ? String(initial.dayDue) : '1',
  );
  const [weekday, setWeekday] = useState(
    initial && initial.frequency === 'weekly' ? initial.dayDue : 1, // Monday
  );
  const [bucketId, setBucketId] = useState<number | undefined>(initial?.bucketId);
  const [fallbackIds, setFallbackIds] = useState<number[]>(initial?.fallbackBucketIds ?? []);
  const [categoryId, setCategoryId] = useState<number | undefined>(initial?.categoryId);
  const amountRef = useRef<TextInput>(null);
  const dayDueRef = useRef<TextInput>(null);

  const amount = parsePesoInput(amountText);
  const amountInvalid = amountText.trim() !== '' && amount === null;
  const dayDue = frequency === 'monthly' ? Number(dayDueText) : weekday;
  const dayDueValid =
    frequency === 'weekly' || (Number.isInteger(dayDue) && dayDue >= 1 && dayDue <= 31);
  const valid = name.trim() !== '' && amount !== null && bucketId !== undefined && dayDueValid;

  const [submitting, submit] = useSubmitGuard(async () => {
    if (!valid || amount === null || bucketId === undefined) return;
    await onSubmit({
      name: name.trim(),
      amount,
      frequency,
      dayDue,
      bucketId,
      categoryId,
      fallbackBucketIds: fallbackIds,
    });
  });

  const bucketById = new Map(buckets.map((b) => [b.id, b]));
  // A bucket appears in the chain once: not offered again as a fallback, and
  // dropped from the fallbacks the moment it is promoted to primary.
  const unusedBuckets = buckets.filter((b) => b.id !== bucketId && !fallbackIds.includes(b.id));

  const choosePrimary = (id: number) => {
    setBucketId(id);
    setFallbackIds((ids) => ids.filter((f) => f !== id));
  };
  const addFallback = (id: number) =>
    setFallbackIds((ids) => (ids.includes(id) ? ids : [...ids, id]));
  const removeFallback = (id: number) => setFallbackIds((ids) => ids.filter((f) => f !== id));
  const moveFallback = (index: number, delta: number) =>
    setFallbackIds((ids) => {
      const to = index + delta;
      if (to < 0 || to >= ids.length) return ids;
      const next = [...ids];
      [next[index], next[to]] = [next[to], next[index]];
      return next;
    });

  return (
    <KeyboardAwareForm>
      <Text style={formStyles.label}>Name</Text>
      <FormTextInput
        style={formStyles.textInput}
        value={name}
        onChangeText={setName}
        placeholder="e.g. Electricity"
        placeholderTextColor={colors.inkFaint}
        returnKeyType="next"
        submitBehavior="submit"
        onSubmitEditing={() => amountRef.current?.focus()}
      />

      <Text style={formStyles.label}>Amount</Text>
      <FormTextInput
        ref={amountRef}
        style={[formStyles.textInput, amountInvalid && formStyles.textInputError]}
        value={amountText}
        onChangeText={setAmountText}
        placeholder="0.00"
        placeholderTextColor={colors.inkFaint}
        keyboardType="decimal-pad"
        accessibilityLabel="Amount"
        accessibilityHint={amountInvalid ? AMOUNT_ERROR : undefined}
        // Weekly mode picks the day from chips, so there is no next field to jump to.
        {...(NUMERIC_PAD_HAS_RETURN_KEY && frequency === 'monthly'
          ? { ...NUMERIC_PAD_NEXT, onSubmitEditing: () => dayDueRef.current?.focus() }
          : null)}
      />
      {amountInvalid && <Text style={errorHint}>{AMOUNT_ERROR}</Text>}

      <Text style={formStyles.label}>How often</Text>
      <Segmented
        options={[
          { value: 'monthly', label: 'Monthly' },
          { value: 'weekly', label: 'Weekly' },
        ]}
        value={frequency}
        onChange={setFrequency}
      />

      {frequency === 'monthly' ? (
        <>
          <Text style={formStyles.label}>Day of month (1–31)</Text>
          <FormTextInput
            ref={dayDueRef}
            style={[formStyles.textInput, !dayDueValid && formStyles.textInputError]}
            value={dayDueText}
            onChangeText={setDayDueText}
            keyboardType="number-pad"
            accessibilityLabel="Day of month (1 to 31)"
            accessibilityHint={dayDueValid ? undefined : DAY_ERROR}
          />
          {!dayDueValid && <Text style={errorHint}>{DAY_ERROR}</Text>}
        </>
      ) : (
        <>
          <Text style={formStyles.label}>Day of week</Text>
          <ChipRow
            items={WEEKDAYS.map((label, i) => ({ id: i, label }))}
            selectedId={weekday}
            onSelect={setWeekday}
          />
        </>
      )}

      <Text style={formStyles.label}>From bucket</Text>
      <ChipRow
        items={buckets.map((b) => ({ id: b.id, label: b.name, icon: b.icon }))}
        selectedId={bucketId}
        onSelect={choosePrimary}
      />

      <Text style={formStyles.label}>If it can’t cover it, try next</Text>
      {fallbackIds.map((id, index) => {
        const bucket = bucketById.get(id);
        if (!bucket) return null;
        return (
          <View key={id} style={styles.chainRow}>
            <Text style={styles.chainPosition}>{index + 2}</Text>
            <Text style={styles.chainName} numberOfLines={1}>
              {bucket.name}
            </Text>
            <Pressable
              style={styles.chainButton}
              onPress={() => moveFallback(index, -1)}
              disabled={index === 0}
              accessibilityRole="button"
              accessibilityLabel={`Move ${bucket.name} earlier`}
              accessibilityState={{ disabled: index === 0 }}
            >
              <Text style={[styles.chainIcon, index === 0 && styles.chainIconOff]}>↑</Text>
            </Pressable>
            <Pressable
              style={styles.chainButton}
              onPress={() => moveFallback(index, 1)}
              disabled={index === fallbackIds.length - 1}
              accessibilityRole="button"
              accessibilityLabel={`Move ${bucket.name} later`}
              accessibilityState={{ disabled: index === fallbackIds.length - 1 }}
            >
              <Text
                style={[
                  styles.chainIcon,
                  index === fallbackIds.length - 1 && styles.chainIconOff,
                ]}
              >
                ↓
              </Text>
            </Pressable>
            <Pressable
              style={styles.chainButton}
              onPress={() => removeFallback(id)}
              accessibilityRole="button"
              accessibilityLabel={`Remove ${bucket.name} from the chain`}
            >
              <Text style={[styles.chainIcon, styles.chainRemove]}>✕</Text>
            </Pressable>
          </View>
        );
      })}
      {unusedBuckets.length > 0 && (
        <ChipRow
          items={unusedBuckets.map((b) => ({ id: b.id, label: b.name, icon: b.icon }))}
          selectedId={undefined}
          onSelect={addFallback}
        />
      )}
      <Text style={styles.chainHint}>
        {fallbackIds.length === 0
          ? 'Optional. With no fallback, this posts from the bucket above even if it runs dry.'
          : 'Tried in order. The whole amount comes from one bucket — never split. If none can cover it, nothing is posted until one can.'}
      </Text>

      <Text style={formStyles.label}>Category</Text>
      <ChipRow
        items={categories.map((c) => ({ id: c.id, label: c.name, icon: c.icon }))}
        selectedId={categoryId}
        onSelect={(id) => setCategoryId(categoryId === id ? undefined : id)}
      />

      <SubmitButton label="Save" disabled={!valid} submitting={submitting} onPress={submit} />
    </KeyboardAwareForm>
  );
}

const errorHint = { color: colors.danger, fontSize: 13, marginTop: 4 };

const styles = StyleSheet.create({
  chainRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radii.md,
    paddingLeft: spacing.sm,
    marginBottom: spacing.xs,
    gap: spacing.xs,
  },
  chainPosition: { fontFamily: fonts.display, fontSize: 13, color: colors.gold, minWidth: 14 },
  chainName: { flex: 1, fontFamily: fonts.bodyMedium, fontSize: 14, color: colors.ink },
  // 44px minimum tap target, as elsewhere — the glyph alone is about half that.
  chainButton: { minWidth: 44, minHeight: 44, justifyContent: 'center', alignItems: 'center' },
  chainIcon: { fontFamily: fonts.bodyBold, fontSize: 16, color: colors.inkDim },
  chainIconOff: { color: colors.border },
  chainRemove: { color: colors.danger },
  chainHint: { fontFamily: fonts.body, fontSize: 11, color: colors.inkFaint, marginTop: spacing.xs },
});
