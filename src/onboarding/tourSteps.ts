/**
 * The walkthrough as data. Every step names the tab it belongs to; the
 * provider navigates there before showing it. `targetId` is optional — a step
 * without one (and any step whose target never registers) renders as a
 * centered card.
 */

export type TabRoute =
  | '/(tabs)'
  | '/(tabs)/transactions'
  | '/(tabs)/recurring'
  | '/(tabs)/utang'
  | '/(tabs)/stats';

/** A measured target, in window coordinates. */
export type Rect = { x: number; y: number; width: number; height: number };

export type TourStep = {
  /** Stable id; also the overlay card's testID suffix. */
  id: string;
  tab: TabRoute;
  targetId?: string;
  title: string;
  body: string;
};

export const ONBOARDING_COMPLETED_KEY = 'onboardingCompleted';

export const TOUR_STEPS: readonly TourStep[] = [
  {
    id: 'welcome',
    tab: '/(tabs)',
    title: 'Welcome to Kuripot',
    body: 'A quick tour of the five tabs and what each one is for. About 30 seconds — you can skip any time.',
  },
  {
    id: 'total',
    tab: '/(tabs)',
    targetId: 'home.total',
    title: 'Your total money',
    body: 'Every bucket added up. This is what you actually have, across cash, banks and e-wallets.',
  },
  {
    id: 'buckets',
    tab: '/(tabs)',
    targetId: 'home.buckets',
    title: 'Buckets hold your money',
    body: 'A bucket is one place money sits — Cash, GCash, a bank, a credit card. Tap one to see only its transactions.',
  },
  {
    id: 'recent',
    tab: '/(tabs)',
    targetId: 'home.recent',
    title: 'Recent activity',
    body: 'Your last ten transactions. Tap any row to edit or delete it.',
  },
  {
    id: 'add',
    tab: '/(tabs)',
    targetId: 'home.add',
    title: 'Log an expense',
    body: 'The + button records an expense, income, or a transfer between two buckets.',
  },
  {
    id: 'settings',
    tab: '/(tabs)',
    targetId: 'home.settings',
    title: 'Settings and backups',
    body: 'The gear holds category management, JSON backup and restore, and auto-logging from bank notifications.',
  },
  {
    id: 'transactions',
    tab: '/(tabs)/transactions',
    targetId: 'tab.transactions',
    title: 'Transactions',
    body: 'Your whole history, filtered by month, type, bucket or category.',
  },
  {
    id: 'inbox',
    tab: '/(tabs)/transactions',
    targetId: 'transactions.inbox',
    title: 'Notification inbox',
    body: 'When auto-log catches a bank notification it waits here, so nothing is recorded without you confirming it.',
  },
  {
    id: 'recurring',
    tab: '/(tabs)/recurring',
    targetId: 'tab.recurring',
    title: 'Recurring and installments',
    body: 'Bills that repeat, and purchases you pay off monthly. Kuripot posts them for you on their due dates.',
  },
  {
    id: 'utang',
    tab: '/(tabs)/utang',
    targetId: 'tab.utang',
    title: 'Utang',
    body: 'Money you owe and money owed to you, with partial payments tracked against each debt.',
  },
  {
    id: 'stats',
    tab: '/(tabs)/stats',
    targetId: 'tab.stats',
    title: 'Stats',
    body: 'Six-month trends, spending by category, and what your monthly commitments add up to.',
  },
  {
    id: 'done',
    tab: '/(tabs)',
    title: "That's the tour",
    body: 'Start by adding a bucket for your cash, then log your first expense. Replay this any time from Settings.',
  },
];
