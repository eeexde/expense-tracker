import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { useState } from 'react';
import { Text, TextInput } from 'react-native';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { AppDb } from '@/db/client';
// babel-plugin-jest-hoist lifts the jest.mock() below above this import, so
// `hooks` sees the stub provider rather than the real one (which would open a
// SQLite handle). The alias and the relative path `hooks.ts` itself uses
// resolve to the same module, so mocking either intercepts both.
import { useAppQuery } from '@/db/hooks';

jest.mock('@/db/DbProvider', () => ({
  useDb: () => ({ db: {} as AppDb, version: 0, refresh: jest.fn(), catchUp: null }),
}));

/** Query whose promise this test settles by hand, mid-form. */
let failQuery: (error: Error) => void = () => {};
const pendingQuery = () =>
  new Promise<string[]>((_resolve, reject) => {
    failQuery = reject;
  });

/** A modal form: a typed field the user cares about, plus a query it needs. */
function FormScreen() {
  const [note, setNote] = useState('');
  const rows = useAppQuery(pendingQuery);
  return (
    <>
      <TextInput testID="note" value={note} onChangeText={setNote} />
      <Text testID="rows">{rows === undefined ? 'loading' : rows.join(',')}</Text>
    </>
  );
}

/**
 * `useAppQuery` used to rethrow a first-load failure. The only thing above
 * these screens is the root `ErrorBoundary` — above the router *and* the
 * `DbProvider` — so that did not surface an error beside the dead section, it
 * replaced the whole app and threw away whatever was half-typed. Before the
 * diff the same failure left a spinner. Trading a common mild failure for a
 * rare severe one is the wrong way round; screens that can do better opt into
 * `useAppQueryResult` + `QueryErrorNotice` instead.
 */
describe('useAppQuery on a rejected first load', () => {
  it('leaves a half-filled form standing', async () => {
    await render(
      <ErrorBoundary>
        <FormScreen />
      </ErrorBoundary>,
    );
    await fireEvent.changeText(screen.getByTestId('note'), 'Chickenjoy');

    await act(async () => {
      failQuery(new Error('database disk image is malformed'));
    });

    expect(screen.getByTestId('note').props.value).toBe('Chickenjoy');
  });

  it('keeps reporting loading rather than throwing', async () => {
    // No boundary at all: a throw here would escape `render` outright, which is
    // the point — an un-upgraded call site must never be worse than the eternal
    // spinner it had before.
    await render(<FormScreen />);

    await act(async () => {
      failQuery(new Error('database disk image is malformed'));
    });

    expect(screen.getByTestId('rows').props.children).toBe('loading');
  });
});
