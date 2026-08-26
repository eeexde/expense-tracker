import { findAmountCandidates, parseNotification } from './notificationParser';

describe('parseNotification', () => {
  it('parses a GCash send as high-confidence expense', () => {
    const r = parseNotification('You have sent PHP 150.00 to JOLLIBEE MAKATI via GCash.');
    expect(r).toEqual({
      amountCentavos: 15000,
      amountCandidates: [15000],
      merchant: 'JOLLIBEE MAKATI',
      direction: 'expense',
      promotional: false,
      confidence: 'high',
    });
  });

  it('parses a card charge with peso sign and thousands', () => {
    const r = parseNotification('Your card was charged ₱1,234.56 at SM SUPERMALLS on 07/10.');
    expect(r.amountCentavos).toBe(123456);
    expect(r.direction).toBe('expense');
    expect(r.merchant).toBe('SM SUPERMALLS');
    expect(r.confidence).toBe('high');
  });

  it('parses received money as income', () => {
    const r = parseNotification('You have received PHP 500.00 from JUAN DELA CRUZ.');
    expect(r.direction).toBe('income');
    expect(r.amountCentavos).toBe(50000);
    expect(r.confidence).toBe('high');
  });

  it('amount without a direction verb is medium confidence', () => {
    const r = parseNotification('Transaction alert: PHP 99.00 JOLLIBEE ref 12345');
    expect(r.amountCentavos).toBe(9900);
    expect(r.direction).toBeNull();
    expect(r.confidence).toBe('medium');
  });

  it('no amount means none confidence', () => {
    const r = parseNotification('Enjoy 20% off at partner stores this weekend!');
    expect(r.amountCentavos).toBeNull();
    expect(r.confidence).toBe('none');
  });

  it('amount without centavos still parses', () => {
    const r = parseNotification('You paid PHP 1,500 to MERALCO');
    expect(r.amountCentavos).toBe(150000);
    expect(r.direction).toBe('expense');
  });

  it('when both verbs appear, the earlier one wins', () => {
    const r = parseNotification('You received a refund. Previously paid PHP 100.00 at STORE.');
    expect(r.direction).toBe('income');
  });

  it('does not mistake OTP codes for amounts', () => {
    const r = parseNotification('Your OTP 123456 confirms that you paid PHP 500.00 at JOLLIBEE.');
    expect(r.amountCentavos).toBe(50000);
    expect(r.direction).toBe('expense');
  });

  it('parses all-caps notifications including merchant', () => {
    const r = parseNotification('A CARD TRANSACTION OF PHP1,234.56 WAS MADE AT SM MEGAMALL ON 07/10/2026.');
    expect(r.amountCentavos).toBe(123456);
    expect(r.merchant).toBe('SM MEGAMALL');
  });

  it('single decimal digit pads to centavos', () => {
    expect(parseNotification('You paid PHP 99.5 to STORE').amountCentavos).toBe(9950);
  });

  it('parses HTML email snippets with tags around the fields', () => {
    const r = parseNotification(
      '<p>You have <b>sent</b> PHP 150.00 to <span style="color:red">JOLLIBEE</span>.</p>',
    );
    expect(r.amountCentavos).toBe(15000);
    expect(r.direction).toBe('expense');
    expect(r.merchant).toBe('JOLLIBEE');
    expect(r.confidence).toBe('high');
  });

  it('decodes HTML entities: peso sign, nbsp, amp', () => {
    const r = parseNotification('You paid &#8369;1,234.56 at M&amp;M&nbsp;BAKERY.');
    expect(r.amountCentavos).toBe(123456);
    expect(r.direction).toBe('expense');
    expect(r.merchant).toBe('M&M BAKERY');
  });

  it('decodes hex entities and survives amounts split by nbsp', () => {
    const r = parseNotification('Charged &#x20B1;&nbsp;99.00 at STORE.');
    expect(r.amountCentavos).toBe(9900);
    expect(r.direction).toBe('expense');
  });

  it('collapses multi-line HTML table layouts', () => {
    const r = parseNotification(
      '<table><tr><td>Amount:</td>\n<td>PHP 2,500.00</td></tr>\n<tr><td>You paid at</td><td>MERALCO</td></tr></table>',
    );
    expect(r.amountCentavos).toBe(250000);
    expect(r.direction).toBe('expense');
  });

  it('parses an Atome card email notification (real sample)', () => {
    const r = parseNotification(
      'Dear Edrian, We are pleased to inform you that your payment of ₱286.50 for OSAVE HAN 838 YATI LILOAN PHL using your Atome Card ending in *6982 has been successfully processed. Thank you for using Atome.',
    );
    expect(r.amountCentavos).toBe(28650);
    expect(r.direction).toBe('expense');
    expect(r.merchant).toBe('OSAVE HAN 838 YATI LILOAN PHL');
    expect(r.confidence).toBe('high');
  });

  it('BPI Pay via QR email logs as expense despite "credited" rewards footer', () => {
    const r = parseNotification(
      'Dear EDRIAN, You have successfully completed your Pay via QR transaction with the following details: Pay via QR Details Confirmation Number R1783810615393108935 Date and Time Sunday, Jul 12 2026; 06:56:55 AM (GMT+8) Pay From XXXX-XXX-132 (SAVINGS ACCOUNT) Pay To Atome Amount PHP 4,986.78 Transaction Ref No. 004619306759564 Notes Keep using the BPI app to Pay via QR and earn BPI Rewards Points for every transaction worth at least Php 400. Your BPI Points will be credited within 60 days after month-end.',
    );
    expect(r.amountCentavos).toBe(498678);
    expect(r.direction).toBe('expense');
    expect(r.confidence).toBe('high');
  });

  it('invalid numeric entities do not throw', () => {
    expect(() => parseNotification('Broken &#99999999; PHP 10.00 paid')).not.toThrow();
    expect(parseNotification('Broken &#99999999; PHP 10.00 paid').amountCentavos).toBe(1000);
  });

  it('BPI incoming Instapay email logs as income despite "sent via" in body', () => {
    const r = parseNotification(
      'Incoming Interbank Funds Transfer Confirmation Dear EDRIAN, You have an incoming interbank funds transfer sent via Instapay with the following details. Interbank Funds Transfer Transaction Details Reference Number 20260713MBTCPHMMXXXB600000000633152 Transaction Date and Time Monday, Jul 13 2026; 05:29:44 PM(GMT + 8) Transfer From XXXXXXXXX1717 Transfer To XXXXXX0132 Bank Name Metropolitan Bank and Trust Company Transfer Amount PHP 15,337.00 Transfer Service INSTAPAY Important Reminders: Successful transactions will be credited real-time.',
    );
    expect(r.amountCentavos).toBe(1533700);
    expect(r.direction).toBe('income');
    expect(r.confidence).toBe('high');
  });
});

describe('findAmountCandidates', () => {
  it('returns every currency-marked amount in source order as centavos', () => {
    expect(
      findAmountCandidates('Spend PHP 500 and get ₱100.50 cashback, up to Php 1,000.'),
    ).toEqual([50000, 10050, 100000]);
  });

  it('returns an empty list when nothing is currency-marked', () => {
    expect(findAmountCandidates('Your OTP is 123456. Ref 9988')).toEqual([]);
  });

  it('sanitizes HTML the same way parseNotification does', () => {
    expect(findAmountCandidates('You paid &#8369;1,234.56 at <b>M&amp;M</b>.')).toEqual([123456]);
  });

  it('agrees with parseNotification: the first candidate is the parsed amount', () => {
    const text = 'Get ₱50 off when you spend PHP 1,000 at partner stores.';
    const r = parseNotification(text);
    expect(r.amountCandidates).toEqual(findAmountCandidates(text));
    expect(r.amountCentavos).toBe(r.amountCandidates[0]);
  });
});

describe('promotional heuristic', () => {
  // Real GCash promo blasts — every one of these carries a peso amount the old
  // regex happily turned into a transaction.
  it.each([
    ['GCash: Get up to ₱500 cashback when you pay bills this weekend!'],
    ['Spend ₱1,000 at partner stores and win ₱10,000 in GCash credits!'],
    ['Enjoy 20% off your next GrabFood order — vouchers worth ₱150. Claim yours now!'],
    ['Load promos as low as PHP 50! Buy now, promo expires Aug 31.'],
    ['Your ₱200 discount voucher is waiting. Claim it in the GCash app.'],
  ])('flags promotional blast and discards it: %s', (text) => {
    const r = parseNotification(text);
    expect(r.promotional).toBe(true);
    expect(r.confidence).toBe('none');
    // The amount is still surfaced — the LLM gets it as a candidate and may
    // overrule the heuristic.
    expect(r.amountCandidates.length).toBeGreaterThan(0);
    expect(r.amountCentavos).toBe(r.amountCandidates[0]);
  });

  // Real transaction notifications must never trip the heuristic.
  it.each([
    ['You have sent PHP 150.00 to JOLLIBEE MAKATI via GCash. Ref. No. 1234567890'],
    ['You have received PHP 500.00 from JUAN DELA CRUZ. Your new balance is PHP 1,200.00.'],
    ['Your GCash account was debited PHP 1,234.56 for MERALCO bill payment.'],
    ['Your card was charged ₱1,234.56 at SM SUPERMALLS on 07/10.'],
  ])('does not flag a real transaction: %s', (text) => {
    const r = parseNotification(text);
    expect(r.promotional).toBe(false);
    expect(r.confidence).toBe('high');
  });

  it('does not fire on "budget", "target" or "spent" (substring safety)', () => {
    const r = parseNotification('You spent PHP 100.00 on your budget target at STORE.');
    expect(r.promotional).toBe(false);
    expect(r.direction).toBe('expense');
  });

  // The heuristic's dangerous edge: a real receipt whose footer sells something.
  // Discarding these loses money the user actually spent, with no inbox row left
  // to recover it from — so a verb that PRECEDES the promo wording keeps the
  // notification alive, at 'medium' (inbox) rather than 'high' (auto-commit).
  it.each([
    ['You paid PHP 286.50 to OSAVE. Get your e-receipt in the app.'],
    ['Your card was charged PHP 1,234.56 at SM SUPERMALLS. Card expires 09/26.'],
    ['You have sent PHP 150.00 to JOLLIBEE. Enjoy 20% off your next order!'],
  ])('queues a real transaction with a promo footer instead of discarding: %s', (text) => {
    const r = parseNotification(text);
    expect(r.promotional).toBe(true);
    expect(r.confidence).toBe('medium');
    expect(r.amountCentavos).not.toBeNull();
  });

  it('still discards a blast whose pitch leads the verb', () => {
    // "Get" at index 7 beats "pay" at index 34 — earliest-wins says marketing.
    const r = parseNotification('GCash: Get up to PHP 500 cashback when you pay bills!');
    expect(r.confidence).toBe('none');
  });

  it('leaves the BPI rewards footer alone', () => {
    const r = parseNotification(
      'Pay To Atome Amount PHP 4,986.78 Notes Keep using the BPI app to Pay via QR and earn BPI Rewards Points for every transaction worth at least Php 400.',
    );
    expect(r.promotional).toBe(false);
    expect(r.confidence).toBe('high');
  });
});
