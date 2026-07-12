import { parseNotification } from './notificationParser';

describe('parseNotification', () => {
  it('parses a GCash send as high-confidence expense', () => {
    const r = parseNotification('You have sent PHP 150.00 to JOLLIBEE MAKATI via GCash.');
    expect(r).toEqual({
      amountCentavos: 15000,
      merchant: 'JOLLIBEE MAKATI',
      direction: 'expense',
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
});
