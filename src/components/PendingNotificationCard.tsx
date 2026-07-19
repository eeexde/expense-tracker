import { Pressable, StyleSheet, Text, View } from 'react-native';
import { PendingNotification } from '@/db/schema';
import { formatPeso } from '@/lib/money';
import { colors, fonts, radii, spacing } from '@/theme';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Merchant label with a fallback to a slice of the raw notification text. */
export function merchantLabel(row: PendingNotification): string {
  return row.parsedMerchant || row.rawText.slice(0, 60);
}

/** Days left before this row auto-commits, or a discard notice if it has no amount. */
function expiryLabel(row: PendingNotification): string {
  if (row.parsedAmount == null) return 'Will be discarded';
  const daysLeft = Math.max(0, Math.ceil(2 - (Date.now() - Date.parse(row.postedAt)) / DAY_MS));
  return `Auto-logs in ${daysLeft}d`;
}

/** 'YYYY-MM-DD' in the device's local timezone — mirrors notificationRepo's private localDateOf. */
function localDateOf(iso: string): string {
  const d = new Date(iso);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

type Props = {
  row: PendingNotification;
  bucketName: string;
  /** True while any row on the screen is committing/discarding — disables actions. */
  busy: boolean;
  onConfirm: (id: number) => void;
  onEdit: (row: PendingNotification) => void;
  onDiscard: (row: PendingNotification) => void;
};

/** One pending auto-log notification with confirm / edit / discard actions. */
export function PendingNotificationCard({ row, bucketName, busy, onConfirm, onEdit, onDiscard }: Props) {
  const directionLabel =
    row.parsedType === 'expense' ? 'Expense' : row.parsedType === 'income' ? 'Income' : '?';
  const noAmount = row.parsedAmount == null;

  return (
    <View style={styles.card}>
      <View style={styles.cardTopRow}>
        <Text style={styles.merchant} numberOfLines={1}>
          {merchantLabel(row)}
        </Text>
        <Text style={styles.amount}>{noAmount ? 'No amount' : formatPeso(row.parsedAmount!)}</Text>
      </View>
      <Text style={styles.sub}>
        {directionLabel} · {bucketName} · {localDateOf(row.postedAt)}
      </Text>
      <Text style={styles.expiry}>{expiryLabel(row)}</Text>
      <View style={styles.actionsRow}>
        <Pressable
          style={[styles.actionBtn, styles.confirmBtn, (busy || noAmount) && styles.actionBtnDisabled]}
          onPress={() => onConfirm(row.id)}
          disabled={busy || noAmount}
          accessibilityRole="button"
          testID={`confirm-${row.id}`}
        >
          <Text style={[styles.actionText, styles.confirmText]}>Confirm</Text>
        </Pressable>
        <Pressable
          style={[styles.actionBtn, styles.editBtn, busy && styles.actionBtnDisabled]}
          onPress={() => onEdit(row)}
          disabled={busy}
          accessibilityRole="button"
          testID={`edit-${row.id}`}
        >
          <Text style={styles.actionText}>Edit</Text>
        </Pressable>
        <Pressable
          style={[styles.actionBtn, styles.discardBtn, busy && styles.actionBtnDisabled]}
          onPress={() => onDiscard(row)}
          disabled={busy}
          accessibilityRole="button"
          testID={`discard-${row.id}`}
        >
          <Text style={[styles.actionText, styles.discardText]}>Discard</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radii.md,
    padding: spacing.md,
    gap: 4,
  },
  cardTopRow: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.sm },
  merchant: { flex: 1, fontFamily: fonts.bodyMedium, fontSize: 15, color: colors.ink },
  amount: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.ink },
  sub: { fontFamily: fonts.body, fontSize: 13, color: colors.inkFaint },
  expiry: { fontFamily: fonts.body, fontSize: 12, color: colors.gold },
  actionsRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xs },
  actionBtn: {
    flex: 1,
    borderRadius: radii.sm,
    paddingVertical: spacing.sm,
    alignItems: 'center',
    borderWidth: 1,
  },
  actionBtnDisabled: { opacity: 0.35 },
  confirmBtn: { backgroundColor: colors.gold, borderColor: colors.gold },
  editBtn: { backgroundColor: colors.surfaceRaised, borderColor: colors.border },
  discardBtn: { backgroundColor: colors.surfaceRaised, borderColor: colors.border },
  actionText: { fontFamily: fonts.bodyBold, fontSize: 13, color: colors.ink },
  confirmText: { color: colors.bg },
  discardText: { color: colors.danger },
});
