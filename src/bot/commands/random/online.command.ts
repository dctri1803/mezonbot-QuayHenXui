import { ChannelMessage, EMarkdownType } from 'mezon-sdk';
import { CommandMessage } from 'src/bot/base/command.abstract';
import { Command } from 'src/bot/base/commandRegister.decorator';
import { MezonClientService } from 'src/mezon/services/mezon-client.service';
import { ActiveUsersService } from 'src/bot/services/active-users.service';

@Command('online')
export class OnlineCommand extends CommandMessage {
    constructor(
        clientService: MezonClientService,
        private active: ActiveUsersService
    ) {
        super(clientService);
    }

    async execute(args: string[], message: ChannelMessage) {
        const withinMin = args[0] ? Math.max(1, parseInt(args[0], 10)) : 15;
        const messageChannel = await this.getChannelMessage(message);

        const candidates = this.active
            .listActive(message.channel_id!, withinMin * 60 * 1000);

        if (candidates.length === 0) {
            const t = `Không ai online trong ${withinMin} phút gần đây ở phòng này.`;
            return messageChannel?.reply({ t, mk: [{ type: EMarkdownType.PRE, s: 0, e: t.length }] });
        }

        const clan = this.client.clans.get(message.clan_id!);
        if (!clan) {
            const t = 'Không lấy được thông tin clan hiện tại.';
            return messageChannel?.reply({ t, mk: [{ type: EMarkdownType.PRE, s: 0, e: t.length }] });
        }

        const fetched = await Promise.all(
            candidates.map((id) => clan.users.fetch(id).catch(() => undefined))
        );
        const users = fetched.filter(Boolean) as Array<{ display_name?: string; username: string }>;

        const lines = users.map((u, idx) => `${idx + 1}. ${u.display_name || u.username}`);
        const header = `🟢 Online (${lines.length}):`;
        const t = header + '\n' + lines.join('\n');
        return messageChannel?.reply({ t, mk: [{ type: EMarkdownType.PRE, s: 0, e: t.length }] });
    }
}