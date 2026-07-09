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
});
