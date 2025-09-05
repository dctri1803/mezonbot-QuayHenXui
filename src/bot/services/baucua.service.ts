import { Injectable } from '@nestjs/common';

export type Face = 'bau' | 'cua' | 'tom' | 'ca' | 'ga' | 'nai';

const FACES: Face[] = ['bau', 'cua', 'tom', 'ca', 'ga', 'nai'];

/**
 * Chuẩn hóa input: hỗ trợ alias tiếng Việt có dấu / không dấu.
 */
export function normalizeFace(raw: string): Face | null {
  const s = (raw || '').toLowerCase().trim();
  const map: Record<string, Face> = {
    'bau': 'bau', 'bầu': 'bau', 'bauu': 'bau',
    'cua': 'cua', 'cùa': 'cua',
    'tom': 'tom', 'tôm': 'tom',
    'ca': 'ca', 'cá': 'ca',
    'ga': 'ga', 'gà': 'ga',
    'nai': 'nai', 'nái': 'nai',
  };
  if (map[s]) return map[s];
  // fallback đơn giản bỏ dấu
  const ascii = s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd');
  return (map[ascii] as Face) || (FACES.includes(ascii as Face) ? (ascii as Face) : null);
}

@Injectable()
export class BauCuaService {
  // điểm tích lũy theo user trong từng channel
  // key: `${clanId}:${channelId}:${userId}`
  private scores = new Map<string, number>();

  roll(seed?: number): [Face, Face, Face] {
    // PRNG đơn giản nếu có seed (phục vụ test), mặc định dùng Math.random
    const rnd = seed != null
      ? (() => {
          // xorshift32
          let x = (seed >>> 0) || 123456789;
          return () => {
            x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
            return ((x >>> 0) % 10000) / 10000;
          };
        })()
      : Math.random;

    const pick = (): Face => FACES[Math.floor(rnd() * FACES.length)];
    return [pick(), pick(), pick()];
  }

  /**
   * Tính thưởng theo luật phổ biến:
   * - Mỗi lựa chọn là 1 cửa cược (khuyên 1–3 lựa chọn).
   * - Mỗi cửa ăn số lần xuất hiện * betUnit; không xuất hiện thì mất betUnit.
   * - Nếu đặt nhiều cửa: tổng tiền đặt = số cửa * betUnit.
   */
  settle(picks: Face[], betUnit: number, result: [Face, Face, Face]) {
    const counts: Record<Face, number> = { bau: 0, cua: 0, tom: 0, ca: 0, ga: 0, nai: 0 };
    result.forEach((f) => (counts[f] += 1));

    let win = 0;
    let lose = 0;
    const details: { pick: Face; appear: number; delta: number }[] = [];

    for (const p of picks) {
      const appear = counts[p] || 0;
      const delta = appear > 0 ? appear * betUnit : -betUnit;
      if (delta > 0) win += delta;
      else lose += -delta;
      details.push({ pick: p, appear, delta });
    }

    const wager = picks.length * betUnit;
    const net = win - lose; // dương là lời, âm là lỗ
    return { wager, win, lose, net, details, counts };
  }

  addScore(clanId: string, channelId: string, userId: string, delta: number) {
    const key = `${clanId}:${channelId}:${userId}`;
    const cur = this.scores.get(key) || 0;
    const next = cur + delta;
    this.scores.set(key, next);
    return next;
  }

  getScore(clanId: string, channelId: string, userId: string) {
    const key = `${clanId}:${channelId}:${userId}`;
    return this.scores.get(key) || 0;
  }
}
