import {
  formatMoneyInput,
  parseNumberInput,
  sanitizeDecimalInput,
} from '../src/screens/ProductsScreen';

describe('product money inputs', () => {
  it('keeps a suggested COP cost at its original scale', () => {
    const displayed = formatMoneyInput(2300.75);

    expect(displayed).toBe('2.300,75');
    expect(parseNumberInput(displayed)).toBe(2300.75);
  });

  it('does not add thousands separators while the user is editing', () => {
    expect(sanitizeDecimalInput('2300')).toBe('2300');
    expect(sanitizeDecimalInput('2300,50')).toBe('2300,50');
    expect(sanitizeDecimalInput('2300.50')).toBe('2300,50');
  });
});
