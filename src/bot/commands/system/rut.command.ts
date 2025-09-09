import { ChannelMessage, EMarkdownType } from 'mezon-sdk';
import { Command } from 'src/bot/base/commandRegister.decorator';
import { CommandMessage } from 'src/bot/base/command.abstract';
import { MezonClientService } from 'src/mezon/services/mezon-client.service';
import { User } from 'src/bot/models/user.entity';
import { Repository, DataSource } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';

@Command('rut')
export class RutCommand extends CommandMessage {
    private static isBlockRut: boolean = false;
    private static processingUsers: Set<string> = new Set();
    private static TRANSACTION_TIMEOUT_MS: number = 10000;
    private static userTimeouts: Map<string, NodeJS.Timeout> = new Map();

    constructor(
        clientService: MezonClientService,
        @InjectRepository(User)
        private userRepository: Repository<User>,
        private dataSource: DataSource,
        private configService: ConfigService,
    ) {
        super(clientService);
    }

    async execute(args: string[], message: ChannelMessage) {
        const messageChannel = await this.getChannelMessage(message);

        if (message.sender_id === (this.configService.get('ADMIN_ID') as string)) {
            if (args[0] === 'block') {
                RutCommand.isBlockRut = true;
                return await messageChannel?.reply({
                    t: 'Đã khóa Hệ thống rút tiền',
                    mk: [{ type: EMarkdownType.PRE, s: 0, e: 36 }],
                });
            } else if (args[0] === 'unlock') {
                RutCommand.isBlockRut = false;
                return await messageChannel?.reply({
                    t: 'Hệ thống đã được mở khóa rút tiền',
                    mk: [{ type: EMarkdownType.PRE, s: 0, e: 36 }],
                });
            } else if (args[0] === 'clear') {
                this.clearAllProcessingUsers();
                return await messageChannel?.reply({
                    t: 'Đã xóa danh sách người dùng đang xử lý giao dịch',
                    mk: [{ type: EMarkdownType.PRE, s: 0, e: 48 }],
                });
            } else if (args[0] === 'status') {
                const processingCount = RutCommand.processingUsers.size;
                const usersList = Array.from(RutCommand.processingUsers).join(', ');
                const statusMessage = `Hệ thống ${RutCommand.isBlockRut ? 'đang bị khóa' : 'đang hoạt động'
                    }\nSố người dùng đang xử lý: ${processingCount}\n${processingCount > 0 ? `Danh sách: ${usersList}` : ''
                    }`;
                return await messageChannel?.reply({
                    t: statusMessage,
                    mk: [{ type: EMarkdownType.PRE, s: 0, e: statusMessage.length }],
                });
            }
        }

        if (RutCommand.isBlockRut) {
            const context = 'Hệ thống đang bảo trì, vui lòng thử lại sau';
            return await messageChannel?.reply({
                t: context,
                mk: [{ type: EMarkdownType.PRE, s: 0, e: context.length }],
            });
        }

        if (RutCommand.processingUsers.has(message.sender_id)) {
            const busyMessage =
                'Bạn đang có một giao dịch đang xử lý, vui lòng đợi giao dịch hoàn tất';
            return await messageChannel?.reply({
                t: busyMessage,
                mk: [{ type: EMarkdownType.PRE, s: 0, e: busyMessage.length }],
            });
        }

        if (!args[0] || !Number(args[0]) || Number(args[0]) <= 0) {
            return await messageChannel?.reply({
                t: 'Vui lòng nhập số tiền cần rút hợp lệ',
                mk: [{ type: EMarkdownType.PRE, s: 0, e: 36 }],
            });
        }

        const amount = Number(args[0]);
        const queryRunner = this.dataSource.createQueryRunner();

        this.markUserAsProcessing(message.sender_id);

        try {
            await queryRunner.connect();
            await queryRunner.startTransaction();

            const user = await queryRunner.manager
                .createQueryBuilder(User, 'user')
                .setLock('pessimistic_write')
                .where('user.user_id = :userId', { userId: message.sender_id })
                .getOne();

            const bot = await queryRunner.manager
                .createQueryBuilder(User, 'user')
                .setLock('pessimistic_write')
                .where('user.user_id = :userId', {
                    userId: this.configService.get('BOT_ID'),
                })
                .getOne();

            if (!user) {
                this.clearUserProcessing(message.sender_id);
                return await messageChannel?.reply({
                    t: 'User không tồn tại',
                    mk: [{ type: EMarkdownType.PRE, s: 0, e: 18 }],
                });
            }

            if (!bot) {
                this.clearUserProcessing(message.sender_id);
                return await messageChannel?.reply({
                    t: 'Bot không tồn tại',
                    mk: [{ type: EMarkdownType.PRE, s: 0, e: 18 }],
                });
            }

            if (Number(user.amount) < amount) {
                this.clearUserProcessing(message.sender_id);
                return await messageChannel?.reply({
                    t: 'Số dư không đủ để thực hiện giao dịch',
                    mk: [{ type: EMarkdownType.PRE, s: 0, e: 38 }],
                });
            }

            user.amount = Number(user.amount) - amount;
            bot.amount = Number(bot.amount) + amount;

            await queryRunner.manager.save(User, [user, bot]);

            await queryRunner.commitTransaction();

            const dataSendToken = {
                sender_id: this.configService.get('BOT_ID'),
                sender_name: this.configService.get('BOT_NAME') || 'AUCTION-MEZON-BOT',
                receiver_id: message.sender_id,
                amount: amount,
            };

            try {
                await this.client.sendToken(dataSendToken);

                const successMessage = `💸Rút ${amount.toLocaleString('vi-VN')}đ thành công`;
                this.clearUserProcessing(message.sender_id);
                return await messageChannel?.reply({
                    t: successMessage,
                    mk: [{ type: EMarkdownType.PRE, s: 0, e: successMessage.length }],
                });
            } catch (error) {
                console.error('Error sending token:', error);

                const refundQueryRunner = this.dataSource.createQueryRunner();
                try {
                    await refundQueryRunner.connect();
                    await refundQueryRunner.startTransaction();

                    const updatedUser = await refundQueryRunner.manager
                        .createQueryBuilder(User, 'user')
                        .setLock('pessimistic_write')
                        .where('user.user_id = :userId', { userId: message.sender_id })
                        .getOne();

                    const updatedBot = await refundQueryRunner.manager
                        .createQueryBuilder(User, 'user')
                        .setLock('pessimistic_write')
                        .where('user.user_id = :userId', {
                            userId: this.configService.get('BOT_ID'),
                        })
                        .getOne();

                    if (updatedUser && updatedBot) {
                        updatedUser.amount = Number(updatedUser.amount) + amount;
                        updatedBot.amount = Number(updatedBot.amount) - amount;

                        await refundQueryRunner.manager.save(User, [
                            updatedUser,
                            updatedBot,
                        ]);
                        await refundQueryRunner.commitTransaction();
                    }
                } catch (refundError) {
                    console.error('Error refunding:', refundError);
                    await refundQueryRunner.rollbackTransaction();
                } finally {
                    await refundQueryRunner.release();
                }

                const errorMessage = `💸Có lỗi xảy ra khi rút ${amount.toLocaleString('vi-VN')}đ, tiền đã được hoàn lại vào tài khoản của bạn`;
                this.clearUserProcessing(message.sender_id);
                return await messageChannel?.reply({
                    t: errorMessage,
                    mk: [{ type: EMarkdownType.PRE, s: 0, e: errorMessage.length }],
                });
            }
        } catch (error) {
            await queryRunner.rollbackTransaction();
            console.error('Error in RutCommand:', error);

            const errorMessage =
                'Có lỗi xảy ra khi xử lý giao dịch. Vui lòng thử lại sau.';
            this.clearUserProcessing(message.sender_id);
            return await messageChannel?.reply({
                t: errorMessage,
                mk: [{ type: EMarkdownType.PRE, s: 0, e: errorMessage.length }],
            });
        } finally {
            this.clearUserProcessing(message.sender_id);
            await queryRunner.release();
        }
    }

    private markUserAsProcessing(userId: string): void {
        this.clearUserProcessing(userId);

        RutCommand.processingUsers.add(userId);

        const timeoutId = setTimeout(() => {
            if (RutCommand.processingUsers.has(userId)) {
                RutCommand.processingUsers.delete(userId);
            }
        }, RutCommand.TRANSACTION_TIMEOUT_MS);

        RutCommand.userTimeouts.set(userId, timeoutId);
    }

    private clearUserProcessing(userId: string): void {
        const timeoutId = RutCommand.userTimeouts.get(userId);
        if (timeoutId) {
            clearTimeout(timeoutId);
            RutCommand.userTimeouts.delete(userId);
        }

        RutCommand.processingUsers.delete(userId);
    }

    private clearAllProcessingUsers(): void {
        for (const timeoutId of RutCommand.userTimeouts.values()) {
            clearTimeout(timeoutId);
        }

        RutCommand.userTimeouts.clear();
        RutCommand.processingUsers.clear();
    }
}