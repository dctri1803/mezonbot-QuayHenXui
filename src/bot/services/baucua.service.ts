import { Injectable } from '@nestjs/common';
import type { TokenPort } from './token.port';

export type Face = 'bau' | 'cua' | 'tom' | 'ca' | 'ga' | 'nai';
const FACES: Face[] = ['bau','cua','tom','ca','ga','nai'];

export function normalizeFace(raw: string): Face | null {
  const s = (raw || '').toLowerCase().trim();
  const map: Record<string, Face> = {
    'bau': 'bau', 'bầu': 'bau',
    'cua': 'cua', 'cùa': 'cua',
    'tom': 'tom', 'tôm': 'tom',
    'ca': 'ca',  'cá': 'ca',
    'ga': 'ga',  'gà': 'ga',
    'nai': 'nai',
  };
  const exact = map[s]; if (exact) return exact;
  const ascii = s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g,'d');
  return (map[ascii] as Face) || null;
}

export function roll(seed?: number): [Face,Face,Face] {
  const rnd = seed != null
    ? (() => { let x = (seed>>>0)||123456789; return () => ((x^=x<<13,x^=x>>>17,x^=x<<5)>>>0)%1e4/1e4; })()
    : Math.random;
  const pick = (): Face => FACES[Math.floor(rnd()*FACES.length)];
  return [pick(), pick(), pick()];
}

export function settle(picks: Face[], betUnit: number, result: [Face,Face,Face]) {
  const counts: Record<Face, number> = { bau:0,cua:0,tom:0,ca:0,ga:0,nai:0 };
  result.forEach(f => counts[f]++);
  let win=0, lose=0;
  const details = picks.map(p => {
    const appear = counts[p]||0;
    const delta = appear>0 ? appear*betUnit : -betUnit;
    if (delta>0) win += delta; else lose += -delta;
    return { pick:p, appear, delta };
  });
  return { wager: picks.length*betUnit, win, lose, net: win-lose, details, counts };
}

type Bet = { userId: string; picks: Face[]; bet: number };
type RoundStatus = 'OPEN' | 'LOCKED';

type RoundState = {
  bankerId: string;
  minBet: number;
  maxBet: number;
  status: RoundStatus;
  bets: Map<string, Bet>; // userId -> bet
};

@Injectable()
export class BauCuaGameService {
  /** channelId -> round */
  private rounds = new Map<string, RoundState>();

  open(channelId: string, bankerId: string, opts?: { minBet?: number; maxBet?: number }) {
    const exist = this.rounds.get(channelId);
    if (exist && exist.status === 'OPEN') throw new Error('ROUND_ALREADY_OPEN');
    const minBet = Math.max(1, opts?.minBet ?? 10);
    const maxBet = Math.max(minBet, opts?.maxBet ?? 1000);
    this.rounds.set(channelId, {
      bankerId,
      minBet,
      maxBet,
      status: 'OPEN',
      bets: new Map(),
    });
    return this.rounds.get(channelId)!;
  }

  cancel(channelId: string, byUser: string) {
    const r = this.mustRound(channelId);
    if (r.bankerId !== byUser) throw new Error('ONLY_BANKER');
    this.rounds.delete(channelId);
  }

  status(channelId: string) {
    const r = this.rounds.get(channelId);
    if (!r) return null;
    return {
      bankerId: r.bankerId,
      minBet: r.minBet,
      maxBet: r.maxBet,
      status: r.status,
      bets: Array.from(r.bets.values()).map(b => ({ userId: b.userId, picks: b.picks, bet: b.bet })),
    };
  }

  bet(channelId: string, userId: string, picks: Face[], bet: number, token: TokenPort) {
    const r = this.mustRound(channelId);
    if (r.status !== 'OPEN') throw new Error('ROUND_LOCKED');
    if (userId === r.bankerId) throw new Error('BANKER_CANNOT_BET');
    if (picks.length<1 || picks.length>3) throw new Error('PICK_1_TO_3');
    if (!Number.isFinite(bet) || bet < r.minBet || bet > r.maxBet) throw new Error('BET_OUT_OF_RANGE');

    // Check đủ tiền trước (tổng cược = picks.length * bet)
    const need = picks.length * bet;
    return token.getBalance(userId).then(bal => {
      if (bal < need) throw new Error('INSUFFICIENT_FUNDS');
      r.bets.set(userId, { userId, picks, bet }); // ghi đè bet cũ nếu có
      return { ok: true };
    });
  }

  async start(channelId: string, bankerId: string, token: TokenPort, seed?: number) {
    const r = this.mustRound(channelId);
    if (r.bankerId !== bankerId) throw new Error('ONLY_BANKER');
    if (r.bets.size < 1) throw new Error('NO_PLAYER');

    r.status = 'LOCKED'; // khoá, không cho đặt thêm
    const players = Array.from(r.bets.values());

    // Kiểm tra lại số dư tất cả người chơi lúc bắt đầu
    for (const b of players) {
      const need = b.picks.length * b.bet;
      const bal = await token.getBalance(b.userId);
      if (bal < need) throw new Error(`PLAYER_INSUFFICIENT:${b.userId}`);
    }

    const result = roll(seed);

    // Quyết toán: người chơi thắng -> banker trả; thua -> chuyển cho banker
    let bankerDelta = 0;
    const settlements: Array<{ userId: string; net: number; detail: any }> = [];

    for (const b of players) {
      const st = settle(b.picks, b.bet, result);
      settlements.push({ userId: b.userId, net: st.net, detail: st });
      bankerDelta -= st.net; // banker chịu ngược chiều người chơi
    }

    // Thực hiện chuyển token
    // - net > 0: banker -> player (player thắng)
    // - net < 0: player -> banker (player thua)
    for (const s of settlements) {
      if (s.net > 0) {
        await token.transfer(bankerId, s.userId, s.net, 'BauCua: player win');
      } else if (s.net < 0) {
        await token.transfer(s.userId, bankerId, -s.net, 'BauCua: player lose');
      }
    }

    // đóng ván
    this.rounds.delete(channelId);

    return { result, settlements, bankerDelta };
  }

  private mustRound(channelId: string) {
    const r = this.rounds.get(channelId);
    if (!r) throw new Error('NO_ROUND');
    return r;
  }
}
