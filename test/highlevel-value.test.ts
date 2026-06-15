import { describe, expect, it } from 'vitest';
import { SUI, coinInfo, coinTag, price } from '../src/highlevel/value.js';

describe('highlevel/value — Price', () => {
  it('renders mist in coin units and stays exact', () => {
    const p = price(500_000_000n); // 0.5 SUI
    expect(p.mist).toBe(500_000_000n);
    expect(p.format()).toBe('0.50 SUI');
    expect(`${p}`).toBe('0.50 SUI'); // toString = format
    expect(p.toSui()).toBe(0.5);
  });

  it('renders whole amounts', () => {
    expect(price(1_000_000_000n).format()).toBe('1.00 SUI');
    expect(price(900_000_000n).format()).toBe('0.90 SUI');
  });

  it('keeps full precision in .mist regardless of 2-decimal display', () => {
    const p = price(1_234_567_891n);
    expect(p.mist).toBe(1_234_567_891n);
    expect(p.format()).toBe('1.23 SUI');
  });
});

describe('highlevel/value — SUI tag', () => {
  it('is both a coin tag and a Price constructor', () => {
    expect(SUI.type).toBe('0x2::sui::SUI');
    expect(SUI.decimals).toBe(9);
    const p = SUI(0.5);
    expect(p.mist).toBe(500_000_000n);
    expect(p.format()).toBe('0.50 SUI');
  });

  it('rounds whole-coin input to exact mist', () => {
    expect(SUI(0.000_000_001).mist).toBe(1n);
    expect(SUI(2).mist).toBe(2_000_000_000n);
  });
});

describe('highlevel/value — coinInfo / coinTag', () => {
  it('recognises SUI by type suffix', () => {
    expect(coinInfo('0x2::sui::SUI').symbol).toBe('SUI');
  });

  it('derives a symbol from the last type segment for unknown coins', () => {
    const info = coinInfo('0x97fb::dummy_coin::DUMMY_COIN');
    expect(info.symbol).toBe('DUMMY_COIN');
    expect(info.decimals).toBe(9);
  });

  it('builds a usable tag for an arbitrary coin', () => {
    const DUMMY = coinTag({ type: '0xabc::c::C', decimals: 6, symbol: 'C' });
    const p = DUMMY(1);
    expect(p.mist).toBe(1_000_000n);
    expect(p.format()).toBe('1.00 C');
  });
});
