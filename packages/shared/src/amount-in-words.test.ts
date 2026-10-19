import { describe, expect, it } from 'vitest';
import { integerToFrenchWords, numberToFrenchWords } from './amount-in-words';

describe('integerToFrenchWords', () => {
  it.each([
    [0, 'zéro'],
    [1, 'un'],
    [10, 'dix'],
    [16, 'seize'],
    [17, 'dix-sept'],
    [20, 'vingt'],
    [21, 'vingt et un'],
    [22, 'vingt-deux'],
    [30, 'trente'],
    [41, 'quarante et un'],
    [61, 'soixante et un'],
    [70, 'soixante-dix'],
    [71, 'soixante et onze'],
    [72, 'soixante-douze'],
    [79, 'soixante-dix-neuf'],
    [80, 'quatre-vingts'],
    [81, 'quatre-vingt-un'],
    [90, 'quatre-vingt-dix'],
    [91, 'quatre-vingt-onze'],
    [99, 'quatre-vingt-dix-neuf'],
    [100, 'cent'],
    [101, 'cent un'],
    [180, 'cent quatre-vingts'],
    [200, 'deux cents'],
    [201, 'deux cent un'],
    [999, 'neuf cent quatre-vingt-dix-neuf'],
    [1000, 'mille'],
    [1001, 'mille un'],
    [1100, 'mille cent'],
    [2000, 'deux mille'],
    [21000, 'vingt et un mille'],
    [80000, 'quatre-vingt mille'],
    [200000, 'deux cent mille'],
    [280300, 'deux cent quatre-vingt mille trois cents'],
    [1_000_000, 'un million'],
    [2_000_000, 'deux millions'],
    [80_000_000, 'quatre-vingts millions'],
    [200_000_000, 'deux cents millions'],
    [1_234_567, 'un million deux cent trente-quatre mille cinq cent soixante-sept'],
    [1_000_000_000, 'un milliard'],
    [3_000_001_000, 'trois milliards mille'],
  ])('%i → %s', (n, words) => {
    expect(integerToFrenchWords(n)).toBe(words);
  });

  it('handles values beyond Number.MAX_SAFE_INTEGER as bigint', () => {
    expect(integerToFrenchWords(1_000_000_000_000n)).toBe('mille milliards');
  });
});

describe('numberToFrenchWords', () => {
  it.each([
    ['0', 'zéro dinar algérien'],
    ['1', 'un dinar algérien'],
    ['2', 'deux dinars algériens'],
    ['21', 'vingt et un dinars algériens'],
    ['71', 'soixante et onze dinars algériens'],
    ['80', 'quatre-vingts dinars algériens'],
    ['81', 'quatre-vingt-un dinars algériens'],
    ['91', 'quatre-vingt-onze dinars algériens'],
    ['100', 'cent dinars algériens'],
    ['200', 'deux cents dinars algériens'],
    ['1000', 'mille dinars algériens'],
    ['1000000', 'un million de dinars algériens'],
    ['2000000', 'deux millions de dinars algériens'],
    ['2000500', 'deux millions cinq cents dinars algériens'],
    ['0.01', 'zéro dinar algérien et un centime'],
    ['1250.50', 'mille deux cent cinquante dinars algériens et cinquante centimes'],
    [
      '13293.51',
      'treize mille deux cent quatre-vingt-treize dinars algériens et cinquante et un centimes',
    ],
    ['80.80', 'quatre-vingts dinars algériens et quatre-vingts centimes'],
    [
      '999999999999.99',
      'neuf cent quatre-vingt-dix-neuf milliards neuf cent quatre-vingt-dix-neuf millions neuf cent quatre-vingt-dix-neuf mille neuf cent quatre-vingt-dix-neuf dinars algériens et quatre-vingt-dix-neuf centimes',
    ],
  ])('%s → %s', (amount, words) => {
    expect(numberToFrenchWords(amount)).toBe(words);
  });

  it('rounds half-up to the centime before writing', () => {
    expect(numberToFrenchWords('10.005')).toBe('dix dinars algériens et un centime');
  });

  it('writes negative amounts with "moins"', () => {
    expect(numberToFrenchWords('-5')).toBe('moins cinq dinars algériens');
  });
});
