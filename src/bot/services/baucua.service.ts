import { Injectable } from '@nestjs/common';
import type { TokenPort } from './token.port';

export type Face = 'bau' | 'cua' | 'tom' | 'ca' | 'ga' | 'nai';
const FACES: Face[] = ['bau', 'cua', 'tom', 'ca', 'ga', 'nai'];

export function normalizeFace(raw: string): Face | null {
  const s = (raw || '').toLowerCase().trim();
  const map: Record<string, Face> = {
    bau: 'bau',
    bầu: 'bau',
    cua: 'cua',
    cùa: 'cua',
    tom: 'tom',
    tôm: 'tom',
    ca: 'ca',
    cá: 'ca',
    ga: 'ga',
    gà: 'ga',
    nai: 'nai',
  };
  const exact = map[s];
  if (exact) return exact;
  const ascii = s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd');
  return (map[ascii] as Face) || null;
}

export function roll(seed?: number): [Face, Face, Face] {
  const rnd =
    seed != null
      ? (() => {
          let x = seed >>> 0 || 123456789;
          return () =>
            ((((x ^= x << 13), (x ^= x >>> 17), (x ^= x << 5)) >>> 0) % 1e4) /
            1e4;
        })()
      : Math.random;
  const pick = (): Face => FACES[Math.floor(rnd() * FACES.length)];
  return [pick(), pick(), pick()];
}

export function settleVar(
  wagers: { pick: Face; bet: number }[],
  result: [Face, Face, Face],
) {
  const counts: Record<Face, number> = {
    bau: 0,
    cua: 0,
    tom: 0,
    ca: 0,
    ga: 0,
    nai: 0,
  };
  result.forEach((f) => counts[f]++);

  let win = 0,
    lose = 0,
    wager = 0;
  const details = wagers.map(({ pick, bet }) => {
    wager += bet;
    const appear = counts[pick] || 0;
    const delta = appear > 0 ? appear * bet : -bet;
    if (delta > 0) win += delta;
    else lose += -delta;
    return { pick, bet, appear, delta };
  });

  return { wager, win, lose, net: win - lose, details, counts };
}

type Wager = { pick: Face; bet: number };
type Bet = { userId: string; wagers: Wager[] };
type RoundStatus = 'OPEN' | 'LOCKED';

type RoundState = {
  bankerId: string;
  minBet: number;
  maxBet: number;
  maxPlayers: number;
  status: RoundStatus;
  bets: Map<string, Bet>;
};

@Injectable()
export class BauCuaGameService {
  private rounds = new Map<string, RoundState>();

  open(
    channelId: string,
    bankerId: string,
    opts?: { minBet?: number; maxBet?: number; maxPlayers?: number },
  ) {
    const exist = this.rounds.get(channelId);
    if (exist && exist.status === 'OPEN') throw new Error('ROUND_ALREADY_OPEN');
    const minBet = Math.max(1, opts?.minBet ?? 1000);
    const maxBet = Math.max(minBet, opts?.maxBet ?? 100000);
    const maxPlayers = Math.max(1, opts?.maxPlayers ?? 10);
    this.rounds.set(channelId, {
      bankerId,
      minBet,
      maxBet,
      maxPlayers,
      status: 'OPEN',
      bets: new Map(),
    });
    return this.rounds.get(channelId)!;
  }

  setLimits(
    channelId: string,
    byUser: string,
    min?: number,
    max?: number,
    maxPlayers?: number,
  ) {
    const r = this.mustRound(channelId);
    const CAP = 100_000_000;
    if (r.bankerId !== byUser && r.bankerId !== process.env.BOT_ID) {
      throw new Error('ONLY_BANKER');
    }
    if (r.bets.size > 0) throw new Error('CANNOT_CHANGE_LIMITS_AFTER_BET');
    if (typeof min === 'number') {
      const mn = Math.max(1, Math.floor(min));
      r.minBet = mn;
    }
    if (typeof max === 'number') {
      const mx = Math.min(CAP, Math.max(r.minBet, Math.floor(max)));
      r.maxBet = mx;
    }
    if (typeof maxPlayers === 'number') {
      r.maxPlayers = Math.max(1, Math.floor(maxPlayers));
    }
    if (r.maxBet < r.minBet) r.maxBet = r.minBet;
    return { minBet: r.minBet, maxBet: r.maxBet };
  }

  cancel(channelId: string, byUser: string) {
    const r = this.mustRound(channelId);
    if (r.bankerId !== byUser) throw new Error('ONLY_BANKER');
    this.rounds.delete(channelId);
  }

  status(channelId: string): {
    bankerId: string;
    minBet: number;
    maxBet: number;
    maxPlayers: number;
    status: RoundStatus;
    bets: { userId: string; wagers: { pick: Face; bet: number }[] }[];
  } | null {
    const r = this.rounds.get(channelId);
    if (!r) return null;
    return {
      bankerId: r.bankerId,
      minBet: r.minBet,
      maxBet: r.maxBet,
      maxPlayers: r.maxPlayers,
      status: r.status,
      bets: Array.from(r.bets.values()).map((b) => ({
        userId: b.userId,
        wagers: b.wagers,
      })),
    };
  }

  async bet(
    channelId: string,
    userId: string,
    wagers: { pick: Face; bet: number }[],
    token: TokenPort,
  ) {
    const r = this.mustRound(channelId);
    if (r.status !== 'OPEN') throw new Error('ROUND_LOCKED');
    if (userId === r.bankerId) throw new Error('BANKER_CANNOT_BET');

    const merged = new Map<Face, number>();
    for (const w of wagers) {
      if (!Number.isFinite(w.bet)) throw new Error('BET_OUT_OF_RANGE');
      merged.set(w.pick, (merged.get(w.pick) ?? 0) + w.bet);
    }
    const distinct = Array.from(merged, ([pick, bet]) => ({ pick, bet }));

    if (distinct.length < 1 || distinct.length > 3)
      throw new Error('PICK_1_TO_3');

    for (const w of distinct) {
      if (w.bet < r.minBet || w.bet > r.maxBet)
        throw new Error('BET_OUT_OF_RANGE');
    }

    const already = r.bets.has(userId);
    if (!already && r.bets.size >= r.maxPlayers)
      throw new Error('MAX_PLAYERS_REACHED');

    const need = distinct.reduce((s, w) => s + w.bet, 0);
    const bal = await token.getBalance(userId);
    if (bal < need) throw new Error('INSUFFICIENT_FUNDS');

    r.bets.set(userId, { userId, wagers: distinct });
    return { ok: true };
  }

  async start(
    channelId: string,
    bankerId: string,
    token: TokenPort,
    seed?: number,
  ) {
    const r = this.mustRound(channelId);
    if (r.bankerId !== bankerId) throw new Error('ONLY_BANKER');
    if (r.bets.size < 1) throw new Error('NO_PLAYER');

    r.status = 'LOCKED';
    const players = Array.from(r.bets.values());

    try {
      for (const b of players) {
        const need = b.wagers.reduce((s, w) => s + w.bet, 0);
        const bal = await token.getBalance(b.userId);
        if (bal < need) throw new Error(`PLAYER_INSUFFICIENT:${b.userId}`);
      }

      const maxLiability = players.reduce(
        (s, p) => s + 3 * p.wagers.reduce((t, w) => t + w.bet, 0),
        0,
      );
      const bankerBalPre = await token.getBalance(bankerId);
      if (bankerBalPre < maxLiability)
        throw new Error('BANKER_INSUFFICIENT_FUNDS');

      const result = roll(seed);

      let bankerDelta = 0;
      const settlements: Array<{ userId: string; net: number; detail: any }> =
        [];

      for (const b of players) {
        const st = settleVar(b.wagers, result);
        settlements.push({ userId: b.userId, net: st.net, detail: st });
        bankerDelta -= st.net;
      }

      const totalPayout = settlements.reduce(
        (s, x) => s + (x.net > 0 ? x.net : 0),
        0,
      );
      if (totalPayout > 0) {
        const bankerBalNow = await token.getBalance(bankerId);
        if (bankerBalNow < totalPayout)
          throw new Error('BANKER_INSUFFICIENT_FUNDS');
      }

      for (const s of settlements) {
        if (s.net > 0) {
          await token.transfer(bankerId, s.userId, s.net, 'BauCua: player win');
        } else if (s.net < 0) {
          await token.transfer(
            s.userId,
            bankerId,
            -s.net,
            'BauCua: player lose',
          );
        }
      }

      this.rounds.delete(channelId);
      return { result, settlements, bankerDelta };
    } catch (err) {
      r.status = 'OPEN';
      throw err;
    }
  }

  private mustRound(channelId: string) {
    const r = this.rounds.get(channelId);
    if (!r) throw new Error('NO_ROUND');
    return r;
  }
}
