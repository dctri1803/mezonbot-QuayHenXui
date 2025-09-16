import { ChannelMessage, EMarkdownType } from "mezon-sdk";
import { CommandMessage } from "src/bot/base/command.abstract";
import { Command } from "src/bot/base/commandRegister.decorator";
import { ActiveUsersService } from "src/bot/services/active-users.service";
import { DbTokenPort } from "src/bot/services/token.memory";
import { MezonClientService } from "src/mezon/services/mezon-client.service";

function fmtUserTag(id: string, name?: string) {
    return name ? `${name}` : `<@${id}>`;
}

@Command("admin")
export class AdminCommand extends CommandMessage {
    constructor(
        clientService: MezonClientService,
        private token: DbTokenPort,
        private active: ActiveUsersService
    ) {
        super(clientService);
    }

    async execute(args: string[], message: ChannelMessage) {
        const messageChannel = await this.getChannelMessage(message);
        const sub = (args[0] || "").toLowerCase();

        try {
            switch (sub) {
                // RÚT TIỀN: admin lấy tiền từ BOT về admin
                case "remit": {
                    const adminId = process.env.BOT_ADMIN_ID || process.env.ADMIN_ID;
                    const botId = process.env.BOT_ID;

                    if (!botId || !adminId) {
                        const t =
                            "Thiếu cấu hình môi trường: cần BOT_ID và BOT_ADMIN_ID (hoặc ADMIN_ID).";
                        return messageChannel?.reply({
                            t,
                            mk: [{ type: EMarkdownType.PRE, s: 0, e: t.length }],
                        });
                    }

                    // Chỉ admin được phép gọi
                    const callerId = message.sender_id!;
                    if (callerId !== adminId) {
                        const t = "Chỉ admin mới được phép thực hiện remit.";
                        return messageChannel?.reply({
                            t,
                            mk: [{ type: EMarkdownType.PRE, s: 0, e: t.length }],
                        });
                    }

                    // Cú pháp: $admin remit [all|<amount>] [--keep=<number>]
                    const arg1 = (args[1] || "").toLowerCase();
                    const keepRaw = args.find((a) => a.startsWith("--keep="))?.split("=")[1];
                    const keep = Math.max(0, Math.floor(Number(keepRaw ?? "0")) || 0);

                    const botBal = Math.floor(await this.token.getBalance(botId));

                    if (!arg1 || (arg1 !== "all" && isNaN(parseInt(arg1, 10)))) {
                        const t = `Cách dùng:
- $admin remit all [--keep=0]         → rút toàn bộ số dư bot về admin, chừa lại 'keep'
- $admin remit <amount>               → rút đúng số tiền
Số dư bot hiện tại: ${botBal.toLocaleString("vi-VN")}đ`;
                        return messageChannel?.reply({
                            t,
                            mk: [{ type: EMarkdownType.PRE, s: 0, e: t.length }],
                        });
                    }

                    let amount = 0;
                    if (arg1 === "all") {
                        amount = Math.max(0, botBal - keep);
                    } else {
                        amount = Math.floor(parseInt(arg1, 10));
                    }

                    if (amount <= 0) {
                        const t = `Số tiền remit không hợp lệ hoặc không đủ sau khi trừ keep. Số dư bot: ${botBal.toLocaleString(
                            "vi-VN"
                        )}đ`;
                        return messageChannel?.reply({
                            t,
                            mk: [{ type: EMarkdownType.PRE, s: 0, e: t.length }],
                        });
                    }

                    if (amount > botBal) amount = botBal;

                    await this.token.transfer(
                        botId,
                        adminId,
                        amount,
                        "Admin: remit from bot to admin"
                    );

                    const adminName = await this.active.getNameOrFetch(
                        message.channel_id!,
                        adminId
                    );
                    const t = `✅ Remit thành công: +${amount.toLocaleString(
                        "vi-VN"
                    )}đ → admin ${fmtUserTag(adminId, adminName)}
Số dư bot trước: ${botBal.toLocaleString("vi-VN")}đ
Số dư bot sau:  ${(botBal - amount).toLocaleString("vi-VN")}đ`;
                    return messageChannel?.reply({
                        t,
                        mk: [{ type: EMarkdownType.PRE, s: 0, e: t.length }],
                    });
                }

                // NẠP TIỀN: admin nạp tiền cho BOT
                case "fund": {
                    const adminId = process.env.BOT_ADMIN_ID || process.env.ADMIN_ID;
                    const botId = process.env.BOT_ID;

                    if (!botId || !adminId) {
                        const t =
                            "Thiếu cấu hình môi trường: cần BOT_ID và BOT_ADMIN_ID (hoặc ADMIN_ID).";
                        return messageChannel?.reply({
                            t,
                            mk: [{ type: EMarkdownType.PRE, s: 0, e: t.length }],
                        });
                    }

                    // Chỉ admin được phép gọi
                    const callerId = message.sender_id!;
                    if (callerId !== adminId) {
                        const t = "Chỉ admin mới được phép nạp tiền cho bot.";
                        return messageChannel?.reply({
                            t,
                            mk: [{ type: EMarkdownType.PRE, s: 0, e: t.length }],
                        });
                    }

                    // Cú pháp bắt buộc: $admin fund <amount>
                    const amountStr = args[1] || "";
                    const isNumeric = /^[0-9]+$/.test(amountStr);
                    const amount = Math.floor(Number(amountStr));

                    const [adminBalRaw, botBalRaw] = await Promise.all([
                        this.token.getBalance(adminId),
                        this.token.getBalance(botId),
                    ]);
                    const adminBal = Math.floor(adminBalRaw);
                    const botBal = Math.floor(botBalRaw);

                    if (!isNumeric || amount <= 0) {
                        const t = `Cách dùng:
$ admin fund 50000   ← nạp đúng 50.000 vào bot

Số dư admin hiện tại: ${adminBal.toLocaleString("vi-VN")}đ
Số dư bot hiện tại:   ${botBal.toLocaleString("vi-VN")}đ`;
                        return messageChannel?.reply({
                            t,
                            mk: [{ type: EMarkdownType.PRE, s: 0, e: t.length }],
                        });
                    }

                    if (amount > adminBal) {
                        const t = `Số dư admin không đủ để nạp ${amount.toLocaleString(
                            "vi-VN"
                        )}đ.
Số dư admin: ${adminBal.toLocaleString("vi-VN")}đ`;
                        return messageChannel?.reply({
                            t,
                            mk: [{ type: EMarkdownType.PRE, s: 0, e: t.length }],
                        });
                    }

                    await this.token.transfer(
                        adminId,
                        botId,
                        amount,
                        "Admin: fund bot from admin"
                    );

                    const t = `✅ Nạp thành công: +${amount.toLocaleString(
                        "vi-VN"
                    )}đ → bot
Số dư admin trước: ${adminBal.toLocaleString("vi-VN")}đ
Số dư admin sau:   ${(adminBal - amount).toLocaleString("vi-VN")}đ
Số dư bot trước:   ${botBal.toLocaleString("vi-VN")}đ
Số dư bot sau:     ${(botBal + amount).toLocaleString("vi-VN")}đ`;
                    return messageChannel?.reply({
                        t,
                        mk: [{ type: EMarkdownType.PRE, s: 0, e: t.length }],
                    });
                }

                default: {
                    const t = `Lệnh admin:
- $admin remit all [--keep=0]
- $admin remit <amount>
- $admin fund <amount>`;
                    return messageChannel?.reply({
                        t,
                        mk: [{ type: EMarkdownType.PRE, s: 0, e: t.length }],
                    });
                }
            }
        } catch (e: any) {
            const t = `Lỗi: ${String(e?.message || e)}`;
            return messageChannel?.reply({
                t,
                mk: [{ type: EMarkdownType.PRE, s: 0, e: t.length }],
            });
        }
    }
}
