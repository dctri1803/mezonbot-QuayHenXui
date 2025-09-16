import { ChannelMessage, EMarkdownType } from 'mezon-sdk';
import { Command } from 'src/bot/base/commandRegister.decorator';
import { CommandMessage } from 'src/bot/base/command.abstract';
import { MezonClientService } from 'src/mezon/services/mezon-client.service';
import { DbTokenPort } from 'src/bot/services/token.memory';
import {
  BauCuaGameService,
  Face,
  normalizeFace,
} from 'src/bot/services/baucua.service';
import { ActiveUsersService } from 'src/bot/services/active-users.service';

type ParsedBet =
  | { mode: 'uniform'; picks: Face[]; bet: number }
  | { mode: 'per-face'; wagers: { pick: Face; bet: number }[] };

function parseBetArgs(args: string[]): ParsedBet {
  const CAP = 100_000_000;
  let uniformBet: number | null = null;
  const picks: Face[] = [];
  const perFace = new Map<Face, number>();

  for (const a of args) {
    if (a.startsWith('--bet=')) {
      const n = parseInt(a.split('=')[1], 10);
      if (!isNaN(n) && n > 0) uniformBet = Math.min(n, CAP);
      continue;
    }

    const m = a.match(/^(.+?)\s*[:=]\s*(\d+)$/);
    if (m) {
      const f = normalizeFace(m[1]);
      const n = parseInt(m[2], 10);
      if (f && !isNaN(n) && n > 0) {
        perFace.set(f, Math.min(n, CAP));
        continue;
      }
    }

    const f = normalizeFace(a);
    if (f) picks.push(f);
  }

  if (perFace.size > 0) {
    const wagers = Array.from(perFace, ([pick, bet]) => ({ pick, bet }));
    return { mode: 'per-face', wagers };
  }
  return { mode: 'uniform', picks, bet: uniformBet ?? 1000 };
}

function fmtResult(r: [Face, Face, Face]) {
  const emo: Record<Face, string> = {
    bau: '🎍',
    cua: '🦀',
    tom: '🦐',
    ca: '🐟',
    ga: '🐓',
    nai: '🦌',
  };
  return r.map((f) => `${emo[f]} ${f}`).join('  |  ');
}

function fmtUserTag(id: string, name?: string) {
  return name ? `${name}` : `<@${id}>`;
}

@Command('baucua')
export class BauCuaTokenCommand extends CommandMessage {
  constructor(
    clientService: MezonClientService,
    private game: BauCuaGameService,
    private token: DbTokenPort,
    private active: ActiveUsersService,
  ) {
    super(clientService);
  }

  async execute(args: string[], message: ChannelMessage) {
    const messageChannel = await this.getChannelMessage(message);
    const sub = (args[0] || '').toLowerCase();
    const channelId = message.channel_id!;
    const wantsBotHost =
      (args[0] || '').toLowerCase() === 'host' &&
      (args.includes('bot') || args.includes('--bot'));
    const botId = process.env.BOT_ID;
    const bankerId = wantsBotHost && botId ? botId : message.sender_id!;

    try {
      switch (sub) {
        case 'help': {
          const t = `BẦU CUA DÙNG TOKEN — LUẬT & CÁCH CHƠI

LỆNH NHANH
• $baucua host --min=1000 --max=100000 --maxPlayers=10
→ mở bàn, bạn là nhà cái
• $baucua host bot --min=1000 --max=100000 --maxPlayers=10
→ mở bàn, bot là nhà cái
• $baucua bet tom:2000 ca:500                   
→ đặt mỗi cửa một mức tiền (per-face)
• $baucua bet tom ca --bet=1000                 
→ đặt đều mỗi cửa 1000→ người chơi đặt (1–3 mặt)
• $baucua start                                                 
→ nhà cái bắt đầu, quay & quyết toán
• $baucua bet tom ca --bet=1000 --go                 
→ Khi bot làm nhà cái, người cuối cùng đặt cược sẽ phải thêm --go để bot quay
• $baucua status                                                
→ xem bàn hiện tại
• $baucua cancel                                                
→ nhà cái hủy bàn chưa bắt đầu
• $baucua bal                                                   
→ xem số dư của bạn
• $baucua help                                                  
→ xem hướng dẫn này

CỬA HỢP LỆ
• bau | cua | tom | ca | ga | nai  (chấp nhận tiếng Việt có/không dấu)

LUẬT TÍNH TIỀN
• Ván quay 3 mặt.
• Mỗi người chơi chọn 1–3 cửa, mức cược mỗi cửa là --bet.
• Tổng tiền đặt = số cửa × bet.
• Với mỗi cửa đã chọn:
  - Nếu xuất hiện k lần trong 3 mặt → NHẬN k × bet.
  - Nếu không xuất hiện → MẤT bet.
• Lãi/lỗ của người chơi = (tổng thắng) – (tổng thua).
• Quyết toán với nhà cái:
  - Người chơi THẮNG (net > 0): nhà cái → người chơi số token = net.
  - Người chơi THUA  (net < 0): người chơi → nhà cái số token = |net|.
• Nhà cái KHÔNG được đặt cược.

ĐIỀU KIỆN BẮT ĐẦU VÁN
• Phải có 1 nhà cái + ít nhất 1 người chơi đã đặt.
• Khi bắt đầu, hệ thống kiểm tra người chơi có đủ token để trả tổng tiền đặt.
• Nhà cái nên đảm bảo có đủ token để chi trả khi nhiều người thắng.

VÍ DỤ
1) Mở bàn:
   $baucua host --min=1000 --max=100000 --maxPlayers=10
2) Người chơi đặt:
   $baucua bet tom:2000 ca:500                   → đặt mỗi cửa một mức tiền
   $baucua bet tom ca --bet=1000                 → đặt đều mỗi cửa 1000
3) Nhà cái bắt đầu:
   $baucua start

GHI CHÚ
• --min/--max: giới hạn mức bet mỗi cửa của người chơi.
• Số dư: $baucua bal
• Lỗi thường gặp:
  - ROUND_ALREADY_OPEN: đã có bàn mở.
  - NO_ROUND: chưa có bàn trong kênh.
  - ONLY_BANKER: chỉ nhà cái mới được phép.
  - NO_PLAYER: chưa có người chơi nào đặt.
  - PICK_1_TO_3: phải chọn 1–3 cửa.
  - BET_OUT_OF_RANGE: bet ngoài min/max.
  - INSUFFICIENT_FUNDS: không đủ token.
  - BANKER_INSUFFICIENT_FUNDS: Nhà cái không đủ token để chi trả.
  - PLAYER_INSUFFICIENT: Một người chơi không đủ token để tham gia.
  - MAX_PLAYERS_REACHED: Bàn đã đủ số người chơi tối đa.`;
          return messageChannel?.reply({
            t,
            mk: [{ type: EMarkdownType.PRE, s: 0, e: t.length }],
          });
        }
        case 'host': {
          const min = Number(
            args.find((a) => a.startsWith('--min='))?.split('=')[1] ?? 1000,
          );
          const max = Number(
            args.find((a) => a.startsWith('--max='))?.split('=')[1] ?? 100000,
          );
          const mp = Number(
            args.find((a) => a.startsWith('--maxPlayers='))?.split('=')[1] ??
            10,
          );
          if (wantsBotHost && !botId) {
            const t =
              'Bạn yêu cầu bot làm nhà cái nhưng `BOT_ID` chưa được cấu hình trên server.';
            return messageChannel?.reply({
              t,
              mk: [{ type: EMarkdownType.PRE, s: 0, e: t.length }],
            });
          }

          this.game.open(channelId, bankerId, {
            minBet: isFinite(min) ? min : 1000,
            maxBet: isFinite(max) ? max : 100000,
            maxPlayers: isFinite(mp) ? Math.max(1, mp) : 10,
          });
          const name = wantsBotHost
            ? 'Bot'
            : (await this.active.getNameOrFetch(channelId, bankerId)) ||
            `<@${bankerId}>`;
          const t = wantsBotHost
            ? `🤖 Bot đã mở bàn bầu cua!
Min bet: ${isFinite(min) ? min : 1000} | Max bet: ${isFinite(max) ? max : 100000} | Max players: ${isFinite(mp) ? Math.max(1, mp) : 10}
Người chơi dùng: $baucua bet ca --bet=1000
                             $baucua bet tom:2000 ca:500`
            : `🧧 Mở bàn bầu cua: nhà cái ${name}
Min bet: ${isFinite(min) ? min : 1000} | Max bet: ${isFinite(max) ? max : 100000} | Max players: ${isFinite(mp) ? Math.max(1, mp) : 10}
Người chơi dùng: $baucua bet ca --bet=1000
                             $baucua bet tom:2000 ca:500`;
          return messageChannel?.reply({
            t,
            mk: [{ type: EMarkdownType.PRE, s: 0, e: t.length }],
          });
        }

        case 'bet': {
          const userId = message.sender_id!;
          const proposedMin = args
            .find((a) => a.startsWith('--min='))
            ?.split('=')[1];
          const proposedMax = args
            .find((a) => a.startsWith('--max='))
            ?.split('=')[1];
          const proposedMp = args
            .find((a) => a.startsWith('--maxPlayers='))
            ?.split('=')[1];
          if ((proposedMin || proposedMax) && this.game) {
            try {
              const minN = proposedMin ? Number(proposedMin) : undefined;
              const maxN = proposedMax ? Number(proposedMax) : undefined;
              const mpN = proposedMp ? Number(proposedMp) : undefined;
              if (minN != null || maxN != null || mpN != null) {
                const limits = this.game.setLimits(
                  channelId,
                  userId,
                  minN,
                  maxN,
                  mpN,
                );
                const t =
                  `✅ Đề xuất giới hạn đã áp dụng: Min=${limits.minBet} | Max=${limits.maxBet}` +
                  (mpN ? ` | MaxPlayers=${mpN}` : '');
                await messageChannel?.reply({
                  t,
                  mk: [{ type: EMarkdownType.PRE, s: 0, e: t.length }],
                });
              }
            } catch (err: any) {
              const t = `Không thể thay đổi giới hạn: ${String(err?.message || err)}`;
              await messageChannel?.reply({
                t,
                mk: [{ type: EMarkdownType.PRE, s: 0, e: t.length }],
              });
            }
          }

          const parsed = parseBetArgs(args.slice(1));
          const startNow =
            args.includes('--start') ||
            args.includes('--go') ||
            args.includes('--last');

          if (parsed.mode === 'uniform') {
            if (parsed.picks.length < 1 || parsed.picks.length > 3) {
              const t = `Bạn cần chọn 1–3 mặt (bau: '🎍'| cua: '🦀'| tom: '🦐'| ca: '🐟'| ga: '🐓'| nai: '🦌').
Ví dụ:  $baucua bet tom ca --bet=1000.
           $baucua bet tom:2000 ca:500.`;
              return messageChannel?.reply({
                t,
                mk: [{ type: EMarkdownType.PRE, s: 0, e: t.length }],
              });
            }
            const wagers = parsed.picks.map((pick) => ({
              pick,
              bet: parsed.bet,
            }));
            await this.game.bet(channelId, userId, wagers, this.token);

            const total = wagers.reduce((s, w) => s + w.bet, 0);
            const desc = wagers.map((w) => `${w.pick} x ${w.bet}`).join(', ');
            const t = `✅ Đặt cược: ${desc}\nTổng đặt: ${total}`;
            const round = this.game.status(channelId);
            const currentBankerIsBot = round?.bankerId === botId;
            if (startNow && currentBankerIsBot) {
              try {
                const result = await this.game.start(
                  channelId,
                  round!.bankerId,
                  this.token,
                );
                const lines = (
                  await Promise.all(
                    result.settlements.map(async (s) => {
                      const n = await this.active.getNameOrFetch(
                        channelId,
                        s.userId,
                      );
                      const sign = s.net >= 0 ? '+' : '';
                      return `- ${fmtUserTag(s.userId, n)}: ${sign}${s.net}`;
                    }),
                  )
                ).join('\n');
                const bankerName =
                  round?.bankerId === botId
                    ? 'Bot'
                    : await this.active.getNameOrFetch(
                      channelId,
                      round!.bankerId,
                    );
                const rt = `${t}\nNhà cái dùng bot để bắt đầu và đã quyết toán\n🎲 Kết quả: ${fmtResult(result.result)}\nQuyết toán (net):\n${lines}\n-------------------------\n💼 Nhà cái ${fmtUserTag(round!.bankerId, bankerName)}: ${result.bankerDelta >= 0 ? '+' : ''}${result.bankerDelta}`;
                return messageChannel?.reply({
                  t: rt,
                  mk: [{ type: EMarkdownType.PRE, s: 0, e: rt.length }],
                });
              } catch (err: any) {
                const eMsg = String(err?.message || err);
                const t2 = `Đặt cược thành công nhưng không thể tự động bắt đầu: ${eMsg}`;
                return messageChannel?.reply({
                  t: `${t}\n${t2}`,
                  mk: [
                    {
                      type: EMarkdownType.PRE,
                      s: 0,
                      e: (t + '\n' + t2).length,
                    },
                  ],
                });
              }
            }

            const hint = '\nNhà cái dùng $baucua start để bắt đầu';
            return messageChannel?.reply({
              t: t + hint,
              mk: [{ type: EMarkdownType.PRE, s: 0, e: (t + hint).length }],
            });
          } else {
            if (parsed.wagers.length < 1 || parsed.wagers.length > 3) {
              const t =
                'Bạn cần chọn 1–3 mặt. Ví dụ: $baucua bet tom:2000 ca:500';
              return messageChannel?.reply({
                t,
                mk: [{ type: EMarkdownType.PRE, s: 0, e: t.length }],
              });
            }
            await this.game.bet(channelId, userId, parsed.wagers, this.token);

            const total = parsed.wagers.reduce((s, w) => s + w.bet, 0);
            const desc = parsed.wagers
              .map((w) => `${w.pick} x ${w.bet}`)
              .join(', ');
            const t = `✅ Đặt cược: ${desc}\nTổng đặt: ${total}`;
            const round = this.game.status(channelId);
            const currentBankerIsBot = round?.bankerId === botId;
            if (startNow && currentBankerIsBot) {
              try {
                const result = await this.game.start(
                  channelId,
                  round!.bankerId,
                  this.token,
                );
                const lines = (
                  await Promise.all(
                    result.settlements.map(async (s) => {
                      const n = await this.active.getNameOrFetch(
                        channelId,
                        s.userId,
                      );
                      const sign = s.net >= 0 ? '+' : '';
                      return `- ${fmtUserTag(s.userId, n)}: ${sign}${s.net}`;
                    }),
                  )
                ).join('\n');
                const bankerName =
                  round?.bankerId === botId
                    ? 'Bot'
                    : await this.active.getNameOrFetch(
                      channelId,
                      round!.bankerId,
                    );
                const rt = `${t}\nNhà cái dùng bot để bắt đầu và đã quyết toán\n🎲 Kết quả: ${fmtResult(result.result)}\nQuyết toán (net):\n${lines}\n-------------------------\n💼 Nhà cái ${fmtUserTag(round!.bankerId, bankerName)}: ${result.bankerDelta >= 0 ? '+' : ''}${result.bankerDelta}`;
                return messageChannel?.reply({
                  t: rt,
                  mk: [{ type: EMarkdownType.PRE, s: 0, e: rt.length }],
                });
              } catch (err: any) {
                const eMsg = String(err?.message || err);
                const t2 = `Đặt cược thành công nhưng không thể tự động bắt đầu: ${eMsg}`;
                return messageChannel?.reply({
                  t: `${t}\n${t2}`,
                  mk: [
                    {
                      type: EMarkdownType.PRE,
                      s: 0,
                      e: (t + '\n' + t2).length,
                    },
                  ],
                });
              }
            }

            const hint = '\nNhà cái dùng $baucua start để bắt đầu';
            return messageChannel?.reply({
              t: t + hint,
              mk: [{ type: EMarkdownType.PRE, s: 0, e: (t + hint).length }],
            });
          }
        }

        case 'start': {
          const result = await this.game.start(channelId, bankerId, this.token);

          const lines = (
            await Promise.all(
              result.settlements.map(async (s) => {
                const n = await this.active.getNameOrFetch(channelId, s.userId);
                const sign = s.net >= 0 ? '+' : '';
                return `- ${fmtUserTag(s.userId, n)}: ${sign}${s.net}`;
              }),
            )
          ).join('\n');

          const bankerName =
            bankerId === botId
              ? 'Bot'
              : await this.active.getNameOrFetch(channelId, bankerId);
          const t = `🎲 Kết quả: ${fmtResult(result.result)}
Quyết toán (net):
${lines}
-------------------------
💼 Nhà cái ${fmtUserTag(bankerId, bankerName)}: ${result.bankerDelta >= 0 ? '+' : ''}${result.bankerDelta}`;
          return messageChannel?.reply({
            t,
            mk: [{ type: EMarkdownType.PRE, s: 0, e: t.length }],
          });
        }

        case 'status': {
          const st = this.game.status(channelId);
          if (!st) {
            const t = 'Chưa có bàn nào. Tạo bằng: $baucua host';
            return messageChannel?.reply({
              t,
              mk: [{ type: EMarkdownType.PRE, s: 0, e: t.length }],
            });
          }
          const bankerName =
            st.bankerId === botId
              ? 'Bot'
              : await this.active.getNameOrFetch(channelId, st.bankerId);
          const betLines = st.bets.length
            ? (
              await Promise.all(
                st.bets.map(async (b) => {
                  const n = await this.active.getNameOrFetch(
                    channelId,
                    b.userId,
                  );
                  const desc = b.wagers
                    .map((w) => `${w.pick} x ${w.bet}`)
                    .join(', ');
                  return `- ${n ?? `<@${b.userId}>`}: ${desc}`;
                }),
              )
            ).join('\n')
            : '(chưa ai đặt)';

          const t = `Bàn hiện tại
Nhà cái: ${bankerName ?? `<@${st.bankerId}>`}
Min: ${st.minBet} | Max: ${st.maxBet} | Max players: ${st.maxPlayers}
Trạng thái: ${st.status}
Số người chơi: ${st.bets.length}/${st.maxPlayers}
Cược:
${betLines}`;
          return messageChannel?.reply({
            t,
            mk: [{ type: EMarkdownType.PRE, s: 0, e: t.length }],
          });
        }

        case 'cancel': {
          const st = this.game.status(channelId);
          if (!st) {
            const t = 'Chưa có bàn để hủy.';
            return messageChannel?.reply({
              t,
              mk: [{ type: EMarkdownType.PRE, s: 0, e: t.length }],
            });
          }
          const isBanker = st.bankerId === message.sender_id;
          if (!isBanker && st.bankerId !== botId) {
            const t = 'Chỉ nhà cái mới được hủy bàn.';
            return messageChannel?.reply({
              t,
              mk: [{ type: EMarkdownType.PRE, s: 0, e: t.length }],
            });
          }
          this.game.cancel(channelId, st.bankerId);
          const t = '❌ Đã hủy bàn.';
          return messageChannel?.reply({
            t,
            mk: [{ type: EMarkdownType.PRE, s: 0, e: t.length }],
          });
        }

        case 'bal': {
          const target = (args[1] || '').toLowerCase() === 'bot'
            ? (process.env.BOT_ID || message.sender_id!)
            : message.sender_id!;
          const bal = await this.token.getBalance(target);
          const label = (args[1] || '').toLowerCase() === 'bot' ? 'Bot' : 'bạn';
          const t = `💸Số dư của ${label}: ${Math.floor(bal).toLocaleString('vi-VN')}đ`;
          return messageChannel?.reply({
            t,
            mk: [{ type: EMarkdownType.PRE, s: 0, e: t.length }],
          });
        }

        case 'remit': {
          const messageChannel = await this.getChannelMessage(message);
          const adminId = process.env.BOT_ADMIN_ID || process.env.ADMIN_ID;
          const botId = process.env.BOT_ID;

          if (!botId || !adminId) {
            const t = 'Thiếu cấu hình môi trường: cần BOT_ID và BOT_ADMIN_ID (hoặc ADMIN_ID).';
            return messageChannel?.reply({ t, mk: [{ type: EMarkdownType.PRE, s: 0, e: t.length }] });
          }

          // Chỉ admin được phép gọi
          const callerId = message.sender_id!;
          if (callerId !== adminId) {
            const t = 'Chỉ admin mới được phép thực hiện remit.';
            return messageChannel?.reply({ t, mk: [{ type: EMarkdownType.PRE, s: 0, e: t.length }] });
          }

          // Cú pháp: $baucua remit [all|<amount>] [--keep=<number>]
          const arg1 = (args[1] || '').toLowerCase();
          const keepRaw = args.find(a => a.startsWith('--keep='))?.split('=')[1];
          const keep = Math.max(0, Math.floor(Number(keepRaw ?? '0')) || 0);

          // Lấy số dư hiện tại của bot
          const botBal = Math.floor(await this.token.getBalance(botId));

          if (!arg1 || (arg1 !== 'all' && isNaN(parseInt(arg1, 10)))) {
            const t = `Cách dùng:
- $baucua remit all [--keep=0]         → rút toàn bộ số dư bot về admin, chừa lại 'keep'
- $baucua remit <amount>                → rút đúng số tiền
Số dư bot hiện tại: ${botBal.toLocaleString('vi-VN')}đ`;
            return messageChannel?.reply({ t, mk: [{ type: EMarkdownType.PRE, s: 0, e: t.length }] });
          }

          let amount = 0;
          if (arg1 === 'all') {
            amount = Math.max(0, botBal - keep);
          } else {
            amount = Math.floor(parseInt(arg1, 10));
          }

          if (amount <= 0) {
            const t = `Số tiền remit không hợp lệ hoặc không đủ sau khi trừ keep. Số dư bot: ${botBal.toLocaleString('vi-VN')}đ`;
            return messageChannel?.reply({ t, mk: [{ type: EMarkdownType.PRE, s: 0, e: t.length }] });
          }

          // Nếu amount > botBal, hạ xuống bằng botBal để tránh lỗi
          if (amount > botBal) amount = botBal;

          // Thực hiện chuyển
          await this.token.transfer(botId, adminId, amount, 'BauCua: manual remit to admin');

          const adminName = await this.active.getNameOrFetch(message.channel_id!, adminId);
          const t = `✅ Remit thành công: +${amount.toLocaleString('vi-VN')}đ → admin ${fmtUserTag(adminId, adminName)}
Số dư bot trước: ${botBal.toLocaleString('vi-VN')}đ
Số dư bot sau:  ${(botBal - amount).toLocaleString('vi-VN')}đ`;
          return messageChannel?.reply({ t, mk: [{ type: EMarkdownType.PRE, s: 0, e: t.length }] });
        }

        case 'fund': {
          const messageChannel = await this.getChannelMessage(message);
          const adminId = process.env.BOT_ADMIN_ID || process.env.ADMIN_ID;
          const botId = process.env.BOT_ID;

          if (!botId || !adminId) {
            const t = 'Thiếu cấu hình môi trường: cần BOT_ID và BOT_ADMIN_ID (hoặc ADMIN_ID).';
            return messageChannel?.reply({
              t,
              mk: [{ type: EMarkdownType.PRE, s: 0, e: t.length }],
            });
          }

          // Chỉ admin được phép gọi
          const callerId = message.sender_id!;
          if (callerId !== adminId) {
            const t = 'Chỉ admin mới được phép nạp tiền cho bot.';
            return messageChannel?.reply({
              t,
              mk: [{ type: EMarkdownType.PRE, s: 0, e: t.length }],
            });
          }

          // Cú pháp bắt buộc: $baucua fund <amount>
          const amountStr = args[1] || '';
          const isNumeric = /^[0-9]+$/.test(amountStr);
          const amount = Math.floor(Number(amountStr));

          // Lấy số dư hiện tại (trước khi chuyển) để hiển thị
          const [adminBalRaw, botBalRaw] = await Promise.all([
            this.token.getBalance(adminId),
            this.token.getBalance(botId),
          ]);
          const adminBal = Math.floor(adminBalRaw);
          const botBal = Math.floor(botBalRaw);

          if (!isNumeric || amount <= 0) {
            const t = `Cách dùng:
$ baucua fund 50000   ← nạp đúng 50.000 vào bot

Số dư admin hiện tại: ${adminBal.toLocaleString('vi-VN')}đ
Số dư bot hiện tại:   ${botBal.toLocaleString('vi-VN')}đ`;
            return messageChannel?.reply({
              t,
              mk: [{ type: EMarkdownType.PRE, s: 0, e: t.length }],
            });
          }

          if (amount > adminBal) {
            const t = `Số dư admin không đủ để nạp ${amount.toLocaleString('vi-VN')}đ.
Số dư admin: ${adminBal.toLocaleString('vi-VN')}đ`;
            return messageChannel?.reply({
              t,
              mk: [{ type: EMarkdownType.PRE, s: 0, e: t.length }],
            });
          }

          await this.token.transfer(adminId, botId, amount, 'BauCua: manual fund bot from admin');

          const t = `✅ Nạp thành công: +${amount.toLocaleString('vi-VN')}đ → bot
Số dư admin trước: ${adminBal.toLocaleString('vi-VN')}đ
Số dư admin sau:   ${(adminBal - amount).toLocaleString('vi-VN')}đ
Số dư bot trước:   ${botBal.toLocaleString('vi-VN')}đ
Số dư bot sau:     ${(botBal + amount).toLocaleString('vi-VN')}đ`;
          return messageChannel?.reply({
            t,
            mk: [{ type: EMarkdownType.PRE, s: 0, e: t.length }],
          });
        }

        default: {
          // Gợi ý nhanh
          const t =
            'Dùng $baucua help để xem hướng dẫn.\nPhổ biến: $baucua host | $baucua bet tom ca --bet=1000 | $baucua start';
          return messageChannel?.reply({
            t,
            mk: [{ type: EMarkdownType.PRE, s: 0, e: t.length }],
          });
        }
      }
    } catch (e: any) {
      const msg = String(e?.message || e);
      const map: Record<string, string> = {
        ROUND_ALREADY_OPEN: 'Đang có bàn mở rồi.',
        NO_ROUND: 'Chưa có bàn trong kênh.',
        ONLY_BANKER: 'Chỉ nhà cái mới được thực hiện.',
        NO_PLAYER: 'Cần ít nhất 1 người chơi mới bắt đầu.',
        ROUND_LOCKED: 'Bàn đã khoá, không thể đặt thêm.',
        BANKER_CANNOT_BET: 'Nhà cái không được đặt cược.',
        PICK_1_TO_3: 'Bạn phải chọn 1–3 mặt.',
        BET_OUT_OF_RANGE: 'Mức cược nằm ngoài min/max của bàn.',
        INSUFFICIENT_FUNDS: 'Bạn không đủ token để đặt.',
        BANKER_INSUFFICIENT_FUNDS: 'Nhà cái không đủ token để chi trả.',
        PLAYER_INSUFFICIENT: 'Người chơi không đủ token để tham gia.',
        MAX_PLAYERS_REACHED: 'Bàn đã đủ số người chơi tối đa.',
      };
      const t =
        map[msg] ||
        (msg.startsWith('PLAYER_INSUFFICIENT')
          ? `Một người chơi không đủ token để tham gia (userId=${msg.split(':')[1]})`
          : `Lỗi: ${msg}`);
      return messageChannel?.reply({
        t,
        mk: [{ type: EMarkdownType.PRE, s: 0, e: t.length }],
      });
    }
  }
}
