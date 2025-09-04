import { ChannelMessage, EMarkdownType } from 'mezon-sdk';
import { CommandMessage } from 'src/bot/base/command.abstract';
import { Command } from 'src/bot/base/commandRegister.decorator';
import { MezonClientService } from 'src/mezon/services/mezon-client.service';
import { ActiveUsersService } from 'src/bot/services/active-users.service';

function parseArgs(args: string[]) {
    // $random [count] [--within=phut]
    let count = 1;
    let withinMin = 15;
    for (const a of args) {
        const n = parseInt(a, 10);
        if (!isNaN(n)) count = Math.min(Math.max(n, 1), 10);
        const m = a.match(/^--within=(\d{1,3})$/);
        if (m) withinMin = Math.max(1, parseInt(m[1], 10));
    }
    return { count, withinMin };
}

@Command('random')
export class RandomCommand extends CommandMessage {
    constructor(
        clientService: MezonClientService,
        private active: ActiveUsersService
    ) {
        super(clientService);
    }

    async execute(args: string[], message: ChannelMessage) {
        const { count, withinMin } = parseArgs(args);
        const messageChannel = await this.getChannelMessage(message);

        const candidates = this.active
            .listActive(message.channel_id!, withinMin * 60 * 1000)
            .filter((id) => id !== message.sender_id);

        if (candidates.length === 0) {
            const t = `Không thấy ai hoạt động trong ${withinMin} phút gần đây ở phòng này.`;
            return messageChannel?.reply({ t, mk: [{ type: EMarkdownType.PRE, s: 0, e: t.length }] });
        }

        // shuffle Fisher–Yates...
        for (let i = candidates.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
        }
        const pickIds = candidates.slice(0, Math.min(count, candidates.length));

        // ✅ LẤY CLAN CÓ GUARD
        const clan = this.client.clans.get(message.clan_id!);
        if (!clan) {
            const t = 'Không lấy được thông tin clan hiện tại.';
            return messageChannel?.reply({ t, mk: [{ type: EMarkdownType.PRE, s: 0, e: t.length }] });
        }

        // fetch user info an toàn
        const fetched = await Promise.all(
            pickIds.map((id) => clan.users.fetch(id).catch(() => undefined))
        );
        const users = fetched.filter(Boolean) as Array<{ display_name?: string; username: string }>;

        const lines = users.map((u, idx) => `${idx + 1}. ${u.display_name || u.username}`);
        const header = `🎲 Random ${lines.length}/${candidates.length} người (trong ${withinMin} phút):`;
        const t = header + '\n' + lines.join('\n');
        return messageChannel?.reply({ t, mk: [{ type: EMarkdownType.PRE, s: 0, e: t.length }] });
    }
}
