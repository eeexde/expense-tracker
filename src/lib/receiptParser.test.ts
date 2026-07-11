import { parseReceipt, parseTransactionImage } from './receiptParser';

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

describe('parseTransactionImage', () => {
  it('keeps receipt heuristics for receipt-shaped text', () => {
    const result = parseTransactionImage(SM_RECEIPT);
    expect(result.amountCentavos).toBe(42350);
    expect(result.merchant).toBe('SM SUPERMARKET');
    expect(result.direction).toBeNull();
  });

  it('reads a GCash send-money screenshot as an expense', () => {
    const text = `GCash
You have sent PHP 1,250.00 to JUAN DELA CRUZ
via GCash on 07/10/2026. Ref No. 900123456.`;
    const result = parseTransactionImage(text);
    expect(result.amountCentavos).toBe(125000);
    expect(result.merchant).toBe('JUAN DELA CRUZ');
    expect(result.direction).toBe('expense');
  });

  it('reads a received-money screenshot as income', () => {
    const text = `Maya
You received P500.00 from MARIA SANTOS.
Available balance: P2,340.11`;
    const result = parseTransactionImage(text);
    expect(result.amountCentavos).toBe(50000);
    expect(result.merchant).toBe('MARIA SANTOS');
    expect(result.direction).toBe('income');
  });

  it('a TOTAL line wins over payment verbs elsewhere in the text', () => {
    const text = `MERCURY DRUG
BIOGESIC 500MG x10  42.50
TOTAL 110.50
Amount paid in CASH 200.00`;
    const result = parseTransactionImage(text);
    expect(result.amountCentavos).toBe(11050);
    expect(result.direction).toBeNull();
  });

  it('falls back to a currency-marked whole-peso amount the receipt regex misses', () => {
    // ("TINDAHAN" would trip the TIN filter in the merchant heuristic.)
    const result = parseTransactionImage('SARI-SARI NI ALING NENA\nbayad ₱500');
    expect(result.amountCentavos).toBe(50000);
    expect(result.merchant).toBe('SARI-SARI NI ALING NENA');
    expect(result.direction).toBeNull();
  });

  it('returns nulls on garbage', () => {
    const result = parseTransactionImage('%%%###\n@@@');
    expect(result.amountCentavos).toBeNull();
    expect(result.merchant).toBeNull();
    expect(result.direction).toBeNull();
  });
});
