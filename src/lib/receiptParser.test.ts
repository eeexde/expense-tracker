import { parseReceipt } from './receiptParser';

const SM_RECEIPT = `SM SUPERMARKET
SM City Cebu
TIN 000-123-456-789 VAT REG
07/01/2026 14:32

BEAR BRAND 320G     89.50
LUCKY ME PANCIT x3  45.00
RICE 5KG           289.00

SUBTOTAL           423.50
VAT 12%             50.82
TOTAL              423.50
CASH               500.00
CHANGE              76.50
Thank you for shopping!`;

const SEVEN_ELEVEN = `7-ELEVEN
Store #2145 Quezon City
TIN: 201-543-888-000

COKE MISMO          25.00
SIOPAO ASADO        45.00

AMOUNT DUE          70.00
CASH TENDERED      100.00
CHANGE              30.00`;

const MERCURY = `MERCURY DRUG
Ayala Center Branch
07-02-2026

BIOGESIC 500MG x10  42.50
NEOZEP FORTE x10    68.00

TOTAL 110.50
CASH 200.00`;

describe('parseReceipt', () => {
  it('reads TOTAL line from SM receipt, ignoring CASH/CHANGE/VAT', () => {
    const result = parseReceipt(SM_RECEIPT);
    expect(result.amountCentavos).toBe(42350);
    expect(result.merchant).toBe('SM SUPERMARKET');
  });

  it('reads AMOUNT DUE from 7-Eleven receipt', () => {
    const result = parseReceipt(SEVEN_ELEVEN);
    expect(result.amountCentavos).toBe(7000);
    expect(result.merchant).toBe('7-ELEVEN');
  });

  it('reads inline TOTAL from Mercury receipt', () => {
    const result = parseReceipt(MERCURY);
    expect(result.amountCentavos).toBe(11050);
    expect(result.merchant).toBe('MERCURY DRUG');
  });

  it('falls back to largest amount when no total keyword', () => {
    const text = `TINDAHAN NI ALING NENA
skyflakes 15.00
kape 12.00
asukal 30.50`;
    expect(parseReceipt(text).amountCentavos).toBe(3050);
  });

  it('returns nulls on garbage', () => {
    const result = parseReceipt('%%%###\n@@@');
    expect(result.amountCentavos).toBeNull();
    expect(result.merchant).toBeNull();
  });
});
