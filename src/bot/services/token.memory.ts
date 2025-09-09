import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { User } from 'src/bot/models/user.entity';
import { TokenPort } from './token.port';

@Injectable()
export class DbTokenPort implements TokenPort {
  constructor(
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    private readonly dataSource: DataSource,
  ) {}

  /**
   * Đồng bộ số dư (set thẳng amount trong DB)
   */
  async syncBalance(userId: string, amount: number): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const u = await manager
        .createQueryBuilder(User, 'u')
        .setLock('pessimistic_write')
        .where('u.user_id::text = :uid', { uid: userId })
        .getOne();

      if (!u) throw new Error('USER_NOT_FOUND');
      u.amount = Number(amount);
      await manager.save(User, u);
    });
  }

  /**
   * Lấy số dư, nếu truyền amount sẽ đồng bộ trước rồi trả về
   */
  async getBalance(userId: string, amount?: number): Promise<number> {
    if (typeof amount === 'number') {
      await this.syncBalance(userId, amount);
      return amount;
    }

    const u = await this.userRepo
      .createQueryBuilder('u')
      .where('u.user_id::text = :uid', { uid: userId })
      .getOne();

    if (!u) throw new Error('USER_NOT_FOUND');
    return Math.floor(Number(u.amount) || 0);
  }

  /**
   * Chuyển token giữa 2 user trong 1 transaction, có khóa ghi
   */
  async transfer(from: string, to: string, amount: number, memo?: string): Promise<void> {
    if (!Number.isFinite(amount) || amount <= 0) throw new Error('INVALID_AMOUNT');

    await this.dataSource.transaction(async (manager) => {
      // Khóa người gửi
      const sender = await manager
        .createQueryBuilder(User, 'u')
        .setLock('pessimistic_write')
        .where('u.user_id::text = :uid', { uid: from })
        .getOne();
      if (!sender) throw new Error('SENDER_NOT_FOUND');

      // Khóa người nhận
      const receiver = await manager
        .createQueryBuilder(User, 'u')
        .setLock('pessimistic_write')
        .where('u.user_id::text = :uid', { uid: to })
        .getOne();
      if (!receiver) throw new Error('RECEIVER_NOT_FOUND');

      const sb = Number(sender.amount) || 0;
      if (sb < amount) throw new Error('INSUFFICIENT_FUNDS');

      sender.amount = sb - amount;
      receiver.amount = (Number(receiver.amount) || 0) + amount;

      await manager.save(User, [sender, receiver]);

      // nếu cần lưu memo/ledger → thêm bảng transactions và insert ở đây
    });
  }
}
