import { rollUp, completion } from './rollup';

describe('rollUp', () => {
  it('is None without acknowledgements', () => expect(rollUp([])).toBe('None'));
  it('prefers Overdue over everything', () =>
    expect(rollUp(['Done', 'Pending', 'Overdue'])).toBe('Overdue'));
  it('is Done only at 100 percent', () => {
    expect(rollUp(['Done', 'Done'])).toBe('Done');
    expect(rollUp(['Done', 'Pending'])).toBe('Pending');
  });
  it('is Obsolete only if all are obsolete', () => {
    expect(rollUp(['Obsolete', 'Obsolete'])).toBe('Obsolete');
    expect(rollUp(['Obsolete', 'Pending'])).toBe('Pending');
  });
});

describe('completion', () => {
  it('reports percentage done', () =>
    expect(completion(['Done', 'Done', 'Pending', 'Overdue']).pct).toBe(50));
});
