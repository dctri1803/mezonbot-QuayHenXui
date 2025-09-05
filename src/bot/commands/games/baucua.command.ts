import { ChannelMessage, EMarkdownType } from 'mezon-sdk';
import { Command } from 'src/bot/base/commandRegister.decorator';
import { CommandMessage } from 'src/bot/base/command.abstract';
import { MezonClientService } from 'src/mezon/services/mezon-client.service';
import { BauCuaService, Face, normalizeFace } from 'src/bot/services/baucua.service';

function parseArgs(args: string[]) {
  // $baucua <chon...> [--bet=10] [--seed=123] | $baucua score | $baucua help
  let bet = 10;
  let seed: number | undefined;
  const picks: Face[] = [];

  for (const a of args) {
    if (a.startsWith('--bet=')) {
      const n = parseInt(a.split('=')[1], 10);
      if (!isNaN(n) && n > 0) bet = Math.min(n, 1_000_000);
      continue;
    }
    if (a.startsWith('--seed=')) {
      const n = parseInt(a.split('=')[1], 10);
      if (!isNaN(n)) seed = n;
      continue;
    }
    const f = normalizeFace(a);
    if (f) picks.push(f);
  }

  return { picks, bet, seed };
}

function formatResult(r: [Face, Face, Face]) {
  const emoji: Record<Face, string> = {
    bau: '🎍', cua: '🦀', tom: '🦐', ca: '🐟', ga: '🐓', nai: '🦌',
  };
  return r.map((f) => `${emoji[f]} ${f}`).join('  |  ');
}

@Command('baucua')
export class BauCuaCommand extends CommandMessage {
  constructor(
    clientService: MezonClientService,
    private game: BauCuaService
  ) {
    super(clientService);
  }

  async execute(args: string[], message: ChannelMessage) {
    const messageChannel = await this.getChannelMessage(message);

    // quick help
    const sub = (args[0] || '').toLowerCase();
    if (sub === 'help') {
      const t =
`Cú pháp:
$ baucua <chon...> [--bet=10] [--seed=123]
   - <chon>: bau | cua | tom | ca | ga | nai (có thể 1–3 lựa chọn)
Ví dụ:
$ baucua bau --bet=50
$ baucua tom ca nai --bet=20
$ baucua score   # xem điểm tích lũy của bạn`;
      return messageChannel?.reply({ t, mk: [{ type: EMarkdownType.PRE, s: 0, e: t.length }] });
    }

    // show score
    if (sub === 'score') {
      const score = this.game.getScore(message.clan_id!, message.channel_id!, message.sender_id!);
      const t = `Điểm tích lũy của bạn: ${score}`;
      return messageChannel?.reply({ t, mk: [{ type: EMarkdownType.PRE, s: 0, e: t.length }] });
    }

    const { picks, bet, seed } = parseArgs(args);

    if (picks.length === 0 || picks.length > 3) {
      const t = 'Bạn cần chọn 1–3 mặt (bau|cua|tom|ca|ga|nai). Ví dụ: $baucua tom ca --bet=20';
      return messageChannel?.reply({ t, mk: [{ type: EMarkdownType.PRE, s: 0, e: t.length }] });
    }

    // Guard clan
    const clan = this.client.clans.get(message.clan_id!);
    if (!clan) {
      const t = 'Không lấy được thông tin clan hiện tại.';
      return messageChannel?.reply({ t, mk: [{ type: EMarkdownType.PRE, s: 0, e: t.length }] });
    }

    // Xổ 3 viên
    const result = this.game.roll(seed);
    const settle = this.game.settle(picks, bet, result);

    // Cập nhật điểm tích lũy (net có thể âm/dương)
    const score = this.game.addScore(
      message.clan_id!, message.channel_id!, message.sender_id!, settle.net
    );

    // Render chi tiết
    const picksStr = picks.join(', ');
    const resultStr = formatResult(result);
    const detailLines = settle.details.map((d) => {
      const sign = d.delta >= 0 ? '+' : '';
      return `- ${d.pick}: xuất hiện ${d.appear} → ${sign}${d.delta}`;
    }).join('\n');

    const t =
`🎲 Bầu Cua Tôm Cá
Bạn đặt: ${picksStr} | Mỗi cửa: ${bet}
Kết quả: ${resultStr}

${detailLines}
-------------------------
Đặt: ${settle.wager} | Thắng: ${settle.win} | Thua: ${settle.lose} | **Net**: ${settle.net >= 0 ? '+' : ''}${settle.net}
Điểm tích lũy hiện tại: ${score}`;

    return messageChannel?.reply({ t, mk: [{ type: EMarkdownType.PRE, s: 0, e: t.length }] });
  }
}
