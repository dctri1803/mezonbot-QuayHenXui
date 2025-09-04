import { ChannelMessage, EMarkdownType } from 'mezon-sdk';
import { CommandMessage } from 'src/bot/base/command.abstract';
import { Command } from 'src/bot/base/commandRegister.decorator';
import { MezonClientService } from 'src/mezon/services/mezon-client.service';
import { ActiveUsersService } from 'src/bot/services/active-users.service';

@Command('assign')
export class AssignCommand extends CommandMessage {
    constructor(
        clientService: MezonClientService,
        private active: ActiveUsersService
    ) {
        super(clientService);
    }

    async execute(args: string[], message: ChannelMessage) {
        // $assign <mô tả công việc> [--within=phut]
        let withinMin = 15;
        const withinIdx = args.findIndex((a) => a.startsWith('--within='));
        if (withinIdx > -1) {
            const v = args[withinIdx].split('=')[1];
            args.splice(withinIdx, 1);
            const n = parseInt(v, 10);
            if (!isNaN(n) && n > 0) withinMin = n;
        }

        const task = args.join(' ').trim();
        const messageChannel = await this.getChannelMessage(message);

        if (!task) {
            const t =
                'Cú pháp: $assign <mô tả công việc> [--within=<phút>]\nVD: $assign Viết báo cáo sprint --within=30';
            return messageChannel?.reply({
                t,
                mk: [{ type: EMarkdownType.PRE, s: 0, e: t.length }],
            });
        }

        // Guard các ID bắt buộc
        const channelId = message.channel_id;
        const clanId = message.clan_id;
        if (!channelId || !clanId) {
            const t = 'Thiếu channel_id hoặc clan_id trong message.';
            return messageChannel?.reply({
                t,
                mk: [{ type: EMarkdownType.PRE, s: 0, e: t.length }],
            });
        }

        const candidates = this.active
            .listActive(channelId, withinMin * 60 * 1000)
            .filter((id) => id !== message.sender_id);

        if (candidates.length === 0) {
            const t = `Không thấy ai hoạt động trong ${withinMin} phút gần đây ở phòng này.`;
            return messageChannel?.reply({
                t,
                mk: [{ type: EMarkdownType.PRE, s: 0, e: t.length }],
            });
        }

        const pickedId = candidates[Math.floor(Math.random() * candidates.length)];

        // Guard clan trước khi fetch user
        const clan = this.client.clans.get(clanId);
        if (!clan) {
            const t = 'Không lấy được thông tin clan hiện tại.';
            return messageChannel?.reply({
                t,
                mk: [{ type: EMarkdownType.PRE, s: 0, e: t.length }],
            });
        }

        // Fetch user kèm try/catch để tránh vỡ Promise
        let picked: { display_name?: string; username: string } | undefined;
        try {
            picked = await clan.users.fetch(pickedId);
        } catch {
            // ignore
        }
        if (!picked) {
            const t = 'Không tìm được thông tin người dùng được chọn.';
            return messageChannel?.reply({
                t,
                mk: [{ type: EMarkdownType.PRE, s: 0, e: t.length }],
            });
        }

        const t = `📝 Giao việc: ${task}\n➡️ Người nhận: ${picked.display_name || picked.username}`;
        return messageChannel?.reply({
            t,
            mk: [{ type: EMarkdownType.PRE, s: 0, e: t.length }],
        });
    }
}