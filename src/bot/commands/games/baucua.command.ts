import { ChannelMessage, EMarkdownType, EMessageComponentType } from 'mezon-sdk';
import { Command } from 'src/bot/base/commandRegister.decorator';
import { CommandMessage } from 'src/bot/base/command.abstract';
import { MezonClientService } from 'src/mezon/services/mezon-client.service';
import { DbTokenPort } from 'src/bot/services/token.memory';
import { BauCuaGameService, Face, normalizeFace } from 'src/bot/services/baucua.service';
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
    const emo: Record<Face, string> = { bau: '🎍', cua: '🦀', tom: '🦐', ca: '🐟', ga: '🐓', nai: '🦌' };
    return r.map(f => `${emo[f]} ${f}`).join('  |  ');
}

function fmtUserTag(id: string, name?: string) {
    return name ? `${name}` : `<@${id}>`;
}

const BAUCUA_SPRITESHEET = 'https://raw.githubusercontent.com/dctri1803/baucua-assets/main/baucua_draw_spritesheet.png';
// "https://cdn.mezon.ai/0/1834156727516270592/1805415525119955000/1751356942745_1slots.png"
const BAUCUA_POSITIONS = 'https://raw.githubusercontent.com/dctri1803/baucua-assets/main/baucua_chibi_positions.json';
// "https://cdn.mezon.ai/0/1834156727516270592/1827994776956309500/1751357108975_slots.json"

// Thứ tự frame trong spritesheet (tùy bạn vẽ mà chỉnh lại)
const FACE_ORDER: Face[] = ['bau', 'cua', 'tom', 'ca', 'ga', 'nai'];

// Nếu bạn dùng filename thay vì index, có thể làm mảng file:
const FACE_FILES = {
    bau: '1.png',
    cua: '2.png',
    tom: '3.png',
    ca: '4.png',
    ga: '5.png',
    nai: '6.png',
} as const;

function faceToIndex(f: Face) {
    return FACE_ORDER.indexOf(f); // 0..5
}

function faceToFile(f: Face) {
    return FACE_FILES[f]; // 'bau.png'...
}

/**
 * Tạo chuỗi "quay lắc" cho mỗi viên xí ngầu, kết thúc ở mặt finalFace.
 * Giống logic slots: pool là mảng các dải frame, phần tử cuối ứng với "kết quả".
 */
function buildRollSequencesFiles(
    finals: [Face, Face, Face],
    cycles = 3,
    jitter = [0, 1, 2],
): string[][] {
    const N = FACE_ORDER.length; // 6

    return finals.map((finalFace, i) => {
        const spinLen = cycles * N + jitter[i % jitter.length];
        const seq: string[] = [];

        for (let k = 0; k < spinLen; k++) {
            const idx = k % N;
            seq.push(faceToFile(FACE_ORDER[idx])); // luôn là filename -> string
        }
        // kết thúc bằng đúng mặt kết quả
        seq.push(faceToFile(finalFace));
        return seq;
    });
}

/** Embed Animation cho giai đoạn "đang quay" */
function buildBauCuaSpinEmbed(pool: (string[] | number[])[]) {
    return {
        color: '#ffaa00',
        title: '🎲 Bầu Cua — Đang lắc…',
        fields: [
            {
                name: '',
                value: '',
                inputs: {
                    id: 'baucua',
                    type: EMessageComponentType.ANIMATION,
                    component: {
                        url_image: BAUCUA_SPRITESHEET,
                        url_position: BAUCUA_POSITIONS,
                        pool,           // 3 dải cho 3 viên
                        repeat: 3,      // đi hết chuỗi 1 lần (đã chứa cycles)
                        duration: 0.35, // tốc độ khung (có thể tinh chỉnh)
                        width: 512,        // hoặc 600/720…
                        height: 512,
                        fit: 'contain',
                    },
                },
            },
        ],
    };
}

/** Embed Animation cho giai đoạn "hiện kết quả" */
function buildBauCuaResultEmbed(
    pool: string[][],
    resultText: string,
    summaryText: string
) {
    return {
        color: '#22c55e',               // <--
        title: '🎲 Bầu Cua — Kết quả',
        description:
            '```\n' + resultText + '\n-------------------------\n' + summaryText + '\n```',
        fields: [
            {
                name: '',
                value: '',
                inputs: {
                    id: 'baucua',
                    type: EMessageComponentType.ANIMATION,
                    component: {
                        url_image: BAUCUA_SPRITESHEET,
                        url_position: BAUCUA_POSITIONS,
                        pool,
                        repeat: 1,
                        duration: 0.35,
                        isResult: 1,
                        width: 512,
                        height: 512,
                        fit: 'contain',
                    },
                },
            },
        ],
    };
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
        const bankerId = message.sender_id!;

        try {
            switch (sub) {
                case 'help': {
                    const t =
                        `BẦU CUA DÙNG TOKEN — LUẬT & CÁCH CHƠI

LỆNH NHANH
• $baucua host --min=1000 --max=100000 --maxPlayers=10
→ mở bàn, bạn là nhà cái
• $baucua bet tom:2000 ca:500                   
→ đặt mỗi cửa một mức tiền (per-face)
• $baucua bet tom ca --bet=1000                 
→ đặt đều mỗi cửa 1000→ người chơi đặt (1–3 mặt)
• $baucua start                                                 
→ nhà cái bắt đầu, quay & quyết toán
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
                    return messageChannel?.reply({ t, mk: [{ type: EMarkdownType.PRE, s: 0, e: t.length }] });
                }
                case 'host': {
                    const min = Number(args.find(a => a.startsWith('--min='))?.split('=')[1] ?? 1000);
                    const max = Number(args.find(a => a.startsWith('--max='))?.split('=')[1] ?? 100000);
                    const mp = Number(args.find(a => a.startsWith('--maxPlayers='))?.split('=')[1] ?? 10);
                    this.game.open(channelId, bankerId, {
                        minBet: isFinite(min) ? min : 1000,
                        maxBet: isFinite(max) ? max : 100000,
                        maxPlayers: isFinite(mp) ? Math.max(1, mp) : 10,
                    });

                    const name = await this.active.getNameOrFetch(channelId, bankerId) || `<@${bankerId}>`;
                    const t = `🧧 Mở bàn bầu cua: nhà cái ${name}
Min bet: ${isFinite(min) ? min : 1000} | Max bet: ${isFinite(max) ? max : 100000} | Max players: ${isFinite(mp) ? Math.max(1, mp) : 10}
Người chơi dùng: $baucua bet ca --bet=1000
                             $baucua bet tom:2000 ca:500`;
                    return messageChannel?.reply({ t, mk: [{ type: EMarkdownType.PRE, s: 0, e: t.length }] });
                }

                case 'bet': {
                    const userId = message.sender_id!;
                    const parsed = parseBetArgs(args.slice(1));

                    if (parsed.mode === 'uniform') {
                        if (parsed.picks.length < 1 || parsed.picks.length > 3) {
                            const t = `Bạn cần chọn 1–3 mặt (bau: '🎍'| cua: '🦀'| tom: '🦐'| ca: '🐟'| ga: '🐓'| nai: '🦌').
Ví dụ:  $baucua bet tom ca --bet=1000.
           $baucua bet tom:2000 ca:500.`;
                            return messageChannel?.reply({ t, mk: [{ type: EMarkdownType.PRE, s: 0, e: t.length }] });
                        }
                        const wagers = parsed.picks.map(pick => ({ pick, bet: parsed.bet }));
                        await this.game.bet(channelId, userId, wagers, this.token);

                        const total = wagers.reduce((s, w) => s + w.bet, 0);
                        const desc = wagers.map(w => `${w.pick} x ${w.bet}`).join(', ');
                        const t = `✅ Đặt cược: ${desc}\nTổng đặt: ${total}\nNhà cái dùng $baucua start để bắt đầu`;
                        return messageChannel?.reply({ t, mk: [{ type: EMarkdownType.PRE, s: 0, e: t.length }] });
                    } else {
                        if (parsed.wagers.length < 1 || parsed.wagers.length > 3) {
                            const t = 'Bạn cần chọn 1–3 mặt. Ví dụ: $baucua bet tom:2000 ca:500';
                            return messageChannel?.reply({ t, mk: [{ type: EMarkdownType.PRE, s: 0, e: t.length }] });
                        }
                        await this.game.bet(channelId, userId, parsed.wagers, this.token);

                        const total = parsed.wagers.reduce((s, w) => s + w.bet, 0);
                        const desc = parsed.wagers.map(w => `${w.pick} x ${w.bet}`).join(', ');
                        const t = `✅ Đặt cược: ${desc}\nTổng đặt: ${total}\nNhà cái dùng $baucua start để bắt đầu`;
                        return messageChannel?.reply({ t, mk: [{ type: EMarkdownType.PRE, s: 0, e: t.length }] });
                    }
                }

                case 'start': {
                    // 1) Chạy game: ra kết quả & quyết toán như cũ
                    const result = await this.game.start(channelId, bankerId, this.token);
                    // result.result: [Face, Face, Face]
                    // result.settlements: { userId, net }[]
                    // result.bankerDelta: number

                    // 2) Build text kết quả + quyết toán
                    const lines = (await Promise.all(
                        result.settlements.map(async (s) => {
                            const n = await this.active.getNameOrFetch(channelId, s.userId);
                            const sign = s.net >= 0 ? '+' : '';
                            return `- ${fmtUserTag(s.userId, n)}: ${sign}${s.net}`;
                        })
                    )).join('\n');
                    const bankerName = await this.active.getNameOrFetch(channelId, bankerId);

                    const resultText = `Kết quả: ${fmtResult(result.result)}`;
                    const summaryText =
                        `Quyết toán (net):\n${lines}\n` +
                        `-------------------------\n` +
                        `💼 Nhà cái ${fmtUserTag(bankerId, bankerName)}: ${result.bankerDelta >= 0 ? '+' : ''}${result.bankerDelta}`;

                    // 3) Tạo chuỗi animation "đang quay" (giống slots.pool)
                    const pool = buildRollSequencesFiles(result.result, 3, [0, 1, 2]); // 3 vòng
                    const spinEmbed = buildBauCuaSpinEmbed(pool);

                    // 4) Gửi embed quay
                    const messageChannel = await this.getChannelMessage(message);
                    if (!messageChannel) return;
                    const messBot = await messageChannel.reply({ embed: [spinEmbed] });
                    if (!messBot) return;

                    // 5) Chuẩn bị message giả BOT để update (y như slots)
                    const msg: ChannelMessage = {
                        mode: messBot.mode,
                        message_id: messBot.message_id,
                        code: messBot.code,
                        create_time: messBot.create_time,
                        update_time: messBot.update_time,
                        id: messBot.message_id,
                        clan_id: message.clan_id,
                        channel_id: message.channel_id,
                        persistent: messBot.persistence,
                        channel_label: message.channel_label,
                        content: {},
                        sender_id: (process.env.UTILITY_BOT_ID as string) ?? bankerId,
                    };


                    // 6) Sau delay ngắn, update sang embed kết quả (dừng ở frame cuối)
                    //    Thời gian delay = cycles * frames * duration ~ cảm giác “đủ đã”
                    const cycles = 3;
                    const framesPerCycle = FACE_ORDER.length; // 6
                    const duration = 0.35; // trùng với build*
                    const safety = 300;    // bù trễ
                    const delayMs = Math.round(cycles * framesPerCycle * (duration * 1000)) + safety;

                    setTimeout(async () => {
                        const messageBot = await this.getChannelMessage(msg);
                        if (!messageBot) return;                           // guard
                        const resultEmbed = buildBauCuaResultEmbed(pool, resultText, summaryText);
                        await messageBot.update({ embed: [resultEmbed] });
                    }, delayMs);

                    return;
                }


                case 'status': {
                    const st = this.game.status(channelId);
                    if (!st) {
                        const t = 'Chưa có bàn nào. Tạo bằng: $baucua host';
                        return messageChannel?.reply({ t, mk: [{ type: EMarkdownType.PRE, s: 0, e: t.length }] });
                    }
                    const bankerName = await this.active.getNameOrFetch(channelId, st.bankerId);
                    const betLines = st.bets.length
                        ? (await Promise.all(st.bets.map(async b => {
                            const n = await this.active.getNameOrFetch(channelId, b.userId);
                            const desc = b.wagers.map(w => `${w.pick} x ${w.bet}`).join(', ');
                            return `- ${n ?? `<@${b.userId}>`}: ${desc}`;
                        }))).join('\n')
                        : '(chưa ai đặt)';

                    const t =
                        `Bàn hiện tại
Nhà cái: ${bankerName ?? `<@${st.bankerId}>`}
Min: ${st.minBet} | Max: ${st.maxBet} | Max players: ${st.maxPlayers}
Trạng thái: ${st.status}
Số người chơi: ${st.bets.length}/${st.maxPlayers}
Cược:
${betLines}`;
                    return messageChannel?.reply({ t, mk: [{ type: EMarkdownType.PRE, s: 0, e: t.length }] });
                }

                case 'cancel': {
                    this.game.cancel(channelId, bankerId);
                    const t = '❌ Đã hủy bàn.';
                    return messageChannel?.reply({ t, mk: [{ type: EMarkdownType.PRE, s: 0, e: t.length }] });
                }

                case 'bal': {
                    const bal = await this.token.getBalance(bankerId);
                    const t = `Số dư của bạn: ${bal}`;
                    return messageChannel?.reply({ t, mk: [{ type: EMarkdownType.PRE, s: 0, e: t.length }] });
                }
                default: {
                    // Gợi ý nhanh
                    const t = 'Dùng $baucua help để xem hướng dẫn.\nPhổ biến: $baucua host | $baucua bet tom ca --bet=1000 | $baucua start';
                    return messageChannel?.reply({ t, mk: [{ type: EMarkdownType.PRE, s: 0, e: t.length }] });
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
            const t = map[msg] || (msg.startsWith('PLAYER_INSUFFICIENT')
                ? `Một người chơi không đủ token để tham gia (userId=${msg.split(':')[1]})`
                : `Lỗi: ${msg}`);
            return messageChannel?.reply({ t, mk: [{ type: EMarkdownType.PRE, s: 0, e: t.length }] });
        }
    }
}
